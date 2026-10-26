import { env } from '../../common/config/env';

/**
 * Puts a verified hostname in front of the frontend, or takes it away.
 * - vercel: attaches the domain to the frontend project (Vercel issues TLS).
 * - caddy: nothing to call; Caddy's on-demand TLS asks
 *   GET /api/public/domains/tls-ask before issuing a certificate.
 */
export interface DomainProvisioner {
  readonly name: 'vercel' | 'caddy';
  add(hostname: string): Promise<void>;
  remove(hostname: string): Promise<void>;
}

type Fetch = typeof fetch;

export function vercelProvisioner(settings: { token: string; projectId: string; teamId?: string }, fetchImpl: Fetch = fetch): DomainProvisioner {
  const team = settings.teamId ? `?teamId=${encodeURIComponent(settings.teamId)}` : '';
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetchImpl(`https://api.vercel.com${path}${team}`, {
      method,
      headers: { Authorization: `Bearer ${settings.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res;
  };
  return {
    name: 'vercel',
    async add(hostname) {
      const res = await call('POST', `/v10/projects/${encodeURIComponent(settings.projectId)}/domains`, { name: hostname });
      // 409: already attached to this project, which is what we want.
      if (!res.ok && res.status !== 409) throw new Error(`Vercel answered ${res.status} adding the domain`);
    },
    async remove(hostname) {
      const res = await call('DELETE', `/v9/projects/${encodeURIComponent(settings.projectId)}/domains/${encodeURIComponent(hostname)}`);
      if (!res.ok && res.status !== 404) throw new Error(`Vercel answered ${res.status} removing the domain`);
    },
  };
}

export const caddyProvisioner: DomainProvisioner = {
  name: 'caddy',
  async add() {},
  async remove() {},
};

let override: DomainProvisioner | null = null;
/** Tests swap the provisioner. */
export const setDomainProvisioner = (provisioner: DomainProvisioner | null) => {
  override = provisioner;
};

/** The configured provisioner; null when custom domains are off. */
export function domainProvisioner(): DomainProvisioner | null {
  if (override) return override;
  const domains = env.domains;
  if (!domains) return null;
  return domains.provisioner === 'vercel' && domains.vercel ? vercelProvisioner(domains.vercel) : caddyProvisioner;
}
