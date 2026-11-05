import { randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import { audit } from '../../common/audit/audit';
import { redisClient } from '../../common/config/redis';
import { env } from '../../common/config/env';
import { assertFeature } from '../../common/plans/entitlements';
import { assertCan } from '../../common/tenancy/policy';
import type { WorkspaceRequest } from '../../common/tenancy/workspaceContext.middleware';
import { ApiError } from '../../common/utils/ApiError';
import { encryptSecret } from '../../common/utils/crypto';
import { hasVerificationRecord, normalizeDomain, verificationHost, verificationValue, type TxtResolver } from '../../common/utils/dnsVerify';
import { WorkspaceModel } from '../workspaces/workspace.model';
import { oidcSecretContext } from './oidc';
import { parseIdpMetadata } from './saml';
import type { CreateConnectionInput, UpdateConnectionInput } from './sso.schema';
import { ssoUrls } from './sso.urls';
import { MAX_SSO_CONNECTIONS, SsoConnectionModel, type ISsoConnection } from './ssoConnection.model';

export const SSO_ERROR_CODES = {
  disabled: 'SSO_DISABLED',
  teamOnly: 'TEAM_WORKSPACE_ONLY',
  notFound: 'SSO_CONNECTION_NOT_FOUND',
  notReady: 'SSO_NOT_READY',
  limit: 'SSO_CONNECTION_LIMIT',
  badMetadata: 'SSO_BAD_METADATA',
  badDomain: 'SSO_BAD_DOMAIN',
  domainTaken: 'SSO_DOMAIN_TAKEN',
  notVerified: 'SSO_DOMAIN_NOT_VERIFIED',
} as const;

/** How long an admin's test sign-in link stays valid. */
const TEST_TTL_SEC = 10 * 60;

type Ctx = WorkspaceRequest & { user: NonNullable<WorkspaceRequest['user']> };

/** DNS lookups; tests swap them. */
let resolveTxt: TxtResolver | undefined;
export const setSsoTxtResolver = (resolver: TxtResolver | undefined) => {
  resolveTxt = resolver;
};

/**
 * The gates every admin route passes: the server has SSO (ENCRYPTION_KEY),
 * the workspace is a team one, the member may manage SSO and the plan has it.
 */
export function assertSsoAdmin(ctx: Ctx) {
  if (!env.capabilities.samlSso) throw new ApiError(503, 'Single sign-on is not enabled on this server', SSO_ERROR_CODES.disabled);
  if (ctx.workspace!.type !== 'team') throw new ApiError(403, 'Only team workspaces have single sign-on', SSO_ERROR_CODES.teamOnly);
  assertCan(ctx, 'workspace:sso');
  assertFeature(ctx.workspace!, 'sso');
}

export interface ConnectionView {
  id: string;
  name: string;
  type: ISsoConnection['type'];
  enabled: boolean;
  domains: { domain: string; verified: boolean; verifiedAt: string | null; record: { host: string; value: string } }[];
  saml: (Omit<NonNullable<ISsoConnection['saml']>, 'idpCerts'> & { certificates: number }) | null;
  oidc: { issuer: string; clientId: string; clientSecretSet: boolean } | null;
  jit: boolean;
  defaultRole: ISsoConnection['defaultRole'];
  groupRoles: ISsoConnection['groupRoles'];
  lastTest: { at: string; email: string; name: string; groups: string[] } | null;
  lastLoginAt: string | null;
  /** What to enter in the identity provider. */
  serviceProvider: { entityId: string; acsUrl: string; metadataUrl: string; oidcRedirectUri: string; loginUrl: string };
  /** What still stops it from being turned on. */
  missing: string[];
}

const missingFor = (connection: ISsoConnection): string[] => {
  const missing: string[] = [];
  if (connection.type === 'saml' && (!connection.saml || connection.saml.idpCerts.length === 0)) missing.push('identity provider details');
  if (connection.type === 'oidc' && !connection.oidc) missing.push('identity provider details');
  if (!connection.domains.some((d) => d.verifiedAt)) missing.push('a verified domain');
  return missing;
};

export const toConnectionView = (connection: ISsoConnection): ConnectionView => {
  const urls = ssoUrls(String(connection._id));
  return {
    id: String(connection._id),
    name: connection.name,
    type: connection.type,
    enabled: connection.enabled,
    domains: connection.domains.map((d) => ({
      domain: d.domain,
      verified: Boolean(d.verifiedAt),
      verifiedAt: d.verifiedAt ? d.verifiedAt.toISOString() : null,
      record: { host: verificationHost(d.domain), value: verificationValue(d.token) },
    })),
    saml: connection.saml
      ? {
          idpEntityId: connection.saml.idpEntityId,
          idpSsoUrl: connection.saml.idpSsoUrl,
          wantAssertionsSigned: connection.saml.wantAssertionsSigned,
          attributeMapping: connection.saml.attributeMapping,
          certificates: connection.saml.idpCerts.length,
        }
      : null,
    oidc: connection.oidc ? { issuer: connection.oidc.issuer, clientId: connection.oidc.clientId, clientSecretSet: true } : null,
    jit: connection.jit,
    defaultRole: connection.defaultRole,
    groupRoles: connection.groupRoles.map((g) => ({ group: g.group, role: g.role })),
    lastTest: connection.lastTest?.at
      ? { at: connection.lastTest.at.toISOString(), email: connection.lastTest.email, name: connection.lastTest.name, groups: connection.lastTest.groups }
      : null,
    lastLoginAt: connection.lastLoginAt ? connection.lastLoginAt.toISOString() : null,
    serviceProvider: { entityId: urls.spEntityId, acsUrl: urls.acsUrl, metadataUrl: urls.metadataUrl, oidcRedirectUri: urls.oidcRedirectUri, loginUrl: urls.loginUrl },
    missing: missingFor(connection),
  };
};

const notFound = () => new ApiError(404, 'Single sign-on connection not found', SSO_ERROR_CODES.notFound);

async function findConnection(ctx: Ctx, id: string) {
  if (!Types.ObjectId.isValid(id)) throw notFound();
  const connection = await SsoConnectionModel.findOne({ _id: id, workspaceId: ctx.workspace!._id });
  if (!connection) throw notFound();
  return connection;
}

const samlFrom = (input: Partial<NonNullable<CreateConnectionInput['saml']>>, current?: ISsoConnection['saml']) => {
  const idpEntityId = input.idpEntityId ?? current?.idpEntityId;
  const idpSsoUrl = input.idpSsoUrl ?? current?.idpSsoUrl;
  const idpCerts = input.idpCerts ?? current?.idpCerts;
  if (!idpEntityId || !idpSsoUrl || !idpCerts?.length) {
    throw ApiError.badRequest('Add the IdP entity ID, sign-in URL and signing certificate');
  }
  return {
    idpEntityId,
    idpSsoUrl,
    idpCerts,
    wantAssertionsSigned: true,
    attributeMapping: {
      email: input.attributeMapping?.email ?? current?.attributeMapping.email ?? 'email',
      name: input.attributeMapping?.name ?? current?.attributeMapping.name ?? 'displayName',
      groups: input.attributeMapping?.groups ?? current?.attributeMapping.groups ?? 'groups',
    },
  };
};

/** Turning the last enabled connection off also turns "require single sign-on" off, so nobody is locked out. */
async function releaseRequireSso(workspaceId: Types.ObjectId) {
  const stillOn = await SsoConnectionModel.exists({ workspaceId, enabled: true });
  if (!stillOn) await WorkspaceModel.updateOne({ _id: workspaceId }, { $set: { 'settings.requireSso': false } });
}

export class SsoAdminService {
  static async list(ctx: Ctx) {
    assertSsoAdmin(ctx);
    const connections = await SsoConnectionModel.find({ workspaceId: ctx.workspace!._id }).sort({ createdAt: 1 });
    return { connections: connections.map(toConnectionView), requireSso: Boolean(ctx.workspace!.settings?.requireSso) };
  }

  static async create(ctx: Ctx, input: CreateConnectionInput) {
    assertSsoAdmin(ctx);
    const workspaceId = ctx.workspace!._id;
    if ((await SsoConnectionModel.countDocuments({ workspaceId })) >= MAX_SSO_CONNECTIONS) {
      throw new ApiError(409, `A workspace keeps up to ${MAX_SSO_CONNECTIONS} connections`, SSO_ERROR_CODES.limit);
    }
    const connection = new SsoConnectionModel({
      workspaceId,
      name: input.name,
      type: input.type,
      jit: input.jit ?? true,
      defaultRole: input.defaultRole ?? 'editor',
      groupRoles: input.groupRoles ?? [],
      createdBy: ctx.user.id,
    });
    if (input.type === 'saml' && input.saml) connection.saml = samlFrom(input.saml);
    if (input.type === 'oidc' && input.oidc) {
      connection.oidc = {
        issuer: input.oidc.issuer,
        clientId: input.oidc.clientId,
        clientSecretEnc: encryptSecret(input.oidc.clientSecret!, oidcSecretContext(String(connection._id))),
      };
    }
    await connection.save();
    void audit(ctx, 'sso.connection_create', { type: 'sso_connection', id: connection._id }, { name: connection.name, type: connection.type });
    return toConnectionView(connection);
  }

  static async update(ctx: Ctx, id: string, input: UpdateConnectionInput) {
    assertSsoAdmin(ctx);
    const connection = await findConnection(ctx, id);
    if (input.saml && connection.type !== 'saml') throw ApiError.badRequest('This is not a SAML connection');
    if (input.oidc && connection.type !== 'oidc') throw ApiError.badRequest('This is not an OIDC connection');
    if (input.name !== undefined) connection.name = input.name;
    if (input.jit !== undefined) connection.jit = input.jit;
    if (input.defaultRole !== undefined) connection.defaultRole = input.defaultRole;
    if (input.groupRoles !== undefined) connection.groupRoles = input.groupRoles;
    if (input.saml) {
      connection.saml = samlFrom(input.saml, connection.saml);
      // New IdP details need a new test; renaming attributes does not.
      if (input.saml.idpEntityId || input.saml.idpSsoUrl || input.saml.idpCerts) connection.lastTest = null;
    }
    if (input.oidc) {
      const secret = input.oidc.clientSecret;
      if (!secret && !connection.oidc) throw ApiError.badRequest('Add the client secret');
      connection.oidc = {
        issuer: input.oidc.issuer,
        clientId: input.oidc.clientId,
        clientSecretEnc: secret ? encryptSecret(secret, oidcSecretContext(String(connection._id))) : connection.oidc!.clientSecretEnc,
      };
      connection.lastTest = null;
    }
    if (input.enabled === true && !connection.enabled) {
      const missing = missingFor(connection);
      if (missing.length) {
        throw new ApiError(400, `Add ${missing.join(' and ')} before turning it on`, SSO_ERROR_CODES.notReady, { missing });
      }
    }
    if (input.enabled !== undefined) connection.enabled = input.enabled;
    await connection.save();
    if (input.enabled === false) await releaseRequireSso(connection.workspaceId);
    void audit(ctx, 'sso.connection_update', { type: 'sso_connection', id: connection._id }, {
      name: connection.name,
      fields: Object.keys(input),
    });
    return toConnectionView(connection);
  }

  static async remove(ctx: Ctx, id: string) {
    assertSsoAdmin(ctx);
    const connection = await findConnection(ctx, id);
    await connection.deleteOne();
    await releaseRequireSso(connection.workspaceId);
    void audit(ctx, 'sso.connection_delete', { type: 'sso_connection', id: connection._id }, { name: connection.name });
    return { id: String(connection._id), deleted: true as const };
  }

  static async importMetadata(ctx: Ctx, id: string, xml: string) {
    assertSsoAdmin(ctx);
    const connection = await findConnection(ctx, id);
    if (connection.type !== 'saml') throw ApiError.badRequest('This is not a SAML connection');
    let parsed;
    try {
      parsed = parseIdpMetadata(xml);
    } catch (error) {
      throw new ApiError(400, (error as Error).message, SSO_ERROR_CODES.badMetadata);
    }
    connection.saml = samlFrom({ ...parsed, attributeMapping: connection.saml?.attributeMapping }, connection.saml);
    connection.lastTest = null;
    await connection.save();
    void audit(ctx, 'sso.connection_update', { type: 'sso_connection', id: connection._id }, { fields: ['metadata'] });
    return toConnectionView(connection);
  }

  static async addDomain(ctx: Ctx, id: string, input: string) {
    assertSsoAdmin(ctx);
    const connection = await findConnection(ctx, id);
    const domain = normalizeDomain(input);
    if (!domain) throw new ApiError(400, 'Enter a domain like example.com', SSO_ERROR_CODES.badDomain);
    if (!connection.domains.some((d) => d.domain === domain)) {
      if (connection.domains.length >= 20) throw ApiError.badRequest('A connection keeps up to 20 domains');
      connection.domains.push({ domain, token: randomBytes(16).toString('hex'), verifiedAt: null });
      await connection.save();
    }
    return toConnectionView(connection);
  }

  static async verifyDomain(ctx: Ctx, id: string, input: string) {
    assertSsoAdmin(ctx);
    const connection = await findConnection(ctx, id);
    const entry = connection.domains.find((d) => d.domain === normalizeDomain(input));
    if (!entry) throw ApiError.notFound('Domain not found');
    if (!entry.verifiedAt) {
      const taken = await SsoConnectionModel.exists({
        _id: { $ne: connection._id },
        domains: { $elemMatch: { domain: entry.domain, verifiedAt: { $ne: null } } },
      });
      if (taken) throw new ApiError(409, 'Another workspace already verified this domain', SSO_ERROR_CODES.domainTaken);
      if (!(await hasVerificationRecord(entry.domain, entry.token, resolveTxt))) {
        throw new ApiError(400, `The TXT record at ${verificationHost(entry.domain)} was not found yet`, SSO_ERROR_CODES.notVerified, {
          record: { host: verificationHost(entry.domain), value: verificationValue(entry.token) },
        });
      }
      entry.verifiedAt = new Date();
      await connection.save();
      void audit(ctx, 'sso.domain_verify', { type: 'sso_connection', id: connection._id }, { domain: entry.domain });
    }
    return toConnectionView(connection);
  }

  static async removeDomain(ctx: Ctx, id: string, input: string) {
    assertSsoAdmin(ctx);
    const connection = await findConnection(ctx, id);
    const domain = normalizeDomain(input);
    connection.domains.pull({ domain });
    if (connection.enabled && !connection.domains.some((d) => d.verifiedAt)) connection.enabled = false;
    await connection.save();
    await releaseRequireSso(connection.workspaceId);
    return toConnectionView(connection);
  }

  /** A one-time link that runs the sign-in without touching any account; the result lands on the connection. */
  static async startTest(ctx: Ctx, id: string) {
    assertSsoAdmin(ctx);
    const connection = await findConnection(ctx, id);
    if (connection.type === 'saml' ? !connection.saml : !connection.oidc) {
      throw new ApiError(400, 'Add the identity provider details first', SSO_ERROR_CODES.notReady);
    }
    const token = randomBytes(24).toString('base64url');
    await redisClient.set(`sso:test:${token}`, String(connection._id), { EX: TEST_TTL_SEC });
    return { url: `${ssoUrls(String(connection._id)).loginUrl}?test=${token}` };
  }
}
