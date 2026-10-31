"use client";

import { memo, useMemo } from "react";
import { useTranslations } from "next-intl";
import { StageView } from "@/features/presentations/components/stage/StageView";
import type { LiveParticipant } from "@/features/presentations/types/live";
import { asRevealDistribution, toStageSlide } from "../query";
import { ScaledStage, STAGE_DESIGN_WIDTH } from "./ScaledStage";
import type { SlideDistribution } from "../types";

interface SlideResultCardProps {
  slideIndex: number;
  /** The slide as it ran (a deck-snapshot slide, or the participant-facing one on public pages). */
  slide: Record<string, unknown>;
  typeName?: string;
  label: string;
  answeredCount: number;
  distribution: SlideDistribution | null;
  participants: LiveParticipant[];
}

const NO_LEADERBOARD: never[] = [];

/**
 * One slide's results: its own StageView in `report` mode on a dark stage
 * panel (the same chart the host saw), with the slide number, type and
 * response count above.
 */
export const SlideResultCard = memo(function SlideResultCard({
  slideIndex,
  slide,
  typeName,
  label,
  answeredCount,
  distribution,
  participants,
}: SlideResultCardProps) {
  const t = useTranslations("sessions.report.slides");
  const stageSlide = useMemo(() => toStageSlide(slide), [slide]);
  const live = useMemo(
    () => ({ distribution: asRevealDistribution(distribution), answeredCount, leaderboard: NO_LEADERBOARD }),
    [distribution, answeredCount]
  );

  return (
    <article
      aria-label={`${t("slideNumber", { number: slideIndex + 1 })}: ${label}`}
      className="rounded-xl border border-border bg-card p-1.5 shadow-[0_1px_2px_rgb(23_23_23/0.06)]"
    >
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3.5 pb-2.5 pt-2">
        <p className="flex items-center gap-2.5 text-sm">
          <span className="font-medium text-foreground">{t("slideNumber", { number: slideIndex + 1 })}</span>
          {typeName ? <span className="text-muted-foreground">{typeName}</span> : null}
        </p>
        <p className="text-sm text-muted-foreground">{t("responses", { count: answeredCount })}</p>
      </header>
      {/* The stage as the room saw it: always the dark deck stage, in either app theme. */}
      <div className="rounded-lg bg-deck-stage-bg px-4 py-6 text-deck-stage-fg ring-inset dark:ring-1 dark:ring-border sm:px-8">
        <h3 className="mx-auto mb-4 max-w-3xl text-balance text-center text-xl font-semibold leading-tight tracking-[-0.02em] text-deck-stage-fg sm:text-2xl">
          {label}
        </h3>
        <div className="mx-auto w-full max-w-3xl">
          <ScaledStage designWidth={STAGE_DESIGN_WIDTH[stageSlide.type] ?? 0}>
            <StageView slide={stageSlide} mode="report" live={live} participants={participants} />
          </ScaledStage>
        </div>
      </div>
    </article>
  );
});
