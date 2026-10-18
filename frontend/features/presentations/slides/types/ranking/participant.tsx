"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown, ChevronUp, Loader2, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { ParticipantViewProps } from "../../runtime";

export function RankingParticipant({ slide, mode, onSubmit, submitting }: ParticipantViewProps) {
  const t = useTranslations("live.slides.ranking");
  const { items } = slide;
  // Item indices in the participant's order; starts as authored.
  const [rankingOrder, setRankingOrder] = useState<number[]>(() => (items ?? []).map((_, i) => i));
  const locked = submitting || mode === "preview";

  const moveItem = (from: number, to: number) =>
    setRankingOrder((prev) => {
      const next = [...prev];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });

  return (
    <div className="space-y-4 w-full">
      <p className="text-xs text-center text-deck-muted-fg font-medium">{t("hint")}</p>

      <div className="space-y-2.5">
        {rankingOrder.map((itemIndex, position) => (
          <motion.div
            key={itemIndex}
            layout
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 350, damping: 25 }}
            className="flex items-center gap-3 rounded-2xl border border-deck-border/80 bg-deck-surface/70 px-4 py-3 shadow-sm"
          >
            <div className="flex size-7 items-center justify-center rounded-xl bg-deck-primary/15 border border-deck-primary/30 text-xs font-bold text-deck-primary tabular-nums shrink-0">
              #{position + 1}
            </div>

            <span className="flex-1 text-sm font-semibold truncate">{items[itemIndex]}</span>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                disabled={position === 0 || locked}
                onClick={() => moveItem(position, position - 1)}
                className="flex size-8 items-center justify-center rounded-xl border border-deck-border bg-deck-secondary/40 disabled:opacity-20 hover:bg-deck-secondary transition-all"
              >
                <ChevronUp className="size-4 text-deck-fg/80" />
              </button>
              <button
                type="button"
                disabled={position === rankingOrder.length - 1 || locked}
                onClick={() => moveItem(position, position + 1)}
                className="flex size-8 items-center justify-center rounded-xl border border-deck-border bg-deck-secondary/40 disabled:opacity-20 hover:bg-deck-secondary transition-all"
              >
                <ChevronDown className="size-4 text-deck-fg/80" />
              </button>
            </div>
          </motion.div>
        ))}
      </div>

      <Button
        onClick={() => onSubmit({ ranking: rankingOrder })}
        disabled={locked}
        className="w-full h-12 rounded-2xl bg-deck-primary text-deck-primary-fg font-bold text-base shadow-md transition-all"
      >
        {submitting ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <span className="flex items-center gap-2">
            {t("submit")} <Send className="size-4" />
          </span>
        )}
      </Button>
    </div>
  );
}
