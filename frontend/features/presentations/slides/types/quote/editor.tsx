import type { QuoteContent } from "../../../types/content";
import { blankContentSlide, cleanContentSlide, TextField } from "../../content/editorFields";
import { readQuote } from "../../content/payloads";
import type { SlideEditorDef, SlideEditorProps } from "../../editor";
import { meta } from "./meta";

function QuoteEditor({ slide, onChange }: SlideEditorProps) {
  const content = readQuote(slide.content);
  const set = (patch: Partial<QuoteContent>) => onChange({ content: { ...content, ...patch } });
  return (
    <div className="space-y-4">
      <TextField
        label="Quote"
        required
        multiline
        rows={4}
        value={content.text}
        onChange={(text) => set({ text })}
        maxLength={500}
        placeholder="Simplicity is prerequisite for reliability."
      />
      <TextField
        label="Attribution"
        value={content.attribution}
        onChange={(attribution) => set({ attribution })}
        maxLength={150}
        placeholder="Edsger W. Dijkstra"
      />
    </div>
  );
}

export const editor: SlideEditorDef = {
  meta,
  blank: () => blankContentSlide(meta, { text: "", attribution: "" }),
  Editor: QuoteEditor,
  validate: (slide) => (readQuote(slide.content).text ? null : "add the quote text."),
  clean: (slide) => {
    const { text, attribution } = readQuote(slide.content);
    return cleanContentSlide(slide, meta, { text: text.trim(), attribution: attribution.trim() });
  },
  fillDraft: (slide) => {
    const content = readQuote(slide.content);
    return { ...slide, question: "", content: { ...content, text: content.text || "Untitled quote" } };
  },
};
