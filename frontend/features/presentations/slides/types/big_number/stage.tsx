"use client";

import { useEffect, useState } from "react";
import { useFormatter } from "next-intl";

import { ContentStage } from "../../content/ContentViews";
import { readBigNumber } from "../../content/payloads";
import type { StageViewProps } from "../../runtime";
import { fractionDigits } from "./format";

const COUNT_UP_MS = 1200;

/** Counts from 0 up to `target` (ease-out) when `enabled`; instant with reduced motion. */
function useCountUp(target: number, enabled: boolean): number {
  const [current, setCurrent] = useState(enabled ? 0 : target);
  useEffect(() => {
    if (!enabled) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const startedAt = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = reduced ? 1 : Math.min(1, (now - startedAt) / COUNT_UP_MS);
      setCurrent(target * (1 - Math.pow(1 - progress, 3)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, enabled]);
  return enabled ? current : target;
}

/** The figure, as large as fits, with its prefix/suffix and label. Live, it counts up. */
export function BigNumberStage({ slide, mode }: StageViewProps) {
  const format = useFormatter();
  const { value, label, prefix, suffix } = readBigNumber(slide.content);
  const target = value ?? 0;
  const current = useCountUp(target, mode === "live" && value !== null);
  const digits = fractionDigits(target);
  const formatted = (n: number) =>
    format.number(n, { minimumFractionDigits: digits, maximumFractionDigits: digits });

  // Shrink the figure for long numbers so it never overflows the stage.
  const chars = `${prefix}${formatted(target)}${suffix}`.length;
  const figureSize = `clamp(2.75rem, ${Math.min(19, 150 / Math.max(chars, 1)).toFixed(1)}cqw, 11rem)`;

  return (
    <ContentStage mode={mode} className="flex flex-col items-center gap-[2.5cqw] py-[3cqw] text-center">
      <p
        className="flex max-w-full items-baseline justify-center font-black leading-none tracking-tight text-deck-accent tabular-nums"
        style={{ fontSize: figureSize }}
      >
        {prefix && <span className="mr-[0.08em] text-[0.55em] text-deck-accent/80">{prefix}</span>}
        {value === null ? (
          <span className="text-deck-stage-fg/30">0</span>
        ) : (
          <>
            <span aria-hidden>{formatted(current)}</span>
            <span className="sr-only">{formatted(target)}</span>
          </>
        )}
        {suffix && <span className="ml-[0.08em] text-[0.55em] text-deck-accent/80">{suffix}</span>}
      </p>
      {label && (
        <p className="max-w-[90%] text-[clamp(1.1rem,3.6cqw,2.2rem)] font-semibold leading-snug text-deck-stage-fg/75 text-balance">
          {label}
        </p>
      )}
    </ContentStage>
  );
}
