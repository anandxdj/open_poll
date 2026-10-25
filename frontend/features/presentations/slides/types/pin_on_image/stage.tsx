"use client";

import { useState } from "react";
import { ImageIcon, ImageOff, Target } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { percentOf } from "../../advanced/read";
import { MediaPlaceholder } from "../../content/ContentViews";
import type { StageViewProps } from "../../runtime";
import { isRevealMode } from "../../shared";
import { emptyPinDistribution, parsePinDistribution, pinImageOf, pinRegion } from "./config";
import { PinImage } from "./PinImage";

/**
 * The image with every pin on it while answers come in; once revealed a
 * heatmap of all pins and, on graded slides, the correct area with how many
 * pins landed in it.
 */
export function PinOnImageStage({ slide, live, reveal, mode }: StageViewProps) {
  const t = useTranslations("slidesAdvanced.pinOnImage");
  const tImage = useTranslations("live.slides.image");
  const thumbnail = mode === "thumbnail";
  const image = pinImageOf(slide);
  const authoredRegion = pinRegion(slide);
  const dist =
    (thumbnail ? null : parsePinDistribution(live.distribution ?? reveal?.distribution)) ??
    emptyPinDistribution(authoredRegion);
  const revealed = isRevealMode(mode);
  const region = revealed ? (dist.region ?? authoredRegion) : null;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = failedUrl !== null && failedUrl === image.url;

  const maxHeat = Math.max(1, ...dist.heat.cells.map((cell) => cell.count));
  const cellSize = 100 / dist.heat.size;

  return (
    <div className="pt-2 font-sans">
      <figure className="mx-auto flex w-full max-w-3xl flex-col items-center gap-3">
        {image.url && !failed ? (
          <div className="relative w-fit max-w-full overflow-hidden rounded-2xl border border-deck-stage-fg/10 bg-deck-stage-panel shadow-2xl">
            <PinImage
              url={image.url}
              alt={image.alt}
              className={cn("block h-auto w-auto max-w-full", thumbnail ? "max-h-[300px]" : "max-h-[50vh]")}
              onFail={() => setFailedUrl(image.url)}
            />
            {revealed &&
              dist.heat.cells.map((cell) => (
                <span
                  key={`${cell.col}:${cell.row}`}
                  aria-hidden
                  className="pointer-events-none absolute bg-deck-danger"
                  style={{
                    left: `${cell.col * cellSize}%`,
                    top: `${cell.row * cellSize}%`,
                    width: `${cellSize}%`,
                    height: `${cellSize}%`,
                    opacity: 0.12 + 0.55 * (cell.count / maxHeat),
                  }}
                />
              ))}
            {region && (
              <span
                aria-hidden
                data-testid="correct-area"
                className="pointer-events-none absolute border-2 border-dashed border-deck-correct bg-deck-correct/15"
                style={{
                  left: `${region.x * 100}%`,
                  top: `${region.y * 100}%`,
                  width: `${region.width * 100}%`,
                  height: `${region.height * 100}%`,
                }}
              />
            )}
            {!thumbnail &&
              dist.pins.map((pin, i) => (
                <span
                  key={i}
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-deck-stage-scrim/60",
                    revealed ? "size-2 bg-deck-stage-fg/80" : "size-3.5 bg-deck-accent"
                  )}
                  style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}
                />
              ))}
          </div>
        ) : (
          <MediaPlaceholder
            Icon={image.url ? ImageOff : ImageIcon}
            label={image.url ? tImage("unavailable") : tImage("missing")}
            className="h-56 w-full"
          />
        )}

        {!thumbnail && (
          <figcaption className="flex flex-wrap items-center justify-center gap-3 text-center font-mono text-xs text-deck-stage-fg/60">
            <span>{t("pins", { count: dist.count })}</span>
            {revealed && region && dist.inRegion !== null && dist.count > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-deck-correct/50 bg-deck-correct-deep/20 px-3 py-1 font-sans text-sm font-bold text-deck-correct-soft">
                <Target className="size-4" aria-hidden />
                {t("inArea", { inside: dist.inRegion, total: dist.count, percent: Math.round(percentOf(dist.inRegion, dist.count)) })}
              </span>
            )}
          </figcaption>
        )}
      </figure>
    </div>
  );
}
