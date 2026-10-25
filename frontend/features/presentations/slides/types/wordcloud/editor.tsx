import type { SlideEditorDef, SlideEditorProps } from "../../editor";
import { blankBase, cleanBase, FieldLabel, requireQuestion } from "../../editorKit";
import { meta } from "./meta";

const ENTRY_CHOICES = [1, 2, 3];

function WordCloudEditor({ slide, onChange }: SlideEditorProps) {
  return (
    <div className="space-y-2">
      <FieldLabel>Entries per participant</FieldLabel>
      <div className="flex gap-2" role="group" aria-label="Entries per participant">
        {ENTRY_CHOICES.map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={slide.maxEntries === n}
            onClick={() => onChange({ maxEntries: n })}
            className={`size-10 rounded-xl border text-sm font-bold transition-all ${
              slide.maxEntries === n
                ? "border-primary/40 bg-primary/10 text-accent-ink"
                : "border-border bg-card text-muted-foreground hover:bg-accent"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Repeated words grow bigger in the live cloud.</p>
    </div>
  );
}

export const editor: SlideEditorDef = {
  meta,
  blank: () => blankBase(meta),
  Editor: WordCloudEditor,
  validate: requireQuestion,
  clean: (slide) => cleanBase(slide, meta),
  fillDraft: (slide) => slide,
};
