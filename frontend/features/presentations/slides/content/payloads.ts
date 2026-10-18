import type {
  BigNumberContent,
  BulletsContent,
  HeadingContent,
  ImageContent,
  ImageFit,
  InstructionsContent,
  ParagraphContent,
  QuoteContent,
  VideoContent,
  VideoProvider,
} from "../../types/content";

// Typed readers for content slide payloads. `content` arrives from the API, a
// local draft or a live event, so every read is defensive: missing or
// malformed fields fall back to the blank value. Shared by the editors and
// the runtime views (no editor code here).

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const text = (value: unknown): string => (typeof value === "string" ? value : "");

const textOrNull = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

const bool = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);

const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** The `content` of a deck slide or of a live (participant) slide. */
export const contentOf = (slide: object): unknown => (slide as { content?: unknown }).content;

export const readHeading = (content: unknown): HeadingContent => {
  const c = record(content);
  return { title: text(c.title), subtitle: text(c.subtitle) };
};

export const readParagraph = (content: unknown): ParagraphContent => {
  const c = record(content);
  return { title: text(c.title), body: text(c.body) };
};

export const readBullets = (content: unknown): BulletsContent => {
  const c = record(content);
  return {
    title: text(c.title),
    items: Array.isArray(c.items) ? c.items.filter((item): item is string => typeof item === "string") : [],
  };
};

export const IMAGE_FITS: readonly ImageFit[] = ["contain", "cover"];

export const readImage = (content: unknown): ImageContent => {
  const c = record(content);
  return {
    key: textOrNull(c.key),
    url: textOrNull(c.url),
    alt: text(c.alt),
    fit: IMAGE_FITS.find((fit) => fit === c.fit) ?? "contain",
    caption: text(c.caption),
  };
};

export const readBigNumber = (content: unknown): BigNumberContent => {
  const c = record(content);
  return { value: finite(c.value), label: text(c.label), prefix: text(c.prefix), suffix: text(c.suffix) };
};

export const readQuote = (content: unknown): QuoteContent => {
  const c = record(content);
  return { text: text(c.text), attribution: text(c.attribution) };
};

export const VIDEO_PROVIDERS: readonly VideoProvider[] = ["youtube", "vimeo", "file"];

export const readVideo = (content: unknown): VideoContent => {
  const c = record(content);
  const start = finite(c.start);
  return {
    provider: VIDEO_PROVIDERS.find((provider) => provider === c.provider) ?? "youtube",
    id: textOrNull(c.id),
    key: textOrNull(c.key),
    url: textOrNull(c.url),
    start: start !== null && start > 0 ? Math.floor(start) : 0,
  };
};

export const readInstructions = (content: unknown): InstructionsContent => {
  const c = record(content);
  return { showQr: bool(c.showQr, true), showCode: bool(c.showCode, true), text: text(c.text) };
};

/** One-line summary of `value` for slide lists, cut at `max` characters. */
export const oneLine = (value: string, max = 80): string => {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};
