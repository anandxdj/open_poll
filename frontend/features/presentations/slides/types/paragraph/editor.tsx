import type { ParagraphContent } from "../../../types/content";
import { blankContentSlide, cleanContentSlide, TextField } from "../../content/editorFields";
import { hasUnsafeLink } from "../../content/markdown";
import { readParagraph } from "../../content/payloads";
import type { SlideEditorDef, SlideEditorProps } from "../../editor";
import { meta } from "./meta";

export const MAX_PARAGRAPH = 2000;

function ParagraphEditor({ slide, onChange }: SlideEditorProps) {
  const content = readParagraph(slide.content);
  const set = (patch: Partial<ParagraphContent>) => onChange({ content: { ...content, ...patch } });
  return (
    <div className="space-y-4">
      <TextField
        label="Title"
        value={content.title}
        onChange={(title) => set({ title })}
        maxLength={150}
        placeholder="Optional title"
      />
      <TextField
        label="Text"
        required
        multiline
        rows={8}
        value={content.body}
        onChange={(body) => set({ body })}
        maxLength={MAX_PARAGRAPH}
        placeholder="What do you want to tell your audience?"
        hint={
          <>
            <code>**bold**</code>, <code>*italic*</code> and <code>[links](https://…)</code> work. A blank line starts
            a new paragraph.
          </>
        }
      />
    </div>
  );
}

export const editor: SlideEditorDef = {
  meta,
  blank: () => blankContentSlide(meta, { title: "", body: "" }),
  Editor: ParagraphEditor,
  validate: (slide) => {
    const { body } = readParagraph(slide.content);
    if (!body) return "add some text.";
    if (hasUnsafeLink(body)) return "links must start with https://, http:// or mailto:.";
    return null;
  },
  clean: (slide) => {
    const { title, body } = readParagraph(slide.content);
    return cleanContentSlide(slide, meta, { title: title.trim(), body: body.trim() });
  },
  fillDraft: (slide) => {
    const content = readParagraph(slide.content);
    return { ...slide, question: "", content: { ...content, body: content.body || "Untitled paragraph" } };
  },
};
