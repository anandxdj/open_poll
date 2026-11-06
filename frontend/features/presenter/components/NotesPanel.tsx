"use client";

import { NotebookPen } from "lucide-react";
import { useTranslations } from "next-intl";
import { useLive } from "@/features/presentations/live/store";

/** The slide the presenter is about to talk over: the current one, else (lobby, not started) the first. */
export const notesSlideIndex = (status: string | null, currentSlideIndex: number) =>
  status === "active" && currentSlideIndex >= 0 ? currentSlideIndex : 0;

/**
 * Speaker notes of the slide on screen. They come from the host's own deck
 * (host state); no participant payload carries them, and the audience window
 * never renders this panel.
 */
export function NotesPanel() {
  const t = useTranslations("presenter.console");
  const status = useLive((s) => s.status);
  const index = useLive((s) => notesSlideIndex(s.status, s.currentSlideIndex));
  const notes = useLive((s) => (s.deck?.slides[notesSlideIndex(s.status, s.currentSlideIndex)]?.notes ?? "").trim());

  return (
    <section aria-labelledby="presenter-notes-title" className="flex min-h-0 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="presenter-notes-title" className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-deck-stage-muted">
          <NotebookPen className="size-3.5" aria-hidden="true" /> {t("notes")}
        </h2>
        {status !== "active" && <span className="text-xs text-deck-stage-muted">#{index + 1}</span>}
      </div>
      {notes ? (
        <div
          data-testid="speaker-notes"
          tabIndex={0}
          className="max-h-64 min-h-24 overflow-y-auto whitespace-pre-wrap rounded-lg border border-deck-stage-fg/10 bg-deck-stage-panel px-4 py-3 text-[17px] leading-relaxed text-deck-stage-fg"
        >
          {notes}
        </div>
      ) : (
        <p data-testid="speaker-notes" className="rounded-lg border border-dashed border-deck-stage-fg/15 px-4 py-3 text-sm text-deck-stage-muted">
          {t("noNotes")}
        </p>
      )}
      <p className="text-xs text-deck-stage-muted">{t("notesHint")}</p>
    </section>
  );
}
