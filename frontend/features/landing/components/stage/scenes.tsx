"use client";

import { motion } from "framer-motion";
import { WordCloud } from "@/features/presentations/slides/types/wordcloud/WordCloud";
import { ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { CountUp, ease, useStepper } from "../shared/motion";
import { ResultRow } from "../shared/ResultRow";

/**
 * One small, sample result per slide type, played on the dark stage of the
 * question-types section. Each scene mounts when its tab is shown and plays
 * once: answers arrive, then the result settles. Reduced motion renders the
 * settled result. All content is invented sample data.
 *
 * Scenes fill a fixed 300px-tall area and must fit a 300px-wide phone stage.
 * They follow the app theme: cards are `bg-card` sheets on the stage's graph paper.
 */

/* ── Multiple choice ───────────────────────────────────────────────────── */

const PLANETS = [
  { label: "Jupiter", pct: 58, correct: true },
  { label: "Saturn", pct: 24 },
  { label: "Neptune", pct: 11 },
  { label: "Earth", pct: 7 },
];

function MultipleChoiceScene() {
  return (
    <ul className="space-y-2.5">
      {PLANETS.map((o, i) => (
        <li key={o.label}>
          <ResultRow
            letter={String.fromCharCode(65 + i)}
            label={o.label}
            pct={o.pct}
            lead={Boolean(o.correct)}
            correct={o.correct}
            delay={0.1 + i * 0.08}
          />
        </li>
      ))}
    </ul>
  );
}

/* ── Word cloud ────────────────────────────────────────────────────────── */

// Answers in the order they arrive, one at a time: a new word appears in its
// own spot and every repeat makes it bigger there.
const WORD_STREAM = [
  "practical", "fun", "clear", "practical", "useful", "hands-on", "practical", "engaging",
  "fun", "clear", "relevant", "practical", "insightful", "fun", "useful", "practical",
  "inspiring", "hands-on", "clear", "practical", "engaging", "fun", "helpful", "fast",
  "practical", "interactive", "deep", "focused", "clear", "useful", "friendly", "new",
  "practical", "fun", "energizing", "honest", "lively", "practical", "calm", "creative",
];

// The product's cloud colours are deck tokens tuned for the dark stage; here they map to the
// app's categorical chart colours, which hold 3:1 on the stage in both themes.
const CLOUD_COLOURS = {
  "--deck-cloud-1": "var(--chart-1)",
  "--deck-cloud-2": "var(--chart-2)",
  "--deck-cloud-3": "var(--chart-3)",
  "--deck-cloud-4": "var(--chart-4)",
  "--deck-cloud-5": "var(--chart-5)",
  "--deck-cloud-6": "var(--chart-6)",
  "--deck-cloud-7": "var(--foreground)",
  "--deck-cloud-8": "var(--chart-1)",
  "--deck-cloud-9": "var(--chart-2)",
  "--deck-cloud-10": "var(--chart-4)",
  "--deck-cloud-11": "var(--chart-5)",
  "--deck-cloud-12": "var(--chart-3)",
} as React.CSSProperties;

function WordCloudScene() {
  const step = useStepper(WORD_STREAM.length, 140);
  const counts = new Map<string, number>();
  for (const w of WORD_STREAM.slice(0, step + 1)) counts.set(w, (counts.get(w) ?? 0) + 1);
  const words = [...counts].map(([text, count]) => ({ text, count }));

  return (
    <div className="h-full" style={CLOUD_COLOURS}>
      <WordCloud words={words} className="relative size-full overflow-hidden select-none" />
    </div>
  );
}

/* ── Pin on image ──────────────────────────────────────────────────────── */

// The "image" is a venue floor plan drawn in a 480 × 240 box; pins, heat and the correct
// area are placed in the same units. Most of the room finds the side exit by the seats.
const PLAN_W = 480;
const PLAN_H = 240;
const PINS = [
  [212, 216], [230, 210], [452, 184], [202, 224], [238, 226], [218, 204], [322, 152], [222, 226], [200, 208], [232, 220],
];
const EXIT_AREA = { left: 190, top: 194, right: 246, bottom: 236 };
const IN_AREA = PINS.filter(
  ([x, y]) => x >= EXIT_AREA.left && x <= EXIT_AREA.right && y >= EXIT_AREA.top && y <= EXIT_AREA.bottom,
).length;
// The stage's heatmap: pins counted per cell of a 20 × 20 grid, as on the real stage.
const HEAT_CELLS = (() => {
  const cells = new Map<string, { col: number; row: number; count: number }>();
  for (const [x, y] of PINS) {
    const col = Math.floor((x / PLAN_W) * 20);
    const row = Math.floor((y / PLAN_H) * 20);
    const cell = cells.get(`${col}:${row}`) ?? { col, row, count: 0 };
    cell.count += 1;
    cells.set(`${col}:${row}`, cell);
  }
  return [...cells.values()];
})();
const HEAT_MAX = Math.max(...HEAT_CELLS.map((c) => c.count));
// Two blocks of seats facing the stage, clear of the aisle and the exit door's swing.
const SEATS = Array.from({ length: 11 }, (_, i) => 80 + i * 20).flatMap((x) =>
  [24, 40, 56, 72, 88, 144, 160, 176, 192, 208]
    .filter((y) => !(x >= 190 && x <= 240 && y >= 170))
    .map((y) => [x, y] as const),
);

const pct = (v: number, of: number) => `${(v / of) * 100}%`;

function VenuePlan() {
  return (
    <svg viewBox={`0 0 ${PLAN_W} ${PLAN_H}`} className="absolute inset-0 size-full" aria-hidden="true">
      {/* Seats, café tables, reception desk */}
      <g className="fill-muted-foreground/25">
        {SEATS.map(([x, y]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="10" height="10" rx="2" />
        ))}
        <rect x="340" y="194" width="58" height="14" rx="7" />
      </g>
      <g className="fill-none stroke-muted-foreground/45" strokeWidth="1.5">
        {[[348, 48], [396, 48], [444, 48], [372, 86], [420, 86]].map(([cx, cy]) => (
          <circle key={cx * 1000 + cy} cx={cx} cy={cy} r="10" />
        ))}
      </g>
      <rect x="20" y="56" width="36" height="128" rx="3" className="fill-muted stroke-border" strokeWidth="1.5" />
      {/* Door swings */}
      <path
        d="M196 232V194A38 38 0 0 1 234 232M472 160H434A38 38 0 0 0 472 198M312 140H344A32 32 0 0 1 312 172M372 112V144A32 32 0 0 0 404 112"
        className="fill-none stroke-muted-foreground/50"
        strokeWidth="1"
      />
      {/* Walls, with gaps for the doors */}
      <path
        d="M8 8H472V160M472 198V232H236M196 232H8V8M312 8V140M312 172V232M312 112H372M404 112H472"
        className="fill-none stroke-foreground"
        strokeWidth="4"
        strokeLinecap="square"
      />
      {/* Exit sign over the side door */}
      <rect x="201" y="176" width="30" height="13" rx="2" className="fill-success" />
      <text x="216" y="185.5" textAnchor="middle" className="fill-background text-[8px] font-bold">
        EXIT
      </text>
      {/* Labels */}
      <g className="fill-muted-foreground text-[10px] font-medium">
        <text x="38" y="120" textAnchor="middle" transform="rotate(-90 38 120)" dominantBaseline="middle">
          Stage
        </text>
        <text x="324" y="28">Café</text>
        <text x="324" y="130">Lobby</text>
        <text x="464" y="224" textAnchor="end">Entrance</text>
      </g>
      {/* You are here */}
      <circle cx="150" cy="120" r="9" className="fill-foreground/10" />
      <circle cx="150" cy="120" r="4.5" className="fill-foreground" />
      <text x="164" y="123.5" className="fill-foreground text-[10px] font-semibold">
        You are here
      </text>
    </svg>
  );
}

function PinScene() {
  // Pins drop one per tick, then the result is revealed.
  const step = useStepper(PINS.length + 4, 170);
  const revealed = step >= PINS.length + 3;
  const dropped = Math.min(step + 1, PINS.length);
  const spring = { type: "spring", stiffness: 520, damping: 22 } as const;

  return (
    <div className="@container h-full">
      <div className="flex h-full flex-col gap-3 @xl:flex-row @xl:gap-6">
        <div className="relative aspect-[2/1] w-full [container-type:size] @xl:aspect-auto @xl:h-full @xl:min-w-0 @xl:flex-1">
          <div className="absolute left-0 top-0 h-[min(100cqh,50cqw)] w-[min(100cqw,200cqh)] overflow-hidden rounded-lg border border-border bg-card shadow-[0_1px_2px_rgb(23_23_23/0.06)]">
            <VenuePlan />
            {HEAT_CELLS.map((cell) => (
              <motion.span
                key={`${cell.col}:${cell.row}`}
                initial={false}
                animate={{ opacity: revealed ? 0.12 + 0.55 * (cell.count / HEAT_MAX) : 0 }}
                transition={{ duration: 0.5, ease }}
                className="absolute bg-destructive"
                style={{ left: `${cell.col * 5}%`, top: `${cell.row * 5}%`, width: "5%", height: "5%" }}
              />
            ))}
            <motion.span
              initial={false}
              animate={revealed ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.85 }}
              transition={{ duration: 0.45, ease, delay: revealed ? 0.25 : 0 }}
              className="absolute rounded-sm border-2 border-dashed border-success bg-success/15"
              style={{
                left: pct(EXIT_AREA.left, PLAN_W),
                top: pct(EXIT_AREA.top, PLAN_H),
                width: pct(EXIT_AREA.right - EXIT_AREA.left, PLAN_W),
                height: pct(EXIT_AREA.bottom - EXIT_AREA.top, PLAN_H),
              }}
            />
            {PINS.map(([x, y], i) => {
              const shown = i < dropped;
              return (
                <span key={i} className="absolute" style={{ left: pct(x, PLAN_W), top: pct(y, PLAN_H) }}>
                  {/* While answers come in: a pin, tip on the spot */}
                  <motion.svg
                    viewBox="0 0 16 22"
                    initial={false}
                    animate={
                      shown && !revealed ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: revealed ? 0 : -18, scale: revealed ? 0.4 : 1 }
                    }
                    transition={shown && !revealed ? spring : { duration: 0.25, ease }}
                    className="absolute bottom-0 left-0 h-[22px] w-4 -translate-x-1/2 origin-bottom drop-shadow-[0_1px_1px_rgb(23_23_23/0.3)]"
                    aria-hidden="true"
                  >
                    <path
                      d="M8 0C3.6 0 0 3.5 0 7.9 0 13.6 8 22 8 22s8-8.4 8-14.1C16 3.5 12.4 0 8 0z"
                      className="fill-primary"
                    />
                    <circle cx="8" cy="8" r="3" className="fill-primary-foreground" />
                  </motion.svg>
                  {/* Once revealed: a dot on the heatmap */}
                  <motion.span
                    initial={false}
                    animate={{ opacity: revealed ? 1 : 0, scale: revealed ? 1 : 0 }}
                    transition={{ duration: 0.3, ease, delay: revealed ? 0.15 : 0 }}
                    className="absolute -left-1 -top-1 size-2 rounded-full bg-foreground ring-2 ring-card"
                  />
                </span>
              );
            })}
          </div>
        </div>
        <div className="flex shrink-0 items-baseline gap-2 @xl:w-36 @xl:flex-col @xl:gap-1">
          <p className="font-mono text-base tabular-nums text-foreground @xl:text-4xl @xl:tracking-tight">
            {revealed ? <CountUp value={Math.round((IN_AREA / PINS.length) * 100)} suffix="%" duration={700} /> : dropped}
          </p>
          <p className="text-sm text-muted-foreground">
            {revealed ? (
              <>
                <span className="font-mono tabular-nums text-foreground">{IN_AREA}</span> of{" "}
                <span className="font-mono tabular-nums text-foreground">{PINS.length}</span> pins in the correct area
              </>
            ) : (
              "pins dropped"
            )}
          </p>
        </div>
      </div>
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
            i === 0 && final ? "border-primary/60 bg-primary/10" : "border-border bg-card shadow-[0_1px_2px_rgb(23_23_23/0.06)]",
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
            i === 0 ? "border-primary/60 bg-primary/10" : "border-border bg-card shadow-[0_1px_2px_rgb(23_23_23/0.06)]",
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
  "word-cloud": { question: "One word for today's workshop?", Scene: WordCloudScene },
  pin: { question: "Where is the nearest exit?", Scene: PinScene },
  qna: { question: "Ask the speakers anything", Scene: QnaScene },
  leaderboard: { question: "Standings after round 3", Scene: LeaderboardScene },
} as const;

export type SceneId = keyof typeof SCENES;
