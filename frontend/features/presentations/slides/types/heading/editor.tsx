import type { HeadingContent } from "../../../types/content";
import { readHeading } from "../../content/payloads";
import { blankContentSlide, cleanContentSlide, TextField } from "../../content/editorFields";
import type { SlideEditorDef, SlideEditorProps } from "../../editor";
import { meta } from "./meta";

function HeadingEditor({ slide, onChange }: SlideEditorProps) {
  const content = readHeading(slide.content);
  const set = (patch: Partial<HeadingContent>) => onChange({ content: { ...content, ...patch } });
  return (
    <div className="space-y-4">
      <TextField
        label="Title"
        required
        value={content.title}
        onChange={(title) => set({ title })}
        maxLength={150}
        placeholder="Welcome to the kick-off"
      />
      <TextField
        label="Subtitle"
        value={content.subtitle}
        onChange={(subtitle) => set({ subtitle })}
        maxLength={300}
        placeholder="Optional line under the title"
      />
    </div>
  );
}

export const editor: SlideEditorDef = {
  meta,
  blank: () => blankContentSlide(meta, { title: "", subtitle: "" }),
  Editor: HeadingEditor,
  validate: (slide) => (readHeading(slide.content).title ? null : "add a title."),
  clean: (slide) => {
    const { title, subtitle } = readHeading(slide.content);
    return cleanContentSlide(slide, meta, { title: title.trim(), subtitle: subtitle.trim() });
  },
  fillDraft: (slide) => {
    const content = readHeading(slide.content);
    return { ...slide, question: "", content: { ...content, title: content.title || "Untitled heading" } };
  },
};
