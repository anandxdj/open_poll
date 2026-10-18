import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BulletsContent } from "../../../types/content";
import { blankContentSlide, cleanContentSlide, TextField } from "../../content/editorFields";
import { readBullets } from "../../content/payloads";
import type { SlideEditorDef, SlideEditorProps } from "../../editor";
import { entryInputClass, FieldLabel, RemoveEntryButton } from "../../editorKit";
import { meta } from "./meta";

export const MAX_BULLETS = 10;

function BulletsEditor({ slide, onChange }: SlideEditorProps) {
  const content = readBullets(slide.content);
  const set = (patch: Partial<BulletsContent>) => onChange({ content: { ...content, ...patch } });
  const setItem = (index: number, value: string) =>
    set({ items: content.items.map((item, i) => (i === index ? value : item)) });

  return (
    <div className="space-y-4">
      <TextField
        label="Title"
        value={content.title}
        onChange={(title) => set({ title })}
        maxLength={150}
        placeholder="Optional title"
      />
      <div className="space-y-2">
        <FieldLabel>Bullets</FieldLabel>
        <ul className="space-y-2">
          {content.items.map((item, i) => (
            <li key={i} className="flex items-center gap-2">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary/60" />
              <Input
                value={item}
                onChange={(e) => setItem(i, e.target.value)}
                placeholder={`Point ${i + 1}`}
                aria-label={`Bullet ${i + 1}`}
                maxLength={200}
                className={entryInputClass}
              />
              {content.items.length > 1 && (
                <RemoveEntryButton
                  label={`Remove bullet ${i + 1}`}
                  onClick={() => set({ items: content.items.filter((_, j) => j !== i) })}
                />
              )}
            </li>
          ))}
        </ul>
        {content.items.length < MAX_BULLETS && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => set({ items: [...content.items, ""] })}
            className="text-xs text-muted-foreground/70 hover:text-foreground"
          >
            <Plus className="size-3.5 mr-1" /> Add bullet
          </Button>
        )}
      </div>
    </div>
  );
}

export const editor: SlideEditorDef = {
  meta,
  blank: () => blankContentSlide(meta, { title: "", items: [""] }),
  Editor: BulletsEditor,
  validate: (slide) => (readBullets(slide.content).items.length > 0 ? null : "add at least one bullet."),
  clean: (slide) => {
    const { title, items } = readBullets(slide.content);
    return cleanContentSlide(slide, meta, {
      title: title.trim(),
      items: items
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, MAX_BULLETS),
    });
  },
  fillDraft: (slide) => {
    const content = readBullets(slide.content);
    return {
      ...slide,
      question: "",
      content: { ...content, items: content.items.length > 0 ? content.items : ["Untitled bullet"] },
    };
  },
};
