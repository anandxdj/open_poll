"use client";

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown, ChevronUp, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { ParticipantViewProps } from "../../runtime";
import { SendingSpinner } from "../../SendingSpinner";

/**
 * Ranking on the phone: each item has Move up / Move down buttons (named after
 * the item, 44 px), focus stays on the item that moved (on its other button
 * once it reaches an end), and a polite live region says where it landed.
 */
export function RankingParticipant({ slide, mode, onSubmit, submitting }: ParticipantViewProps) {
  const t = useTranslations("live.slides.ranking");
  const { items } = slide;
  // Item indices in the participant's order; starts as authored.
  const [rankingOrder, setRankingOrder] = useState<number[]>(() => (items ?? []).map((_, i) => i));
  const [moved, setMoved] = useState<{ message: string; count: number }>({ message: "", count: 0 });
  const list = useRef<HTMLOListElement>(null);
  const locked = submitting || mode === "preview";

  const moveItem = (from: number, to: number) => {
    const itemIndex = rankingOrder[from]!;
    const next = [...rankingOrder];
    [next[from], next[to]] = [next[to]!, next[from]!];
    setRankingOrder(next);
    setMoved((prev) => ({ message: t("moved", { item: items[itemIndex] ?? "", position: to + 1 }), count: prev.count + 1 }));
    // At the top or the bottom the pressed button turns disabled: keep focus on the item's other button.
    const direction = to < from ? "up" : "down";
    const atEnd = to === 0 || to === next.length - 1;
    if (atEnd) {
      requestAnimationFrame(() => {
        list.current
          ?.querySelector<HTMLButtonElement>(`[data-item="${itemIndex}"][data-move="${direction === "up" ? "down" : "up"}"]`)
          ?.focus();
      });
    }
  };

  return (
    <div className="space-y-4 w-full">
      <p className="text-xs text-center text-deck-muted-fg font-medium" id={`ranking-hint-${slide.slideIndex}`}>
        {t("hint")}
      </p>

      <ol ref={list} className="space-y-2.5" aria-describedby={`ranking-hint-${slide.slideIndex}`}>
        {rankingOrder.map((itemIndex, position) => {
          const item = items[itemIndex] ?? "";
          return (
            <motion.li
              key={itemIndex}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 350, damping: 25 }}
              className="flex items-center gap-3 rounded-2xl border border-deck-border/80 bg-deck-surface/70 px-4 py-2 shadow-sm"
            >
              <div
                aria-hidden="true"
                className="flex size-7 items-center justify-center rounded-xl bg-deck-primary/15 border border-deck-primary/30 text-xs font-bold text-deck-primary-ink tabular-nums shrink-0"
              >
                #{position + 1}
              </div>

              <span className="flex-1 text-sm font-semibold truncate">
                <span className="sr-only">{t("position", { position: position + 1 })} </span>
                {item}
              </span>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  data-item={itemIndex}
                  data-move="up"
                  disabled={position === 0 || locked}
                  onClick={() => moveItem(position, position - 1)}
                  aria-label={t("moveUp", { item })}
                  className="flex size-11 items-center justify-center rounded-xl border border-deck-border bg-deck-secondary/40 disabled:opacity-30 hover:bg-deck-secondary transition-all"
                >
                  <ChevronUp className="size-5 text-deck-fg" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  data-item={itemIndex}
                  data-move="down"
                  disabled={position === rankingOrder.length - 1 || locked}
                  onClick={() => moveItem(position, position + 1)}
                  aria-label={t("moveDown", { item })}
                  className="flex size-11 items-center justify-center rounded-xl border border-deck-border bg-deck-secondary/40 disabled:opacity-30 hover:bg-deck-secondary transition-all"
                >
                  <ChevronDown className="size-5 text-deck-fg" aria-hidden="true" />
                </button>
              </div>
            </motion.li>
          );
        })}
      </ol>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {moved.message ? <span key={moved.count}>{moved.message}</span> : null}
      </p>

      <Button
        onClick={() => onSubmit({ ranking: rankingOrder })}
        disabled={locked}
        className="w-full h-12 rounded-2xl bg-deck-primary text-deck-primary-fg font-bold text-base shadow-md transition-all"
      >
        {submitting ? (
          <SendingSpinner />
        ) : (
          <span className="flex items-center gap-2">
            {t("submit")} <Send className="size-4" aria-hidden="true" />
          </span>
        )}
      </Button>
    </div>
  );
}
