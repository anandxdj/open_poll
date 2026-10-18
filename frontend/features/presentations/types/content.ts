// Payloads of the content slide types (`slide.content`), as the CRUD API
// stores them. Participants get the same shapes without the storage `key`
// (the server resolves `url` from it). Contract:
// backend/docs/wiki/modules/presentations.md, "Content slide types".

/** Shown on the stage, no answers, never scored. */
export const CONTENT_SLIDE_TYPES = [
  "heading",
  "paragraph",
  "bullets",
  "image",
  "big_number",
  "quote",
  "video",
  "instructions",
] as const;

export type ContentSlideType = (typeof CONTENT_SLIDE_TYPES)[number];

export const isContentSlideType = (type: string): type is ContentSlideType =>
  (CONTENT_SLIDE_TYPES as readonly string[]).includes(type);

export interface HeadingContent {
  title: string;
  subtitle: string;
}

/** `body` is markdown-lite: `**bold**`, `*italic*` / `_italic_`, `[text](https://…)`. */
export interface ParagraphContent {
  title: string;
  body: string;
}

export interface BulletsContent {
  title: string;
  items: string[];
}

export type ImageFit = "contain" | "cover";

/** `key` for an upload (the server pins `url` to it), else a pasted https `url`. Neither = placeholder. */
export interface ImageContent {
  key: string | null;
  url: string | null;
  alt: string;
  fit: ImageFit;
  caption: string;
}

/** `value` is null only while an author has not entered it yet. */
export interface BigNumberContent {
  value: number | null;
  label: string;
  prefix: string;
  suffix: string;
}

export interface QuoteContent {
  text: string;
  attribution: string;
}

export type VideoProvider = "youtube" | "vimeo" | "file";

/** `id` for YouTube/Vimeo; `key` (+ server-resolved `url`) for an uploaded file. `start` in seconds. */
export interface VideoContent {
  provider: VideoProvider;
  id: string | null;
  key: string | null;
  url: string | null;
  start: number;
}

export interface InstructionsContent {
  showQr: boolean;
  showCode: boolean;
  text: string;
}

export type SlideContent =
  | HeadingContent
  | ParagraphContent
  | BulletsContent
  | ImageContent
  | BigNumberContent
  | QuoteContent
  | VideoContent
  | InstructionsContent;
