import { env } from '../../common/config/env';

/** Keeps well-formed http(s) origins only, lower-cased and without duplicates. */
export function normalizeOrigins(origins: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of origins) {
    const origin = parseOrigin(raw);
    if (origin) out.add(origin);
  }
  return [...out];
}

/**
 * `https://example.com` (or `http://` outside production), `https://*.example.com`
 * for every subdomain. Paths, queries and anything else are refused: a CSP
 * `frame-ancestors` source is an origin.
 */
export function parseOrigin(raw: string): string | null {
  const value = raw.trim().toLowerCase().replace(/\/+$/, '');
  const match = /^(https?):\/\/(\*\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::(\d{1,5}))?$/.exec(value);
  if (!match) return null;
  const [, scheme, wildcard, host, port] = match;
  if (scheme === 'http' && env.isProduction && host !== 'localhost') return null;
  if (wildcard && !host!.includes('.')) return null;
  if (port && (Number(port) < 1 || Number(port) > 65535)) return null;
  return `${scheme}://${wildcard ?? ''}${host}${port ? `:${port}` : ''}`;
}
