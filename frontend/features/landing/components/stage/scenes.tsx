"use client";

import { motion, useReducedMotion } from "framer-motion";
import { WordCloud } from "@/features/presentations/slides/types/wordcloud/WordCloud";
import { Check, ChevronUp, X } from "lucide-react";
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

/** Framer's `initial` for an entrance; `false` (start settled) for reduced motion. */
function useFrom<T>(from: T): T | false {
  return useReducedMotion() ? false : from;
}

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
          className="mb-3 break-inside-avoid rounded-xl border border-border bg-card p-3.5 shadow-[0_1px_2px_rgb(23_23_23/0.06)]"
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
            i === 0 && final ? "border-primary/60 bg-primary/10" : "border-border bg-card shadow-[0_1px_2px_rgb(23_23_23/0.06)]",
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
