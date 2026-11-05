"use client";

import Link from "next/link";
import { ArrowLeft, Loader2, Play, Sparkles, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface BuilderHeaderProps {
  title: string;
  onTitleChange: (title: string) => void;
  isEditing: boolean;
  isAiGenerating: boolean;
  onOpenAi: () => void;
  /** Opens the question-file import (features/imports). */
  onImportQuestions?: () => void;
  saving: boolean;
  savingDraft: boolean;
  onSave: () => void;
  onSaveDraft: () => void;
  /** Saves, then opens the host console. Only for a deck that exists (editing). */
  onPresent?: () => void;
}

/**
 * The builder's top bar: back to the library, the deck title (edited in place)
 * and the deck's actions. Present (save, then the host console) is the one ember
 * action on a deck that exists; a new deck's is Create deck.
 */
export function BuilderHeader({
  title,
  onTitleChange,
  isEditing,
  isAiGenerating,
  onOpenAi,
  onImportQuestions,
  saving,
  savingDraft,
  onSave,
  onSaveDraft,
  onPresent,
}: BuilderHeaderProps) {
  const present = isEditing && onPresent;
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-background px-4 py-3 sm:px-6">
      <Link
        href="/polls"
        aria-label="Back to the library"
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <ArrowLeft className="size-4" />
      </Link>
      <div className="min-w-0 flex-1 basis-48">
        <Input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Untitled deck"
          aria-label="Deck title"
          className="h-9 border-transparent bg-transparent px-2 text-lg font-semibold tracking-[-0.02em] shadow-none hover:border-border focus-visible:border-ring md:text-lg"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          disabled={isAiGenerating}
          onClick={onOpenAi}
          className={cn("bg-card", isAiGenerating && "animate-ai-glow")}
        >
          <Sparkles className={cn("text-accent-ink", isAiGenerating && "animate-spin")} />
          {isAiGenerating ? "Generating…" : "AI generate"}
        </Button>
        {onImportQuestions ? (
          <Button variant="ghost" onClick={onImportQuestions}>
            <Upload aria-hidden />
            Import questions
          </Button>
        ) : null}
        <Button variant="ghost" onClick={() => onSaveDraft()} disabled={savingDraft || saving}>
          {savingDraft ? <Loader2 className="animate-spin" /> : null}
          Save draft
        </Button>
        <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-border sm:block" />
        <Button variant={present ? "outline" : "default"} className={cn(present && "bg-card")} onClick={() => onSave()} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : null}
          {isEditing ? "Save changes" : "Create deck"}
        </Button>
        {present ? (
          <Button onClick={() => present()} disabled={saving}>
            <Play aria-hidden className="fill-current" />
            Present
          </Button>
        ) : null}
      </div>
    </header>
  );
}
