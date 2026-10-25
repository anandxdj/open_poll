import type { ReactNode } from "react";
import { X } from "lucide-react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { PresentationSlide } from "../types/deck";
import type { SlideTypeMeta } from "./meta";

// Shared building blocks for `types/<type>/editor.tsx`. Builder-only.

/** Every field empty; the type's `blank()` overrides what it needs. */
export function blankBase(meta: SlideTypeMeta): PresentationSlide {
  return {
    type: meta.type,
    question: "",
    options: [],
    acceptedAnswers: [],
    statements: [],
    minLabel: "",
    maxLabel: "",
    scaleMax: 5,
    items: [],
    maxEntries: 3,
    timeLimit: 30,
    points: meta.scored ? 1000 : 0,
    scoreDependsOnTime: meta.scored,
  };
}

/**
 * Trims the question, clears every type-specific list/label, and zeroes
 * scoring for unscored types. The type's `clean()` then restores its own
 * fields from the original slide.
 */
export function cleanBase(slide: PresentationSlide, meta: SlideTypeMeta): PresentationSlide {
  return {
    ...slide,
    question: slide.question.trim(),
    options: [],
    acceptedAnswers: [],
    statements: [],
    minLabel: "",
    maxLabel: "",
    items: [],
    points: meta.scored ? slide.points : 0,
    scoreDependsOnTime: meta.scored ? slide.scoreDependsOnTime : false,
  };
}

export const requireQuestion = (slide: PresentationSlide): string | null =>
  slide.question.trim() ? null : "question text is missing.";

/** Pads `list` with generated entries until it has `min` items. */
export function padTo<T>(list: T[], min: number, make: (index: number) => T): T[] {
  const next = [...list];
  while (next.length < min) next.push(make(next.length));
  return next;
}

export function FieldLabel({
  children,
  className,
  htmlFor,
}: {
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <Label
      htmlFor={htmlFor}
      className={cn("text-sm font-medium text-foreground", className)}
    >
      {children}
    </Label>
  );
}

export function RemoveEntryButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
    >
      <X className="size-4" />
    </button>
  );
}

export function EditorNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-border bg-secondary/60 px-4 py-3 text-sm text-muted-foreground">
      {children}
    </p>
  );
}

export const entryInputClass = "h-10 bg-card";
