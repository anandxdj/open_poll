"use client";

import { cn } from "@/lib/utils";
import { embedUrl, isVideoId, MAX_VIDEO_START } from "./video";

export interface EmbeddableVideo {
  provider: "youtube" | "vimeo" | "file";
  id: string | null;
  /** Uploaded file URL (served from storage); only for `file`. */
  url: string | null;
  /** Seconds. */
  start: number;
}

/** True when `video` has what VideoEmbed needs to play it. */
export const canEmbed = (video: EmbeddableVideo) =>
  video.provider === "file" ? Boolean(video.url) : video.id !== null && isVideoId(video.provider, video.id);

/**
 * Plays a slide video: YouTube through youtube-nocookie.com, Vimeo through
 * player.vimeo.com (both allowed by the CSP `frame-src`), or an uploaded file
 * in a native player. Renders nothing for a video it cannot play; check
 * `canEmbed` first to show a placeholder instead. Size it with `className`
 * (it fills the box).
 */
export function VideoEmbed({ video, title, className }: { video: EmbeddableVideo; title: string; className?: string }) {
  if (!canEmbed(video)) return null;
  const start = Math.min(Math.max(Math.floor(video.start), 0), MAX_VIDEO_START);
  const boxClass = cn("block size-full border-0 bg-deck-stage-scrim", className);

  if (video.provider === "file") {
    return (
      <video
        src={start > 0 ? `${video.url}#t=${start}` : video.url!}
        title={title}
        aria-label={title}
        controls
        playsInline
        preload="metadata"
        className={boxClass}
      />
    );
  }

  return (
    <iframe
      src={embedUrl(video.provider, video.id!, start)}
      title={title}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
      loading="lazy"
      sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
      className={boxClass}
    />
  );
}
