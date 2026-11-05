"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Check, FilePlus2, FileUp, Link2, Play, Sparkles, Table } from "lucide-react";
import { cn } from "@/lib/utils";
import { ArtFrame, artSheet } from "../shared/ArtFrame";
import { CountUp, ease, useSeen, useStepper } from "../shared/motion";

/**
 * One small illustration per how-it-works step: build, go live, review.
 * Same rules as the capabilities bento: plays once when half on screen,
 * settled for reduced motion, sample content.
 */

/* 1. Build or bring a deck: pick a start, slides stack up */

const SOURCES = [
  { icon: FilePlus2, label: "Blank" },
  { icon: FileUp, label: "Import" },
  { icon: Sparkles, label: "AI draft" },
];
const SLIDES = 5;

export function BuildArt() {
  const [ref, seen] = useSeen<HTMLDivElement>();
  const step = useStepper(SLIDES + 2, 280, seen);
  const reduce = useReducedMotion();
  // Step 1 picks "AI draft"; from step 2 a slide lands per step.
  const picked = step >= 1;
  const slides = Math.max(0, step - 1);
  return (
    <ArtFrame ref={ref} size="sm" label="Illustration of building a deck: start blank, import or draft with AI, and slides stack up.">
      <div className="flex w-full flex-col gap-3">
        <div className="flex gap-1.5">
          {SOURCES.map(({ icon: Icon, label }, i) => {
            const on = picked && i === 2;
            return (
              <span
                key={label}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-medium transition-colors duration-300",
                  on ? "border-primary bg-primary/10 text-accent-ink" : "border-border bg-card text-muted-foreground",
                )}
              >
                <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                {label}
              </span>
            );
          })}
        </div>
        <div className="flex h-12 items-center gap-1.5">
          {Array.from({ length: SLIDES }, (_, i) => (
            <motion.span
              key={i}
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={i < slides ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
              transition={{ duration: 0.3, ease }}
              className="flex h-full flex-1 flex-col gap-1 rounded-md border border-border bg-card p-1.5"
            >
              <span className="h-1 w-3/4 rounded-full bg-foreground/60" />
              <span className={cn("mt-auto h-2 rounded-sm", i === 1 ? "w-2/3 bg-primary/70" : "w-1/2 bg-muted")} />
            </motion.span>
          ))}
        </div>
      </div>
    </ArtFrame>
  );
}

/* 2. Go live with a join code: the code appears, people pour in */

const CODE = "482913";
const FACES = ["AN", "RJ", "MW", "TS", "LB", "PK", "SO"];

export function JoinArt() {
  const [ref, seen] = useSeen<HTMLDivElement>();
  const step = useStepper(CODE.length + 2, 160, seen);
  const reduce = useReducedMotion();
  const digits = Math.min(step, CODE.length);
  const live = step > CODE.length;
  return (
    <ArtFrame ref={ref} size="sm" label="Illustration of going live: the join code 482 913 appears and people join from their phones.">
      <div className="flex w-full flex-col items-center gap-3">
        <p className="flex gap-1 font-mono text-3xl font-semibold tabular-nums tracking-[0.06em] text-foreground">
          {CODE.split("").map((d, i) => (
            <span key={i} className={cn("w-[0.8em] text-center transition-opacity duration-200", i === 3 && "ml-3", i < digits ? "opacity-100" : "opacity-0")}>
              {d}
            </span>
          ))}
        </p>
        <div className="flex items-center gap-3">
          <div className="flex -space-x-1.5">
            {FACES.map((f, i) => (
              <motion.span
                key={f}
                initial={reduce ? false : { opacity: 0, scale: 0.4 }}
                animate={live ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.4 }}
                transition={{ duration: 0.3, ease, delay: i * 0.08 }}
                className={cn(
                  "flex size-7 items-center justify-center rounded-full border-2 border-background font-mono text-xs font-medium",
                  i === 0 ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground",
                )}
              >
                {f[0]}
              </motion.span>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            {live ? <CountUp value={36} duration={900} className="font-mono tabular-nums text-foreground" /> : "0"} joined
          </span>
        </div>
      </div>
    </ArtFrame>
  );
}

/* 3. Review and share: the session report, then a results link */

export function ShareArt() {
  const [ref, seen] = useSeen<HTMLDivElement>();
  const step = useStepper(3, 650, seen);
  return (
    <ArtFrame ref={ref} size="sm" label="Illustration of a session report with actions to export it, share a results link and run the deck again.">
      <div className={cn(artSheet, "@container p-3")}>
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-medium text-foreground">Team offsite</p>
          <p className="shrink-0 text-xs text-muted-foreground">
            <span className="font-mono tabular-nums">36</span> people
          </p>
        </div>
        <div className="mt-2 flex h-7 items-end gap-1">
          {[40, 75, 55, 90, 65, 80, 50, 70].map((h, i) => (
            <span key={i} className={cn("flex-1 rounded-t-sm", i === 3 ? "bg-chart-1" : "bg-muted-foreground/30")} style={{ height: `${h}%` }} />
          ))}
        </div>
        {/* One row at every width: in a narrow sheet "Run again" keeps only its icon. */}
        <div className="mt-3 flex gap-1.5">
          <span className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground">
            <Table className="size-3" aria-hidden="true" />
            Export
          </span>
          <span
            className={cn(
              "flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-xs font-medium transition-colors duration-300",
              step >= 1 ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground",
            )}
          >
            {step >= 1 ? <Check className="size-3" strokeWidth={3} aria-hidden="true" /> : <Link2 className="size-3" aria-hidden="true" />}
            {step >= 1 ? "Link copied" : "Share results"}
          </span>
          <span
            className={cn(
              "flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-border px-2 py-1 text-xs text-foreground transition-opacity duration-300",
              step >= 2 ? "opacity-100" : "opacity-40",
            )}
          >
            <Play className="size-3" aria-hidden="true" />
            <span className="hidden @[17.5rem]:inline">Run again</span>
          </span>
        </div>
      </div>
    </ArtFrame>
  );
}
