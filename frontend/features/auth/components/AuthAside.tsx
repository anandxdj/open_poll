import { Check } from "lucide-react";
import { JoinCodeTile } from "@/features/landing/components/hero/LiveRoomPreview";
import { ResultRow } from "@/features/landing/components/shared/ResultRow";

const POINTS = [
  "Polls, quizzes, word clouds and Q&A in one deck",
  "Your audience joins with a code, no account",
  "A report and exports for every session",
];

const BARS = [
  { label: "Running Q&A", pct: 46, lead: true },
  { label: "Writing good polls", pct: 31 },
  { label: "Quiz rounds", pct: 23 },
];

/** The product panel beside the sign-in forms (large screens): a static sample session and three real selling points. */
export function AuthAside() {
  return (
    <aside
      aria-label="About Open Poll"
      className="relative hidden flex-col justify-center overflow-hidden border-l border-border bg-card px-12 py-16 lg:flex xl:px-20"
    >
      {/* The landing's graph paper, so signing in feels like the same place. */}
      <div aria-hidden="true" className="mk-grid mk-grid-flat pointer-events-none absolute inset-0" />
      <div className="relative mx-auto w-full max-w-md">
        <h2 className="text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.04em]">Ask the room. See answers live.</h2>

        <ul className="mt-6 space-y-3">
          {POINTS.map((point) => (
            <li key={point} className="flex items-start gap-3 text-base text-muted-foreground">
              <Check className="mt-1 size-4 shrink-0 text-accent-ink" strokeWidth={2.25} aria-hidden="true" />
              {point}
            </li>
          ))}
        </ul>

        {/* Sample session, a sheet that follows the app theme with its answers as cards */}
        <div
          role="img"
          aria-label="Sample live session with three answers and a join code."
          className="mt-10 overflow-hidden rounded-2xl border border-border bg-card text-foreground shadow-[0_32px_64px_-28px_rgb(23_23_23/0.3)]"
        >
          <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm">
            <span className="size-2 rounded-full bg-success" />
            <span className="font-medium">Live</span>
            <span className="text-muted-foreground">Sample session</span>
          </div>
          <div className="bg-background p-5">
            <p className="text-lg font-semibold tracking-[-0.02em]">What should we cover next?</p>
            <ul className="mt-4 space-y-2">
              {BARS.map((bar, i) => (
                <li key={bar.label}>
                  <ResultRow size="sm" letter={String.fromCharCode(65 + i)} label={bar.label} pct={bar.pct} lead={bar.lead} delay={0.2 + i * 0.08} />
                </li>
              ))}
            </ul>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-border px-4 py-3">
            <div>
              <p className="text-xs text-muted-foreground">Join with code</p>
              <p className="font-mono text-lg font-semibold tracking-[0.12em]">482 913</p>
            </div>
            <JoinCodeTile size={56} />
          </div>
        </div>
      </div>
    </aside>
  );
}
