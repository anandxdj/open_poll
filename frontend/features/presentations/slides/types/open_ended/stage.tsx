"use client";

import type { StageViewProps } from "../../runtime";

/** Card wall of free-form responses; repeats show a ×N badge. */
export function OpenEndedStage({ live, reveal, mode }: StageViewProps) {
  const dist =
    mode === "thumbnail"
      ? ({ kind: "responses", responses: [] } as const)
      : (live.distribution ?? reveal?.distribution ?? null);
  if (dist?.kind !== "responses") return null;
  return (
    <div className="pt-2 max-h-[55vh] overflow-y-auto">
      <div className="flex flex-wrap gap-2.5 justify-center font-sans">
        {dist.responses.map((r, i) => (
          <span
            key={i}
            className="rounded-2xl bg-deck-stage-fg/10 border border-deck-stage-fg/15 px-4 py-2 text-sm font-semibold text-deck-stage-fg/90 shadow-sm"
          >
            {r.text}
            {r.count > 1 && (
              <span className="ml-2 font-mono text-xs text-deck-accent bg-deck-accent/10 px-2 py-0.5 rounded-full border border-deck-accent/20">
                ×{r.count}
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
