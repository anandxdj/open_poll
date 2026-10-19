"use client";

import { useEffect, useState } from "react";
import { Check, Users } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useReducedMotion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const OPTIONS = ["Running Q&A", "Writing good polls", "Quiz rounds", "Reading the report"];
const START = [34, 22, 14, 8];

/**
 * The hero visual: a sample live session, the projected screen next to a phone.
 * It always renders dark (the real stage does, whatever the app theme). Bars
 * fill once on load, then an answer lands every couple of seconds; reduced
 * motion keeps it still. Labelled "Sample session" and exposed as one image.
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
    const weights = [0.45, 0.28, 0.17, 0.1];
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      const roll = Math.random();
      let acc = 0;
      let pick = 0;
      for (let i = 0; i < weights.length; i++) {
        acc += weights[i];
        if (roll < acc) {
          pick = i;
          break;
        }
      }
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
      className={cn("grid items-end gap-5 md:grid-cols-[1fr_232px]", className)}
    >
      {/* Presenter screen */}
      <div className="dark overflow-hidden rounded-2xl border border-border bg-background text-foreground shadow-2xl shadow-black/20 dark:shadow-black/60">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div className="flex items-center gap-2.5">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-success/60" />
              <span className="relative inline-flex size-2 rounded-full bg-success" />
            </span>
            <span className="text-sm font-medium">Live</span>
            <Badge variant="outline">Sample session</Badge>
          </div>
          <span className="flex items-center gap-1.5 text-sm tabular-nums text-muted-foreground">
            <Users className="size-4" aria-hidden="true" />
            {total} answers
          </span>
        </div>

        <div className="px-5 pb-6 pt-7 sm:px-8 sm:pb-8 sm:pt-9">
          <p className="text-balance text-2xl font-semibold tracking-[-0.03em] sm:text-[1.75rem]">
            What should we cover next?
          </p>
          <ul className="mt-7 space-y-4">
            {OPTIONS.map((label, i) => {
              const pct = Math.round((counts[i] / total) * 100);
              const isLead = i === lead;
              return (
                <li key={label}>
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <span className={cn("text-base", isLead ? "font-medium text-foreground" : "text-muted-foreground")}>
                      {label}
                    </span>
                    <span
                      className={cn(
                        "font-mono text-sm tabular-nums",
                        isLead ? "font-medium text-accent-ink" : "text-muted-foreground",
                      )}
                    >
                      {pct}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-secondary">
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width,background-color] duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]",
                        isLead ? "bg-primary" : "bg-muted-foreground/50",
                      )}
                      style={{ width: filled ? `${pct}%` : "0%" }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border bg-card px-5 py-3.5">
          <div className="flex items-baseline gap-3">
            <span className="text-sm text-muted-foreground">Join with code</span>
            <span className="font-mono text-lg font-semibold tracking-[0.12em]">482 913</span>
          </div>
          <span className="hidden text-sm text-muted-foreground sm:inline">No account needed</span>
        </div>
      </div>

      {/* Audience phone */}
      <div className="dark hidden md:block">
        <div className="mx-auto w-[216px] rounded-[2rem] border border-border bg-background p-2 text-foreground shadow-2xl shadow-black/20 dark:shadow-black/60">
          <div className="rounded-[1.5rem] border border-border bg-card px-4 pb-5 pt-4">
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border" />
            <p className="text-sm font-semibold leading-snug tracking-tight">What should we cover next?</p>
            <div className="mt-4 space-y-2">
              {OPTIONS.map((label, i) => (
                <div
                  key={label}
                  className={cn(
                    "flex min-h-9 items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-xs",
                    i === 0
                      ? "border-primary bg-primary/10 font-medium text-foreground"
                      : "border-border text-muted-foreground",
                  )}
                >
                  <span className="truncate">{label}</span>
                  {i === 0 ? <Check className="size-3.5 shrink-0 text-accent-ink" aria-hidden="true" /> : null}
                </div>
              ))}
            </div>
            <p className="mt-4 text-center text-xs font-medium text-accent-ink">Answer sent</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Join code and scannable code on a white tile, shared by the sign-in aside. */
export function JoinCodeTile({ size = 96 }: { size?: number }) {
  return (
    <div className="rounded-lg bg-white p-2">
      <QRCodeSVG value="Open Poll sample session" size={size} level="M" />
    </div>
  );
}
