// YouTube / Vimeo links → provider + id (+ start), and the privacy-friendly
// embed URLs. Pure functions shared by the video slide editor and VideoEmbed.
// The id rules match the backend's (content/video.ts), so an id that passes
// here is accepted on save and can never inject into a player URL.

export type VideoHost = "youtube" | "vimeo";

export const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
export const VIMEO_ID_RE = /^[1-9][0-9]{5,11}$/;

/** Longest start offset the API accepts, in seconds (24h). */
export const MAX_VIDEO_START = 86_400;

export const isVideoId = (host: VideoHost, id: string) =>
  host === "youtube" ? YOUTUBE_ID_RE.test(id) : VIMEO_ID_RE.test(id);

export interface ParsedVideoLink {
  provider: VideoHost;
  id: string;
  /** Start offset from the link (`t=`/`start=`/`#t=`), or null when it has none. */
  start: number | null;
}

/** "90", "90s", "1m30s", "1h2m3s", "1:30", "1:02:03" → seconds; null when unreadable. */
export function parseStart(value: string | null | undefined): number | null {
  const raw = value?.trim().toLowerCase();
  if (!raw) return null;
  let seconds: number | null = null;
  if (/^\d+s?$/.test(raw)) {
    seconds = Number.parseInt(raw, 10);
  } else if (/^\d+(:\d{1,2}){1,2}$/.test(raw)) {
    seconds = raw.split(":").reduce((total, part) => total * 60 + Number(part), 0);
  } else {
    const units = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw);
    if (units && (units[1] || units[2] || units[3])) {
      seconds = Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0);
    }
  }
  return seconds !== null && seconds <= MAX_VIDEO_START ? seconds : null;
}

/** Seconds as "m:ss" or "h:mm:ss". */
export function formatStart(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
}

const YOUTUBE_HOSTS = new Set(["youtube.com", "youtube-nocookie.com", "music.youtube.com"]);
const YOUTUBE_PATH_PREFIXES = new Set(["embed", "shorts", "live", "v"]);

/**
 * A pasted YouTube or Vimeo link, or a bare id (11-character YouTube id,
 * all-digit Vimeo id). Anything else is null.
 */
export function parseVideoLink(input: string): ParsedVideoLink | null {
  const raw = input.trim();
  if (!raw) return null;
  if (YOUTUBE_ID_RE.test(raw)) return { provider: "youtube", id: raw, start: null };
  if (VIMEO_ID_RE.test(raw)) return { provider: "vimeo", id: raw, start: null };

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, "");
  const segments = url.pathname.split("/").filter(Boolean);
  const hashStart = /(?:^#|&)t=([^&]+)/.exec(url.hash)?.[1];
  const start = parseStart(url.searchParams.get("t") ?? url.searchParams.get("start") ?? hashStart);

  if (host === "youtu.be" || YOUTUBE_HOSTS.has(host)) {
    const id =
      host === "youtu.be"
        ? segments[0]
        : segments[0] === "watch"
          ? url.searchParams.get("v")
          : YOUTUBE_PATH_PREFIXES.has(segments[0] ?? "")
            ? segments[1]
            : undefined;
    return id && YOUTUBE_ID_RE.test(id) ? { provider: "youtube", id, start } : null;
  }

  if (host === "vimeo.com" || host === "player.vimeo.com") {
    // vimeo.com/123, vimeo.com/channels/x/123, player.vimeo.com/video/123
    const id = segments.find((segment) => VIMEO_ID_RE.test(segment));
    return id ? { provider: "vimeo", id, start } : null;
  }

  return null;
}

/** Embed URL on the privacy-enhanced players (no tracking cookies before play). */
export function embedUrl(provider: VideoHost, id: string, start = 0): string {
  const from = Math.max(0, Math.floor(start));
  if (provider === "youtube") {
    return `https://www.youtube-nocookie.com/embed/${id}?rel=0${from > 0 ? `&start=${from}` : ""}`;
  }
  return `https://player.vimeo.com/video/${id}?dnt=1${from > 0 ? `#t=${from}s` : ""}`;
}

/** Link to the video on its own site (for the editor preview). */
export function watchUrl(provider: VideoHost, id: string): string {
  return provider === "youtube" ? `https://www.youtube.com/watch?v=${id}` : `https://vimeo.com/${id}`;
}
