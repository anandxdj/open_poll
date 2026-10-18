import { useId } from "react";
import { CheckCircle2, Circle, Plus, Square, SquareCheckBig } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { PresentationSlide, SelectAnswerConfig } from "../../../types/deck";
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
import { isGradedSelectAnswer, MAX_EXPLANATION_LENGTH, selectAnswerConfig } from "./config";
import { meta } from "./meta";

const MAX_OPTIONS = 8;
/** Points a slide gets when it is switched back to graded (the builder default). */
const GRADED_POINTS = 1000;

function SettingSwitch({
  id,
  label,
  checked,
  onCheckedChange,
  hint,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  hint: string;
}) {
  return (
    <div className="space-y-2">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="flex items-center gap-3 h-10">
        <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
        <span className="text-xs text-muted-foreground/60">{hint}</span>
      </div>
    </div>
  );
}

function CorrectMarker({
  index,
  isCorrect,
  multiple,
  onToggle,
}: {
  index: number;
  isCorrect: boolean;
  multiple: boolean;
  onToggle: () => void;
}) {
  const Icon = multiple ? (isCorrect ? SquareCheckBig : Square) : isCorrect ? CheckCircle2 : Circle;
  return (
    <button
      type="button"
      onClick={onToggle}
      title="Mark correct"
      aria-label={`Mark option ${index + 1} correct`}
      aria-pressed={isCorrect}
      className="shrink-0"
    >
      <Icon
        className={
          isCorrect
            ? "size-5 text-emerald-400"
            : "size-5 text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors"
        }
      />
    </button>
  );
}

function SelectAnswerEditor({ slide, onChange }: SlideEditorProps) {
  const id = useId();
  const graded = isGradedSelectAnswer(slide);
  const config = selectAnswerConfig(slide);
  const setConfig = (patch: Partial<SelectAnswerConfig>) => onChange({ config: { ...config, ...patch } });
  const explanationId = `${id}-explanation`;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SettingSwitch
          id={`${id}-graded`}
          label="Graded"
          checked={graded}
          // Ungraded keeps the marks while editing (switching back restores
          // them); `clean` drops them on save.
          onCheckedChange={(checked) => onChange({ points: checked ? GRADED_POINTS : 0 })}
          hint={graded ? "Correct answers score points" : "Results only — no correct answer, no points"}
        />
        <SettingSwitch
          id={`${id}-multiple`}
          label="Allow multiple answers"
          checked={config.allowMultiple}
          onCheckedChange={(allowMultiple) => setConfig({ allowMultiple })}
          hint={
            !config.allowMultiple
              ? "Participants pick one option"
              : graded
              ? "Correct = exactly the marked options"
              : "Participants pick one or more"
          }
        />
      </div>

      <div className="space-y-2">
        <FieldLabel>
          {!graded
            ? "Options"
            : config.allowMultiple
            ? "Options — tick every correct option"
            : "Options — tap the circle to mark correct"}
        </FieldLabel>
        <div className="space-y-2">
          {slide.options.map((option, i) => (
            <div key={i} className="flex items-center gap-2">
              {graded ? (
                <CorrectMarker
                  index={i}
                  isCorrect={option.isCorrect}
                  multiple={config.allowMultiple}
                  onToggle={() =>
                    onChange({
                      options: slide.options.map((o, j) => (j === i ? { ...o, isCorrect: !o.isCorrect } : o)),
                    })
                  }
                />
              ) : (
                <span
                  aria-hidden
                  className="flex size-5 shrink-0 items-center justify-center text-[11px] font-bold text-muted-foreground/50"
                >
                  {String.fromCharCode(65 + i)}
                </span>
              )}
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

      <div className="space-y-2">
        <FieldLabel htmlFor={explanationId}>Explanation (optional)</FieldLabel>
        <Textarea
          id={explanationId}
          value={config.explanation}
          onChange={(e) => setConfig({ explanation: e.target.value })}
          maxLength={MAX_EXPLANATION_LENGTH}
          placeholder="Why is this the answer? Shown on the stage after the reveal."
          className="min-h-20 rounded-xl bg-secondary/15 border-border/40 resize-none [field-sizing:content]"
        />
      </div>
    </div>
  );
}

/** Settings as saved: null while every one is at its default, so single-select slides keep their shape. */
function cleanConfig(slide: PresentationSlide): SelectAnswerConfig | null {
  const { allowMultiple, explanation } = selectAnswerConfig(slide);
  const trimmed = explanation.trim();
  return allowMultiple || trimmed ? { allowMultiple, explanation: trimmed } : null;
}

export const editor: SlideEditorDef = {
  meta,
  blank: () => ({
    ...blankBase(meta),
    options: [
      { text: "", isCorrect: true },
      { text: "", isCorrect: false },
    ],
    config: null,
  }),
  Editor: SelectAnswerEditor,
  validate: (slide) => {
    const missing = requireQuestion(slide);
    if (missing) return missing;
    const filled = slide.options.filter((o) => o.text.trim());
    if (filled.length < 2) return "needs at least 2 options.";
    if (isGradedSelectAnswer(slide) && !filled.some((o) => o.isCorrect)) return "mark a correct option.";
    if (selectAnswerConfig(slide).explanation.length > MAX_EXPLANATION_LENGTH) {
      return `keep the explanation under ${MAX_EXPLANATION_LENGTH} characters.`;
    }
    return null;
  },
  clean: (slide) => {
    const options = slide.options.filter((o) => o.text.trim());
    return {
      ...cleanBase(slide, meta),
      // An ungraded slide has no correct option: a 0-point slide is a survey question.
      options: isGradedSelectAnswer(slide) ? options : options.map((o) => ({ ...o, isCorrect: false })),
      config: cleanConfig(slide),
    };
  },
  fillDraft: (slide) => {
    const options = padTo(
      slide.options.map((o) => ({ ...o, text: o.text.trim() })).filter((o) => o.text),
      2,
      (i) => ({ text: `Option ${i + 1}`, isCorrect: false })
    );
    if (isGradedSelectAnswer(slide) && !options.some((o) => o.isCorrect)) {
      options[0] = { ...options[0], isCorrect: true };
    }
    const config = slide.config?.explanation
      ? { ...slide.config, explanation: slide.config.explanation.slice(0, MAX_EXPLANATION_LENGTH) }
      : slide.config;
    return { ...slide, options, config };
  },
};
