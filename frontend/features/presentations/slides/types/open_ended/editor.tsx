import type { SlideEditorDef } from "../../editor";
import { blankBase, cleanBase, EditorNote, requireQuestion } from "../../editorKit";
import { meta } from "./meta";

function OpenEndedEditor() {
  return (
    <EditorNote>
      Participants type a free-form response. Answers show up as a card wall on the presenter screen —
      duplicates are grouped with a counter.
    </EditorNote>
  );
}

export const editor: SlideEditorDef = {
  meta,
  blank: () => ({ ...blankBase(meta), timeLimit: 60 }),
  Editor: OpenEndedEditor,
  validate: requireQuestion,
  clean: (slide) => cleanBase(slide, meta),
  fillDraft: (slide) => slide,
};
