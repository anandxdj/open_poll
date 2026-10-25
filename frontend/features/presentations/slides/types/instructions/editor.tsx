"use client";

import { useId } from "react";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { InstructionsContent } from "../../../types/content";
import { blankContentSlide, cleanContentSlide, TextField } from "../../content/editorFields";
import { readInstructions } from "../../content/payloads";
import type { SlideEditorDef, SlideEditorProps } from "../../editor";
import { meta } from "./meta";

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-secondary/40 px-4 py-3">
      <Label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function InstructionsEditor({ slide, onChange }: SlideEditorProps) {
  const content = readInstructions(slide.content);
  const set = (patch: Partial<InstructionsContent>) => onChange({ content: { ...content, ...patch } });
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Shows how to join this session — handy after a break or for latecomers. The code is filled in live.
      </p>
      <Toggle label="Show the join address and code" checked={content.showCode} onChange={(showCode) => set({ showCode })} />
      <Toggle label="Show the QR code" checked={content.showQr} onChange={(showQr) => set({ showQr })} />
      <TextField
        label="Extra instructions"
        value={content.text}
        onChange={(text) => set({ text })}
        maxLength={300}
        placeholder="e.g. Grab your phone — the quiz starts in a minute"
      />
    </div>
  );
}

export const editor: SlideEditorDef = {
  meta,
  blank: () => blankContentSlide(meta, { showQr: true, showCode: true, text: "" }),
  Editor: InstructionsEditor,
  validate: (slide) => {
    const { showQr, showCode, text } = readInstructions(slide.content);
    return showQr || showCode || text ? null : "show the QR code, the join code or some text.";
  },
  clean: (slide) => {
    const content = readInstructions(slide.content);
    return cleanContentSlide(slide, meta, { ...content, text: content.text.trim() });
  },
  fillDraft: (slide) => ({ ...slide, question: "" }),
};
