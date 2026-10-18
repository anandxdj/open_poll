"use client";

import { motion } from "framer-motion";
import { Loader2, Presentation as PresentationIcon, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const ease = [0.32, 0.72, 0, 1] as const;

interface BuilderHeaderProps {
  title: string;
  onTitleChange: (title: string) => void;
  isEditing: boolean;
  isAiGenerating: boolean;
  onOpenAi: () => void;
  saving: boolean;
  savingDraft: boolean;
  onSave: () => void;
  onSaveDraft: () => void;
}

export function BuilderHeader({
  title,
  onTitleChange,
  isEditing,
  isAiGenerating,
  onOpenAi,
  saving,
  savingDraft,
  onSave,
  onSaveDraft,
}: BuilderHeaderProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease }}
      className="flex flex-col md:flex-row md:items-center gap-4 shrink-0"
    >
      <div className="flex-1 space-y-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-primary/60 flex items-center gap-1.5">
          <PresentationIcon className="size-3.5" /> Presentation Deck Studio
        </p>
        <Input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Untitled Presentation Deck"
          aria-label="Deck title"
          className="border-none bg-transparent px-0 text-2xl font-bold tracking-tight focus-visible:ring-0 placeholder:text-muted-foreground/30"
        />
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="outline"
          disabled={isAiGenerating}
          onClick={onOpenAi}
          className={cn(
            "h-9 rounded-full px-4 text-xs font-semibold transition-all duration-300",
            isAiGenerating
              ? "animate-ai-glow border-primary text-primary"
              : "border-primary/30 text-primary hover:bg-primary/10 hover:shadow-[0_0_15px_rgba(216,173,135,0.3)]"
          )}
        >
          <Sparkles className={cn("size-3.5 mr-1.5 transition-transform duration-200", isAiGenerating && "animate-spin")} />
          {isAiGenerating ? "Generating..." : "AI generate"}
        </Button>
        <Button
          variant="outline"
          onClick={onSaveDraft}
          disabled={savingDraft || saving}
          className="h-9 rounded-full px-4 text-xs font-semibold border-white/15 text-foreground/80 hover:bg-white/5"
        >
          {savingDraft ? <Loader2 className="size-3.5 animate-spin" /> : "Save Draft"}
        </Button>
        <Button
          onClick={onSave}
          disabled={saving}
          className="h-9 rounded-full bg-primary text-primary-foreground text-xs font-semibold px-5 hover:bg-primary/90 shadow-sm"
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : isEditing ? "Save changes" : "Create deck"}
        </Button>
      </div>
    </motion.div>
  );
}
