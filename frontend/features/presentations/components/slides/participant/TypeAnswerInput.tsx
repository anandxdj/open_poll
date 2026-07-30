"use client";

import { motion } from "framer-motion";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface TypeAnswerInputProps {
  typedText: string;
  onTypedTextChange: (text: string) => void;
  onSubmit: () => void;
  submitting: boolean;
}

export function TypeAnswerInput({
  typedText,
  onTypedTextChange,
  onSubmit,
  submitting,
}: TypeAnswerInputProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (typedText.trim() && !submitting) {
      onSubmit();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 w-full">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-3"
      >
        <Input
          value={typedText}
          onChange={(e) => onTypedTextChange(e.target.value)}
          placeholder="Type your exact answer here…"
          autoFocus
          disabled={submitting}
          className="h-14 rounded-2xl bg-card/80 border-border/80 text-center font-bold text-lg tracking-wide placeholder:text-muted-foreground/40 focus:ring-2 focus:ring-primary/30"
        />

        <Button
          type="submit"
          disabled={submitting || !typedText.trim()}
          className="w-full h-12 rounded-2xl bg-primary text-primary-foreground font-bold text-base shadow-md transition-all"
        >
          {submitting ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <span className="flex items-center gap-2">
              Submit Answer <Send className="size-4" />
            </span>
          )}
        </Button>
      </motion.div>
    </form>
  );
}
