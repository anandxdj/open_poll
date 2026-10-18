import { useState } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SlideEditorDef, SlideEditorProps } from "../../editor";
import { blankBase, cleanBase, entryInputClass, FieldLabel, requireQuestion } from "../../editorKit";
import { meta } from "./meta";

function TypeAnswerEditor({ slide, onChange }: SlideEditorProps) {
  const [draft, setDraft] = useState("");

  const addAcceptedAnswer = () => {
    const value = draft.trim();
    if (!value) return;
    if (slide.acceptedAnswers.some((a) => a.toLowerCase() === value.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange({ acceptedAnswers: [...slide.acceptedAnswers, value] });
    setDraft("");
  };

  return (
    <div className="space-y-2">
      <FieldLabel>Accepted answers (case-insensitive)</FieldLabel>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addAcceptedAnswer();
            }
          }}
          placeholder="Type an answer and press Enter"
          className={entryInputClass}
        />
        <Button variant="outline" onClick={addAcceptedAnswer} className="rounded-xl">
          Add
        </Button>
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        {slide.acceptedAnswers.map((answer, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 text-xs font-medium text-emerald-400"
          >
            {answer}
            <button
              type="button"
              aria-label={`Remove accepted answer ${answer}`}
              onClick={() => onChange({ acceptedAnswers: slide.acceptedAnswers.filter((_, j) => j !== i) })}
              className="hover:text-red-400 transition-colors"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

export const editor: SlideEditorDef = {
  meta,
  blank: () => blankBase(meta),
  Editor: TypeAnswerEditor,
  validate: (slide) => {
    const missing = requireQuestion(slide);
    if (missing) return missing;
    if (slide.acceptedAnswers.length === 0) return "add at least one accepted answer.";
    return null;
  },
  clean: (slide) => ({
    ...cleanBase(slide, meta),
    acceptedAnswers: slide.acceptedAnswers,
  }),
  fillDraft: (slide) =>
    slide.acceptedAnswers.length === 0 ? { ...slide, acceptedAnswers: [slide.question] } : slide,
};
