import { PencilLine } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getSlideEditor } from "../../../slides/editor";
import type { InspectorTabDef, InspectorTabProps } from "../inspectorTabs";

/** Question text plus the slide type's own editor from the editor registry. */
function ContentPanel({ slide, index, onChange }: InspectorTabProps) {
  const { Editor } = getSlideEditor(slide.type);
  const questionId = `slide-${index}-question`;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label
          htmlFor={questionId}
          className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50"
        >
          Slide Question / Title
        </Label>
        <Textarea
          id={questionId}
          value={slide.question}
          onChange={(e) => onChange({ question: e.target.value })}
          placeholder="What statement or question would you like to present?"
          className="min-h-24 rounded-2xl border-white/10 bg-secondary/15 px-4 py-3 text-base font-semibold focus-visible:ring-primary/40 resize-none overflow-hidden [field-sizing:content]"
        />
      </div>

      <Editor slide={slide} onChange={onChange} />
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
