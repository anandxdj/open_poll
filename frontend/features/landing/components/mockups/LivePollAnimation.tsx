"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { ChartColumn, Heart, PartyPopper, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { MockFrame } from "./MockFrame";

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
    <MockFrame
      label="Illustration of live results: bar results for a sample question, three audience questions with upvote counts and emoji reactions."
      icon={<ChartColumn />}
      title="Live results"
    >
      <p className="text-base font-semibold tracking-tight text-foreground">How do customers contact us most?</p>
      <ul className="mt-4 space-y-3.5">
        {OPTIONS.map((o) => (
          <li key={o.label}>
            <div className="mb-1.5 flex items-baseline justify-between text-sm">
              <span className="text-foreground">{o.label}</span>
              <span className="font-mono tabular-nums text-muted-foreground">{o.value}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]",
                  o.value > 40 ? "bg-primary" : "bg-muted-foreground/50",
                )}
                style={{ width: filled ? `${o.value}%` : "0%" }}
              />
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-6 border-t border-border pt-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-foreground">Audience questions</p>
          <div className="flex items-center gap-1.5">
            {REACTIONS.map((Icon, i) => (
              <span
                key={i}
                className={cn(
                  "flex size-8 items-center justify-center rounded-md border transition-colors duration-300",
                  i === active ? "border-primary bg-primary/10 text-accent-ink" : "border-border text-muted-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
              </span>
            ))}
          </div>
        </div>
        <ul className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border">
          {QUESTIONS.map((q) => (
            <li key={q.text} className="flex items-center gap-3 bg-background px-3.5 py-2.5">
              <span className="w-8 shrink-0 text-center font-mono text-sm font-medium tabular-nums text-foreground">
                {q.votes}
              </span>
              <span className="text-sm text-foreground">{q.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </MockFrame>
  );
}
