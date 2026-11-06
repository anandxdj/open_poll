"use client";

import { useTranslations } from "next-intl";
import { SlideThumbnail } from "@/features/presentations/components/builder/SlideThumbnail";
import { useLive } from "@/features/presentations/live/store";

/** Index of the slide that comes next: the first one before the session runs. */
export const nextSlideIndex = (status: string | null, currentSlideIndex: number) =>
  status === "active" ? currentSlideIndex + 1 : 0;

/** A thumbnail of the slide after the current one (the builder's renderer). */
export function NextSlidePreview() {
  const t = useTranslations("presenter.console");
  const index = useLive((s) => nextSlideIndex(s.status, s.currentSlideIndex));
  const slide = useLive((s) => s.deck?.slides[nextSlideIndex(s.status, s.currentSlideIndex)] ?? null);
  const total = useLive((s) => s.totalSlides);

  return (
    <section aria-labelledby="presenter-next-title" className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="presenter-next-title" className="text-xs font-medium uppercase tracking-wider text-deck-stage-muted">
          {t("nextSlide")}
        </h2>
        {slide && <span className="font-mono text-xs tabular-nums text-deck-stage-muted">{index + 1} / {total}</span>}
      </div>
      {slide ? (
        <div data-testid="next-slide-preview" title={slide.question || slide.type}>
          <SlideThumbnail slide={slide} className="border-deck-stage-fg/15" />
          <p className="mt-1.5 truncate text-sm text-deck-stage-fg/70">{slide.question || " "}</p>
        </div>
      ) : (
        <p data-testid="next-slide-preview" className="flex aspect-video items-center justify-center rounded-md border border-dashed border-deck-stage-fg/15 text-sm text-deck-stage-muted">
          {t("noNextSlide")}
        </p>
      )}
    </section>
  );
}
