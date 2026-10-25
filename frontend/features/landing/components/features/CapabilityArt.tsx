"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Check,
  ChevronUp,
  CircleCheckBig,
  Cloud,
  Copy,
  FileText,
  Heading1,
  Heart,
  Lock,
  PartyPopper,
  ThumbsUp,
  Trophy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ArtFrame, artSheet } from "../shared/ArtFrame";
import { CountUp, ease, useSeen, useStepper } from "../shared/motion";

/**
 * The illustrations in the capabilities bento: large ones for the featured
 * cells, small ones for the compact cells. Each plays once, the first time it
 * is half on screen, and then holds its last frame; reduced motion shows that
 * frame straight away. Sample content (`ArtFrame`).
 */

const sheet = cn(artSheet, "max-w-sm");

/* ── Q&A and reactions: a question climbs on upvotes, reactions float up ── */

const QNA = ["Will the recording be shared?", "Can we try it on our own data?", "What does the pilot cost?"];
const QNA_VOTES = [
  [8, 5, 2],
  [9, 8, 2],
  [9, 11, 3],
  [10, 14, 3],
];
const REACTIONS = [ThumbsUp, Heart, PartyPopper];

export function QnaArt() {
  const [ref, seen] = useSeen<HTMLDivElement>();
  const step = useStepper(QNA_VOTES.length, 700, seen);
  const reduce = useReducedMotion();
  const rows = QNA.map((q, i) => ({ q, v: QNA_VOTES[step][i] })).sort((a, b) => b.v - a.v);

  return (
    <ArtFrame ref={ref} label="Illustration of audience questions: one question climbs to the top as it gets upvotes, while emoji reactions float up.">
      <div className={cn(sheet, "relative p-2")}>
        <ul className="space-y-1.5">
          {rows.map(({ q, v }, i) => (
            <motion.li
              key={q}
              layout
              transition={{ layout: { duration: 0.5, ease } }}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2",
                i === 0 && step === QNA_VOTES.length - 1 ? "bg-primary/10" : "bg-transparent",
              )}
            >
              <span className="flex w-6 flex-col items-center text-accent-ink">
                <ChevronUp className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
                <span className="font-mono text-xs font-medium tabular-nums text-foreground">{v}</span>
              </span>
              <span className="text-sm leading-snug text-foreground">{q}</span>
            </motion.li>
          ))}
        </ul>
        {/* Reactions rise off the right edge of the panel, once. */}
        {seen && !reduce
          ? REACTIONS.map((Icon, i) => (
              <motion.span
                key={i}
                initial={{ opacity: 0, y: 0, scale: 0.6 }}
                animate={{ opacity: [0, 1, 1, 0], y: -90, scale: 1 }}
                transition={{ duration: 1.8, ease: "easeOut", delay: 0.6 + i * 0.5 }}
                className="absolute -right-3 bottom-4 flex size-8 items-center justify-center rounded-full border border-border bg-card text-accent-ink shadow-sm"
                style={{ marginRight: i * 14 }}
              >
                <Icon className="size-4" aria-hidden="true" />
              </motion.span>
            ))
          : null}
      </div>
    </ArtFrame>
  );
}

/* ── AI deck generation: the topic types itself, the outline follows ──── */

const TOPIC = "Onboarding workshop for new support agents";
const OUTLINE = [
  { icon: Heading1, title: "Welcome and goals" },
  { icon: Cloud, title: "What do you hope to learn today?" },
  { icon: CircleCheckBig, title: "Which channel gets the most tickets?" },
];

export function AiArt() {
  const [ref, seen] = useSeen<HTMLDivElement>();
  // One step per typed character, then one per outline row.
  const typed = useStepper(TOPIC.length + 1, 35, seen);
  const done = typed >= TOPIC.length;
  const rows = useStepper(OUTLINE.length + 1, 260, seen && done);
  const reduce = useReducedMotion();

  return (
    <ArtFrame ref={ref} label="Illustration of AI deck generation: a topic is typed in and an outline of slides appears below it.">
      <div className={cn(sheet, "p-3")}>
        <div className="rounded-lg border border-input bg-background px-3 py-2">
          <p className="text-xs text-muted-foreground">Topic</p>
          <p className="mt-0.5 min-h-5 truncate text-sm text-foreground">
            {TOPIC.slice(0, typed)}
            {!done && !reduce ? <span className="ml-px inline-block h-4 w-px translate-y-0.5 animate-pulse bg-foreground" /> : null}
          </p>
        </div>
        <ol className="mt-2 space-y-1">
          <AnimatePresence initial={false}>
            {OUTLINE.slice(0, rows).map(({ icon: Icon, title }, i) => (
              <motion.li
                key={title}
                initial={reduce ? false : { opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, ease }}
                className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-foreground"
              >
                <span className="w-3 font-mono text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                <Icon className="size-3.5 shrink-0 text-accent-ink" aria-hidden="true" />
                <span className="truncate">{title}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      </div>
    </ArtFrame>
  );
}

/* ── Import: a file turns into a fan of slides ─────────────────────────── */

const THUMBS = [0, 1, 2, 3];

export function ImportArt() {
  const [ref, seen] = useSeen<HTMLDivElement>();
  const step = useStepper(3, 700, seen);
  const reduce = useReducedMotion();

  return (
    <ArtFrame ref={ref} label="Illustration of an import: a PowerPoint file is converted into a fan of slides, with a note of what to review.">
      <div className="flex w-full max-w-sm flex-col items-center gap-4">
        <div className="relative h-24 w-full">
          {THUMBS.map((t) => (
            <motion.div
              key={t}
              initial={reduce ? false : { x: 0, rotate: 0, opacity: t === 0 ? 1 : 0 }}
              animate={
                step >= 2
                  ? { x: (t - 1.5) * 62, rotate: (t - 1.5) * 4, opacity: 1 }
                  : { x: 0, rotate: 0, opacity: t === 0 ? 1 : 0 }
              }
              transition={{ duration: 0.6, ease, delay: step >= 2 ? t * 0.06 : 0 }}
              className="absolute left-1/2 top-0 -ml-[52px] flex h-[72px] w-[104px] flex-col gap-1.5 rounded-md border border-border bg-card p-2 shadow-[0_8px_16px_-10px_rgb(23_23_23/0.35)]"
            >
              {step >= 2 ? (
                <>
                  <span className="h-1.5 w-3/4 rounded-full bg-foreground/70" />
                  <span className="h-1 w-full rounded-full bg-muted" />
                  <span className="h-1 w-5/6 rounded-full bg-muted" />
                  <span className={cn("mt-auto h-3 rounded-sm", t === 1 ? "w-1/2 bg-primary/70" : "w-1/3 bg-muted")} />
                </>
              ) : (
                <span className="m-auto flex flex-col items-center gap-1 text-xs text-muted-foreground">
                  <FileText className="size-5 text-accent-ink" aria-hidden="true" />
                  review.pptx
                </span>
              )}
            </motion.div>
          ))}
        </div>
        <div className="w-full max-w-60">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <motion.div
              className="h-full rounded-full bg-primary"
              initial={reduce ? false : { width: "0%" }}
              animate={{ width: step >= 1 ? "100%" : "0%" }}
              transition={{ duration: 0.7, ease }}
            />
          </div>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            {step >= 2 ? "14 slides imported, 2 to review" : "Importing slides..."}
          </p>
        </div>
      </div>
    </ArtFrame>
  );
}

/* ── Reports and exports: results per slide draw in, exports appear ──── */

const COLUMNS = [64, 82, 45, 91, 58, 73];
const EXPORTS = ["CSV", "Excel", "PDF"];

export function ReportArt() {
  const [ref, seen] = useSeen<HTMLDivElement>();
  const reduce = useReducedMotion();
  const play = seen || reduce;

  return (
    <ArtFrame ref={ref} label="Illustration of a session report: a column chart of results per slide, the participant count and export formats.">
      <div className={cn(sheet, "p-4")}>
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-medium text-foreground">Results per slide</p>
          <p className="text-xs text-muted-foreground">
            {play ? <CountUp value={48} duration={1000} className="font-mono tabular-nums text-foreground" /> : "0"} participants
          </p>
        </div>
        <div className="mt-3 flex h-20 items-end gap-2 border-b border-border">
          {COLUMNS.map((h, i) => (
            <motion.div
              key={i}
              initial={reduce ? false : { height: "0%" }}
              animate={{ height: play ? `${h}%` : "0%" }}
              transition={{ duration: 0.7, ease, delay: i * 0.08 }}
              className={cn("flex-1 rounded-t-sm", h === Math.max(...COLUMNS) ? "bg-chart-1" : "bg-muted-foreground/35")}
            />
          ))}
        </div>
        <div className="mt-3 flex gap-1.5">
          {EXPORTS.map((format, i) => (
            <motion.span
              key={format}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={play ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }}
              transition={{ duration: 0.3, ease, delay: 0.8 + i * 0.12 }}
              className="rounded-md border border-border bg-background px-2 py-0.5 font-mono text-xs text-foreground"
            >
              {format}
            </motion.span>
          ))}
        </div>
      </div>
    </ArtFrame>
  );
}

/* ── Compact cells ─────────────────────────────────────────────────────── */

/* Live decks and quizzes: the presenter steps through the deck */

const DECK = [
  { icon: Heading1, label: "Welcome" },
  { icon: CircleCheckBig, label: "Quiz round" },
  { icon: Cloud, label: "Word cloud" },
  { icon: Trophy, label: "Leaderboard" },
];

export function DeckArt() {
  const [ref, seen] = useSeen<HTMLDivElement>();
  const step = useStepper(DECK.length, 650, seen);
  const Current = DECK[step].icon;
  return (
    <ArtFrame ref={ref} size="sm" label="Illustration of a live deck: the presenter steps through four slides, from a welcome slide to the leaderboard.">
      <div className="flex w-full flex-col gap-2.5">
        <div className={cn(artSheet, "flex items-center gap-3 px-3 py-2.5")}>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-accent-ink">
            <Current className="size-4" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-xs text-muted-foreground">
              Slide <span className="font-mono tabular-nums">{step + 1}</span> of 4
            </span>
            <span className="block truncate text-sm font-medium text-foreground">{DECK[step].label}</span>
          </span>
        </div>
        <div className="flex gap-1.5">
          {DECK.map((d, i) => (
            <span
              key={d.label}
              className={cn(
                "h-7 flex-1 rounded-md border transition-colors duration-300",
                i === step ? "border-primary bg-primary/15" : i < step ? "border-border bg-muted" : "border-border bg-card",
              )}
            />
          ))}
        </div>
      </div>
    </ArtFrame>
  );
}

/* Teams and roles: members join the workspace with a role each */

const MEMBERS = [
  { initials: "AN", name: "Ana", role: "Owner" },
  { initials: "RJ", name: "Raj", role: "Editor" },
  { initials: "MW", name: "Mei", role: "Presenter" },
];

export function TeamArt() {
  const [ref, seen] = useSeen<HTMLDivElement>();
  const reduce = useReducedMotion();
  const show = seen || reduce;
  return (
    <ArtFrame ref={ref} size="sm" label="Illustration of a shared workspace: three members with the roles owner, editor and presenter.">
      <ul className={cn(artSheet, "divide-y divide-border px-3")}>
        {MEMBERS.map((m, i) => (
          <motion.li
            key={m.name}
            initial={reduce ? false : { opacity: 0, x: -8 }}
            animate={show ? { opacity: 1, x: 0 } : { opacity: 0, x: -8 }}
            transition={{ duration: 0.35, ease, delay: i * 0.18 }}
            className="flex items-center gap-2.5 py-2"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary font-mono text-xs font-medium text-foreground">
              {m.initials}
            </span>
            <span className="text-sm text-foreground">{m.name}</span>
            <span
              className={cn(
                "ml-auto rounded-full border px-2 py-0.5 text-xs",
                i === 0 ? "border-primary/50 bg-primary/10 text-accent-ink" : "border-border text-muted-foreground",
              )}
            >
              {m.role}
            </span>
          </motion.li>
        ))}
      </ul>
    </ArtFrame>
  );
}

/* Private by default: notes and the answer key stay on the presenter's side */

export function PrivacyArt() {
  const [ref, seen] = useSeen<HTMLDivElement>();
  const reduce = useReducedMotion();
  const show = seen || reduce;
  const reveal = (delay: number) => ({
    initial: reduce ? false : { opacity: 0, scale: 0.9 },
    animate: show ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.9 },
    transition: { duration: 0.35, ease, delay },
  });
  return (
    <ArtFrame ref={ref} size="sm" label="Illustration of privacy: the presenter's screen shows speaker notes and the answer key, the audience phone shows only the question.">
      <div className="grid w-full grid-cols-[1.4fr_1fr] items-end gap-2.5">
        <div className={cn(artSheet, "p-2.5")}>
          <p className="text-xs text-muted-foreground">Presenter</p>
          <span className="mt-2 block h-1.5 w-4/5 rounded-full bg-foreground/70" />
          <motion.div {...reveal(0.2)} className="mt-2 space-y-1">
            <span className="block h-1 w-full rounded-full bg-muted-foreground/30" />
            <span className="block h-1 w-3/4 rounded-full bg-muted-foreground/30" />
          </motion.div>
          <motion.span
            {...reveal(0.5)}
            className="mt-2 inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-accent-ink"
          >
            <Check className="size-3" strokeWidth={3} aria-hidden="true" />
            Answer
          </motion.span>
        </div>
        <div className={cn(artSheet, "relative rounded-2xl p-2.5")}>
          <p className="text-xs text-muted-foreground">Phone</p>
          <span className="mt-2 block h-1.5 w-full rounded-full bg-foreground/70" />
          <span className="mt-2 block h-4 rounded border border-border" />
          <span className="mt-1 block h-4 rounded border border-border" />
          <motion.span
            {...reveal(0.8)}
            className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full bg-foreground text-background"
          >
            <Lock className="size-3" aria-hidden="true" />
          </motion.span>
        </div>
      </div>
    </ArtFrame>
  );
}

/* Quick polls by link: the link is copied, the first answers come in */

const LINK_RESULTS = [62, 26, 12];

export function LinkArt() {
  const [ref, seen] = useSeen<HTMLDivElement>();
  const step = useStepper(3, 700, seen);
  const reduce = useReducedMotion();
  return (
    <ArtFrame ref={ref} size="sm" label="Illustration of a quick poll: its link is copied and the first results fill three bars.">
      <div className="flex w-full flex-col gap-3">
        <div className={cn(artSheet, "flex items-center gap-2 py-1.5 pl-3 pr-1.5")}>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">/p/lunch-vote</span>
          <span
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors duration-300",
              step >= 1 ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground",
            )}
          >
            {step >= 1 ? <Check className="size-3" strokeWidth={3} aria-hidden="true" /> : <Copy className="size-3" aria-hidden="true" />}
            {step >= 1 ? "Copied" : "Copy"}
          </span>
        </div>
        <div className="space-y-1.5 px-1">
          {LINK_RESULTS.map((pct, i) => (
            <div key={i} className="h-2 overflow-hidden rounded-full bg-muted">
              <motion.div
                className={cn("h-full rounded-full", i === 0 ? "bg-primary" : "bg-muted-foreground/40")}
                initial={reduce ? false : { width: "0%" }}
                animate={{ width: step >= 2 ? `${pct}%` : "0%" }}
                transition={{ duration: 0.7, ease, delay: i * 0.08 }}
              />
            </div>
          ))}
        </div>
      </div>
    </ArtFrame>
  );
}
