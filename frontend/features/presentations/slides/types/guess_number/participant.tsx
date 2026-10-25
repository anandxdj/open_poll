"use client";

import { useId, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { formatNumber } from "../../advanced/read";
import type { ParticipantViewProps } from "../../runtime";
import { guessNumberConfig, snapGuess } from "./config";

/** A slider and a number field for one guess, starting mid-range. */
export function GuessNumberParticipant({ slide, mode, onSubmit, submitting }: ParticipantViewProps) {
  const t = useTranslations("slidesAdvanced.guessNumber");
  const config = guessNumberConfig(slide);
  const { min, max, step } = config;
  const [value, setValue] = useState(() => snapGuess((min + max) / 2, config));
  // What the participant is typing, until the field loses focus.
  const [typed, setTyped] = useState<string | null>(null);
  const inputId = useId();
  const locked = submitting || mode === "preview";

  const typedNumber = typed === null || typed.trim() === "" ? null : Number(typed);
  const outOfRange = typedNumber !== null && Number.isFinite(typedNumber) && (typedNumber < min || typedNumber > max);

  return (
    <div className="space-y-6 w-full">
      <div className="rounded-2xl border border-deck-border/60 bg-deck-surface/60 p-5 space-y-5 shadow-sm">
        <p
          aria-hidden
          className="text-center text-5xl font-black tabular-nums text-deck-primary"
          data-testid="guess-value"
        >
          {formatNumber(value, 4)}
        </p>

        <div className="space-y-2">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            disabled={locked}
            aria-label={t("slider")}
            aria-valuetext={formatNumber(value, 4)}
            onChange={(event) => {
              setTyped(null);
              setValue(snapGuess(Number(event.target.value), config));
            }}
            className="w-full h-3 rounded-lg accent-deck-primary bg-deck-secondary cursor-pointer disabled:cursor-not-allowed"
          />
          <div className="flex justify-between text-xs font-medium text-deck-muted-fg tabular-nums">
            <span>{formatNumber(min, 4)}</span>
            <span>{formatNumber(max, 4)}</span>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor={inputId} className="block text-xs font-semibold text-deck-muted-fg">
            {t("typeIt")}
          </label>
          <input
            id={inputId}
            type="number"
            inputMode="decimal"
            min={min}
            max={max}
            step={step}
            disabled={locked}
            value={typed ?? String(value)}
            aria-invalid={outOfRange || undefined}
            onChange={(event) => {
              setTyped(event.target.value);
              const parsed = event.target.value.trim() === "" ? NaN : Number(event.target.value);
              if (Number.isFinite(parsed)) setValue(snapGuess(parsed, config));
            }}
            onBlur={() => setTyped(null)}
            className="h-12 w-full rounded-2xl border border-deck-border bg-deck-secondary/40 px-4 text-lg font-bold tabular-nums text-deck-fg outline-none focus-visible:ring-2 focus-visible:ring-deck-primary/50 disabled:opacity-60"
          />
          {outOfRange && (
            <p role="alert" className="text-xs font-medium text-deck-wrong">
              {t("outOfRange", { min: formatNumber(min, 4), max: formatNumber(max, 4) })}
            </p>
          )}
        </div>
      </div>

      <Button
        onClick={() => onSubmit({ payload: { value } })}
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
