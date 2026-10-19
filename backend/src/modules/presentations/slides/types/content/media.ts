import { z } from 'zod';
import { assertValidKey, storage } from '../../../../../common/storage/storage';
import { ApiError } from '../../../../../common/utils/ApiError';
import { MediaAssetModel } from '../../../../uploads/media.model';
import { contentOf, textField } from './shared';
import type { Slide } from '../../types';

/**
 * Media references of the content slides (image, uploaded video).
 *
 * A slide points at media either by storage `key` (an upload; the server
 * pins the public URL from the key, so a client cannot pair a key with some
 * other URL) or, for images, by a pasted `https://` URL. Keys are only
 * accepted while storage is configured, and `assertContentMediaInWorkspace`
 * checks that each key is a MediaAsset of the deck's workspace.
 */

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'] as const;
export const VIDEO_EXTENSIONS = ['mp4', 'webm'] as const;

export const isHttpsUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.length > 0 && !url.username && !url.password;
  } catch {
    return false;
  }
};

/** A well-formed storage key of a file with one of `extensions`. */
export const isUploadKey = (key: string, extensions: readonly string[]) => {
  try {
    assertValidKey(key);
  } catch {
    return false;
  }
  const extension = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
  return key.includes('.') && extensions.includes(extension);
};

/** An optional storage key; `''` reads as no key. Check its shape with `isUploadKey`. */
export const optionalKeySchema = z
  .string()
  .trim()
  .max(512)
  .nullable()
  .default(null)
  .transform((key) => key || null);

/** An optional storage key of an uploaded file with one of `extensions`. */
export const storageKeySchema = (extensions: readonly string[], message: string) =>
  optionalKeySchema.refine((key) => key === null || isUploadKey(key, extensions), message);

/** An optional `https://` URL; `''` reads as no URL. */
export const httpsUrlSchema = (message: string) =>
  z
    .string()
    .trim()
    .max(2048)
    .nullable()
    .default(null)
    .transform((url) => url || null)
    .refine((url) => url === null || isHttpsUrl(url), message);

export const storageDisabledMessage = 'File uploads are not configured on this server; use a link instead';

/** Public URL of an uploaded object, or null while storage is off (the slide then shows a placeholder). */
export const publicUrlOf = (key: string | null): string | null =>
  key && storage.enabled ? storage.publicUrl(key) : null;

/**
 * The URL participants load a slide's media from. Keys are resolved against
 * the current storage base URL (so a CDN move needs no data migration); a
 * pasted URL is used as stored.
 */
export const mediaUrlOf = (slide: Slide): string | null => {
  const content = contentOf(slide);
  const key = textField(content.key) || null;
  if (key) return publicUrlOf(key) ?? (textField(content.url) || null);
  return textField(content.url) || null;
};

/** What kind of upload each slide type may reference by `content.key` (pin_on_image keeps its image there too). */
const MEDIA_KIND: Record<string, 'image' | 'video'> = { image: 'image', pin_on_image: 'image', video: 'video' };

interface MediaRef {
  slideNumber: number;
  key: string;
  kind: 'image' | 'video';
}

const mediaRefs = (slides: ReadonlyArray<{ type: string; content?: unknown }>): MediaRef[] =>
  slides.flatMap((slide, index): MediaRef[] => {
    const kind = MEDIA_KIND[slide.type];
    const content = slide.content as { key?: unknown } | null | undefined;
    if (!kind || !content || typeof content.key !== 'string' || !content.key) return [];
    return [{ slideNumber: index + 1, key: content.key, kind }];
  });

/**
 * Rejects slides whose uploaded media is not a MediaAsset of `workspaceId`
 * (or is the wrong kind of file). Call it on create/update after the request
 * schema ran, with the deck's workspace. Pasted URLs are not checked here.
 */
export async function assertContentMediaInWorkspace(
  slides: ReadonlyArray<{ type: string; content?: unknown }>,
  workspaceId: string
): Promise<void> {
  const refs = mediaRefs(slides);
  if (refs.length === 0) return;
  if (!storage.enabled) {
    throw new ApiError(400, `Slide ${refs[0]!.slideNumber}: ${storageDisabledMessage}`, 'STORAGE_DISABLED');
  }

  const assets = await MediaAssetModel.find({ workspaceId, key: { $in: refs.map((ref) => ref.key) } })
    .select('key mime')
    .lean();
  const mimeByKey = new Map(assets.map((asset) => [asset.key, asset.mime]));

  for (const ref of refs) {
    const mime = mimeByKey.get(ref.key);
    if (!mime || !mime.startsWith(`${ref.kind}/`)) {
      throw new ApiError(
        400,
        `Slide ${ref.slideNumber}: the uploaded ${ref.kind} was not found in this workspace`,
        'MEDIA_NOT_FOUND',
        { slide: ref.slideNumber }
      );
    }
  }
}
