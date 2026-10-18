import { Plus } from "lucide-react";

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

const MAX_ITEMS = 10;

function RankingEditor({ slide, onChange }: SlideEditorProps) {
  return (
    <div className="space-y-2">
      <FieldLabel>Items to rank</FieldLabel>
      <div className="space-y-2">
        {slide.items.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-muted-foreground/40 tabular-nums w-4 text-right">
              {i + 1}
            </span>
            <Input
              value={item}
              onChange={(e) => onChange({ items: slide.items.map((it, j) => (j === i ? e.target.value : it)) })}
              placeholder={`Item ${i + 1}`}
              className={entryInputClass}
            />
            {slide.items.length > 2 && (
              <RemoveEntryButton
                label={`Remove item ${i + 1}`}
                onClick={() => onChange({ items: slide.items.filter((_, j) => j !== i) })}
              />
            )}
          </div>
        ))}
      </div>
      {slide.items.length < MAX_ITEMS && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({ items: [...slide.items, ""] })}
          className="text-xs text-muted-foreground/70 hover:text-foreground"
        >
          <Plus className="size-3.5 mr-1" /> Add item
        </Button>
      )}
    </div>
  );
}

export const editor: SlideEditorDef = {
  meta,
  blank: () => ({ ...blankBase(meta), items: ["", ""] }),
  Editor: RankingEditor,
  validate: (slide) => {
    const missing = requireQuestion(slide);
    if (missing) return missing;
    if (slide.items.filter((it) => it.trim()).length < 2) return "ranking needs at least 2 items.";
    return null;
  },
  clean: (slide) => ({
    ...cleanBase(slide, meta),
    items: slide.items.filter((it) => it.trim()),
  }),
  fillDraft: (slide) => ({
    ...slide,
    items: padTo(
      slide.items.filter((it) => it.trim()),
      2,
      (i) => `Item ${i + 1}`
    ),
  }),
};
