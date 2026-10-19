import type { ComponentPropsWithoutRef, Ref } from "react";

import { cn } from "@/lib/utils";
import { formatNumber } from "../../advanced/read";
import { fractionOf, type GridAxis, type GridPosition } from "./config";

/** `device`: on a participant's phone (app theme). `stage`: on the projected screen (always dark). */
export type BoardTone = "device" | "stage";

export interface BoardMarker {
  /** Item number shown in the marker is `index + 1`. */
  index: number;
  position: GridPosition;
  active?: boolean;
}

const TONE = {
  device: {
    label: "text-deck-muted-fg",
    board: "border-deck-border bg-deck-surface/60",
    line: "bg-deck-border",
    marker: "bg-deck-primary/75 text-deck-primary-fg",
    active: "bg-deck-primary text-deck-primary-fg ring-4 ring-deck-primary/30",
  },
  stage: {
    label: "text-deck-stage-fg/60",
    board: "border-deck-stage-fg/15 bg-deck-stage-fg/5",
    line: "bg-deck-stage-fg/15",
    marker: "bg-deck-accent text-deck-stage-ink",
    active: "bg-deck-accent text-deck-stage-ink ring-4 ring-deck-accent/30",
  },
} as const;

/**
 * A square board with a cross through the middle, the two axes labelled with
 * their name and range, and a numbered marker per placed item. The vertical
 * axis grows upwards. `boardProps` carries the participant's pointer and
 * keyboard handlers; the stage passes none.
 */
export function GridBoard({
  x,
  y,
  tone,
  markers,
  boardRef,
  boardProps,
  className,
}: {
  x: GridAxis;
  y: GridAxis;
  tone: BoardTone;
  markers: BoardMarker[];
  boardRef?: Ref<HTMLDivElement>;
  boardProps?: ComponentPropsWithoutRef<"div">;
  className?: string;
}) {
  const colors = TONE[tone];
  const ends = cn("shrink-0 font-mono text-[10px] tabular-nums", colors.label);
  return (
    <div className={cn("grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1.5", className)}>
      <div className="flex flex-col items-center justify-between py-0.5">
        <span className={ends}>{formatNumber(y.max)}</span>
        <span
          className={cn("max-h-full truncate text-xs font-semibold [writing-mode:vertical-rl] rotate-180", colors.label)}
        >
          {y.label}
        </span>
        <span className={ends}>{formatNumber(y.min)}</span>
      </div>

      <div
        ref={boardRef}
        {...boardProps}
        className={cn(
          "relative aspect-square w-full select-none overflow-hidden rounded-2xl border",
          colors.board,
          boardProps?.className
        )}
      >
        <span aria-hidden className={cn("absolute inset-y-0 left-1/2 w-px", colors.line)} />
        <span aria-hidden className={cn("absolute inset-x-0 top-1/2 h-px", colors.line)} />
        {markers.map(({ index, position, active }) => {
          const { fx, fy } = fractionOf(position, x, y);
          return (
            <span
              key={index}
              aria-hidden
              data-marker={index}
              className={cn(
                "pointer-events-none absolute flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-xs font-extrabold shadow-md transition-[left,top] duration-500",
                active ? colors.active : colors.marker
              )}
              style={{ left: `${fx * 100}%`, top: `${(1 - fy) * 100}%` }}
            >
              {index + 1}
            </span>
          );
        })}
      </div>

      <span aria-hidden />
      <div className="flex items-center justify-between gap-2">
        <span className={ends}>{formatNumber(x.min)}</span>
        <span className={cn("min-w-0 truncate text-xs font-semibold", colors.label)}>{x.label}</span>
        <span className={ends}>{formatNumber(x.max)}</span>
      </div>
    </div>
  );
}
