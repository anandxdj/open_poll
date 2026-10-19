"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { ChartColumn, Heart, PartyPopper, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { MockFrame, MockHeader, SampleBadge } from "./MockFrame";

const OPTIONS = [
  { label: "Email", value: 34 },
  { label: "Chat", value: 52 },
  { label: "Phone", value: 14 },
];

const QUESTIONS = [
  { text: "Can we get the slides afterwards?", votes: 12 },
  { text: "How do refunds work for annual plans?", votes: 7 },
  { text: "Is there a way to export this?", votes: 3 },
];

const REACTIONS = [ThumbsUp, Heart, PartyPopper];

/** Showcase illustration: live results next to the audience's Q&A and reactions. */
export function LivePollAnimation() {
  const reduce = useReducedMotion();
  const [filled, setFilled] = useState(false);
  const [bursts, setBursts] = useState(0);

  useEffect(() => {
    const id = requestAnimationFrame(() => setFilled(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // A reaction pulse every few seconds; none for reduced motion.
  useEffect(() => {
    if (reduce) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setBursts((n) => n + 1);
    }, 2600);
    return () => window.clearInterval(timer);
  }, [reduce]);

  const active = bursts % REACTIONS.length;

  return (
    <MockFrame label="Illustration of live results: bar results for a sample question, three audience questions with upvote counts and emoji reactions.">
      <MockHeader icon={<ChartColumn className="size-[18px]" />} title="Live results" badge={<SampleBadge />} />

      <p className="mt-5 text-lg font-bold leading-snug text-foreground">How do customers contact us most?</p>
      <ul className="mt-4 space-y-3.5">
        {OPTIONS.map((o) => (
          <li key={o.label}>
            <div className="mb-1.5 flex items-baseline justify-between text-sm">
              <span className="font-medium text-foreground">{o.label}</span>
              <span className="tabular-nums font-semibold text-muted-foreground">{o.value}%</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-foreground/10">
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-[1100ms] ease-[cubic-bezier(0.32,0.72,0,1)]",
                  o.value > 40 ? "bg-primary" : "bg-foreground/30",
                )}
                style={{ width: filled ? `${o.value}%` : "0%" }}
              />
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-6 border-t border-border pt-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-foreground">Audience questions</p>
          <div className="flex items-center gap-1.5">
            {REACTIONS.map((Icon, i) => (
              <span
                key={i}
                className={cn(
                  "flex size-8 items-center justify-center rounded-full border transition-colors duration-500",
                  i === active ? "border-primary bg-primary/15 text-brand-ink" : "border-border text-muted-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
              </span>
            ))}
          </div>
        </div>
        <ul className="mt-3 space-y-2">
          {QUESTIONS.map((q) => (
            <li
              key={q.text}
              className="flex items-center gap-3 rounded-xl border border-border bg-background/50 px-3.5 py-2.5"
            >
              <span className="flex min-w-10 flex-col items-center rounded-lg bg-foreground/[0.06] px-2 py-1 text-xs font-semibold tabular-nums text-foreground">
                {q.votes}
                <span className="font-normal text-muted-foreground">votes</span>
              </span>
              <span className="text-sm text-foreground">{q.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </MockFrame>
  );
}
