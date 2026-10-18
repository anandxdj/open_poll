import { CheckCircle2, Circle, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SlideEditorDef, SlideEditorProps } from "../../editor";
import {
  blankBase,
  cleanBase,
  entryInputClass,
  FieldLabel,
  padTo,
  RemoveEntryButton,
  requireQuestion,
} from "../../editorKit";
import { meta } from "./meta";

const MAX_OPTIONS = 8;

function SelectAnswerEditor({ slide, onChange }: SlideEditorProps) {
  return (
    <div className="space-y-2">
      <FieldLabel>Options — tap the circle to mark correct</FieldLabel>
      <div className="space-y-2">
        {slide.options.map((option, i) => (
          <div key={i} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                onChange({
                  options: slide.options.map((o, j) => (j === i ? { ...o, isCorrect: !o.isCorrect } : o)),
                })
              }
              title="Mark correct"
              aria-label={`Mark option ${i + 1} correct`}
              aria-pressed={option.isCorrect}
              className="shrink-0"
            >
              {option.isCorrect ? (
                <CheckCircle2 className="size-5 text-emerald-400" />
              ) : (
                <Circle className="size-5 text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors" />
              )}
            </button>
            <Input
              value={option.text}
              onChange={(e) =>
                onChange({
                  options: slide.options.map((o, j) => (j === i ? { ...o, text: e.target.value } : o)),
                })
              }
              placeholder={`Option ${i + 1}`}
              className={entryInputClass}
            />
            {slide.options.length > 2 && (
              <RemoveEntryButton
                label={`Remove option ${i + 1}`}
                onClick={() => onChange({ options: slide.options.filter((_, j) => j !== i) })}
              />
            )}
          </div>
        ))}
      </div>
      {slide.options.length < MAX_OPTIONS && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({ options: [...slide.options, { text: "", isCorrect: false }] })}
          className="text-xs text-muted-foreground/70 hover:text-foreground"
        >
          <Plus className="size-3.5 mr-1" /> Add option
        </Button>
      )}
    </div>
  );
}

export const editor: SlideEditorDef = {
  meta,
  blank: () => ({
    ...blankBase(meta),
    options: [
      { text: "", isCorrect: true },
      { text: "", isCorrect: false },
    ],
  }),
  Editor: SelectAnswerEditor,
  validate: (slide) => {
    const missing = requireQuestion(slide);
    if (missing) return missing;
    const filled = slide.options.filter((o) => o.text.trim());
    if (filled.length < 2) return "needs at least 2 options.";
    if (!filled.some((o) => o.isCorrect)) return "mark a correct option.";
    return null;
  },
  clean: (slide) => ({
    ...cleanBase(slide, meta),
    options: slide.options.filter((o) => o.text.trim()),
  }),
  fillDraft: (slide) => {
    const options = padTo(
      slide.options.map((o) => ({ ...o, text: o.text.trim() })).filter((o) => o.text),
      2,
      (i) => ({ text: `Option ${i + 1}`, isCorrect: false })
    );
    if (!options.some((o) => o.isCorrect)) options[0] = { ...options[0], isCorrect: true };
    return { ...slide, options };
  },
};
