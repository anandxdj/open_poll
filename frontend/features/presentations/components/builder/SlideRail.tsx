"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { slideLabel, slideTypeMeta } from "../../slides/meta";
import type { PresentationSlide, PresentationSlideType } from "../../types/deck";
import { SlideThumbnail } from "./SlideThumbnail";
import { SlideTypePicker } from "./SlideTypePicker";

interface SlideRailProps {
  slides: PresentationSlide[];
  active: number;
  onSelect: (index: number) => void;
  onAdd: (type: PresentationSlideType) => void;
  onMove: (from: number, to: number) => void;
  onDuplicate: (index: number) => void;
  onRemove: (index: number) => void;
}

const actionButtonClass =
  "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-30";

/**
 * Slide list with thumbnails. Keyboard, on a focused slide: ArrowUp/ArrowDown
 * select the previous/next slide, Home/End the first/last, and Alt+ArrowUp /
 * Alt+ArrowDown move the slide.
 */
export function SlideRail({ slides, active, onSelect, onAdd, onMove, onDuplicate, onRemove }: SlideRailProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Set by keyboard actions so focus follows the selection once it re-renders.
  const focusAfterRender = useRef<number | null>(null);

  useEffect(() => {
    itemRefs.current[active]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [active]);

  useEffect(() => {
    if (focusAfterRender.current === null) return;
    itemRefs.current[focusAfterRender.current]?.focus();
    focusAfterRender.current = null;
  }, [slides, active]);

  const total = slides.length;

  const move = (from: number, to: number) => {
    if (to < 0 || to >= total) return;
    onMove(from, to);
    focusAfterRender.current = to;
    setAnnouncement(`Slide moved to position ${to + 1} of ${total}.`);
  };

  const select = (index: number) => {
    if (index < 0 || index >= total) return;
    onSelect(index);
    focusAfterRender.current = index;
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const reorder = e.altKey;
    let target: number | null = null;
    if (e.key === "ArrowUp") target = index - 1;
    else if (e.key === "ArrowDown") target = index + 1;
    else if (!reorder && e.key === "Home") target = 0;
    else if (!reorder && e.key === "End") target = total - 1;
    if (target === null) return;
    e.preventDefault();
    if (reorder) move(index, target);
    else select(target);
  };

  const remove = (index: number) => {
    onRemove(index);
    focusAfterRender.current = Math.max(0, Math.min(index, total - 2));
    setAnnouncement(`Slide ${index + 1} deleted.`);
  };

  const duplicate = (index: number) => {
    onDuplicate(index);
    focusAfterRender.current = index + 1;
    setAnnouncement(`Slide ${index + 1} duplicated.`);
  };

  return (
    <div className="flex min-h-0 w-full shrink-0 flex-col border-b border-sidebar-border bg-sidebar lg:h-full lg:w-64 lg:border-b-0 lg:border-r">
      {/* Header */}
      <div className="flex h-11 shrink-0 items-center justify-between px-4">
        <p id="slide-rail-heading" className="text-sm font-medium text-foreground">
          Slides
        </p>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{total}</span>
      </div>

      {/* Scrollable list of slides */}
      <ol
        aria-labelledby="slide-rail-heading"
        className="custom-scrollbar max-h-[40vh] min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2 lg:max-h-none"
      >
        {slides.map((s, i) => {
          const meta = slideTypeMeta(s.type);
          const isActive = i === active;
          const name = slideLabel(s);
          return (
            <li
              key={i}
              className={cn(
                "group relative rounded-lg border p-2 transition-colors duration-150",
                isActive
                  ? "border-border bg-card text-foreground shadow-[0_1px_2px_rgb(23_23_23/0.06)]"
                  : "border-transparent text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              )}
            >
              <button
                type="button"
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                onClick={() => onSelect(i)}
                onKeyDown={(e) => handleKeyDown(e, i)}
                aria-current={isActive ? "true" : undefined}
                aria-label={`Slide ${i + 1} of ${total}: ${meta.label}, ${name}`}
                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                className="flex w-full items-start gap-2 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span className={cn("w-4 shrink-0 pt-0.5 font-mono text-xs tabular-nums", isActive ? "text-accent-ink" : "text-muted-foreground")}>
                  {i + 1}
                </span>
                <SlideThumbnail slide={s} />
              </button>

              <div
                className={cn(
                  "absolute bottom-3 right-3 flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5 shadow-sm transition-opacity",
                  isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                )}
              >
                <button
                  type="button"
                  onClick={() => move(i, i - 1)}
                  disabled={i === 0}
                  aria-label={`Move slide ${i + 1} up`}
                  title="Move up (Alt+↑)"
                  className={actionButtonClass}
                >
                  <ArrowUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, i + 1)}
                  disabled={i === total - 1}
                  aria-label={`Move slide ${i + 1} down`}
                  title="Move down (Alt+↓)"
                  className={actionButtonClass}
                >
                  <ArrowDown className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => duplicate(i)}
                  aria-label={`Duplicate slide ${i + 1}`}
                  title="Duplicate"
                  className={actionButtonClass}
                >
                  <Copy className="size-3.5" />
                </button>
                {total > 1 && (
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    aria-label={`Delete slide ${i + 1}`}
                    title="Delete"
                    className={cn(actionButtonClass, "hover:text-destructive")}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      {/* Pinned Footer */}
      <div className="relative shrink-0 border-t border-sidebar-border p-3">
        <Button
          variant="outline"
          onClick={() => setPickerOpen((v) => !v)}
          aria-expanded={pickerOpen}
          className="w-full border-dashed bg-card"
        >
          <Plus /> New slide
        </Button>
        <SlideTypePicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onPick={(type) => {
            onAdd(type);
            setPickerOpen(false);
          }}
          position="top"
        />
      </div>
    </div>
  );
}
