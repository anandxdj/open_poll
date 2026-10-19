"use client";

import { useTranslations } from "next-intl";

import { formatNumber } from "../../advanced/read";
import type { StageViewProps } from "../../runtime";
import { GridBoard, type BoardMarker } from "./Board";
import { emptyGridDistribution, gridConfig, parseGridDistribution } from "./config";

/**
 * A 2x2 scatter: each item sits at the average position the audience gave it,
 * numbered to match the legend beside the board.
 */
export function Grid2x2Stage({ slide, live, reveal, mode }: StageViewProps) {
  const t = useTranslations("slidesAdvanced.grid2x2");
  const thumbnail = mode === "thumbnail";
  const config = gridConfig(slide);
  const dist = (thumbnail ? null : parseGridDistribution(live.distribution ?? reveal?.distribution)) ?? emptyGridDistribution(config);

  const markers: BoardMarker[] = dist.items.flatMap((item, index) =>
    item.x !== null && item.y !== null ? [{ index, position: { x: item.x, y: item.y } }] : []
  );

  return (
    <div className={`pt-2 font-sans ${thumbnail ? "" : "max-h-[55vh] overflow-y-auto"}`}>
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-5 sm:flex-row sm:items-start">
        <div className={`w-full shrink-0 ${thumbnail ? "max-w-[300px]" : "max-w-[min(28rem,50vh)]"}`}>
          <GridBoard x={dist.x} y={dist.y} tone="stage" markers={markers} />
        </div>
        <div className="w-full min-w-0 flex-1 space-y-2">
          <ol className="space-y-2">
            {dist.items.map((item, i) => (
              <li
                key={i}
                className="flex items-center gap-3 rounded-2xl border border-deck-stage-fg/10 bg-deck-stage-fg/5 px-3.5 py-2.5"
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-deck-accent text-xs font-extrabold text-deck-stage-ink">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-deck-stage-fg">{item.text}</span>
                {!thumbnail && item.x !== null && item.y !== null && (
                  <span className="shrink-0 font-mono text-xs tabular-nums text-deck-stage-fg/60">
                    {formatNumber(item.x)} · {formatNumber(item.y)}
                  </span>
                )}
              </li>
            ))}
          </ol>
          {!thumbnail && (
            <p className="text-center font-mono text-xs text-deck-stage-fg/50">{t("voters", { count: dist.voters })}</p>
          )}
        </div>
      </div>
    </div>
  );
}
