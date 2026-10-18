import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SlideEditorDef, SlideEditorProps } from "../../editor";
import {
  blankBase,
  cleanBase,
  entryInputClass,
  FieldLabel,
  RemoveEntryButton,
  requireQuestion,
} from "../../editorKit";
import { meta } from "./meta";

const MAX_STATEMENTS = 10;

function ScalesEditor({ slide, onChange }: SlideEditorProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <FieldLabel>Statements to rate (1–{slide.scaleMax})</FieldLabel>
        <div className="space-y-2">
          {slide.statements.map((statement, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={statement}
                onChange={(e) =>
                  onChange({ statements: slide.statements.map((s, j) => (j === i ? e.target.value : s)) })
                }
                placeholder={`Statement ${i + 1}`}
                className={entryInputClass}
              />
              {slide.statements.length > 1 && (
                <RemoveEntryButton
                  label={`Remove statement ${i + 1}`}
                  onClick={() => onChange({ statements: slide.statements.filter((_, j) => j !== i) })}
                />
              )}
            </div>
          ))}
        </div>
        {slide.statements.length < MAX_STATEMENTS && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange({ statements: [...slide.statements, ""] })}
            className="text-xs text-muted-foreground/70 hover:text-foreground"
          >
            <Plus className="size-3.5 mr-1" /> Add statement
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <FieldLabel>Low label</FieldLabel>
          <Input
            value={slide.minLabel}
            onChange={(e) => onChange({ minLabel: e.target.value })}
            placeholder="Disagree"
            aria-label="Low label"
            className={entryInputClass}
          />
        </div>
        <div className="space-y-2">
          <FieldLabel>High label</FieldLabel>
          <Input
            value={slide.maxLabel}
            onChange={(e) => onChange({ maxLabel: e.target.value })}
            placeholder="Agree"
            aria-label="High label"
            className={entryInputClass}
          />
        </div>
      </div>
    </div>
  );
}

export const editor: SlideEditorDef = {
  meta,
  blank: () => ({ ...blankBase(meta), statements: [""], minLabel: "Disagree", maxLabel: "Agree" }),
  Editor: ScalesEditor,
  validate: (slide) => {
    const missing = requireQuestion(slide);
    if (missing) return missing;
    if (slide.statements.filter((st) => st.trim()).length === 0) return "add at least one statement.";
    return null;
  },
  clean: (slide) => ({
    ...cleanBase(slide, meta),
    statements: slide.statements.filter((st) => st.trim()),
    minLabel: slide.minLabel,
    maxLabel: slide.maxLabel,
  }),
  fillDraft: (slide) =>
    slide.statements.length === 0 ? { ...slide, statements: ["Untitled statement"] } : slide,
};
