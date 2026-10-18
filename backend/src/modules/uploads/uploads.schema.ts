import { z } from 'zod';
import type { Action } from '../../common/tenancy/roles';

const MB = 1024 * 1024;

// SVG is excluded everywhere: it can carry script, and objects are served as-is.
const IMAGE_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
} as const;
const VIDEO_TYPES = { 'video/mp4': 'mp4', 'video/webm': 'webm' } as const;
const FONT_TYPES = { 'font/woff2': 'woff2', 'font/woff': 'woff', 'font/ttf': 'ttf', 'font/otf': 'otf' } as const;
const IMPORT_TYPES = {
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/pdf': 'pdf',
} as const;

export interface UploadPurposeRule {
  /** Allowed MIME type → file extension used in the object key. */
  types: Readonly<Record<string, string>>;
  maxBytes: number;
  /** What the uploader must be allowed to do in the workspace. */
  action: Action;
}

/** What may be uploaded, how big, and who may upload it. */
export const UPLOAD_PURPOSES = {
  slide_image: { types: IMAGE_TYPES, maxBytes: 10 * MB, action: 'deck:edit' },
  slide_video: { types: VIDEO_TYPES, maxBytes: 200 * MB, action: 'deck:edit' },
  brand_logo: { types: IMAGE_TYPES, maxBytes: 2 * MB, action: 'workspace:brand' },
  brand_background: { types: IMAGE_TYPES, maxBytes: 10 * MB, action: 'workspace:brand' },
  brand_font: { types: FONT_TYPES, maxBytes: 5 * MB, action: 'workspace:brand' },
  import_source: { types: IMPORT_TYPES, maxBytes: 100 * MB, action: 'deck:create' },
} as const satisfies Record<string, UploadPurposeRule>;
export type UploadPurpose = keyof typeof UPLOAD_PURPOSES;

const PURPOSES = Object.keys(UPLOAD_PURPOSES) as [UploadPurpose, ...UploadPurpose[]];

export const presignUploadSchema = z.object({
  purpose: z.enum(PURPOSES),
  mime: z.string().trim().toLowerCase().min(1).max(127),
  bytes: z.number().int().positive(),
});
export type PresignUploadInput = z.infer<typeof presignUploadSchema>;

export const completeUploadSchema = z.object({
  key: z.string().trim().min(1).max(512),
});
export type CompleteUploadInput = z.infer<typeof completeUploadSchema>;
