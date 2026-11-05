"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { EMBED_RESIZE_MESSAGE, type EmbedKind, type EmbedResizeMessage } from "../embedUrls";

/**
 * The root of an embed page. Chromeless; inside a frame it tells the parent
 * page its content height (`openpoll:embed:resize` postMessage) whenever it
 * changes, so the host can size the iframe to fit (`resizeScript`).
 *
 * `fit="content"` (live, results): the content decides the height; pages
 * drawn for a full screen give up their viewport minimums here (globals.css,
 * `[data-embed-root=content]`), or the height could only ever grow.
 * `fit="viewport"` (stage): fills the frame, which the host sizes (16:9).
 */
export function EmbedFrame({ kind, fit, children }: { kind: EmbedKind; fit: "content" | "viewport"; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof window === "undefined" || window.parent === window) return;
    let last = -1;
    const report = () => {
      const height = Math.ceil(element.getBoundingClientRect().height);
      if (height === last || height <= 0) return;
      last = height;
      const message: EmbedResizeMessage = { type: EMBED_RESIZE_MESSAGE, kind, height };
      // Only a height: nothing private, so any parent may read it.
      window.parent.postMessage(message, "*");
    };
    const observer = new ResizeObserver(report);
    observer.observe(element);
    report();
    return () => observer.disconnect();
  }, [kind]);

  return (
    <div
      ref={ref}
      data-embed-root={fit}
      data-embed-kind={kind}
      className={cn("w-full", fit === "viewport" ? "flex h-dvh flex-col overflow-hidden" : "flow-root")}
    >
      {children}
    </div>
  );
}
