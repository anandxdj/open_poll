"use client";

import { MessageCircleQuestion } from "lucide-react";
import { useTranslations } from "next-intl";

import { QnaPanel } from "@/features/qna/components/QnaPanel";
import type { ParticipantViewProps } from "../../runtime";

/**
 * The phone view of a Q&A slide: the same ask-and-upvote panel as the Q&A
 * tab. Previews (builder) show an inert stand-in.
 */
export function QnaParticipant({ slide, mode }: ParticipantViewProps) {
  const t = useTranslations("qna");
  if (mode === "preview") {
    return (
      <div className="w-full space-y-3 text-center">
        <div className="flex items-center justify-center gap-2 text-sm font-bold text-deck-primary">
          <MessageCircleQuestion className="size-4" aria-hidden /> {slide.question || t("title")}
        </div>
        <p className="rounded-2xl border border-deck-border/50 bg-deck-surface/40 px-4 py-3 text-sm text-deck-muted-fg">
          {t("ask.placeholder")}
        </p>
      </div>
    );
  }
  return <QnaPanel />;
}
