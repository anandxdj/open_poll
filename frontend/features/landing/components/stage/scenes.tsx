"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Check, ChevronUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CountUp, ease, useStepper } from "../shared/motion";

/**
 * One small, sample result per slide type, played on the dark stage of the
 * question-types section. Each scene mounts when its tab is shown and plays
 * once: answers arrive, then the result settles. Reduced motion renders the
 * settled result. All content is invented sample data.
 *
 * Scenes fill a fixed 300px-tall area and must fit a 300px-wide phone stage.
 */

/** Framer's `initial` for an entrance; `false` (start settled) for reduced motion. */
function useFrom<T>(from: T): T | false {
  return useReducedMotion() ? false : from;
}

const track = "h-2.5 overflow-hidden rounded-full bg-secondary";

/* ── Multiple choice ───────────────────────────────────────────────────── */

const PLANETS = [
  { label: "Jupiter", pct: 58, correct: true },
  { label: "Saturn", pct: 24 },
  { label: "Neptune", pct: 11 },
  { label: "Earth", pct: 7 },
];

function MultipleChoiceScene() {
  const from = useFrom({ width: "0%" });
  return (
    <ul className="space-y-5">
      {PLANETS.map((o, i) => (
        <li key={o.label}>
          <div className="mb-2 flex items-baseline justify-between gap-3 text-base">
            <span className={cn("flex items-center gap-2", o.correct ? "font-medium text-foreground" : "text-muted-foreground")}>
              {o.label}
              {o.correct ? <Check className="size-4 text-accent-ink" strokeWidth={2.5} aria-hidden="true" /> : null}
            </span>
            <CountUp
              value={o.pct}
              suffix="%"
              duration={1100}
              className={cn("font-mono text-sm tabular-nums", o.correct ? "text-accent-ink" : "text-muted-foreground")}
            />
          </div>
          <div className={track}>
            <motion.div
              className={cn("h-full rounded-full", o.correct ? "bg-primary" : "bg-muted-foreground/40")}
              initial={from}
              animate={{ width: `${o.pct}%` }}
              transition={{ duration: 1.1, ease, delay: 0.1 + i * 0.08 }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ── Type answer ───────────────────────────────────────────────────────── */

const TYPED = [
  { text: "Canberra", ok: true, who: "Ana" },
  { text: "Sydney", ok: false, who: "Raj" },
  { text: "Canberra", ok: true, who: "Mei" },
  { text: "Melbourne", ok: false, who: "Tom" },
  { text: "Canberra", ok: true, who: "Sam" },
  { text: "Canberra", ok: true, who: "Lea" },
];

function TypeAnswerScene() {
  const step = useStepper(TYPED.length + 1, 420);
  const shown = TYPED.slice(0, Math.min(step, TYPED.length));
  const correct = shown.filter((a) => a.ok).length;
  const from = useFrom({ opacity: 0, y: 8 });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        Accepted answer
        <span className="rounded-md border border-primary/50 bg-primary/10 px-2 py-0.5 font-medium text-foreground">
          Canberra
        </span>
      </div>
      <ul className="mt-5 grid grid-cols-2 gap-2.5">
        {shown.map((a, i) => (
          <motion.li
            key={i}
            initial={from}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease }}
            className={cn(
              "flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2.5 text-sm",
              a.ok ? "border-border bg-card text-foreground" : "border-border/60 text-muted-foreground",
            )}
          >
            {a.ok ? (
              <Check className="size-4 shrink-0 text-accent-ink" strokeWidth={2.5} aria-hidden="true" />
            ) : (
              <X className="size-4 shrink-0 text-faint" strokeWidth={2.5} aria-hidden="true" />
            )}
            <span className="truncate">{a.text}</span>
            <span className="ml-auto hidden shrink-0 text-xs text-faint sm:inline">{a.who}</span>
          </motion.li>
        ))}
      </ul>
      <p className="mt-auto text-sm text-muted-foreground">
        <span className="font-mono tabular-nums text-foreground">{correct}</span> of{" "}
        <span className="font-mono tabular-nums text-foreground">{shown.length}</span> correct so far
      </p>
    </div>
  );
}

/* ── Word cloud ────────────────────────────────────────────────────────── */

// Answers in the order they arrive; a word grows with every repeat.
const WORD_STREAM = [
  "practical", "fun", "insightful", "practical", "clear", "inspiring", "practical",
  "insightful", "long", "useful", "practical", "fun", "insightful", "practical",
];
const WORD_ORDER = ["clear", "insightful", "fun", "practical", "inspiring", "useful", "long"];

function WordCloudScene() {
  const step = useStepper(WORD_STREAM.length, 260);
  const counts = new Map<string, number>();
  for (const w of WORD_STREAM.slice(0, step + 1)) counts.set(w, (counts.get(w) ?? 0) + 1);
  const top = Math.max(...counts.values());
  const from = useFrom({ opacity: 0, scale: 0.6 });

  return (
    <div className="flex h-full flex-wrap content-center items-center justify-center gap-x-5 gap-y-2">
      {WORD_ORDER.filter((w) => counts.has(w)).map((w) => {
        const n = counts.get(w)!;
        return (
          // No layout animation: the font size eases (CSS) and the row reflows with it.
          <motion.span
            key={w}
            initial={from}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, ease }}
            className={cn(
              "font-semibold leading-none tracking-[-0.03em] transition-[font-size] duration-300",
              n === top ? "text-accent-ink" : n > 1 ? "text-foreground" : "text-muted-foreground",
            )}
            style={{ fontSize: `${16 + n * 9}px` }}
          >
            {w}
          </motion.span>
        );
      })}
    </div>
  );
}

/* ── Open ended ────────────────────────────────────────────────────────── */

const NOTES = [
  { text: "Fewer meetings, more written updates", who: "Ana" },
  { text: "A shared roadmap everyone can see", who: "Raj" },
  { text: "Shorter release cycles", who: "Mei" },
  { text: "More pairing on tricky bugs", who: "Tom" },
  { text: "Celebrate launches as a team", who: "Lea" },
];

function OpenEndedScene() {
  const from = useFrom({ opacity: 0, y: -18, rotate: -2 });
  return (
    <ul className="columns-2 gap-3 [column-fill:balance]">
      {NOTES.map((n, i) => (
        <motion.li
          key={n.text}
          initial={from}
          animate={{ opacity: 1, y: 0, rotate: 0 }}
          transition={{ duration: 0.45, ease, delay: 0.1 + i * 0.32 }}
          className="mb-3 break-inside-avoid rounded-xl border border-border bg-card p-3.5"
        >
          <p className="text-sm leading-snug text-foreground">{n.text}</p>
          <p className="mt-2 text-xs text-muted-foreground">{n.who}</p>
        </motion.li>
      ))}
    </ul>
  );
}

/* ── Scales ────────────────────────────────────────────────────────────── */

const STATEMENTS = [
  { label: "Explaining the product", votes: [4, 5, 4, 5, 3, 4, 5] },
  { label: "Handling refunds", votes: [2, 3, 2, 4, 3, 2, 3] },
  { label: "Using the new tools", votes: [3, 4, 3, 5, 4, 2, 4] },
];
// Fixed vertical offsets so the dots read as a small swarm, the same on every render.
const JITTER = [-5, 4, -1, 6, -6, 2, -3];
const pos = (v: number) => `${((v - 1) / 4) * 100}%`;

function ScalesScene() {
  const fromDot = useFrom({ opacity: 0, scale: 0 });
  const fromAvg = useFrom({ left: "0%", opacity: 0 });
  return (
    <div className="space-y-7 pt-1">
      {STATEMENTS.map((s, row) => {
        const avg = s.votes.reduce((a, b) => a + b, 0) / s.votes.length;
        return (
          <div key={s.label}>
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <span className="text-base text-foreground">{s.label}</span>
              <CountUp value={avg} decimals={1} duration={1400} className="font-mono text-sm tabular-nums text-accent-ink" />
            </div>
            <div className="relative mx-2 h-6">
              <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
              {[1, 2, 3, 4, 5].map((t) => (
                <span key={t} className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-muted-foreground/40" style={{ left: pos(t) }} />
              ))}
              {s.votes.map((v, i) => (
                <motion.span
                  key={i}
                  initial={fromDot}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.3, ease, delay: 0.1 + row * 0.15 + i * 0.09 }}
                  className="absolute top-1/2 size-2 rounded-full bg-muted-foreground/70"
                  style={{ left: pos(v), marginLeft: -4 + (i % 3) * 2, marginTop: -4 + JITTER[i] }}
                />
              ))}
              <motion.span
                initial={fromAvg}
                animate={{ left: pos(avg), opacity: 1 }}
                transition={{ duration: 1.2, ease, delay: 0.5 + row * 0.15 }}
                className="absolute top-1/2 -ml-1.5 -mt-3 h-6 w-3 rounded-full border-2 border-background bg-primary"
              />
            </div>
          </div>
        );
      })}
      <div className="mx-2 flex justify-between font-mono text-xs text-faint">
        <span>1</span>
        <span>5</span>
      </div>
    </div>
  );
}

/* ── Ranking ───────────────────────────────────────────────────────────── */

const RANK_FRAMES = [
  ["SSO", "API access", "Offline mode", "Dark mode"],
  ["API access", "SSO", "Dark mode", "Offline mode"],
  ["API access", "Dark mode", "SSO", "Offline mode"],
  ["Dark mode", "API access", "SSO", "Offline mode"],
];

function RankingScene() {
  const step = useStepper(RANK_FRAMES.length, 850);
  const order = RANK_FRAMES[step];
  const final = step === RANK_FRAMES.length - 1;
  return (
    <ol className="space-y-2.5">
      {order.map((item, i) => (
        <motion.li
          key={item}
          layout
          transition={{ layout: { duration: 0.5, ease } }}
          className={cn(
            "flex items-center gap-4 rounded-xl border px-4 py-3.5",
            i === 0 && final ? "border-primary/60 bg-primary/10" : "border-border bg-card",
          )}
        >
          <span className={cn("w-5 font-mono text-sm tabular-nums", i === 0 ? "text-accent-ink" : "text-muted-foreground")}>
            {i + 1}
          </span>
          <span className="text-base font-medium text-foreground">{item}</span>
        </motion.li>
      ))}
    </ol>
  );
}

/* ── Guess the number ──────────────────────────────────────────────────── */

const BUCKETS = [
  { from: 100, n: 2 },
  { from: 200, n: 5 },
  { from: 300, n: 9 },
  { from: 400, n: 14 },
  { from: 500, n: 8 },
  { from: 600, n: 4 },
  { from: 700, n: 2 },
];
const ANSWER = 412;

function GuessNumberScene() {
  const fromBar = useFrom({ height: "0%" });
  const fromLine = useFrom({ opacity: 0, y: -16 });
  const max = Math.max(...BUCKETS.map((b) => b.n));
  // The answer line sits inside the 400 bucket, 12% of the way along.
  const answerLeft = ((3 + (ANSWER - 400) / 100) / BUCKETS.length) * 100;

  return (
    <div className="flex h-full flex-col">
      <div className="relative flex-1">
        <div className="absolute inset-0 flex items-end gap-1.5 border-b border-border">
          {BUCKETS.map((b, i) => (
            <motion.div
              key={b.from}
              initial={fromBar}
              animate={{ height: `${(b.n / max) * 100}%` }}
              transition={{ duration: 0.8, ease, delay: 0.1 + i * 0.07 }}
              className={cn("flex-1 rounded-t-md", b.from === 400 ? "bg-primary" : "bg-muted-foreground/40")}
            />
          ))}
        </div>
        <motion.div
          initial={fromLine}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease, delay: 1.2 }}
          className="absolute -top-1 bottom-0 w-px bg-foreground"
          style={{ left: `${answerLeft}%` }}
        >
          <span className="absolute -top-1 left-2 whitespace-nowrap rounded-md bg-foreground px-2 py-0.5 font-mono text-xs font-medium text-background">
            {ANSWER}
          </span>
        </motion.div>
      </div>
      <div className="mt-2 flex gap-1.5 font-mono text-xs tabular-nums text-faint">
        {BUCKETS.map((b) => (
          <span key={b.from} className="flex-1 text-center">
            {b.from}
          </span>
        ))}
      </div>
      <motion.p
        initial={fromLine}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease, delay: 1.6 }}
        className="mt-4 text-sm text-muted-foreground"
      >
        Closest guess: <span className="text-foreground">Priya</span> with{" "}
        <span className="font-mono tabular-nums text-accent-ink">409</span>
      </motion.p>
    </div>
  );
}

/* ── 100 points ────────────────────────────────────────────────────────── */

const SPLIT = [
  { label: "Growth", points: 38, color: "bg-chart-1" },
  { label: "Quality", points: 27, color: "bg-chart-2" },
  { label: "Hiring", points: 21, color: "bg-chart-3" },
  { label: "Tools", points: 14, color: "bg-chart-4" },
];

function HundredPointsScene() {
  const from = useFrom({ width: "25%" });
  return (
    <div>
      <div className="flex h-12 gap-1 overflow-hidden rounded-xl">
        {SPLIT.map((s) => (
          <motion.div
            key={s.label}
            initial={from}
            animate={{ width: `${s.points}%` }}
            transition={{ duration: 1.3, ease, delay: 0.3 }}
            className={cn("h-full", s.color)}
          />
        ))}
      </div>
      <p className="mt-3 text-sm text-muted-foreground">Average of 32 people, each splitting 100 points</p>
      <ul className="mt-6 divide-y divide-border border-y border-border">
        {SPLIT.map((s) => (
          <li key={s.label} className="flex items-center gap-3 py-2.5">
            <span className={cn("size-2.5 rounded-full", s.color)} />
            <span className="text-base text-foreground">{s.label}</span>
            <CountUp value={s.points} from={25} duration={1300} className="ml-auto font-mono text-sm tabular-nums text-muted-foreground" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── 2 by 2 grid ───────────────────────────────────────────────────────── */

// x = effort (low → high), y = impact (low → high), both 0..1
const IDEAS = [
  { label: "Onboarding emails", x: 0.22, y: 0.78 },
  { label: "New pricing", x: 0.72, y: 0.84 },
  { label: "Dark mode", x: 0.3, y: 0.28 },
  { label: "Mobile app", x: 0.84, y: 0.36 },
];
const VOTES = [
  [0.16, 0.7], [0.28, 0.86], [0.2, 0.82], [0.66, 0.9], [0.78, 0.76], [0.36, 0.22],
  [0.24, 0.34], [0.9, 0.42], [0.8, 0.3], [0.7, 0.8], [0.26, 0.72], [0.34, 0.32],
];

function GridScene() {
  const fromDot = useFrom({ opacity: 0, scale: 0 });
  return (
    <div className="flex h-full gap-3">
      <span className="self-center font-mono text-xs text-faint [writing-mode:vertical-rl] rotate-180">Impact</span>
      <div className="flex flex-1 flex-col">
        <div className="relative flex-1 rounded-lg border border-border">
          <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
          <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
          <span className="absolute left-2 top-1.5 text-xs text-muted-foreground">Quick wins</span>
          <span className="absolute right-2 top-1.5 text-xs text-muted-foreground">Big bets</span>
          {VOTES.map(([x, y], i) => (
            <motion.span
              key={i}
              initial={fromDot}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3, ease, delay: 0.1 + i * 0.06 }}
              className="absolute -ml-1 -mt-1 size-2 rounded-full bg-muted-foreground/50"
              style={{ left: `${x * 100}%`, top: `${(1 - y) * 100}%` }}
            />
          ))}
          {IDEAS.map((idea, i) => (
            <motion.div
              key={idea.label}
              initial={fromDot}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, ease, delay: 1 + i * 0.15 }}
              className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
              style={{ left: `${idea.x * 100}%`, top: `${(1 - idea.y) * 100}%` }}
            >
              <span className="size-3.5 rounded-full border-2 border-background bg-primary" />
              <span className="mt-1 whitespace-nowrap rounded bg-background/80 px-1 text-xs font-medium text-foreground">
                {idea.label}
              </span>
            </motion.div>
          ))}
        </div>
        <span className="mt-1.5 text-center font-mono text-xs text-faint">Effort</span>
      </div>
    </div>
  );
}

/* ── Pin on image ──────────────────────────────────────────────────────── */

// Pins in percent of the floor plan; most land near the exit (target at 82%, 24%).
const PINS = [
  [80, 22], [84, 27], [78, 26], [83, 19], [76, 30], [86, 24], [30, 70], [81, 29], [55, 40], [79, 18],
];

function PinScene() {
  const fromPin = useFrom({ opacity: 0, y: -24 });
  const fromTarget = useFrom({ opacity: 0, scale: 0.6 });
  return (
    <div className="flex h-full flex-col">
      <div className="relative flex-1 overflow-hidden rounded-lg border border-border bg-card">
        {/* A sample floor plan drawn as the "image" */}
        <svg viewBox="0 0 400 220" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden="true">
          <g fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground/45">
            <rect x="12" y="12" width="376" height="196" rx="4" />
            <path d="M150 12v80M150 130v78M12 120h100M150 92h90M240 12v60M240 110v98M300 110h88M300 110v40" />
          </g>
          <g fill="currentColor" className="text-muted-foreground/25">
            <rect x="40" y="150" width="70" height="36" rx="4" />
            <rect x="180" y="140" width="40" height="40" rx="20" />
          </g>
        </svg>
        <motion.span
          initial={fromTarget}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease, delay: 1.5 }}
          className="absolute size-20 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-primary bg-primary/10"
          style={{ left: "82%", top: "24%" }}
        />
        {PINS.map(([x, y], i) => (
          <motion.span
            key={i}
            initial={fromPin}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease, delay: 0.1 + i * 0.1 }}
            className="absolute -ml-1.5 -mt-3 flex flex-col items-center"
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            <span className="size-3 rounded-full border-2 border-background bg-foreground" />
            <span className="h-1.5 w-px bg-foreground" />
          </motion.span>
        ))}
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        <span className="font-mono tabular-nums text-foreground">8</span> of{" "}
        <span className="font-mono tabular-nums text-foreground">10</span> pins in the right area
      </p>
    </div>
  );
}

/* ── Q&A ───────────────────────────────────────────────────────────────── */

const QUESTIONS = ["Can we get the slides afterwards?", "How do refunds work for annual plans?", "Is there a way to export this?"];
// Upvotes per step; the refunds question climbs to the top.
const VOTE_FRAMES = [
  [9, 4, 3],
  [10, 8, 3],
  [11, 12, 4],
  [12, 17, 5],
];

function QnaScene() {
  const step = useStepper(VOTE_FRAMES.length, 800);
  const votes = VOTE_FRAMES[step];
  const order = QUESTIONS.map((q, i) => ({ q, v: votes[i] })).sort((a, b) => b.v - a.v);
  const final = step === VOTE_FRAMES.length - 1;
  return (
    <ul className="space-y-2.5">
      {order.map(({ q, v }, i) => (
        <motion.li
          key={q}
          layout
          transition={{ layout: { duration: 0.5, ease } }}
          className={cn(
            "flex items-center gap-4 rounded-xl border px-4 py-3.5",
            i === 0 && final ? "border-primary/60 bg-primary/10" : "border-border bg-card",
          )}
        >
          <span className="flex w-8 shrink-0 flex-col items-center text-accent-ink">
            <ChevronUp className="size-4" strokeWidth={2.5} aria-hidden="true" />
            <span className="font-mono text-sm font-medium tabular-nums text-foreground">{v}</span>
          </span>
          <span className="min-w-0 flex-1 text-base leading-snug text-foreground">{q}</span>
          {i === 0 && final ? (
            <span className="hidden shrink-0 rounded-md bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground sm:inline">
              On screen
            </span>
          ) : null}
        </motion.li>
      ))}
    </ul>
  );
}

/* ── Leaderboard ───────────────────────────────────────────────────────── */

const PLAYERS = [
  { name: "Priya", before: 2140, gain: 640 },
  { name: "Sam", before: 2310, gain: 180 },
  { name: "Mei", before: 1980, gain: 720 },
  { name: "Tom", before: 2050, gain: 0 },
  { name: "Raj", before: 1720, gain: 560 },
];

function LeaderboardScene() {
  const step = useStepper(2, 1100);
  const rows = PLAYERS.map((p) => ({ ...p, score: step ? p.before + p.gain : p.before })).sort((a, b) => b.score - a.score);
  return (
    <ol className="space-y-2">
      {rows.map((p, i) => (
        <motion.li
          key={p.name}
          layout
          transition={{ layout: { duration: 0.6, ease } }}
          className={cn(
            "flex items-center gap-4 rounded-xl border px-4 py-2.5",
            i === 0 ? "border-primary/60 bg-primary/10" : "border-border bg-card",
          )}
        >
          <span className={cn("w-5 font-mono text-sm tabular-nums", i === 0 ? "text-accent-ink" : "text-muted-foreground")}>
            {i + 1}
          </span>
          <span className="text-base font-medium text-foreground">{p.name}</span>
          {step > 0 && p.gain > 0 ? (
            <span className="font-mono text-xs tabular-nums text-success">+{p.gain}</span>
          ) : null}
          <CountUp
            value={p.score}
            from={p.before}
            duration={900}
            className="ml-auto font-mono text-sm tabular-nums text-foreground"
          />
        </motion.li>
      ))}
    </ol>
  );
}

export const SCENES = {
  "multiple-choice": { question: "Which planet is the largest?", Scene: MultipleChoiceScene },
  "type-answer": { question: "What is the capital of Australia?", Scene: TypeAnswerScene },
  "word-cloud": { question: "One word for today's workshop?", Scene: WordCloudScene },
  "open-ended": { question: "What should we change next quarter?", Scene: OpenEndedScene },
  scales: { question: "How confident do you feel about...", Scene: ScalesScene },
  ranking: { question: "What should we build first?", Scene: RankingScene },
  "guess-number": { question: "How many jelly beans are in the jar?", Scene: GuessNumberScene },
  "hundred-points": { question: "Split 100 points across next year's priorities", Scene: HundredPointsScene },
  grid: { question: "Place each idea by effort and impact", Scene: GridScene },
  pin: { question: "Where is the nearest exit?", Scene: PinScene },
  qna: { question: "Ask the speakers anything", Scene: QnaScene },
  leaderboard: { question: "Standings after round 3", Scene: LeaderboardScene },
} as const;

export type SceneId = keyof typeof SCENES;
