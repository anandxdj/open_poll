import { Input } from "@/components/ui/input";
import type { SlideEditorDef, SlideEditorProps } from "../../editor";
import { blankBase, cleanBase, EditorNote, FieldLabel } from "../../editorKit";
import { meta } from "./meta";

const HEADING_MAX = 200;

function QnaEditor({ slide, onChange }: SlideEditorProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <FieldLabel htmlFor="qna-slide-heading">Heading</FieldLabel>
        <Input
          id="qna-slide-heading"
          value={slide.question}
          maxLength={HEADING_MAX}
          onChange={(e) => onChange({ question: e.target.value })}
          placeholder="Ask us anything"
          className="h-10 rounded-xl bg-secondary/15 border-border/40"
        />
      </div>
      <EditorNote>
        The stage lists the audience&apos;s questions, most upvoted first. While this slide is on screen
        participants can ask even if Q&amp;A is switched off for the deck. Turn moderation, anonymous
        questions and upvotes on or off in the Audience tab.
      </EditorNote>
    </div>
  );
}

export const editor: SlideEditorDef = {
  meta,
  // A heading is optional; the slide runs without a timer or points.
  blank: () => ({ ...blankBase(meta), timeLimit: 0 }),
  Editor: QnaEditor,
  validate: () => null,
  clean: (slide) => ({ ...cleanBase(slide, meta), timeLimit: 0 }),
  // The draft normalizer fills an empty heading with "Untitled Question"; a Q&A board has none.
  fillDraft: (slide) => ({ ...slide, question: slide.question === "Untitled Question" ? "" : slide.question }),
};
