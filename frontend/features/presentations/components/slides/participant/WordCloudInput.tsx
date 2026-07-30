"use client";

import { motion } from "framer-motion";
import { Loader2, Plus, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface WordCloudInputProps {
  entries: string[];
  entryDraft: string;
  onEntryDraftChange: (draft: string) => void;
  onAddEntry: () => void;
  onRemoveEntry: (index: number) => void;
  onSubmit: () => void;
  maxEntries: number;
  submitting: boolean;
}

export function WordCloudInput({
  entries,
  entryDraft,
  onEntryDraftChange,
  onAddEntry,
  onRemoveEntry,
  onSubmit,
  maxEntries,
  submitting,
}: WordCloudInputProps) {
  const canAddMore = entries.length < maxEntries;

  return (
    <div className="space-y-4 w-full">
      {/* Active word chips */}
      <div className="flex flex-wrap gap-2 justify-center min-h-[44px] p-2 rounded-2xl border border-dashed border-border/60 bg-card/30">
        {entries.length === 0 ? (
          <p className="text-xs text-muted-foreground/50 self-center">
            Add up to {maxEntries} word{maxEntries > 1 ? "s" : ""}
          </p>
        ) : (
          entries.map((entry, i) => (
            <motion.span
              key={i}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 border border-primary/30 px-3 py-1.5 text-sm font-semibold text-primary"
            >
              {entry}
              <button
                type="button"
                onClick={() => onRemoveEntry(i)}
                disabled={submitting}
                className="rounded-full p-0.5 hover:bg-primary/20 transition-colors text-primary/70 hover:text-primary"
              >
                <X className="size-3.5" />
              </button>
            </motion.span>
          ))
        )}
      </div>

      {/* Input form */}
      {canAddMore && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onAddEntry();
          }}
          className="flex gap-2"
        >
          <Input
            value={entryDraft}
            onChange={(e) => onEntryDraftChange(e.target.value)}
            placeholder={`Word ${entries.length + 1} of ${maxEntries}…`}
            maxLength={50}
            disabled={submitting}
            className="h-12 rounded-2xl bg-card border-border font-medium text-center"
          />
          <Button
            type="submit"
            variant="outline"
            disabled={submitting || !entryDraft.trim()}
            className="h-12 rounded-2xl px-4 shrink-0 border-border hover:bg-secondary font-semibold"
          >
            <Plus className="size-4 mr-1" /> Add
          </Button>
        </form>
      )}

      <Button
        onClick={onSubmit}
        disabled={submitting || (entries.length === 0 && !entryDraft.trim())}
        className="w-full h-12 rounded-2xl bg-primary text-primary-foreground font-bold text-base shadow-md transition-all"
      >
        {submitting ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <span className="flex items-center gap-2">
            Send Words <Send className="size-4" />
          </span>
        )}
      </Button>
    </div>
  );
}
