import { PencilLine } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getSlideEditor } from "../../../slides/editor";
import { isContentSlide } from "../../../slides/meta";
import type { InspectorTabDef, InspectorTabProps } from "../inspectorTabs";

/**
 * Question text plus the slide type's own editor from the editor registry.
 * Content slides (heading, image, …) have no question: their editor is all.
 */
function ContentPanel({ slide, index, onChange }: InspectorTabProps) {
  const { Editor } = getSlideEditor(slide.type);
  const questionId = `slide-${index}-question`;

  return (
    <div className="space-y-6">
      {!isContentSlide(slide.type) && (
        <div className="space-y-2">
          <Label
            htmlFor={questionId}
            className="text-sm font-medium text-foreground"
          >
            Question or title
          </Label>
          <Textarea
            id={questionId}
            value={slide.question}
            onChange={(e) => onChange({ question: e.target.value })}
            placeholder="What statement or question would you like to present?"
            className="min-h-24 rounded-lg bg-card px-4 py-3 text-base font-semibold focus-visible:ring-primary/40 resize-none overflow-hidden [field-sizing:content]"
          />
        </div>
      )}

      {/* Keyed per slide so editors with local drafts start fresh on another slide. */}
      <Editor key={index} slide={slide} onChange={onChange} />
    </div>
  );
}

export const contentTab: InspectorTabDef = {
  id: "content",
  label: "Content",
  Icon: PencilLine,
  order: 10,
  Panel: ContentPanel,
};
