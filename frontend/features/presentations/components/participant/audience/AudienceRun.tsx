"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Clock, Hourglass, Loader2, Lock } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { SlotOutlet } from "../../../live/slots";
import { useLive } from "../../../live/store";
import type { AudienceParticipantView, AudienceWindowView } from "../../../types";
import { audienceSliceOf } from "./audienceSlice";
import { AudienceSlideCard } from "./AudienceSlideCard";
import { AudienceSummary } from "./AudienceSummary";

/** Minutes left before `closesAt` (re-rendered every 15 s), or null without a closing time. */
function useClosingLabel(audienceWindow: AudienceWindowView | null, closed: boolean) {
  const t = useTranslations("live.audience");
  const locale = useLocale();
  const [now, setNow] = useState(() => Date.now());
  const closesAt = audienceWindow?.closesAt ? Date.parse(audienceWindow.closesAt) : null;
  useEffect(() => {
    if (closesAt === null || closed) return;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [closesAt, closed]);
  if (closed) return t("closed");
  if (closesAt === null) return null;
  const minutes = Math.ceil((closesAt - now) / 60_000);
  if (minutes <= 1) return t("closesSoon");
  if (minutes <= 60) return t("closesIn", { minutes });
  return t("closesAt", { time: new Date(closesAt).toLocaleString(locale, { weekday: "short", hour: "2-digit", minute: "2-digit" }) });
}

/**
 * The participant's audience-paced run (W2-F): every slide is open at once and
 * the participant moves through them on their own — Back / Next, a numbered
 * slide strip with what is answered, the closing time — then submits the
 * attempt on the summary page, sees the score (and pass or fail for an
 * assessment) and may try again while attempts are left. The run comes from
 * `live-state.audience` (the `audience` live slice); answers go through the
 * store's `submitAnswer` for the slide shown.
 */
export function AudienceRun() {
  const t = useTranslations("live.audience");
  const status = useLive((s) => s.status);
  const presentationId = useLive((s) => s.presentationId);
  const run = useLive((s) => audienceSliceOf(s).participant);
  const answeredLocally = useLive((s) => audienceSliceOf(s).answered);
  const audienceWindow = useLive((s) => audienceSliceOf(s).window);
  const closed = run?.status === "closed";
  const closing = useClosingLabel(audienceWindow ?? run?.window ?? null, closed);

  // Which page is on screen: a slide index, or `slides.length` for the summary.
  const [page, setPage] = useState<number | null>(null);
  const attemptKey = run ? `${run.attempt.number}:${run.attempt.submitted}` : "";
  const [shownFor, setShownFor] = useState(attemptKey);
  if (shownFor !== attemptKey) {
    // A new attempt starts at the first slide; a submitted one opens on the result.
    setShownFor(attemptKey);
    setPage(run?.attempt.submitted ? (run.slides.length ?? 0) : 0);
  }

  const answered = useMemo(() => {
    const set = new Set<string>();
    for (const slide of run?.slides ?? []) if (slide.answered || answeredLocally[slide.slideId]) set.add(slide.slideId);
    return set;
  }, [run, answeredLocally]);

  if (status === "lobby" || run?.status === "waiting") {
    return (
      <div className="space-y-4 text-center">
        <Hourglass className="mx-auto size-10 text-deck-primary motion-safe:animate-pulse" aria-hidden="true" />
        <h2 className="text-2xl font-semibold tracking-[-0.03em]">{t("waitingTitle")}</h2>
        <p className="text-sm text-deck-muted-fg">{t("waitingHint")}</p>
      </div>
    );
  }
  if (!run) {
    return <Loader2 className="mx-auto size-6 animate-spin text-deck-muted-fg" aria-hidden="true" />;
  }

  const slides = run.slides;
  const questions = slides.filter((slide) => slide.lifecycle === "response");
  const index = Math.min(page ?? (run.attempt.submitted ? slides.length : 0), slides.length);
  const onSummary = index >= slides.length;
  const go = (next: number) => setPage(Math.max(0, Math.min(slides.length, next)));

  return (
    <div className="flex w-full flex-col gap-5 self-stretch">
      <RunHeader run={run} answered={answered.size} total={questions.length} closing={closing} />

      <nav aria-label={t("slidesNav")} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {slides.map((slide, i) => {
          const done = answered.has(slide.slideId);
          const isResponse = slide.lifecycle === "response";
          return (
            <button
              key={slide.slideId}
              type="button"
              onClick={() => go(i)}
              aria-current={i === index ? "step" : undefined}
              aria-label={t("jumpTo", { number: i + 1 })}
              className={`flex size-11 shrink-0 items-center justify-center rounded-full border text-sm font-semibold tabular-nums transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-deck-primary/50 ${
                i === index
                  ? "border-deck-primary bg-deck-primary text-deck-primary-fg"
                  : done
                    ? "border-deck-primary/40 bg-deck-primary/10 text-deck-fg"
                    : isResponse
                      ? "border-deck-border text-deck-fg"
                      : "border-dashed border-deck-border text-deck-muted-fg"
              }`}
            >
              {i + 1}
            </button>
          );
        })}
      </nav>

      <div className="min-h-[240px]">
        {onSummary ? (
          <AudienceSummary run={run} answered={answered} onJump={go} onReview={() => go(0)} />
        ) : (
          <AudienceSlideCard
            key={`${slides[index]!.slideId}:${run.attempt.number}`}
            view={slides[index]!}
            run={run}
            answeredLocally={Boolean(answeredLocally[slides[index]!.slideId])}
          />
        )}
      </div>

      {!onSummary ? (
        <div className="flex items-center justify-between gap-3">
          <Button variant="outline" onClick={() => go(index - 1)} disabled={index === 0} className="h-12 min-w-28 rounded-lg">
            <ChevronLeft className="size-4" aria-hidden="true" /> {t("back")}
          </Button>
          <span className="text-sm tabular-nums text-deck-muted-fg">{t("progressLabel", { current: index + 1, total: slides.length })}</span>
          <Button onClick={() => go(index + 1)} className="h-12 min-w-28 rounded-lg bg-deck-primary font-semibold text-deck-primary-fg">
            {index === slides.length - 1 ? (run.attempt.submitted ? t("backToResult") : t("finish")) : t("next")}
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      ) : null}

      {/* Once the session ended: what other modules add to the end screen (e.g. the participant's own results page). */}
      {status === "ended" && presentationId ? <SlotOutlet name="endScreen" props={{ role: "participant", presentationId }} /> : null}
    </div>
  );
}

function RunHeader({
  run,
  answered,
  total,
  closing,
}: {
  run: AudienceParticipantView;
  answered: number;
  total: number;
  closing: string | null;
}) {
  const t = useTranslations("live.audience");
  const percent = total > 0 ? Math.round((answered / total) * 100) : 0;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="tabular-nums text-deck-muted-fg">{t("answeredCount", { answered, total })}</span>
        <span className="flex items-center gap-2">
          {run.assessment.enabled && run.attempt.number > 1 ? (
            <span className="rounded-full border border-deck-border px-2.5 py-0.5 text-xs font-semibold">
              {t("attemptBadge", { number: run.attempt.number })}
            </span>
          ) : null}
          {closing ? (
            <span className="flex items-center gap-1 text-deck-muted-fg">
              {run.status === "closed" ? <Lock className="size-3.5" aria-hidden="true" /> : <Clock className="size-3.5" aria-hidden="true" />}
              {closing}
            </span>
          ) : null}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-deck-secondary"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={answered}
        aria-label={t("answeredCount", { answered, total })}
      >
        <div className="h-full rounded-full bg-deck-primary transition-[width]" style={{ width: `${percent}%` }} />
      </div>
      {run.status === "closed" && !run.attempt.submitted ? (
        <p role="status" className="rounded-xl border border-deck-border bg-deck-surface px-4 py-2 text-sm">
          <span className="font-semibold">{t("closedTitle")}. </span>
          {t("closedHint")}
        </p>
      ) : null}
    </div>
  );
}
