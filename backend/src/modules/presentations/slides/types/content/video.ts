import { z } from 'zod';
import { defineSlideType, registerSlideType } from '../../registry';
import {
  VIDEO_EXTENSIONS,
  isUploadKey,
  mediaUrlOf,
  optionalKeySchema,
  publicUrlOf,
  storageDisabledMessage,
} from './media';
import { contentOf, contentSlideSchema, numberField, textField } from './shared';

export const VIDEO_PROVIDERS = ['youtube', 'vimeo', 'file'] as const;
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];

/** Exactly what the embed URLs accept; anything else could inject into the player URL. */
export const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
export const VIMEO_ID_RE = /^[1-9][0-9]{5,11}$/;

/** Longest start offset, in seconds (24h). */
export const MAX_VIDEO_START = 86_400;

const PROVIDER_NAMES: Record<VideoProvider, string> = { youtube: 'YouTube', vimeo: 'Vimeo', file: 'Uploaded' };

const content = z
  .object({
    provider: z.enum(VIDEO_PROVIDERS),
    /** YouTube / Vimeo video id (not a URL). */
    id: z
      .string()
      .trim()
      .max(32)
      .nullable()
      .default(null)
      .transform((id) => id || null),
    /** Storage key of an uploaded mp4/webm (`provider: 'file'`; ignored otherwise). */
    key: optionalKeySchema,
    /** Seconds into the video to start at. */
    start: z.number().int().min(0).max(MAX_VIDEO_START).default(0),
  })
  .superRefine((video, ctx) => {
    if (video.provider === 'youtube' && video.id !== null && !YOUTUBE_ID_RE.test(video.id)) {
      ctx.addIssue({ code: 'custom', path: ['id'], message: 'Not a YouTube video id (11 letters, digits, - or _)' });
    }
    if (video.provider === 'vimeo' && video.id !== null && !VIMEO_ID_RE.test(video.id)) {
      ctx.addIssue({ code: 'custom', path: ['id'], message: 'Not a Vimeo video id (digits only)' });
    }
    if (video.provider === 'file' && video.key) {
      if (!isUploadKey(video.key, VIDEO_EXTENSIONS)) {
        ctx.addIssue({ code: 'custom', path: ['key'], message: 'Not an uploaded video' });
      } else if (!publicUrlOf(video.key)) {
        ctx.addIssue({ code: 'custom', path: ['key'], message: storageDisabledMessage });
      }
    }
  })
  // Keep only the fields of the chosen provider. Uploads are served from
  // storage, so their URL follows the key. A missing id/key is a placeholder.
  .transform((video) =>
    video.provider === 'file'
      ? { provider: video.provider, id: null, key: video.key, url: publicUrlOf(video.key), start: video.start }
      : { provider: video.provider, id: video.id, key: null, url: null, start: video.start }
  );

/** An embedded YouTube/Vimeo video, or an uploaded file when storage is configured. */
export const videoSlide = defineSlideType<never, never>({
  type: 'video',
  name: 'Video',
  kind: 'content',
  lifecycle: 'content',
  scored: false,
  schema: contentSlideSchema('video', content),
  // Ids are re-checked on the way out, so a malformed stored id can never
  // reach a player URL; the storage key itself never leaves the server.
  sanitize: (slide) => {
    const c = contentOf(slide);
    const provider = VIDEO_PROVIDERS.find((p) => p === c.provider) ?? 'youtube';
    const id = textField(c.id);
    const validId =
      (provider === 'youtube' && YOUTUBE_ID_RE.test(id)) || (provider === 'vimeo' && VIMEO_ID_RE.test(id));
    return {
      content: {
        provider,
        id: validId ? id : null,
        url: provider === 'file' ? mediaUrlOf(slide) : null,
        start: Math.min(Math.max(Math.floor(numberField(c.start, 0)), 0), MAX_VIDEO_START),
      },
    };
  },
  label: (slide) => {
    const provider = VIDEO_PROVIDERS.find((p) => p === contentOf(slide).provider);
    return provider ? `${PROVIDER_NAMES[provider]} video` : 'Video';
  },
});

registerSlideType(videoSlide);
