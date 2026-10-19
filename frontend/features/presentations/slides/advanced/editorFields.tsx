"use client";

import { useId, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { entryInputClass, FieldLabel, RemoveEntryButton } from "../editorKit";

// Builder-only building blocks of the advanced slide editors (guess_number,
// hundred_points, grid_2x2, pin_on_image). Live routes must not import this file.

/** Points a slide gets when it is switched back to graded (the builder default). */
export const GRADED_POINTS = 1000;

const labelClass = "text-xs font-semibold uppercase tracking-wider text-muted-foreground/60";

/**
 * A number input that keeps what the author is typing ("-", "0.", "1e") until
 * the field loses focus; only complete numbers reach `onChange`.
 */
export function NumberField({
  label,
  value,
  onChange,
  step,
  min,
  max,
  hint,
  disabled,
  placeholder,
}: {
  label: string;
  /** null shows an empty field (nothing set yet). */
  value: number | null;
  onChange: (value: number) => void;
  step?: number | "any";
  min?: number;
  max?: number;
  hint?: ReactNode;
  disabled?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className={labelClass}>
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step={step ?? "any"}
        min={min}
        max={max}
        disabled={disabled}
        placeholder={placeholder}
        value={draft ?? (value === null ? "" : String(value))}
        aria-describedby={hint ? hintId : undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          const parsed = event.target.value.trim() === "" ? NaN : Number(event.target.value);
          if (Number.isFinite(parsed)) onChange(parsed);
        }}
        onBlur={() => setDraft(null)}
        className={`${entryInputClass} tabular-nums`}
      />
      {hint && (
        <p id={hintId} className="text-[11px] text-muted-foreground/60">
          {hint}
        </p>
      )}
    </div>
  );
}

/** The "Graded" switch of the optionally scored types (on = the slide is worth points). */
export function GradedSwitch({
  graded,
  onChange,
  hintOn,
  hintOff,
}: {
  graded: boolean;
  onChange: (graded: boolean) => void;
  hintOn: string;
  hintOff: string;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <FieldLabel htmlFor={id}>Graded</FieldLabel>
      <div className="flex items-center gap-3 h-10">
        <Switch id={id} checked={graded} onCheckedChange={onChange} />
        <span className="text-xs text-muted-foreground/60">{graded ? hintOn : hintOff}</span>
      </div>
    </div>
  );
}

/** An inline problem with the settings being edited (the save-time message, capitalized). */
export function IssueNote({ issue }: { issue: string | null }) {
  if (!issue) return null;
  return (
    <p role="alert" className="text-xs text-red-400">
      {issue.charAt(0).toUpperCase() + issue.slice(1)}
    </p>
  );
}

/** A list of short texts (the items to share points over or to place on the grid). */
export function ItemsField({
  label,
  items,
  onChange,
  min,
  max,
  placeholder,
  addLabel,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  /** The list never shrinks below this many entries. */
  min: number;
  max: number;
  placeholder: (index: number) => string;
  addLabel: string;
}) {
  return (
    <div className="space-y-2">
      <FieldLabel>{label}</FieldLabel>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={item}
              maxLength={200}
              onChange={(event) => onChange(items.map((entry, j) => (j === i ? event.target.value : entry)))}
              placeholder={placeholder(i)}
              aria-label={`${label}: item ${i + 1}`}
              className={entryInputClass}
            />
            {items.length > min && (
              <RemoveEntryButton
                label={`Remove item ${i + 1}`}
                onClick={() => onChange(items.filter((_, j) => j !== i))}
              />
            )}
          </div>
        ))}
      </div>
      {items.length < max && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange([...items, ""])}
          className="text-xs text-muted-foreground/70 hover:text-foreground"
        >
          <Plus className="size-3.5 mr-1" /> {addLabel}
        </Button>
      )}
    </div>
  );
}
