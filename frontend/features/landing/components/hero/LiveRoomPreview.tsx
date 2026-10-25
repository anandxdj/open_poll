"use client";

import { useEffect, useState } from "react";
import { BatteryFull, Check, Signal, Users, Wifi } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useReducedMotion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ResultRow } from "../shared/ResultRow";

const OPTIONS = ["Running Q&A", "Writing good polls", "Quiz rounds", "Reading the report"];
const START = [34, 22, 14, 8];

/**
 * The hero visual: a sample live session, the projected screen with a phone
 * resting on its corner. It follows the app theme. Answers are cards that fill
 * with their share; once on screen an answer lands every couple of seconds
 * (the card it lands on pops a "+1"); reduced motion keeps it still.
 * Labelled "Sample session" and exposed as one image.
 */
export function LiveRoomPreview({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  const [counts, setCounts] = useState(START);
  // The answer the last vote landed on, and a tick so the same answer can pop twice.
  const [landed, setLanded] = useState<{ index: number; tick: number } | null>(null);

  useEffect(() => {
    if (reduce) return;
    const weights = [0.45, 0.28, 0.17, 0.1];
    let tick = 0;
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
      tick += 1;
      setCounts((prev) => prev.map((n, i) => (i === pick ? n + 1 : n)));
      setLanded({ index: pick, tick });
    }, 1900);
    return () => window.clearInterval(timer);
  }, [reduce]);

  const total = counts.reduce((a, b) => a + b, 0);
  const lead = counts.indexOf(Math.max(...counts));

  return (
    <div
      role="img"
      aria-label="Illustration of a sample live session: answers from the audience fill the answer cards on the presenter's screen while a phone shows the same question."
      className={cn("relative md:pb-10", className)}
    >
      {/* Presenter screen; leaves room on the right for the phone */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card text-foreground shadow-[0_32px_64px_-28px_rgb(23_23_23/0.3)] md:mr-36 lg:mr-44">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div className="flex items-center gap-2.5">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full rounded-full bg-success/60 motion-safe:animate-ping" />
              <span className="relative inline-flex size-2 rounded-full bg-success" />
            </span>
            <span className="text-sm font-medium">Live</span>
            <Badge variant="outline">Sample session</Badge>
          </div>
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Users className="size-4" aria-hidden="true" />
            <span className="font-mono tabular-nums text-foreground">{total}</span> answers
          </span>
        </div>

        {/* The question on graph paper; on md+ the phone covers the right edge, so the answers stop short of it */}
        <div className="relative bg-background">
          <div aria-hidden="true" className="mk-grid mk-grid-flat pointer-events-none absolute inset-0" />
          <div className="relative px-5 pb-6 pt-7 sm:px-8 sm:pb-8 sm:pt-8 md:pr-24 lg:pr-28">
            <p className="text-balance text-2xl font-semibold tracking-[-0.035em] sm:text-[2rem]">What should we cover next?</p>
            <ul className="mt-6 space-y-2.5">
              {OPTIONS.map((label, i) => (
                <li key={label}>
                  <ResultRow
                    letter={String.fromCharCode(65 + i)}
                    label={label}
                    pct={Math.round((counts[i] / total) * 100)}
                    lead={i === lead}
                    delay={0.15 + i * 0.08}
                    bump={landed?.index === i ? landed.tick : undefined}
                  />
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border px-5 py-3.5">
          <div className="flex items-baseline gap-3">
            <span className="text-sm text-muted-foreground">Join with code</span>
            <span className="font-mono text-lg font-semibold tracking-[0.12em]">482 913</span>
          </div>
          {/* Hidden from md, where the phone covers this corner */}
          <span className="hidden text-sm text-muted-foreground sm:inline md:hidden">No account needed</span>
        </div>
      </div>

      {/* Audience phone at real proportions (9:19.5), resting on the screen's lower right corner */}
      <div className="absolute bottom-0 right-0 hidden md:block lg:right-2">
        <div className="relative w-[204px] -rotate-2 lg:w-[228px]">
          {/* Side buttons: action, volume up and down, power */}
          <span aria-hidden="true" className="absolute -left-[3px] top-[19%] h-7 w-[3px] rounded-l-sm bg-device" />
          <span aria-hidden="true" className="absolute -left-[3px] top-[28%] h-12 w-[3px] rounded-l-sm bg-device" />
          <span aria-hidden="true" className="absolute -left-[3px] top-[39%] h-12 w-[3px] rounded-l-sm bg-device" />
          <span aria-hidden="true" className="absolute -right-[3px] top-[31%] h-16 w-[3px] rounded-r-sm bg-device" />

          <div className="rounded-[2.75rem] bg-device p-[7px] shadow-[0_40px_80px_-24px_rgb(23_23_23/0.5)]">
            <div className="relative flex aspect-[9/19.5] flex-col overflow-hidden rounded-[2.3rem] bg-background text-foreground">
              {/* Status bar around the camera island */}
              <div className="relative flex h-11 shrink-0 items-center justify-between px-5 pt-1">
                <span className="w-14 pl-1 text-[13px] font-semibold tabular-nums tracking-[-0.01em]">9:41</span>
                <span aria-hidden="true" className="absolute left-1/2 top-2.5 h-[20px] w-[58px] -translate-x-1/2 rounded-full bg-black lg:w-[66px]" />
                <span className="flex w-14 items-center justify-end gap-0.5">
                  <Signal className="size-3" strokeWidth={2.75} aria-hidden="true" />
                  <Wifi className="size-3" strokeWidth={2.75} aria-hidden="true" />
                  <BatteryFull className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                </span>
              </div>

              {/* The participant view: deck and nickname, then the question */}
              <div className="flex items-center justify-between border-b border-border px-4 pb-2.5 text-xs">
                <span className="font-semibold">Team offsite</span>
                <span className="flex items-center gap-1 text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
                  Ada
                </span>
              </div>

              <div className="flex flex-1 flex-col px-4 pt-4">
                <p className="text-xs text-muted-foreground">Slide 1 of 3</p>
                <p className="mt-1 text-sm font-semibold leading-snug tracking-tight">What should we cover next?</p>
                <div className="mt-3.5 space-y-1.5">
                  {OPTIONS.map((label, i) => (
                    <div
                      key={label}
                      className={cn(
                        "flex min-h-9 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs",
                        i === 0
                          ? "border-primary bg-primary/10 font-medium text-foreground"
                          : "border-border bg-card text-muted-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-5 shrink-0 items-center justify-center rounded border font-mono text-xs",
                          i === 0 ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background",
                        )}
                      >
                        {String.fromCharCode(65 + i)}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{label}</span>
                      {i === 0 ? <Check className="size-3.5 shrink-0 text-accent-ink" aria-hidden="true" /> : null}
                    </div>
                  ))}
                </div>
                <p className="mt-auto flex items-center justify-center gap-1.5 pb-3 text-xs font-medium text-accent-ink">
                  <Check className="size-3.5" strokeWidth={2.5} aria-hidden="true" /> Answer sent
                </p>
              </div>

              {/* Home indicator */}
              <div className="flex h-5 shrink-0 items-center justify-center">
                <span aria-hidden="true" className="h-1 w-24 rounded-full bg-foreground/80" />
              </div>
            </div>
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
