import { randomBytes } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { Types } from 'mongoose';
import { audit } from '../../common/audit/audit';
import { env } from '../../common/config/env';
import { redisClient } from '../../common/config/redis';
import { assertFeature, getEntitlements } from '../../common/plans/entitlements';
import { assertCan } from '../../common/tenancy/policy';
import type { WorkspaceRequest } from '../../common/tenancy/workspaceContext.middleware';
import { ApiError } from '../../common/utils/ApiError';
import { hasVerificationRecord, normalizeDomain, verificationHost, verificationValue, type TxtResolver } from '../../common/utils/dnsVerify';
import { resolveTheme, type ThemeTokens } from '../themes/resolve';
import { WorkspaceModel } from '../workspaces/workspace.model';
import { CustomDomainModel, MAX_CUSTOM_DOMAINS, type ICustomDomain } from './customDomain.model';
import { domainProvisioner } from './provisioners';

/** Redis set of hostnames that serve participant pages (CORS reads it on every cross-origin request). */
export const ACTIVE_DOMAINS_KEY = 'domains:active';

export const DOMAIN_ERROR_CODES = {
  disabled: 'DOMAINS_DISABLED',
  invalid: 'DOMAIN_INVALID',
  reserved: 'DOMAIN_RESERVED',
  taken: 'DOMAIN_TAKEN',
  limit: 'DOMAIN_LIMIT',
  notFound: 'DOMAIN_NOT_FOUND',
  notReady: 'DOMAIN_NOT_READY',
} as const;

type Ctx = WorkspaceRequest & { user: NonNullable<WorkspaceRequest['user']> };

export interface DomainDns {
  txt: TxtResolver;
  cname: (hostname: string) => Promise<string[]>;
}
const systemDns: DomainDns = { txt: (h) => dns.resolveTxt(h), cname: (h) => dns.resolveCname(h) };
let lookup: DomainDns = systemDns;
/** Tests swap DNS. */
export const setDomainDns = (next: DomainDns | null) => {
  lookup = next ?? systemDns;
};

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
};

/** Our own hosts can never be claimed. */
const reservedHosts = () =>
  new Set([hostOf(env.FRONTEND_URL), hostOf(env.apiPublicUrl), env.domains?.cnameTarget ?? '', 'localhost'].filter(Boolean));

export function assertDomainsAdmin(ctx: Ctx) {
  if (!env.capabilities.customDomains || !env.domains) {
    throw new ApiError(503, 'Custom domains are not enabled on this server', DOMAIN_ERROR_CODES.disabled);
  }
  assertCan(ctx, 'workspace:domains');
  assertFeature(ctx.workspace!, 'custom_domains');
}

export interface DomainView {
  id: string;
  hostname: string;
  status: ICustomDomain['status'];
  /** The DNS records to create, and whether the last check found each. */
  records: { type: 'TXT' | 'CNAME'; host: string; value: string; found: boolean }[];
  checkedAt: string | null;
  error: string | null;
  activatedAt: string | null;
  url: string;
}

export const toDomainView = (domain: ICustomDomain): DomainView => ({
  id: String(domain._id),
  hostname: domain.hostname,
  status: domain.status,
  records: [
    { type: 'CNAME', host: domain.hostname, value: env.domains?.cnameTarget ?? '', found: domain.checks.cname },
    { type: 'TXT', host: verificationHost(domain.hostname), value: verificationValue(domain.verificationToken), found: domain.checks.txt },
  ],
  checkedAt: domain.checks.checkedAt ? domain.checks.checkedAt.toISOString() : null,
  error: domain.checks.error,
  activatedAt: domain.activatedAt ? domain.activatedAt.toISOString() : null,
  url: `https://${domain.hostname}`,
});

const notFound = () => new ApiError(404, 'Domain not found', DOMAIN_ERROR_CODES.notFound);

async function findDomain(ctx: Ctx, id: string) {
  if (!Types.ObjectId.isValid(id)) throw notFound();
  const domain = await CustomDomainModel.findOne({ _id: id, workspaceId: ctx.workspace!._id });
  if (!domain) throw notFound();
  return domain;
}

async function cnamePointsHere(hostname: string): Promise<boolean> {
  const target = env.domains?.cnameTarget;
  if (!target) return false;
  try {
    const records = await lookup.cname(hostname);
    return records.some((record) => record.toLowerCase().replace(/\.$/, '') === target);
  } catch {
    return false;
  }
}

const markActive = (hostname: string) => redisClient.sAdd(ACTIVE_DOMAINS_KEY, hostname).catch(() => 0);
const markInactive = (hostname: string) => redisClient.sRem(ACTIVE_DOMAINS_KEY, hostname).catch(() => 0);

export class DomainsService {
  static async list(ctx: Ctx) {
    assertDomainsAdmin(ctx);
    const domains = await CustomDomainModel.find({ workspaceId: ctx.workspace!._id }).sort({ createdAt: 1 });
    return { cnameTarget: env.domains!.cnameTarget, domains: domains.map(toDomainView) };
  }

  static async add(ctx: Ctx, input: string) {
    assertDomainsAdmin(ctx);
    const hostname = normalizeDomain(input);
    if (!hostname) throw new ApiError(400, 'Enter a hostname like polls.example.com', DOMAIN_ERROR_CODES.invalid);
    const reserved = reservedHosts();
    if ([...reserved].some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
      throw new ApiError(400, 'That hostname belongs to this server', DOMAIN_ERROR_CODES.reserved);
    }
    const workspaceId = ctx.workspace!._id;
    if ((await CustomDomainModel.countDocuments({ workspaceId })) >= MAX_CUSTOM_DOMAINS) {
      throw new ApiError(409, `A workspace keeps up to ${MAX_CUSTOM_DOMAINS} domains`, DOMAIN_ERROR_CODES.limit);
    }
    try {
      const domain = await CustomDomainModel.create({
        workspaceId,
        hostname,
        verificationToken: randomBytes(16).toString('hex'),
        provisioner: env.domains!.provisioner,
        createdBy: ctx.user.id,
      });
      void audit(ctx, 'domain.create', { type: 'domain', id: domain._id }, { hostname });
      return toDomainView(domain);
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ApiError(409, 'That hostname is already in use', DOMAIN_ERROR_CODES.taken);
      }
      throw error;
    }
  }

  /** Checks the TXT and CNAME records; when both are there, hands the hostname to the provisioner and serves it. */
  static async verify(ctx: Ctx, id: string) {
    assertDomainsAdmin(ctx);
    const domain = await findDomain(ctx, id);
    const [txt, cname] = await Promise.all([
      hasVerificationRecord(domain.hostname, domain.verificationToken, lookup.txt),
      cnamePointsHere(domain.hostname),
    ]);
    domain.checks = { txt, cname, checkedAt: new Date(), error: null };
    if (txt && cname && domain.status !== 'active') {
      const provisioner = domainProvisioner();
      try {
        await provisioner?.add(domain.hostname);
        domain.status = 'active';
        domain.activatedAt = new Date();
        await markActive(domain.hostname);
        void audit(ctx, 'domain.verify', { type: 'domain', id: domain._id }, { hostname: domain.hostname });
      } catch (error) {
        domain.status = 'failed';
        domain.checks.error = (error as Error).message;
      }
    } else if (!txt || !cname) {
      domain.checks.error = !txt ? `No TXT record at ${verificationHost(domain.hostname)} yet` : `${domain.hostname} does not point at ${env.domains!.cnameTarget} yet`;
    }
    await domain.save();
    return toDomainView(domain);
  }

  static async remove(ctx: Ctx, id: string) {
    assertDomainsAdmin(ctx);
    const domain = await findDomain(ctx, id);
    await markInactive(domain.hostname);
    await domainProvisioner()?.remove(domain.hostname).catch((error: Error) => console.error('[Domains] Provisioner remove failed:', error.message));
    await domain.deleteOne();
    void audit(ctx, 'domain.delete', { type: 'domain', id: domain._id }, { hostname: domain.hostname });
    return { id: String(domain._id), deleted: true as const };
  }
}

export interface ResolvedDomain {
  hostname: string;
  workspace: { id: string; name: string };
  /** The plan removes "Made with Open Poll" from its pages. */
  whiteLabel: boolean;
  /** The workspace's default theme (its brand kit's logo and colours on the join page); null for the built-in look. */
  theme: ThemeTokens | null;
}

/** What a custom hostname serves; null when it is not an active domain. */
export async function resolveDomain(host: string): Promise<ResolvedDomain | null> {
  const hostname = normalizeDomain(host.split(':')[0] ?? '');
  if (!hostname || !env.capabilities.customDomains) return null;
  const domain = await CustomDomainModel.findOne({ hostname, status: 'active' }).lean();
  if (!domain) return null;
  const workspace = await WorkspaceModel.findOne({ _id: domain.workspaceId, deletedAt: null }).lean();
  if (!workspace) return null;
  const entitlements = getEntitlements(workspace);
  if (!entitlements.features.custom_domains) return null;
  const defaultTheme = workspace.settings?.defaultTheme as { presetId?: string; brandKitId?: string | null } | null;
  const theme = defaultTheme
    ? await resolveTheme(defaultTheme, { workspaceId: workspace._id, brandKits: entitlements.features.brand_kits })
    : null;
  return {
    hostname,
    workspace: { id: String(workspace._id), name: workspace.name },
    whiteLabel: entitlements.features.white_label,
    theme: theme?.custom ? theme : null,
  };
}

/**
 * Whether a browser origin is one of the active custom domains (CORS).
 * Redis first; a cold cache falls back to Mongo and warms the set.
 */
export async function isActiveDomainOrigin(origin: string): Promise<boolean> {
  if (!env.capabilities.customDomains) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && env.isProduction) return false;
  const hostname = url.hostname.toLowerCase();
  const cached = await redisClient.sIsMember(ACTIVE_DOMAINS_KEY, hostname).catch(() => null);
  if (cached) return true;
  const active = await CustomDomainModel.exists({ hostname, status: 'active' });
  if (active) await markActive(hostname);
  return Boolean(active);
}
