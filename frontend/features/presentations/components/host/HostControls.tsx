"use client";

import { ArrowRight, ChevronLeft, Flag, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLive } from "../../live/store";

interface HostControlsProps {
  busy: boolean;
  onAdvance: (targetIndex?: number) => void;
  onEnd: () => void;
  onOpenLobby: () => void;
}

/** Host console bottom bar: previous / next slide, end session, host again. */
export function HostControls({ busy, onAdvance, onEnd, onOpenLobby }: HostControlsProps) {
  const status = useLive((s) => s.status);
  const slideIndex = useLive((s) => s.currentSlideIndex);
  const totalSlides = useLive((s) => s.totalSlides);
  const isLastSlide = slideIndex >= totalSlides - 1;

  return (
    <footer className="shrink-0 border-t border-deck-stage-fg/10 bg-deck-stage-chrome px-5 py-3 flex items-center justify-between gap-4">
      <div className="flex items-center gap-2 min-w-[120px]">
        {status === "active" && slideIndex > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onAdvance(slideIndex - 1)}
            disabled={busy}
            className="h-8 rounded-full border-deck-stage-fg/15 bg-deck-stage-fg/5 text-xs font-semibold text-deck-stage-fg/80 hover:bg-deck-stage-fg/10 hover:text-deck-stage-fg"
          >
            <ChevronLeft className="size-3.5 mr-1" /> Prev Slide
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        {status === "active" &&
          (!isLastSlide ? (
            <Button
              onClick={() => onAdvance()}
              disabled={busy}
              className="h-9 rounded-full bg-deck-primary text-deck-primary-fg font-bold px-6 text-xs hover:opacity-90 shadow-md shadow-deck-primary/20"
            >
              Next Slide <ArrowRight className="size-3.5 ml-1.5" />
            </Button>
          ) : (
            <Button
              onClick={onEnd}
              disabled={busy}
              className="h-9 rounded-full bg-deck-danger text-deck-stage-fg font-bold px-6 text-xs hover:bg-deck-danger-strong shadow-md shadow-deck-danger/20"
            >
              <Flag className="size-3.5 mr-1.5" /> End Session
            </Button>
          ))}
        {status === "ended" && (
          <Button
            onClick={onOpenLobby}
            disabled={busy}
            className="h-9 rounded-full bg-deck-primary text-deck-primary-fg font-bold px-6 text-xs hover:opacity-90"
          >
            <RotateCcw className="size-3.5 mr-1.5" /> Host Again
          </Button>
        )}
      </div>
      <div className="flex items-center gap-3 min-w-[120px] justify-end text-xs text-deck-stage-fg/40 font-mono">
        {status === "active" && (
          <span>
            {slideIndex + 1} / {totalSlides}
          </span>
        )}
      </div>
    </footer>
  );
}
