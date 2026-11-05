/**
 * Embed URLs and snippets (W4-D), shared by the builder's Embed dialog, the
 * sessions Share dialog and the embed pages. Pure, unit tested in
 * `tests/unit/embeds.test.ts`. The backend builds the same iframe for oEmbed
 * (`backend/src/modules/embeds/policy.service.ts`).
 */

export type EmbedKind = "live" | "results" | "stage";

/** postMessage an embed page sends its parent whenever its content height changes. */
export const EMBED_RESIZE_MESSAGE = "openpoll:embed:resize";

export interface EmbedResizeMessage {
  type: typeof EMBED_RESIZE_MESSAGE;
  kind: EmbedKind;
  /** CSS pixels of content. */
  height: number;
}

export const isEmbedResizeMessage = (data: unknown): data is EmbedResizeMessage =>
  typeof data === "object" &&
  data !== null &&
  (data as { type?: unknown }).type === EMBED_RESIZE_MESSAGE &&
  typeof (data as { height?: unknown }).height === "number";

/** Default iframe size per kind; the live and results pages then report their real height. */
export const EMBED_SIZES: Record<EmbedKind, { width: number; height: number }> = {
  live: { width: 420, height: 640 },
  results: { width: 800, height: 900 },
  stage: { width: 960, height: 540 },
};

export const liveEmbedUrl = (origin: string, joinCode: string) => `${origin}/embed/live/${encodeURIComponent(joinCode)}`;

export const resultsEmbedUrl = (origin: string, token: string) => `${origin}/embed/results/${encodeURIComponent(token)}`;

export const stageEmbedUrl = (origin: string, presentationId: string, screenToken: string) =>
  `${origin}/embed/stage/${encodeURIComponent(presentationId)}?token=${encodeURIComponent(screenToken)}`;

/** `GET /api/oembed` for a page URL (what a CMS asks for when someone pastes the link). */
export const oembedUrl = (apiOrigin: string, pageUrl: string) =>
  `${apiOrigin}/api/oembed?url=${encodeURIComponent(pageUrl)}&format=json`;

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;");

/** The iframe to paste into a page; the same markup oEmbed returns. */
export function iframeSnippet(src: string, title: string, kind: EmbedKind): string {
  const { width, height } = EMBED_SIZES[kind];
  return (
    `<iframe src="${escapeHtml(src)}" title="${escapeHtml(title)}" width="${width}" height="${height}" ` +
    `style="border:0;max-width:100%" allow="clipboard-write; fullscreen" loading="lazy" ` +
    `referrerpolicy="strict-origin-when-cross-origin"></iframe>`
  );
}

/**
 * Optional script for the host page: sets each Open Poll iframe's height to
 * what its page reports, so a live or results embed never scrolls inside.
 */
export function resizeScript(origin: string): string {
  return [
    "<script>",
    'window.addEventListener("message", function (e) {',
    `  if (e.origin !== ${JSON.stringify(origin)} || !e.data || e.data.type !== ${JSON.stringify(EMBED_RESIZE_MESSAGE)}) return;`,
    '  document.querySelectorAll("iframe").forEach(function (f) {',
    '    if (f.contentWindow === e.source) f.style.height = Math.ceil(e.data.height) + "px";',
    "  });",
    "});",
    "</script>",
  ].join("\n");
}
