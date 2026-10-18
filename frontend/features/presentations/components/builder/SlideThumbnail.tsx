"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { LiveIntlProvider } from "@/i18n/LiveIntlProvider";
import { slideTypeMeta } from "../../slides/meta";
import type { PresentationSlide } from "../../types/deck";
import { StageView } from "../stage/StageView";

// 16:9 preview of a slide for the builder rail — the slide's own StageView in
// `thumbnail` mode, laid out on a full-size stage and scaled down to fit.
// This is the only thumbnail renderer the builder imports.

const STAGE_WIDTH = 960;
const STAGE_HEIGHT = 540;

export function SlideThumbnail({ slide, className }: { slide: PresentationSlide; className?: string }) {
  const meta = slideTypeMeta(slide.type);
  const question = slide.question.trim();
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / STAGE_WIDTH));
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={frameRef}
      aria-hidden
      className={cn(
        "relative aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-deck-stage-bg",
        className
      )}
    >
      {scale !== null && (
        <div
          className="pointer-events-none absolute left-0 top-0 flex flex-col items-center gap-6 p-10 text-deck-stage-fg"
          style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT, transform: `scale(${scale})`, transformOrigin: "top left" }}
        >
          <h2
            className={cn(
              "line-clamp-2 text-center text-3xl font-extrabold leading-tight tracking-tight",
              !question && "text-deck-stage-fg/40"
            )}
          >
            {question || meta.label}
          </h2>
          <div className="w-full max-w-3xl">
            <LiveIntlProvider>
              <StageView slide={slide} mode="thumbnail" />
            </LiveIntlProvider>
          </div>
        </div>
      )}
      <meta.Icon className={cn("absolute left-1.5 top-1.5 size-3", meta.iconClass)} />
    </div>
  );
}
