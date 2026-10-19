"use client";

import { useState } from "react";
import { Loader2, Minus, Plus, Send } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import type { ParticipantViewProps } from "../../runtime";
import {
  HUNDRED_POINTS_TOTAL,
  hundredPointsItems,
  isCompleteAnswer,
  remainingPoints,
  withPoints,
  withPointsWithinTotal,
} from "./config";

/** Points moved by the − and + buttons. */
const NUDGE = 5;

/** Exactly 100 points to hand out in whole numbers: a slider, buttons and a number field per item. */
export function HundredPointsParticipant({ slide, mode, onSubmit, submitting }: ParticipantViewProps) {
  const t = useTranslations("slidesAdvanced.hundredPoints");
  const items = hundredPointsItems(slide);
  const [points, setPoints] = useState<number[]>(() => items.map(() => 0));
  // The text of the number field being typed in, until it loses focus ("" while empty).
  const [typing, setTyping] = useState<{ index: number; text: string } | null>(null);
  const locked = submitting || mode === "preview";
  const left = remainingPoints(points);
  const complete = isCompleteAnswer(points, items.length);

  return (
    <div className="space-y-5 w-full">
      <div
        role="status"
        aria-live="polite"
        className={`rounded-2xl border px-4 py-3 text-center text-sm font-bold tabular-nums ${
          left === 0
            ? "border-deck-correct/50 bg-deck-correct-deep/20 text-deck-correct-soft"
            : left < 0
              ? "border-deck-wrong/50 text-deck-wrong"
              : "border-deck-border/60 bg-deck-surface/60 text-deck-fg"
        }`}
      >
        {left === 0 ? t("allShared") : left > 0 ? t("left", { count: left }) : t("over", { count: -left })}
      </div>

      <ul className="space-y-3">
        {items.map((item, i) => {
          const value = points[i] ?? 0;
          return (
            <li key={i} className="rounded-2xl border border-deck-border/60 bg-deck-surface/60 p-4 space-y-3 shadow-sm">
              <p className="text-sm font-semibold leading-snug break-words">{item}</p>
              <div className="flex items-center gap-2">
                <StepButton
                  label={t("less", { item })}
                  disabled={locked || value === 0}
                  onClick={() => setPoints((prev) => withPoints(prev, i, (prev[i] ?? 0) - NUDGE))}
                >
                  <Minus className="size-4" />
                </StepButton>
                <input
                  type="range"
                  min={0}
                  max={HUNDRED_POINTS_TOTAL}
                  step={1}
                  value={value}
                  disabled={locked}
                  aria-label={t("slider", { item })}
                  onChange={(event) => setPoints((prev) => withPointsWithinTotal(prev, i, Number(event.target.value)))}
                  className="h-2 min-w-0 flex-1 cursor-pointer rounded-lg bg-deck-secondary accent-deck-primary disabled:cursor-not-allowed"
                />
                <StepButton
                  label={t("more", { item })}
                  disabled={locked || left <= 0}
                  onClick={() => setPoints((prev) => withPointsWithinTotal(prev, i, (prev[i] ?? 0) + NUDGE))}
                >
                  <Plus className="size-4" />
                </StepButton>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={HUNDRED_POINTS_TOTAL}
                  step={1}
                  value={typing?.index === i ? typing.text : value}
                  disabled={locked}
                  aria-label={t("points", { item })}
                  onChange={(event) => {
                    setTyping({ index: i, text: event.target.value });
                    setPoints((prev) => withPoints(prev, i, Number(event.target.value)));
                  }}
                  onBlur={() => setTyping(null)}
                  className="h-11 w-16 shrink-0 rounded-xl border border-deck-border bg-deck-secondary/40 px-2 text-center text-base font-bold tabular-nums text-deck-fg outline-none focus-visible:ring-2 focus-visible:ring-deck-primary/50 disabled:opacity-60"
                />
              </div>
            </li>
          );
        })}
      </ul>

      <Button
        onClick={() => onSubmit({ payload: { points } })}
        disabled={locked || !complete}
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

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-deck-border bg-deck-secondary/40 text-deck-fg/80 transition-all hover:bg-deck-secondary disabled:opacity-30"
    >
      {children}
    </button>
  );
}
