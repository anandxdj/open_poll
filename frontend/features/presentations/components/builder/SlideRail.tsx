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
  "flex size-6 items-center justify-center rounded-lg text-muted-foreground/70 transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-30";

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
    <div className="w-full lg:w-56 shrink-0 flex flex-col rounded-3xl border border-white/10 bg-card/60 backdrop-blur-xl h-full min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/10 px-3.5">
        <p id="slide-rail-heading" className="text-[10px] font-bold uppercase tracking-widest text-primary/80">
          Slides
        </p>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">{total}</span>
      </div>

      {/* Scrollable list of slides */}
      <ol
        aria-labelledby="slide-rail-heading"
        className="custom-scrollbar flex-1 space-y-1.5 overflow-y-auto p-2 min-h-0 max-h-[40vh] lg:max-h-none"
      >
        {slides.map((s, i) => {
          const meta = slideTypeMeta(s.type);
          const isActive = i === active;
          const name = slideLabel(s);
          return (
            <li
              key={i}
              className={cn(
                "group relative rounded-2xl border p-2 transition-all duration-300",
                isActive
                  ? "border-primary/40 bg-primary/10 ring-1 ring-yellow-400/30 text-foreground"
                  : "border-white/5 bg-white/3 text-muted-foreground hover:bg-white/6 hover:text-foreground"
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
                className="flex w-full items-start gap-2 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <span className="w-3 shrink-0 pt-0.5 text-[10px] font-bold text-muted-foreground/50 tabular-nums">
                  {i + 1}
                </span>
                <SlideThumbnail slide={s} />
              </button>

              <div
                className={cn(
                  "absolute bottom-3 right-3 flex items-center gap-0.5 rounded-lg border border-white/10 bg-card/90 p-0.5 shadow-sm backdrop-blur transition-opacity",
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
                  <ArrowUp className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, i + 1)}
                  disabled={i === total - 1}
                  aria-label={`Move slide ${i + 1} down`}
                  title="Move down (Alt+↓)"
                  className={actionButtonClass}
                >
                  <ArrowDown className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={() => duplicate(i)}
                  aria-label={`Duplicate slide ${i + 1}`}
                  title="Duplicate"
                  className={actionButtonClass}
                >
                  <Copy className="size-3" />
                </button>
                {total > 1 && (
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    aria-label={`Delete slide ${i + 1}`}
                    title="Delete"
                    className={cn(actionButtonClass, "hover:text-red-400")}
                  >
                    <Trash2 className="size-3" />
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
      <div className="relative shrink-0 border-t border-white/10 p-2">
        <Button
          variant="outline"
          onClick={() => setPickerOpen((v) => !v)}
          aria-expanded={pickerOpen}
          className="w-full rounded-2xl border-dashed border-white/15 bg-transparent text-xs text-muted-foreground/70 hover:text-foreground hover:border-primary/40 hover:bg-primary/5"
        >
          <Plus className="size-3.5 mr-1" /> New slide
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
