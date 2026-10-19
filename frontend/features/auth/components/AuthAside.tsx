import { Check } from "lucide-react";
import { JoinCodeTile } from "@/features/landing/components/hero/LiveRoomPreview";

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
      className="relative hidden flex-col justify-center border-l border-border bg-card px-12 py-16 lg:flex xl:px-20"
    >
      <div className="mx-auto w-full max-w-md">
        <h2 className="text-balance text-3xl font-semibold tracking-[-0.03em]">Ask the room. See answers live.</h2>

        <ul className="mt-6 space-y-3">
          {POINTS.map((point) => (
            <li key={point} className="flex items-start gap-3 text-base text-muted-foreground">
              <Check className="mt-1 size-4 shrink-0 text-accent-ink" strokeWidth={2.25} aria-hidden="true" />
              {point}
            </li>
          ))}
        </ul>

        {/* Sample session, always dark like the projected screen */}
        <div
          role="img"
          aria-label="Sample live session with three answer bars and a join code."
          className="dark mt-10 overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-xl shadow-black/10"
        >
          <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm">
            <span className="size-2 rounded-full bg-success" />
            <span className="font-medium">Live</span>
            <span className="text-muted-foreground">Sample session</span>
          </div>
          <div className="p-5">
            <p className="text-lg font-semibold tracking-[-0.02em]">What should we cover next?</p>
            <ul className="mt-5 space-y-3.5">
              {BARS.map((bar) => (
                <li key={bar.label}>
                  <div className="mb-1.5 flex items-baseline justify-between text-sm">
                    <span className={bar.lead ? "text-foreground" : "text-muted-foreground"}>{bar.label}</span>
                    <span className="font-mono tabular-nums text-muted-foreground">{bar.pct}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div
                      className={bar.lead ? "h-full rounded-full bg-primary" : "h-full rounded-full bg-muted-foreground/50"}
                      style={{ width: `${bar.pct}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-border bg-card px-4 py-3">
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
