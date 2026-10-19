"use client";

import { motion } from "framer-motion";
import {
  CircleCheckBig,
  Cloud,
  Heading1,
  MessagesSquare,
  SlidersHorizontal,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { MockFrame, MockHeader, SampleBadge } from "./MockFrame";

const ease = [0.32, 0.72, 0, 1] as const;

const OUTLINE: { icon: LucideIcon; kind: string; title: string }[] = [
  { icon: Heading1, kind: "Heading", title: "Welcome and goals" },
  { icon: Cloud, kind: "Word cloud", title: "What do you hope to learn today?" },
  { icon: CircleCheckBig, kind: "Multiple choice", title: "Which channel gets the most tickets?" },
  { icon: SlidersHorizontal, kind: "Scales", title: "How confident are you with refunds?" },
  { icon: MessagesSquare, kind: "Q&A", title: "Ask us anything" },
];

/** Showcase illustration: describe a topic, review the AI outline. */
export function LiveAiMockup() {
  return (
    <MockFrame label="Illustration of the AI deck builder: a topic prompt above an outline of five proposed slides.">
      <MockHeader icon={<Sparkles className="size-[18px]" />} title="Draft with AI" badge={<SampleBadge />} />

      <div className="mt-5 rounded-2xl border border-border bg-background/60 p-4">
        <p className="text-xs text-muted-foreground">Topic</p>
        <p className="mt-1 text-base font-medium text-foreground">Onboarding workshop for new support agents</p>
      </div>

      <p className="mb-3 mt-6 text-sm font-semibold text-foreground">Outline to review</p>
      <ol className="space-y-2">
        {OUTLINE.map(({ icon: Icon, kind, title }, i) => (
          <motion.li
            key={title}
            initial={{ opacity: 0, x: -12 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5, ease, delay: i * 0.07 }}
            className="flex items-center gap-3 rounded-xl border border-border bg-background/50 px-3.5 py-2.5"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.06] text-xs font-semibold tabular-nums text-muted-foreground">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">{title}</span>
              <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Icon className="size-3.5 text-brand-ink" aria-hidden="true" />
                {kind}
              </span>
            </span>
          </motion.li>
        ))}
      </ol>

      <div className="mt-5 flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">Speaker notes included</span>
        <span className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">
          Write slides
        </span>
      </div>
    </MockFrame>
  );
}
