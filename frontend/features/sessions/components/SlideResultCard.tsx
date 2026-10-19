"use client";

import { memo, useMemo } from "react";
import { useTranslations } from "next-intl";
import { StageView } from "@/features/presentations/components/stage/StageView";
import type { LiveParticipant } from "@/features/presentations/types/live";
import { asRevealDistribution, toStageSlide } from "../query";
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
      className="rounded-[2rem] border border-border bg-card p-1.5"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
          {t("slideNumber", { number: slideIndex + 1 })}
          {typeName ? ` · ${typeName}` : ""}
        </p>
        <p className="text-xs font-semibold tabular-nums text-foreground/70">
          {t("responses", { count: answeredCount })}
        </p>
      </header>
      <div className="rounded-[calc(2rem-0.375rem)] bg-deck-stage-bg px-4 py-6 text-deck-stage-fg sm:px-8">
        <h3 className="mx-auto mb-4 max-w-3xl text-center text-xl font-extrabold leading-tight tracking-tight sm:text-2xl">
          {label}
        </h3>
        <div className="mx-auto w-full max-w-3xl">
          <StageView slide={stageSlide} mode="report" live={live} participants={participants} />
        </div>
      </div>
    </article>
  );
});
