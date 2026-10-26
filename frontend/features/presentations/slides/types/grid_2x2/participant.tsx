"use client";

import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Check, Loader2, Send } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { formatNumber, pointerFraction } from "../../advanced/read";
import type { ParticipantViewProps } from "../../runtime";
import { GridBoard } from "./Board";
import {
  completePositions,
  gridConfig,
  nearestPlaced,
  nextUnplaced,
  nudgePosition,
  positionAt,
  centerPosition,
  type Direction,
  type GridPosition,
} from "./config";

const ARROWS: Record<string, Direction> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

/**
 * Place every item on the board: tap or drag for the selected item (a tap
 * on an item that is already there grabs it), or focus the board and move the
 * selected item with the arrow keys (Shift = bigger steps, Enter = next item).
 */
export function Grid2x2Participant({ slide, mode, onSubmit, submitting }: ParticipantViewProps) {
  const t = useTranslations("slidesAdvanced.grid2x2");
  const { items, x, y, quadrants } = gridConfig(slide);
  const [positions, setPositions] = useState<(GridPosition | null)[]>(() => items.map(() => null));
  const [active, setActive] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const boardRef = useRef<HTMLDivElement>(null);
  const latest = useRef(positions);
  const drag = useRef<{ index: number; fresh: boolean } | null>(null);
  const hintId = useId();
  const locked = submitting || mode === "preview";

  const place = (index: number, position: GridPosition) => {
    latest.current = latest.current.map((p, i) => (i === index ? position : p));
    setPositions(latest.current);
  };
  const announce = (index: number, position: GridPosition) =>
    setAnnouncement(
      t("placedAt", {
        item: items[index] ?? "",
        xLabel: x.label,
        xValue: formatNumber(position.x),
        yLabel: y.label,
        yValue: formatNumber(position.y),
      })
    );
  const pointerAt = (event: PointerEvent<HTMLDivElement>) => {
    const box = boardRef.current?.getBoundingClientRect();
    if (!box) return null;
    const { fx, fy } = pointerFraction(box, event.clientX, event.clientY);
    return { fx, fy: 1 - fy };
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (locked || items.length === 0) return;
    const at = pointerAt(event);
    if (!at) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const grabbed = nearestPlaced(latest.current, at.fx, at.fy, x, y);
    if (grabbed !== null) {
      setActive(grabbed);
      drag.current = { index: grabbed, fresh: false };
      return;
    }
    drag.current = { index: active, fresh: latest.current[active] === null };
    place(active, positionAt(at.fx, at.fy, x, y));
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    const at = current && pointerAt(event);
    if (current && at) place(current.index, positionAt(at.fx, at.fy, x, y));
  };
  const onPointerEnd = () => {
    const current = drag.current;
    drag.current = null;
    if (!current) return;
    const position = latest.current[current.index];
    if (position) announce(current.index, position);
    // A freshly placed item hands the selection to the next one still to place.
    if (current.fresh) {
      const next = nextUnplaced(latest.current, current.index + 1);
      if (next !== null) setActive(next);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (locked || items.length === 0) return;
    const direction = ARROWS[event.key];
    if (direction) {
      event.preventDefault();
      const next = nudgePosition(latest.current[active] ?? null, direction, x, y, event.shiftKey);
      place(active, next);
      announce(active, next);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const here = latest.current[active];
      if (!here) {
        const middle = centerPosition(x, y);
        place(active, middle);
        announce(active, middle);
        return;
      }
      const next = nextUnplaced(latest.current, active + 1);
      if (next !== null) setActive(next);
    }
  };

  const placed = positions.filter((p) => p !== null).length;
  const answer = completePositions(positions);
  const activePlaced = positions[active] != null;

  return (
    <div className="w-full space-y-5">
      <GridBoard
        x={x}
        y={y}
        tone="device"
        quadrants={quadrants}
        boardRef={boardRef}
        markers={positions.flatMap((position, index) => (position ? [{ index, position, active: index === active }] : []))}
        boardProps={{
          tabIndex: locked ? -1 : 0,
          role: "group",
          "aria-label": t("board", { x: x.label, y: y.label }),
          "aria-describedby": hintId,
          onPointerDown,
          onPointerMove,
          onPointerUp: onPointerEnd,
          onPointerCancel: onPointerEnd,
          onKeyDown,
          className: cn(
            "touch-none cursor-crosshair outline-none focus-visible:ring-2 focus-visible:ring-deck-primary/60",
            locked && "cursor-default opacity-80"
          ),
        }}
      />

      <p id={hintId} className="text-center text-xs text-deck-muted-fg">
        {items[active] === undefined
          ? ""
          : t(activePlaced ? "hintMove" : "hintPlace", { item: items[active] })}
      </p>
      <p role="status" className="sr-only">
        {announcement}
      </p>

      <ul className="grid grid-cols-1 gap-2" aria-label={t("items")}>
        {items.map((item, i) => {
          const isPlaced = positions[i] !== null;
          return (
            <li key={i}>
              <button
                type="button"
                aria-pressed={i === active}
                disabled={locked}
                onClick={() => setActive(i)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition-all",
                  i === active
                    ? "border-deck-primary/70 bg-deck-primary/10 ring-1 ring-deck-primary/40"
                    : "border-deck-border/60 bg-deck-surface/60 hover:border-deck-primary/40"
                )}
              >
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-extrabold",
                    isPlaced ? "bg-deck-primary text-deck-primary-fg" : "border border-deck-border bg-deck-secondary text-deck-muted-fg"
                  )}
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 break-words text-sm font-semibold">{item}</span>
                {isPlaced ? (
                  <Check className="size-4 shrink-0 text-deck-correct-soft" aria-label={t("placed")} />
                ) : (
                  <span className="shrink-0 text-xs text-deck-muted-fg">{t("notPlaced")}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <p className="text-center text-xs font-semibold tabular-nums text-deck-muted-fg">
        {t("progress", { placed, total: items.length })}
      </p>

      <Button
        onClick={() => answer && onSubmit({ payload: { positions: answer } })}
        disabled={locked || !answer}
        className="w-full h-12 rounded-2xl bg-deck-primary text-deck-primary-fg font-bold text-base shadow-md transition-all"
      >
        {submitting ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <span className="flex items-center gap-2">
            {t("submit")} <Send className="size-4" />
          </span>
        )}
      </Button>
    </div>
  );
}
