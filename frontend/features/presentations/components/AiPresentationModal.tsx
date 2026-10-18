"use client";

import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getApiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { generatePresentationDraft } from "../api/presentationApi";
import { SLIDE_TYPE_META } from "../slideTypeMeta";
import type { GeneratedPresentationDraft, PresentationSlideType } from "../types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTopic?: string;
  onGenerated?: (draft: GeneratedPresentationDraft) => void;
  onGenerate?: (params: { topic: string; slideCount: number; slideTypes: PresentationSlideType[] }) => void;
  isGenerating?: boolean;
};

export function AiPresentationModal({ open, onOpenChange, initialTopic, onGenerated, onGenerate, isGenerating }: Props) {
  const [topic, setTopic] = useState("");
  const [slideCount, setSlideCount] = useState(5);
  const [types, setTypes] = useState<PresentationSlideType[]>(["select_answer", "type_answer"]);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!open) return;
    const seed = initialTopic?.trim();
    if (!seed) return;
    void Promise.resolve().then(() => setTopic(seed));
  }, [open, initialTopic]);

  const toggleType = (type: PresentationSlideType) => {
    setTypes((prev) =>
      prev.includes(type)
        ? prev.length > 1
          ? prev.filter((t) => t !== type)
          : prev
        : [...prev, type]
    );
  };

  const handleGenerate = async () => {
    const trimmed = topic.trim();
    if (trimmed.length < 3) {
      toast.error("Topic should be at least 3 characters.");
      return;
    }
    if (onGenerate) {
      onGenerate({ topic: trimmed, slideCount, slideTypes: types });
      onOpenChange(false);
      return;
    }
    setGenerating(true);
    try {
      const draft = await generatePresentationDraft({
        topic: trimmed,
        slideCount,
        slideTypes: types,
      });
      onGenerated?.(draft);
      onOpenChange(false);
      toast.success(`Generated ${draft.slides.length} slides — review and tweak before saving.`);
    } catch (err) {
      toast.error(getApiErrorMessage(err) || "AI generation failed.");
    } finally {
      setGenerating(false);
    }
  };

  const isBusy = isGenerating || generating;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" /> Generate deck with AI
          </DialogTitle>
          <DialogDescription>
            Describe your topic — AI drafts the slides straight into the builder.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="ai-deck-topic">Topic</Label>
            <Textarea
              id="ai-deck-topic"
              placeholder="e.g. Interactive all-hands, product onboarding, team quiz night…"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="min-h-24 rounded-xl"
            />
          </div>

          <div className="grid gap-2">
            <Label>Slide types to include</Label>
            <div className="flex flex-wrap gap-1.5">
              {SLIDE_TYPE_META.map(({ type, label, Icon, iconClass }) => {
                const selected = types.includes(type);
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => toggleType(type)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all",
                      selected
                        ? "border-primary/40 bg-primary/10 text-foreground"
                        : "border-border bg-secondary/20 text-muted-foreground hover:bg-secondary/50"
                    )}
                  >
                    <Icon className={cn("size-3.5", selected ? iconClass : "opacity-40")} />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="ai-deck-count">Slide count</Label>
              <span className="text-xs tabular-nums text-muted-foreground">{slideCount}</span>
            </div>
            <input
              id="ai-deck-count"
              type="range"
              min={1}
              max={15}
              step={1}
              value={slideCount}
              onChange={(e) => setSlideCount(Number(e.target.value))}
              className="accent-primary"
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="rounded-xl bg-primary text-primary-foreground font-medium hover:opacity-90"
            disabled={isBusy}
            onClick={() => void handleGenerate()}
          >
            {isBusy ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" /> Generating…
              </>
            ) : (
              "Generate slides"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const AiQuizModal = AiPresentationModal;
