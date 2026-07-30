"use client";

import { motion } from "framer-motion";
import { ChevronDown, ChevronUp, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";

interface RankingInputProps {
  items: string[];
  rankingOrder: number[];
  onMoveItem: (fromPosition: number, toPosition: number) => void;
  onSubmit: () => void;
  submitting: boolean;
}

export function RankingInput({
  items,
  rankingOrder,
  onMoveItem,
  onSubmit,
  submitting,
}: RankingInputProps) {
  return (
    <div className="space-y-4 w-full">
      <p className="text-xs text-center text-muted-foreground font-medium">
        Use arrows to order items from top (#1) to bottom
      </p>

      <div className="space-y-2.5">
        {rankingOrder.map((itemIndex, position) => (
          <motion.div
            key={itemIndex}
            layout
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 350, damping: 25 }}
            className="flex items-center gap-3 rounded-2xl border border-border/80 bg-card/70 px-4 py-3 shadow-sm"
          >
            <div className="flex size-7 items-center justify-center rounded-xl bg-primary/15 border border-primary/30 text-xs font-bold text-primary tabular-nums shrink-0">
              #{position + 1}
            </div>

            <span className="flex-1 text-sm font-semibold truncate">
              {items[itemIndex]}
            </span>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                disabled={position === 0 || submitting}
                onClick={() => onMoveItem(position, position - 1)}
                className="flex size-8 items-center justify-center rounded-xl border border-border bg-secondary/40 disabled:opacity-20 hover:bg-secondary transition-all"
              >
                <ChevronUp className="size-4 text-foreground/80" />
              </button>
              <button
                type="button"
                disabled={position === rankingOrder.length - 1 || submitting}
                onClick={() => onMoveItem(position, position + 1)}
                className="flex size-8 items-center justify-center rounded-xl border border-border bg-secondary/40 disabled:opacity-20 hover:bg-secondary transition-all"
              >
                <ChevronDown className="size-4 text-foreground/80" />
              </button>
            </div>
          </motion.div>
        ))}
      </div>

      <Button
        onClick={onSubmit}
        disabled={submitting}
        className="w-full h-12 rounded-2xl bg-primary text-primary-foreground font-bold text-base shadow-md transition-all"
      >
        {submitting ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <span className="flex items-center gap-2">
            Submit Ranking <Send className="size-4" />
          </span>
        )}
      </Button>
    </div>
  );
}
