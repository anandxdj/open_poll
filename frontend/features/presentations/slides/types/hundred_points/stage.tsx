"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";

import { percentOf } from "../../advanced/read";
import type { StageViewProps } from "../../runtime";
import { ease, isRevealMode } from "../../shared";
import {
  emptyHundredPointsDistribution,
  formatAverage,
  hundredPointsItems,
  parseHundredPointsDistribution,
} from "./config";

/**
 * The average points per item as a bar each, in the authored order while
 * answers come in and best first once revealed.
 */
export function HundredPointsStage({ slide, live, reveal, mode }: StageViewProps) {
  const t = useTranslations("slidesAdvanced.hundredPoints");
  const thumbnail = mode === "thumbnail";
  const dist =
    (thumbnail ? null : parseHundredPointsDistribution(live.distribution ?? reveal?.distribution)) ??
    emptyHundredPointsDistribution(hundredPointsItems(slide));
  const ranked = isRevealMode(mode);
  const rows = dist.items.map((item, i) => ({ ...item, key: i }));
  if (ranked) rows.sort((a, b) => b.total - a.total || a.key - b.key);
  const maxAverage = Math.max(0, ...rows.map((row) => row.average));

  return (
    <div className={`pt-2 font-sans ${thumbnail ? "" : "max-h-[55vh] overflow-y-auto"}`}>
      <div className="mx-auto w-full max-w-2xl space-y-2.5">
        {rows.map((row, position) => {
          const width = percentOf(row.average, maxAverage);
          return (
            <div
              key={row.key}
              className="flex items-center justify-between gap-4 rounded-2xl border border-deck-stage-fg/10 bg-deck-stage-fg/5 p-3.5"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                {ranked && !thumbnail && (
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-xl border border-deck-accent/30 bg-deck-accent/20 text-xs font-bold text-deck-accent-soft">
                    #{position + 1}
                  </span>
                )}
                <span className="truncate text-sm font-semibold text-deck-stage-fg sm:text-base">{row.text}</span>
              </div>
              <div className="flex w-44 shrink-0 items-center gap-3 sm:w-60">
                <div className="relative h-4 flex-1 overflow-hidden rounded-full border border-deck-stage-fg/10 bg-deck-stage-fg/10 p-0.5">
                  {width > 0 && (
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-deck-accent-strong to-deck-accent"
                      initial={{ width: 0 }}
                      animate={{ width: `${width}%` }}
                      transition={{ duration: 0.6, ease }}
                    />
                  )}
                </div>
                <span className="min-w-[64px] shrink-0 text-right font-mono text-sm font-bold text-deck-accent">
                  {formatAverage(row.average)}
                  <span className="ml-1 text-xs font-normal text-deck-stage-fg/40">{t("avg")}</span>
                </span>
              </div>
            </div>
          );
        })}
        {!thumbnail && (
          <p className="pt-1 text-center font-mono text-xs text-deck-stage-fg/50">
            {t("voters", { count: dist.voters })}
          </p>
        )}
      </div>
    </div>
  );
}
