"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Slide types whose stage view lays itself out in pixels for a wide screen (a
 * word cloud spirals out to about 700 px) and clips on a phone. On a narrower
 * container they are drawn at this width and scaled down to fit, like a
 * thumbnail. Everything else flows to the container and is left alone.
 */
export const STAGE_DESIGN_WIDTH: Readonly<Record<string, number>> = {
  wordcloud: 720,
};

/** Draws `children` at `designWidth` and scales it down when the container is narrower. */
export function ScaledStage({ designWidth, children }: { designWidth: number; children: ReactNode }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [contentHeight, setContentHeight] = useState<number | null>(null);

  useEffect(() => {
    const frame = frameRef.current;
    const content = contentRef.current;
    if (!frame || !content || designWidth <= 0) return;
    const frameObserver = new ResizeObserver(([entry]) => {
      if (entry) setScale(Math.min(1, entry.contentRect.width / designWidth));
    });
    const contentObserver = new ResizeObserver(() => setContentHeight(content.offsetHeight));
    frameObserver.observe(frame);
    contentObserver.observe(content);
    return () => {
      frameObserver.disconnect();
      contentObserver.disconnect();
    };
  }, [designWidth]);

  const scaled = scale < 1 && contentHeight !== null;
  return (
    <div
      ref={frameRef}
      className="w-full overflow-hidden"
      style={scaled ? { height: contentHeight * scale } : undefined}
    >
      <div
        ref={contentRef}
        style={scaled ? { width: designWidth, transform: `scale(${scale})`, transformOrigin: "top left" } : undefined}
      >
        {children}
      </div>
    </div>
  );
}
