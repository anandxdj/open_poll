"use client";

import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface OpenEndedInputProps {
  typedText: string;
  onTypedTextChange: (text: string) => void;
  onSubmit: () => void;
  submitting: boolean;
}

export function OpenEndedInput({
  typedText,
  onTypedTextChange,
  onSubmit,
  submitting,
}: OpenEndedInputProps) {
  const maxLength = 500;

  return (
    <div className="space-y-4 w-full">
      <div className="relative">
        <Textarea
          value={typedText}
          onChange={(e) => onTypedTextChange(e.target.value)}
          placeholder="Share your thoughts or answer freely…"
          maxLength={maxLength}
          disabled={submitting}
          className="min-h-[140px] rounded-2xl bg-card border-border/80 text-base p-4 resize-none focus:ring-2 focus:ring-primary/30"
        />
        <div className="absolute bottom-3 right-3 text-[11px] font-mono text-muted-foreground/60">
          {typedText.length}/{maxLength}
        </div>
      </div>

      <Button
        onClick={onSubmit}
        disabled={submitting || !typedText.trim()}
        className="w-full h-12 rounded-2xl bg-primary text-primary-foreground font-bold text-base shadow-md transition-all"
      >
        {submitting ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <span className="flex items-center gap-2">
            Submit Feedback <Send className="size-4" />
          </span>
        )}
      </Button>
    </div>
  );
}
