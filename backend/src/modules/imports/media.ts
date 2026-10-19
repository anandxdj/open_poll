import { storage } from '../../common/storage/storage';
import { MediaAssetModel } from '../uploads/media.model';

/**
 * Pictures taken out of imported files (PPTX media, rendered PDF pages) are
 * stored as `MediaAsset`s with `source: 'import'` under
 * `uploads/<workspace>/import/<job>/<n>.<ext>`. The key is derived from the
 * job and the picture's position, so a retried job overwrites its own
 * objects instead of leaving a second copy.
 */

export interface WebImage {
  bytes: Uint8Array;
  mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/avif';
  ext: 'png' | 'jpg' | 'gif' | 'webp' | 'avif';
}

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

/** The image type of `bytes` judged by its magic number, or null when it is not one browsers show natively. */
export function sniffImage(bytes: Uint8Array): Omit<WebImage, 'bytes'> | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG') return { mime: 'image/png', ext: 'png' };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (ascii(bytes, 0, 4) === 'GIF8') return { mime: 'image/gif', ext: 'gif' };
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (ascii(bytes, 4, 4) === 'ftyp' && ['avif', 'avis'].includes(ascii(bytes, 8, 4))) {
    return { mime: 'image/avif', ext: 'avif' };
  }
  return null;
}

/** Decoded size above which a conversion is refused (decompression bombs). */
const MAX_CONVERT_PIXELS = 40_000_000;

/**
 * A picture browsers can show. Native formats pass through untouched (judged
 * by content, never by file name); BMP, TIFF-less formats and SVG that the
 * canvas can decode are re-encoded as PNG. Returns null for anything else.
 */
export async function toWebImage(bytes: Uint8Array): Promise<WebImage | null> {
  const native = sniffImage(bytes);
  if (native) return { bytes, ...native };
  try {
    const { createCanvas, loadImage } = await import('@napi-rs/canvas');
    const image = await loadImage(Buffer.from(bytes));
    const { width, height } = image;
    if (!width || !height || width * height > MAX_CONVERT_PIXELS) return null;
    const canvas = createCanvas(width, height);
    canvas.getContext('2d').drawImage(image, 0, 0);
    const png = new Uint8Array(await canvas.encode('png'));
    return { bytes: png, mime: 'image/png', ext: 'png' };
  } catch {
    return null;
  }
}

export interface MediaTarget {
  workspaceId: string;
  userId: string;
  jobId: string;
}

export interface StoredImage {
  key: string;
  url: string;
  mime: string;
  bytes: number;
}

export const importMediaKey = (target: MediaTarget, index: number, ext: string) =>
  `uploads/${target.workspaceId}/import/${target.jobId}/${index}.${ext}`;

/**
 * Writes `image` to storage and records the MediaAsset. `index` is the
 * picture's position within the job. Storage errors propagate (a retry fixes
 * transient ones); callers check `storage.enabled` first.
 */
export async function storeImportImage(target: MediaTarget, index: number, image: WebImage): Promise<StoredImage> {
  const key = importMediaKey(target, index, image.ext);
  await storage.putObject(key, image.bytes, image.mime);
  const url = storage.publicUrl(key);
  await MediaAssetModel.updateOne(
    { key },
    {
      $set: { url, mime: image.mime, bytes: image.bytes.length },
      $setOnInsert: { workspaceId: target.workspaceId, uploaderId: target.userId, source: 'import', purpose: null },
    },
    { upsert: true },
  );
  return { key, url, mime: image.mime, bytes: image.bytes.length };
}
