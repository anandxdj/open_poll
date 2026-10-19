import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ImportError } from './errors';
import { readLimited } from './bytes';

/**
 * Outbound fetches on behalf of a user (Google Slides links) are the one place
 * the import pipeline talks to a host somebody else chose. The guard:
 *
 * - https only, no credentials in the URL, port 443;
 * - the host must pass the caller's allow-list at every hop;
 * - redirects are followed by hand, at most `maxRedirects`, each hop checked;
 * - every address the host resolves to must be public (no loopback, private,
 *   link-local or metadata addresses), checked before the request is sent;
 * - the body is read with a hard size cap and the whole call has a timeout.
 */

const v4Parts = (address: string): number[] | null => {
  const parts = address.split('.').map(Number);
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? parts : null;
};

/** False for addresses that must never be reached from here. */
export function isPublicAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) {
    const [a, b, c] = v4Parts(address)!;
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b! >= 64 && b! <= 127) return false; // carrier-grade NAT
    if (a === 169 && b === 254) return false; // link-local, cloud metadata
    if (a === 172 && b! >= 16 && b! <= 31) return false;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
    if (a === 192 && b === 168) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    if (a! >= 224) return false; // multicast, reserved, broadcast
    return true;
  }
  if (kind === 6) {
    const lower = address.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicAddress(mapped[1]!);
    if (lower === '::' || lower === '::1') return false;
    if (/^f[cd]/.test(lower)) return false; // unique local fc00::/7
    if (/^fe[89ab]/.test(lower)) return false; // link-local fe80::/10
    if (lower.startsWith('ff')) return false; // multicast
    if (lower.startsWith('64:ff9b:')) return false; // NAT64
    return true;
  }
  return false;
}

export type HostResolver = (hostname: string) => Promise<string[]>;

export const resolveHost: HostResolver = async (hostname) =>
  (await lookup(hostname, { all: true })).map((entry) => entry.address);

export interface GuardedFetchOptions {
  /** True for the hosts a request (and each redirect) may go to. */
  allowHost: (hostname: string) => boolean;
  fetchImpl?: typeof fetch;
  resolve?: HostResolver;
  maxRedirects?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
  /** Builds the error for a redirect or a host outside the allow-list. */
  onForbidden?: (url: URL) => ImportError;
}

const defaultForbidden = (url: URL) =>
  new ImportError('LINK_NOT_ALLOWED', `Links to ${url.hostname} cannot be imported.`);

async function assertSafeTarget(url: URL, options: GuardedFetchOptions) {
  const forbidden = options.onForbidden ?? defaultForbidden;
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw forbidden(url);
  }
  const hostname = url.hostname.toLowerCase();
  if (!options.allowHost(hostname)) throw forbidden(url);
  if (isIP(hostname)) throw forbidden(url);
  let addresses: string[];
  try {
    addresses = await (options.resolve ?? resolveHost)(hostname);
  } catch {
    throw new ImportError('LINK_UNREACHABLE', `${hostname} could not be reached.`);
  }
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) throw forbidden(url);
}

/**
 * GET `start` through the guard. Resolves with the final response (not a
 * redirect); the caller reads its body (see `readLimited`).
 */
export async function guardedGet(start: URL, options: GuardedFetchOptions): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxRedirects = options.maxRedirects ?? 3;
  const signal = AbortSignal.timeout(options.timeoutMs ?? 60_000);
  let url = start;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertSafeTarget(url, options);
    let response: Response;
    try {
      response = await fetchImpl(url, { method: 'GET', redirect: 'manual', signal, headers: options.headers });
    } catch (error) {
      if (error instanceof ImportError) throw error;
      throw new ImportError('LINK_UNREACHABLE', `${url.hostname} could not be reached, or took too long to answer.`);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => {});
      if (!location) throw new ImportError('LINK_UNREACHABLE', `${url.hostname} sent an invalid redirect.`);
      try {
        url = new URL(location, url);
      } catch {
        throw new ImportError('LINK_UNREACHABLE', `${url.hostname} sent an invalid redirect.`);
      }
      continue;
    }
    return response;
  }
  throw new ImportError('LINK_UNREACHABLE', 'The link redirected too many times.');
}

export { readLimited };
