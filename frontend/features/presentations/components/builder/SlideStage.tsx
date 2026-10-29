"use client";

import { useId } from "react";

import { isContentSlide, slideTypeMeta } from "../../slides/meta";
import type { PresentationSlide } from "../../types/deck";
import { SlideThumbnail } from "./SlideThumbnail";

/** The API's limit on a slide's speaker notes. */
export const NOTES_MAX_LENGTH = 5000;

/**
 * The builder's canvas: the selected slide as the room will see it (the same
 * StageView the rail thumbnails use, at full width) and its speaker notes,
 * which only the host sees.
 */
export function SlideStage({
  slide,
  index,
  total,
  onChange,
}: {
  slide: PresentationSlide;
  index: number;
  total: number;
  onChange: (patch: Partial<PresentationSlide>) => void;
}) {
  const notesId = useId();
  const meta = slideTypeMeta(slide.type);
  const kind = meta.scored ? "Scored" : isContentSlide(slide.type) ? "Content" : "Interactive";
  const notes = slide.notes ?? "";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="meta-label">
          Slide {index + 1} of {total}
        </p>
        <p className="flex flex-wrap gap-1.5">
          <span className="rounded-full border border-border bg-card px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{meta.label}</span>
          <span className="rounded-full border border-border bg-card px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{kind}</span>
          {slide.timeLimit > 0 && !isContentSlide(slide.type) ? (
            <span className="rounded-full border border-border bg-card px-2.5 py-0.5 font-mono text-xs tabular-nums text-muted-foreground">
              {slide.timeLimit} s
            </span>
          ) : null}
        </p>
      </div>

      <figure className="m-0">
        <SlideThumbnail slide={slide} className="rounded-2xl shadow-[0_32px_64px_-32px_rgb(23_23_23/0.45)]" />
        <figcaption className="sr-only">Preview of slide {index + 1} on the stage</figcaption>
      </figure>

      <div className="rounded-xl border border-border bg-card px-4 py-3 focus-within:border-ring">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={notesId} className="meta-label">
            Speaker notes
          </label>
          <span className="text-xs text-muted-foreground">Only you see these while presenting</span>
        </div>
        <textarea
          id={notesId}
          value={notes}
          maxLength={NOTES_MAX_LENGTH}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder="What to say on this slide"
          rows={3}
          className="mt-2 block w-full resize-y border-0 bg-transparent p-0 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>
    </div>
  );
}
