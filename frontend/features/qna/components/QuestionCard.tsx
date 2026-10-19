"use client";

import { Check, Pin, ThumbsUp } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import type { QnaItem } from "../state";

/** Who asked, as the audience sees it: the nickname, "You", or "Anonymous". */
export function authorLabel(item: QnaItem, t: (key: "list.anonymousAuthor" | "list.you") => string): string {
  if (item.mine) return t("list.you");
  return item.authorName ?? t("list.anonymousAuthor");
}

/**
 * One question on a participant's phone: text, author, status chips and the
 * upvote button (disabled for the participant's own question and while Q&A
 * upvotes are off).
 */
export function QuestionCard({
  item,
  onStage,
  canUpvote,
  voting,
  onToggleUpvote,
}: {
  item: QnaItem;
  /** The host is showing this question over the stage. */
  onStage: boolean;
  /** Upvotes are on for this deck. */
  canUpvote: boolean;
  voting: boolean;
  onToggleUpvote: (item: QnaItem) => void;
}) {
  const t = useTranslations("qna");
  const pending = item.status === "pending";
  const answered = item.status === "answered";
  const own = Boolean(item.mine);

  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-2xl border px-4 py-3",
        onStage ? "border-deck-accent/50 bg-deck-accent/10" : "border-deck-border/50 bg-deck-surface/60",
        pending && "border-dashed opacity-90"
      )}
    >
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-sm font-medium leading-snug break-words text-deck-fg">{item.text}</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-deck-muted-fg">
          <span className="font-semibold">{authorLabel(item, t)}</span>
          {item.pinned && (
            <span className="inline-flex items-center gap-1 text-deck-accent">
              <Pin className="size-3" aria-hidden /> {t("list.pinned")}
            </span>
          )}
          {answered && (
            <span className="inline-flex items-center gap-1 text-deck-correct">
              <Check className="size-3" aria-hidden /> {t("list.answered")}
            </span>
          )}
          {onStage && <span className="font-semibold text-deck-accent">{t("list.onScreen")}</span>}
          {pending && <span className="font-semibold text-deck-accent">{t("list.pending")}</span>}
        </div>
      </div>

      {!pending && (
        <button
          type="button"
          onClick={() => onToggleUpvote(item)}
          disabled={!canUpvote || own || voting}
          aria-pressed={Boolean(item.upvoted)}
          aria-label={t("list.upvote", { text: item.text })}
          title={own ? t("list.ownQuestion") : undefined}
          className={cn(
            "flex shrink-0 flex-col items-center gap-0.5 rounded-xl border px-2.5 py-1.5 text-xs font-bold tabular-nums transition-colors",
            item.upvoted
              ? "border-deck-primary/50 bg-deck-primary/15 text-deck-primary"
              : "border-deck-border/60 text-deck-muted-fg hover:text-deck-fg",
            (!canUpvote || own) && "opacity-60"
          )}
        >
          <ThumbsUp className="size-4" aria-hidden />
          <span aria-hidden>{item.upvoteCount}</span>
          <span className="sr-only">{t("list.votes", { count: item.upvoteCount })}</span>
        </button>
      )}
    </li>
  );
}
