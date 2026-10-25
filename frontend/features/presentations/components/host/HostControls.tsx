"use client";

import { ArrowRight, ChevronLeft, Eye, Flag, Lock, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useLive } from "../../live/store";
import { getSlideRuntime } from "../../slides/runtime";

interface HostControlsProps {
  busy: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onCloseVoting: () => void;
  onReopenVoting: () => void;
  onReveal: () => void;
  onEnd: () => void;
}

const ghost =
  "h-8 rounded-full border-deck-stage-fg/15 bg-deck-stage-fg/5 text-xs font-semibold text-deck-stage-fg/80 hover:bg-deck-stage-fg/10 hover:text-deck-stage-fg";

/**
 * Host console bottom bar. Previous / next move through the deck in both
 * directions; the middle group steps a response slide through its phases —
 * close voting (the only way to end an untimed slide), reveal, reopen.
 */
export function HostControls({
  busy,
  onPrevious,
  onNext,
  onCloseVoting,
  onReopenVoting,
  onReveal,
  onEnd,
}: HostControlsProps) {
  const t = useTranslations("presenter.controls");
  const status = useLive((s) => s.status);
  const phase = useLive((s) => s.phase);
  const slideIndex = useLive((s) => s.currentSlideIndex);
  const totalSlides = useLive((s) => s.totalSlides);
  const slideType = useLive((s) => s.deck?.slides[s.currentSlideIndex]?.type);
  const isLastSlide = slideIndex >= totalSlides - 1;
  const isResponse = slideType ? getSlideRuntime(slideType)?.lifecycle === "response" : false;

  return (
    <footer className="shrink-0 border-t border-deck-stage-fg/10 bg-deck-stage-chrome px-5 py-3 flex items-center justify-between gap-4">
      <div className="flex items-center gap-2 min-w-[120px]">
        {status === "active" && (
          <Button variant="outline" size="sm" onClick={onPrevious} disabled={busy || slideIndex <= 0} className={ghost}>
            <ChevronLeft className="size-3.5 mr-1" /> {t("previous")}
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2">
        {status === "active" && isResponse && (
          <>
            {phase === "open" && (
              <Button variant="outline" size="sm" onClick={onCloseVoting} disabled={busy} className={ghost}>
                <Lock className="size-3.5 mr-1.5" /> {t("closeVoting")}
              </Button>
            )}
            {(phase === "open" || phase === "closed") && (
              <Button variant="outline" size="sm" onClick={onReveal} disabled={busy} className={ghost}>
                <Eye className="size-3.5 mr-1.5" /> {t("reveal")}
              </Button>
            )}
            {(phase === "closed" || phase === "revealed") && (
              <Button variant="outline" size="sm" onClick={onReopenVoting} disabled={busy} className={ghost}>
                <RotateCcw className="size-3.5 mr-1.5" /> {t("reopen")}
              </Button>
            )}
          </>
        )}
        {status === "active" &&
          (!isLastSlide ? (
            <Button
              onClick={onNext}
              disabled={busy}
              className="h-9 rounded-full bg-deck-primary text-deck-primary-fg font-bold px-6 text-xs hover:opacity-90 shadow-md shadow-deck-primary/20"
            >
              {t("next")} <ArrowRight className="size-3.5 ml-1.5" />
            </Button>
          ) : (
            <Button
              onClick={onEnd}
              disabled={busy}
              className="h-9 rounded-full bg-deck-danger text-deck-stage-fg font-bold px-6 text-xs hover:bg-deck-danger-strong shadow-md shadow-deck-danger/20"
            >
              <Flag className="size-3.5 mr-1.5" /> {t("end")}
            </Button>
          ))}
      </div>

      <div className="flex items-center gap-3 min-w-[120px] justify-end text-xs text-deck-stage-fg/40 font-mono">
        {status === "active" && !isLastSlide && (
          <Button variant="ghost" size="sm" onClick={onEnd} disabled={busy} className="h-7 rounded-full px-2.5 text-[11px] font-semibold text-deck-stage-fg/50 hover:text-deck-stage-fg">
            {t("end")}
          </Button>
        )}
        {status === "active" && <span>{t("position", { current: slideIndex + 1, total: totalSlides })}</span>}
      </div>
    </footer>
  );
}
