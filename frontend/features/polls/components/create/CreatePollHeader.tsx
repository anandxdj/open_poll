"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";

import { AiPromptModal } from "@/features/ai/components/AiPromptModal";
import { generateDraft, type AiTone, defaultAiExpiresAtIso, type GeneratedPollDraft } from "@/features/ai/api/generateDraft";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type CreatePollHeaderProps = {
  isAnonymous: boolean;
  onApplyDraft: (draft: GeneratedPollDraft) => void;
  /** When true, renders only the AI button (for toolbar embedding) */
  compact?: boolean;
};

export function CreatePollHeader({ isAnonymous, onApplyDraft, compact }: CreatePollHeaderProps) {
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = async (params: { topic: string; tone: AiTone; questionCount: number }) => {
    setIsGenerating(true);
    const tid = toast.loading("AI is thinking...");
    try {
      const draft = await generateDraft({
        ...params,
        isAnonymous,
        expiresAt: defaultAiExpiresAtIso(7),
      });
      onApplyDraft(draft);
      toast.success("Questions added!", { id: tid });
    } catch {
      toast.error("Generation failed.", { id: tid });
    } finally {
      setIsGenerating(false);
    }
  };

  const aiButton = (
    <AiPromptModal isAnonymous={isAnonymous} onGenerate={handleGenerate} isGenerating={isGenerating}>
      <Button
        type="button"
        size="sm"
        disabled={isGenerating}
        className="group rounded-2xl border border-primary/30 bg-primary/10 font-medium text-primary hover:bg-primary hover:text-primary-foreground active:scale-[0.98] transition-all"
      >
        <Sparkles className="size-4 transition-transform duration-300 group-hover:rotate-12" />
        <span className="hidden sm:inline">{isGenerating ? "Busy..." : "Generate with AI"}</span>
      </Button>
    </AiPromptModal>
  );

  if (compact) return aiButton;

  return (
    <div className="flex flex-col gap-4 border-b border-white/[0.08] pb-8 sm:flex-row sm:items-end sm:justify-between relative">
      {/* Subtle primary glow behind the header */}
      <div className="absolute top-1/2 left-0 -translate-y-1/2 w-32 h-32 bg-primary/20 blur-[60px] pointer-events-none" />
      
      <div className="max-w-2xl space-y-2 relative z-10">
        <p className="text-xs font-bold uppercase tracking-widest text-primary/80">New poll</p>
        <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
          Set the title and schedule, then shape each multiple-choice block. You can collapse cards to scan the full survey
          before publishing.
        </p>
      </div>
      <div className="relative z-10">
        {aiButton}
      </div>
    </div>
  );
}
