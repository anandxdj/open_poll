"use client";

import { useId, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { SlideContent } from "../../types/content";
import type { PresentationSlide } from "../../types/deck";
import { blankBase, cleanBase, entryInputClass } from "../editorKit";
import type { SlideTypeMeta } from "../meta";

// Builder-only building blocks of the content slide editors.

/** Same look as editorKit's FieldLabel. */
const labelClass = "text-xs font-semibold uppercase tracking-wider text-muted-foreground/60";

/** A fresh content slide: no question, no timer, no scoring, the type's blank payload. */
export function blankContentSlide(meta: SlideTypeMeta, content: SlideContent): PresentationSlide {
  return { ...blankBase(meta), timeLimit: 0, content };
}

/**
 * A cleaned content slide: other types' fields cleared, the question emptied
 * (content slides show their own text) and the timer at 0, with the type's
 * cleaned payload.
 */
export function cleanContentSlide(slide: PresentationSlide, meta: SlideTypeMeta, content: SlideContent): PresentationSlide {
  return { ...cleanBase(slide, meta), question: "", timeLimit: 0, content };
}

/** Labelled text input (or textarea) with a character counter near the limit and an optional hint. */
export function TextField({
  label,
  value,
  onChange,
  maxLength,
  placeholder,
  multiline = false,
  required = false,
  hint,
  rows,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  placeholder?: string;
  multiline?: boolean;
  required?: boolean;
  hint?: ReactNode;
  rows?: number;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const field = {
    id,
    value,
    maxLength,
    placeholder,
    required,
    "aria-describedby": hint ? hintId : undefined,
  };
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id} className={labelClass}>
          {label}
          {required && (
            <span className="text-primary/80" aria-hidden>
              *
            </span>
          )}
        </Label>
        {value.length > maxLength * 0.8 && (
          <span className="text-[10px] tabular-nums text-muted-foreground/60">
            {value.length}/{maxLength}
          </span>
        )}
      </div>
      {multiline ? (
        <Textarea
          {...field}
          rows={rows}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-24 rounded-2xl bg-secondary/15 border-border/40 px-4 py-3 text-sm resize-y"
        />
      ) : (
        <Input {...field} onChange={(e) => onChange(e.target.value)} className={entryInputClass} />
      )}
      {hint && (
        <p id={hintId} className="text-[11px] text-muted-foreground/60">
          {hint}
        </p>
      )}
    </div>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  Icon?: LucideIcon;
  disabled?: boolean;
}

/** A small radio group drawn as segmented buttons. */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
}) {
  const labelId = useId();
  return (
    <div className="space-y-2">
      <p id={labelId} className={labelClass}>
        {label}
      </p>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="inline-flex flex-wrap gap-1 rounded-xl border border-border/40 bg-secondary/15 p-1"
      >
        {options.map(({ value: option, label: optionLabel, Icon, disabled }) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={value === option}
            disabled={disabled}
            onClick={() => onChange(option)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              value === option ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {Icon && <Icon className="size-3.5" aria-hidden />}
            {optionLabel}
          </button>
        ))}
      </div>
    </div>
  );
}
