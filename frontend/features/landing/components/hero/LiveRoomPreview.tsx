"use client";

import { useEffect, useState } from "react";
import { Check, Users } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

const OPTIONS = ["Q&A tips", "Writing polls", "Quiz rounds"];
const START = [38, 22, 12];

/**
 * The hero's one moving part: a sample live session. Bars fill once on load,
 * then a new answer lands every couple of seconds, as on a presenter's screen.
 * It is an illustration (labelled "Sample session"), stays still for people who
 * ask for reduced motion, and is exposed to assistive tech as a single image.
 */
export function LiveRoomPreview({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  const [filled, setFilled] = useState(false);
  const [counts, setCounts] = useState(START);

  useEffect(() => {
    const id = requestAnimationFrame(() => setFilled(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (reduce) return;
    const weights = [0.5, 0.3, 0.2];
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      const roll = Math.random();
      const pick = roll < weights[0] ? 0 : roll < weights[0] + weights[1] ? 1 : 2;
      setCounts((prev) => prev.map((n, i) => (i === pick ? n + 1 + Math.floor(Math.random() * 2) : n)));
    }, 1900);
    return () => window.clearInterval(timer);
  }, [reduce]);

  const total = counts.reduce((a, b) => a + b, 0);
  const lead = counts.indexOf(Math.max(...counts));

  return (
    <div
      role="img"
      aria-label="Illustration of a sample live session: answers from the audience fill bars on the presenter's screen while a phone shows the same question."
      className={cn("relative mx-auto w-full max-w-xl", className)}
    >
      <div aria-hidden="true" className="pointer-events-none absolute -inset-8 -z-10 rounded-full bg-primary/10 blur-3xl" />

      {/* Presenter screen: double bezel */}
      <div className="rounded-[2rem] border border-foreground/10 bg-foreground/5 p-1.5 shadow-2xl shadow-black/10 dark:shadow-black/50">
        <div className="rounded-[calc(2rem-0.375rem)] bg-card p-5 shadow-[inset_0_2px_10px_rgba(0,0,0,0.05)] sm:p-7 dark:shadow-[inset_0_4px_20px_rgba(0,0,0,0.8)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="relative flex size-2.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/60" />
                <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
              </span>
              <span className="text-sm font-semibold text-foreground">Live</span>
              <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">
                Sample session
              </span>
            </div>
            <div className="flex items-center gap-2.5 rounded-xl border border-border bg-background/60 px-3 py-1.5">
              <span className="text-xs text-muted-foreground">Join code</span>
              <span className="font-mono text-base font-semibold tracking-[0.18em] text-foreground">482913</span>
            </div>
          </div>

          <p className="mt-7 text-balance text-2xl font-bold leading-tight tracking-tight text-foreground sm:text-[1.75rem]">
            What should we cover next?
          </p>

          <ul className="mt-6 space-y-4">
            {OPTIONS.map((label, i) => {
              const pct = Math.round((counts[i] / total) * 100);
              const isLead = i === lead;
              return (
                <li key={label}>
                  <div className="mb-2 flex items-baseline gap-3 text-base">
                    <span className={cn("font-medium", isLead ? "text-foreground" : "text-foreground/80")}>{label}</span>
                    <span className={cn("tabular-nums text-sm font-semibold", isLead ? "text-brand-ink" : "text-muted-foreground")}>
                      {pct}%
                    </span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-foreground/10">
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width,background-color] duration-[900ms] ease-[cubic-bezier(0.32,0.72,0,1)]",
                        isLead ? "bg-primary" : "bg-foreground/30",
                      )}
                      style={{ width: filled ? `${pct}%` : "0%" }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-6 flex items-center gap-2 border-t border-border pt-4 text-sm text-muted-foreground">
            <Users className="size-4" aria-hidden="true" />
            <span className="tabular-nums">{total} answers</span>
          </div>
        </div>
      </div>

      {/* Phone: what the audience sees */}
      <div className="absolute -bottom-10 -right-3 hidden w-44 rotate-[3deg] rounded-[2rem] border border-foreground/15 bg-background p-1.5 shadow-2xl shadow-black/20 sm:block lg:-right-6 dark:shadow-black/60">
        <div className="rounded-[calc(2rem-0.375rem)] border border-border bg-card px-3.5 pb-4 pt-5">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-foreground/15" />
          <p className="text-sm font-bold leading-snug text-foreground">What should we cover next?</p>
          <div className="mt-3 space-y-1.5">
            {OPTIONS.map((label, i) => (
              <div
                key={label}
                className={cn(
                  "flex items-center justify-between rounded-lg border px-2.5 py-2 text-xs font-medium",
                  i === 0
                    ? "border-primary bg-primary/15 text-foreground"
                    : "border-border text-muted-foreground",
                )}
              >
                <span className="truncate">{label}</span>
                {i === 0 ? <Check className="size-3.5 shrink-0 text-brand-ink" aria-hidden="true" /> : null}
              </div>
            ))}
          </div>
          <p className="mt-3 text-center text-xs font-medium text-brand-ink">Answer sent</p>
        </div>
      </div>
    </div>
  );
}
