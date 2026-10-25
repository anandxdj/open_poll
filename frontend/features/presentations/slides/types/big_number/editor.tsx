"use client";

import { useId, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BigNumberContent } from "../../../types/content";
import { blankContentSlide, cleanContentSlide, TextField } from "../../content/editorFields";
import { readBigNumber } from "../../content/payloads";
import type { SlideEditorDef, SlideEditorProps } from "../../editor";
import { entryInputClass } from "../../editorKit";
import { BIG_NUMBER_LIMIT } from "./format";
import { meta } from "./meta";

const labelClass = "text-xs font-semibold uppercase tracking-wider text-muted-foreground/60";

/** "1,500" / "1 500" / "87.5" → number; anything else → null. */
const parseNumber = (text: string): number | null => {
  const cleaned = text.trim().replace(/[\s,_]/g, "");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
};

function BigNumberEditor({ slide, onChange }: SlideEditorProps) {
  const content = readBigNumber(slide.content);
  const set = (patch: Partial<BigNumberContent>) => onChange({ content: { ...content, ...patch } });
  const valueId = useId();
  const errorId = useId();

  // Typed text is kept as is ("1,500", "3.") and the parsed number stored.
  const [draft, setDraft] = useState(content.value === null ? "" : String(content.value));
  const [shown, setShown] = useState(content.value);
  if (shown !== content.value) {
    setShown(content.value);
    if (parseNumber(draft) !== content.value) setDraft(content.value === null ? "" : String(content.value));
  }
  const invalid = draft.trim() !== "" && parseNumber(draft) === null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[1fr_2fr_1fr] gap-3">
        <TextField label="Before" value={content.prefix} onChange={(prefix) => set({ prefix })} maxLength={12} placeholder="$" />
        <div className="space-y-2">
          <Label htmlFor={valueId} className={labelClass}>
            Number
            <span className="text-primary/80" aria-hidden>
              *
            </span>
          </Label>
          <Input
            id={valueId}
            inputMode="decimal"
            required
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              set({ value: parseNumber(e.target.value) });
            }}
            placeholder="87.5"
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
            className={`${entryInputClass} text-center text-base font-bold tabular-nums`}
          />
        </div>
        <TextField label="After" value={content.suffix} onChange={(suffix) => set({ suffix })} maxLength={12} placeholder="%" />
      </div>
      {invalid && (
        <p id={errorId} className="text-xs text-red-400" role="alert">
          Enter a number, like 87.5 or 1,500.
        </p>
      )}
      <TextField
        label="Label"
        value={content.label}
        onChange={(label) => set({ label })}
        maxLength={150}
        placeholder="of teams ship every week"
      />
    </div>
  );
}

export const editor: SlideEditorDef = {
  meta,
  blank: () => blankContentSlide(meta, { value: null, label: "", prefix: "", suffix: "" }),
  Editor: BigNumberEditor,
  validate: (slide) => {
    const { value } = readBigNumber(slide.content);
    if (value === null) return "enter the number to show.";
    if (Math.abs(value) > BIG_NUMBER_LIMIT) return "the number is too large.";
    return null;
  },
  clean: (slide) => {
    const content = readBigNumber(slide.content);
    return cleanContentSlide(slide, meta, {
      value: content.value,
      label: content.label.trim(),
      prefix: content.prefix.trim(),
      suffix: content.suffix.trim(),
    });
  },
  fillDraft: (slide) => {
    const content = readBigNumber(slide.content);
    const value = content.value === null || Math.abs(content.value) > BIG_NUMBER_LIMIT ? 0 : content.value;
    return { ...slide, question: "", content: { ...content, value } };
  },
};
