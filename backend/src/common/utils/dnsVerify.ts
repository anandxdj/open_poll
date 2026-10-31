import { promises as dns } from 'node:dns';

/**
 * Domain ownership by DNS TXT record: the owner adds `openpoll-verify=<token>`
 * at `_openpoll.<domain>`. Used for SSO domains (W3-D) and custom domains (W4-E).
 */

export type TxtResolver = (hostname: string) => Promise<string[][]>;

export const VERIFY_PREFIX = 'openpoll-verify=';

/** Where the record goes. */
export const verificationHost = (domain: string) => `_openpoll.${domain}`;

/** The record's value. */
export const verificationValue = (token: string) => `${VERIFY_PREFIX}${token}`;

/** Lower-case hostname, no trailing dot; null when it is not a plausible public domain. */
export function normalizeDomain(input: string): string | null {
  const domain = input.trim().toLowerCase().replace(/\.$/, '');
  if (domain.length > 253) return null;
  if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) return null;
  return domain;
}

/**
 * True when `_openpoll.<domain>` has a TXT record equal to the token's value.
 * Lookup failures (NXDOMAIN, timeouts) count as "not yet"; never throws.
 */
export async function hasVerificationRecord(
  domain: string,
  token: string,
  resolve: TxtResolver = (hostname) => dns.resolveTxt(hostname),
): Promise<boolean> {
  try {
    const records = await resolve(verificationHost(domain));
    const expected = verificationValue(token);
    return records.some((chunks) => chunks.join('').trim() === expected);
  } catch {
    return false;
  }
}
