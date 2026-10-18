import type { SlideEditorDef } from "../../editor";
import { blankBase, cleanBase, EditorNote, requireQuestion } from "../../editorKit";
import { meta } from "./meta";

function LeaderboardEditor() {
  return (
    <EditorNote>
      Shows the running quiz standings on the presenter screen. Participants don&apos;t answer on this
      slide.
    </EditorNote>
  );
}

export const editor: SlideEditorDef = {
  meta,
  blank: () => blankBase(meta),
  Editor: LeaderboardEditor,
  validate: requireQuestion,
  clean: (slide) => cleanBase(slide, meta),
  fillDraft: (slide) => slide,
};
