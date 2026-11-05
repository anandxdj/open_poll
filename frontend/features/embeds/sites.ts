/**
 * The sites a workspace lets frame its embeds (W4-D). Mirrors the backend's
 * `parseOrigin` (`backend/src/modules/embeds/origins.ts`), which has the last
 * word: an origin (`https://example.com`, a port allowed) or every subdomain
 * of a domain (`https://*.example.com`). Unit tested in `tests/unit/embeds.test.ts`.
 */
export const MAX_EMBED_SITES = 20;

/** The site in its stored form, or null when it is not one. A missing scheme means https. */
export function normalizeSite(raw: string): string | null {
  let value = raw.trim().toLowerCase().replace(/\/+$/, "");
  if (!value) return null;
  if (!/^[a-z]+:\/\//.test(value)) value = `https://${value}`;
  const match = /^(https?):\/\/(\*\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::(\d{1,5}))?$/.exec(value);
  if (!match) return null;
  const [, scheme, wildcard, host, port] = match;
  if (wildcard && !host!.includes(".")) return null;
  if (port && (Number(port) < 1 || Number(port) > 65535)) return null;
  return `${scheme}://${wildcard ?? ""}${host}${port ? `:${port}` : ""}`;
}
