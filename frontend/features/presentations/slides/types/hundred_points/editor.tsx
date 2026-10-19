import { ItemsField } from "../../advanced/editorFields";
import type { SlideEditorDef, SlideEditorProps } from "../../editor";
import { blankBase, cleanBase, EditorNote, padTo, requireQuestion } from "../../editorKit";
import { hundredPointsItems, MAX_POINT_ITEMS, MIN_POINT_ITEMS } from "./config";
import { meta } from "./meta";

function HundredPointsEditor({ slide, onChange }: SlideEditorProps) {
  return (
    <div className="space-y-4">
      <ItemsField
        label="Items to share the points over"
        items={hundredPointsItems(slide)}
        onChange={(items) => onChange({ config: { items } })}
        min={MIN_POINT_ITEMS}
        max={MAX_POINT_ITEMS}
        placeholder={(i) => `Item ${i + 1}`}
        addLabel="Add item"
      />
      <EditorNote>
        Each participant gives out exactly 100 points in whole numbers. The stage shows the average points per item.
        This slide is never scored.
      </EditorNote>
    </div>
  );
}

const cleanItems = (slide: object) =>
  hundredPointsItems(slide)
    .map((item) => item.trim())
    .filter(Boolean);

export const editor: SlideEditorDef = {
  meta,
  blank: () => ({ ...blankBase(meta), timeLimit: 60, config: { items: ["", ""] } }),
  Editor: HundredPointsEditor,
  validate: (slide) => {
    const missing = requireQuestion(slide);
    if (missing) return missing;
    const items = hundredPointsItems(slide);
    if (items.length < MIN_POINT_ITEMS) return `add at least ${MIN_POINT_ITEMS} items.`;
    if (items.length > MAX_POINT_ITEMS) return `use at most ${MAX_POINT_ITEMS} items.`;
    return null;
  },
  clean: (slide) => ({ ...cleanBase(slide, meta), config: { items: cleanItems(slide) } }),
  fillDraft: (slide) => ({
    ...slide,
    config: { items: padTo(cleanItems(slide), MIN_POINT_ITEMS, (i) => `Item ${i + 1}`).slice(0, MAX_POINT_ITEMS) },
  }),
};
