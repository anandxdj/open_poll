"use client";

import { ArrowRight, ChevronLeft, Eye, FastForward, Flag, Lock, Pause, Play, RotateCcw, TimerReset } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { HostSession } from "@/features/presentations/components/host/useHostSession";
import { useLive } from "@/features/presentations/live/store";
import { useCountdown } from "@/features/presentations/live/useCountdown";
import { getSlideRuntime } from "@/features/presentations/slides/runtime";

const ghost =
  "h-10 rounded-full border-deck-stage-fg/15 bg-transparent px-4 text-sm font-medium text-deck-stage-fg hover:bg-deck-stage-fg/10 hover:text-deck-stage-fg";

interface PresenterControlsProps {
  session: HostSession;
  onEnd: () => void;
}

/**
 * The presenter view's controls: previous / next, the voting phase of a
 * response slide (close, reveal, reopen), the timer of an open timed slide
 * (pause or resume, +30 s, skip = time's up now) and End Session.
 */
export function PresenterControls({ session, onEnd }: PresenterControlsProps) {
  const t = useTranslations("presenter.controls");
  const status = useLive((s) => s.status);
  const phase = useLive((s) => s.phase);
  const slideIndex = useLive((s) => s.currentSlideIndex);
  const totalSlides = useLive((s) => s.totalSlides);
  const timing = useLive((s) => s.timing);
  const slide = useLive((s) => s.deck?.slides[s.currentSlideIndex] ?? null);
  const countdown = useCountdown(timing, slide?.timeLimit ?? 30);
  const { busy } = session;

  if (status !== "active") return null;
  const isLastSlide = slideIndex >= totalSlides - 1;
  const isResponse = slide ? getSlideRuntime(slide.type)?.lifecycle === "response" : false;
  const timerRunning = isResponse && phase === "open" && countdown.timed && (countdown.paused || !countdown.expired);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3" role="toolbar" aria-label={t("position", { current: slideIndex + 1, total: totalSlides })}>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void session.previous()} disabled={busy || slideIndex <= 0} className={ghost}>
          <ChevronLeft className="size-4" /> {t("previous")}
        </Button>
        {!isLastSlide ? (
          <Button
            onClick={() => void session.next()}
            disabled={busy}
            className="h-10 rounded-full bg-deck-accent px-5 text-sm font-semibold text-deck-stage-ink hover:bg-deck-accent-soft"
          >
            {t("next")} <ArrowRight className="size-4" />
          </Button>
        ) : (
          <Button
            onClick={onEnd}
            disabled={busy}
            className="h-10 rounded-full bg-deck-stage-fg px-5 text-sm font-semibold text-deck-stage-bg hover:bg-deck-stage-fg/90"
          >
            <Flag className="size-4" /> {t("end")}
          </Button>
        )}
      </div>

      {isResponse && (
        <div className="flex flex-wrap items-center gap-2">
          {phase === "open" && (
            <Button variant="outline" size="sm" onClick={() => void session.closeVoting()} disabled={busy} className={ghost}>
              <Lock className="size-4" /> {t("closeVoting")}
            </Button>
          )}
          {(phase === "open" || phase === "closed") && (
            <Button variant="outline" size="sm" onClick={() => void session.reveal()} disabled={busy} className={ghost}>
              <Eye className="size-4" /> {t("reveal")}
            </Button>
          )}
          {(phase === "closed" || phase === "revealed") && (
            <Button variant="outline" size="sm" onClick={() => void session.reopenVoting()} disabled={busy} className={ghost}>
              <RotateCcw className="size-4" /> {t("reopen")}
            </Button>
          )}
        </div>
      )}

      {timerRunning && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("skipLabel")}>
          {countdown.paused ? (
            <Button variant="outline" size="sm" onClick={() => void session.resumeTimer()} disabled={busy} className={ghost}>
              <Play className="size-4 fill-current" /> {t("resume")}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => void session.pauseTimer()} disabled={busy} className={ghost}>
              <Pause className="size-4" /> {t("pause")}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void session.extendTimer(30)}
            disabled={busy}
            aria-label={t("extendLabel")}
            className={ghost}
          >
            <TimerReset className="size-4" /> {t("extend")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void session.skip()} disabled={busy} title={t("skipLabel")} className={ghost}>
            <FastForward className="size-4" /> {t("skip")}
          </Button>
        </div>
      )}

      {!isLastSlide && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onEnd}
          disabled={busy}
          className="h-8 rounded-full px-3 text-sm font-medium text-deck-stage-fg/70 hover:bg-deck-stage-fg/10 hover:text-deck-stage-fg"
        >
          {t("end")}
        </Button>
      )}
    </div>
  );
}
