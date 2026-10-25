"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { CountUp, ease, useInstant } from "./motion";

/**
 * One answer of a sample result as a card: the share fills the card from the
 * left, the leading answer is tinted with the accent, the percentage counts
 * to its value, and `bump` (any value that changes when a vote lands on this
 * answer) pops a "+1". Follows the app theme. Part of an illustration, so it
 * renders no interactive elements.
 */
export function ResultRow({
  letter,
  label,
  pct,
  lead = false,
  correct = false,
  delay = 0,
  bump,
  size = "md",
}: {
  letter: string;
  label: string;
  pct: number;
  lead?: boolean;
  correct?: boolean;
  delay?: number;
  bump?: number;
  size?: "sm" | "md";
}) {
  const instant = useInstant();
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border bg-card shadow-[0_1px_2px_rgb(23_23_23/0.06)] transition-colors duration-500",
        lead ? "border-primary/45" : "border-border",
      )}
    >
      {/* The share, filling the card from the left */}
      <motion.div
        aria-hidden="true"
        className={cn("absolute inset-y-0 left-0 transition-colors duration-500", lead ? "bg-primary/15" : "bg-secondary")}
        initial={{ width: "0%" }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: instant ? 0 : 0.9, ease, delay: instant ? 0 : delay }}
      />
      <div className={cn("relative flex items-center gap-3", size === "sm" ? "px-3 py-2" : "px-3.5 py-3")}>
        <span
          className={cn(
            "flex shrink-0 items-center justify-center rounded-md border font-mono text-xs font-medium transition-colors duration-500",
            size === "sm" ? "size-6" : "size-7",
            lead ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground",
          )}
        >
          {letter}
        </span>
        <span
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1.5",
            size === "sm" ? "text-sm" : "text-sm sm:text-base",
            lead ? "font-medium text-foreground" : "text-muted-foreground",
          )}
        >
          <span className="truncate">{label}</span>
          {correct ? <Check className="size-4 shrink-0 text-success" strokeWidth={2.5} aria-hidden="true" /> : null}
        </span>
        <span className="relative">
          <AnimatePresence>
            {bump !== undefined && !instant ? (
              <motion.span
                key={bump}
                aria-hidden="true"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: [0, 1, 1, 0], y: -18 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.1, ease: "easeOut" }}
                className="absolute -top-1 right-0 rounded-full bg-primary px-1.5 font-mono text-xs font-medium text-primary-foreground"
              >
                +1
              </motion.span>
            ) : null}
          </AnimatePresence>
          <CountUp
            value={pct}
            suffix="%"
            duration={700}
            className={cn("font-mono text-sm font-medium tabular-nums", lead ? "text-accent-ink" : "text-muted-foreground")}
          />
        </span>
      </div>
    </div>
  );
}
