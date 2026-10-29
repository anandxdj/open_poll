"use client";

import { ExternalLink, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { slideLabel, slideTypeMeta } from "@/features/presentations/slides/meta";
import type { PresentationSlide } from "@/features/presentations/types/deck";
import { MockDataNotice } from "./AiSourceNotice";
import type { DeckCreatedResponse } from "./types";

/** A slide's host-only speaker notes, trimmed. */
const notesOf = (slide: PresentationSlide) => {
  const notes = slide.notes;
  return typeof notes === "string" ? notes.trim() : "";
};

/** Number of slides that carry speaker notes. */
export const countSlidesWithNotes = (slides: readonly PresentationSlide[]) => slides.filter((slide) => notesOf(slide)).length;

interface AiDeckResultProps {
  result: DeckCreatedResponse;
  onOpen: () => void;
  onAnother: () => void;
}

/** The finished deck: where it came from, what to check, and what was written. */
export function AiDeckResult({ result, onOpen, onAnother }: AiDeckResultProps) {
  const t = useTranslations("ai.deck");
  const { presentation, source, warnings, usage } = result;
  const slides = presentation.slides;

  return (
    <div className="grid gap-4" data-testid="ai-deck-result">
      <div className="grid gap-1">
        <h3 className="text-base font-semibold">{t("result.title")}</h3>
        <p className="text-sm font-medium">{presentation.title}</p>
        <p className="text-xs text-muted-foreground" data-testid="ai-deck-summary">
          {t("result.summary", { slides: slides.length, notes: countSlidesWithNotes(slides) })}
        </p>
      </div>

      {source === "mock" ? (
        <MockDataNotice />
      ) : (
        <p role="status" className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm">
          <Sparkles className="size-4 shrink-0 text-accent-ink" aria-hidden />
          {t("result.aiNotice")}
        </p>
      )}

      {warnings.length > 0 && (
        <div className="grid gap-1 rounded-lg border border-border bg-secondary/40 px-4 py-3 text-sm" data-testid="ai-deck-warnings">
          <p className="font-semibold">{t("warnings.title", { count: warnings.length })}</p>
          <ul className="list-disc pl-5 text-muted-foreground">
            {warnings.map((warning, i) => (
              <li key={i}>{warning.message}</li>
            ))}
          </ul>
        </div>
      )}

      <ol aria-label={t("result.list")} className="grid max-h-[34vh] gap-1.5 overflow-y-auto pr-1" data-testid="ai-deck-slides">
        {slides.map((slide, i) => {
          const meta = slideTypeMeta(slide.type);
          const notes = notesOf(slide);
          return (
            <li key={slide._id ?? i} className="grid gap-1 rounded-lg border border-border bg-secondary/40 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold tabular-nums text-muted-foreground">{i + 1}</span>
                <meta.Icon className={`size-3.5 shrink-0 ${meta.iconClass}`} aria-hidden />
                <span className="truncate text-sm font-medium">{slideLabel(slide)}</span>
              </div>
              <p className="line-clamp-2 pl-6 text-xs text-muted-foreground">
                {notes ? (
                  <>
                    <span className="font-semibold">{t("result.notes")}: </span>
                    {notes}
                  </>
                ) : (
                  t("result.noNotes")
                )}
              </p>
            </li>
          );
        })}
      </ol>

      {usage && (
        <p className="text-xs text-muted-foreground">
          {usage.limit === null ? t("result.usageUnlimited", { used: usage.used }) : t("result.usage", { used: usage.used, limit: usage.limit })}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" className="rounded-xl" onClick={onAnother}>
          {t("result.another")}
        </Button>
        <Button type="button" onClick={onOpen}>
          <ExternalLink className="mr-1.5 size-4" aria-hidden />
          {t("result.open")}
        </Button>
      </div>
    </div>
  );
}
