"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { LIVE_ERROR_CODES } from "../../live/errors";
import type { PendingAnswer } from "../../live/reducer";
import { useLiveStore } from "../../live/store";

/** Toast text for a refused queued answer to a slide that is no longer on screen. */
function offScreenRefusalKey(code: string | null) {
  if (code === LIVE_ERROR_CODES.timeUp) return "syncRefusedSlideTimeUp" as const;
  if (code === LIVE_ERROR_CODES.notAccepting) return "syncRefusedSlideClosed" as const;
  return "syncRefusedSlideOther" as const;
}

/**
 * Tells the participant when an answer from the offline queue was refused for
 * a slide that is no longer on screen (the host moved on while the phone was
 * offline). A refusal for the slide on screen needs no toast:
 * `ParticipantSlide` shows it in place of "Saved — will sync".
 */
export function useAnswerSyncNotices() {
  const store = useLiveStore();
  const t = useTranslations("live.participant");

  useEffect(() => {
    let previous: Record<string, PendingAnswer> = store.getState().pendingAnswers;
    return store.subscribe((state) => {
      if (state.pendingAnswers === previous) return;
      const before = previous;
      previous = state.pendingAnswers;
      for (const [key, entry] of Object.entries(state.pendingAnswers)) {
        if (entry.status !== "refused" || before[key]?.status === "refused") continue;
        const onScreen = entry.slideIndex === state.currentSlideIndex && (entry.slideId === null || entry.slideId === state.slideId);
        if (onScreen) continue;
        // Kicked / stale credentials get their own screen from the shell.
        if (entry.code === LIVE_ERROR_CODES.participantKicked || entry.code === LIVE_ERROR_CODES.participantStale) continue;
        toast.error(t(offScreenRefusalKey(entry.code), { slide: entry.slideIndex + 1 }));
      }
    });
  }, [store, t]);
}
