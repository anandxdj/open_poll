/**
 * A fresh idempotency key for one answer attempt (`clientAnswerId`, ≤ 64
 * chars on the server). Every send of the same attempt — a retry after a
 * timeout, a replay from an offline queue — reuses it, so the server counts
 * the answer once and answers the repeat with `replay: true`.
 *
 * Built from `crypto.getRandomValues`, which (unlike `crypto.randomUUID`) also
 * exists on plain-http pages such as a phone opening a LAN dev server.
 */
export function newClientAnswerId(): string {
  const bytes = new Uint8Array(16);
  const webCrypto = globalThis.crypto;
  if (webCrypto?.getRandomValues) webCrypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
