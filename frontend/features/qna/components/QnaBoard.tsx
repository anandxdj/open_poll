"use client";

import { MessageCircleQuestion, ThumbsUp } from "lucide-react";
import { useTranslations } from "next-intl";

import { useLiveOptional } from "@/features/presentations/live/store";
import { cn } from "@/lib/utils";
import { questionsWithStatus, sortQuestions, type QnaItem } from "../state";
import { selectQna } from "../useQnaSync";

const MAX_ON_BOARD = 8;

/** Placeholder rows for slide thumbnails, which have no session. */
const THUMBNAIL_ROWS = [0.8, 0.6, 0.7];

/**
 * The Q&A slide on the stage: the session's visible questions, most upvoted
 * first with pinned ones on top. Answered questions drop to the bottom.
 * `mode="thumbnail"` draws the empty look for slide rails.
 */
export function QnaBoard({ thumbnail = false }: { thumbnail?: boolean }) {
  const t = useTranslations("qna");
  const qna = useLiveOptional(selectQna);
  const joinCode = useLiveOptional((s) => s.joinCode);

  const open = sortQuestions(questionsWithStatus(qna, "visible"), "top");
  const answered = sortQuestions(questionsWithStatus(qna, "answered"), "new");
  const rows: QnaItem[] = [...open, ...answered];
  const shown = rows.slice(0, MAX_ON_BOARD);
  const hidden = rows.length - shown.length;
  const stageQuestionId = qna.highlightedId;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-3 text-left">
      <div className="flex items-center justify-center gap-2 text-sm font-bold text-deck-primary">
        <MessageCircleQuestion className="size-4" aria-hidden /> {t("stage.title")}
      </div>

      {thumbnail ? (
        <ul className="space-y-2" aria-hidden>
          {THUMBNAIL_ROWS.map((width, index) => (
            <li key={index} className="flex items-center gap-3 rounded-2xl border border-deck-stage-fg/10 bg-deck-stage-fg/[0.04] px-4 py-3">
              <span className="h-2.5 rounded-full bg-deck-stage-fg/20" style={{ width: `${width * 100}%` }} />
            </li>
          ))}
        </ul>
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-base text-deck-stage-fg/50" role="status">
          {t("stage.empty")}
        </p>
      ) : (
        <ul className="space-y-2" aria-label={t("stage.title")}>
          {shown.map((item) => (
            <li
              key={item.id}
              className={cn(
                "flex items-start gap-4 rounded-2xl border px-5 py-3.5",
                item.id === stageQuestionId ? "border-deck-accent/50 bg-deck-accent/10" : "border-deck-stage-fg/10 bg-deck-stage-fg/[0.04]",
                item.status === "answered" && "opacity-60"
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="text-lg font-semibold leading-snug break-words text-deck-stage-fg">{item.text}</p>
                <p className="mt-0.5 text-xs font-medium text-deck-stage-fg/50">
                  {item.authorName ?? t("list.anonymousAuthor")}
                  {item.status === "answered" && ` · ${t("list.answered")}`}
                </p>
              </div>
              <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-deck-stage-fg/10 px-3 py-1 text-sm font-bold tabular-nums text-deck-stage-fg/80">
                <ThumbsUp className="size-3.5" aria-hidden /> {item.upvoteCount}
                <span className="sr-only">{t("list.votes", { count: item.upvoteCount })}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {hidden > 0 && <p className="text-center text-xs text-deck-stage-fg/40">{t("stage.more", { count: hidden })}</p>}

      {!thumbnail && joinCode && (
        <p className="text-center text-xs text-deck-stage-fg/40">{t("stage.ask", { code: joinCode })}</p>
      )}
    </div>
  );
}
