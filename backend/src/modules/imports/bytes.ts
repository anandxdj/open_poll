/**
 * Reads a response body into memory, giving up as soon as it passes `maxBytes`
 * (the declared Content-Length is only a hint; the stream is what counts).
 * Returns null when the limit was exceeded.
 */
export async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** `%PDF-` within the first kilobyte, as PDF readers accept it. */
export const looksLikePdf = (bytes: Uint8Array) =>
  Buffer.from(bytes.subarray(0, Math.min(bytes.length, 1024))).toString('latin1').includes('%PDF-');

/** A zip local-file or end-of-directory signature (`PK`): PPTX and XLSX are zips. */
export const looksLikeZip = (bytes: Uint8Array) => bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
