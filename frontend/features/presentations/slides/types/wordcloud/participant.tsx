"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Plus, Send, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ParticipantViewProps } from "../../runtime";
import { SendingSpinner } from "../../SendingSpinner";

const sameWord = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function WordcloudParticipant({ slide, mode, onSubmit, submitting }: ParticipantViewProps) {
  const t = useTranslations("live.slides.wordcloud");
  const [entries, setEntries] = useState<string[]>([]);
  const [entryDraft, setEntryDraft] = useState("");
  const { maxEntries } = slide;
  const locked = submitting || mode === "preview";
  const canAddMore = entries.length < maxEntries;

  const addEntry = () => {
    const value = entryDraft.trim();
    if (!value) return;
    if (!entries.some((x) => sameWord(x, value))) setEntries((prev) => [...prev, value]);
    setEntryDraft("");
  };

  // A typed-but-not-added word is sent along.
  const submit = () => {
    const draft = entryDraft.trim();
    const all = draft && !entries.some((x) => sameWord(x, draft)) ? [...entries, draft] : entries;
    if (all.length > 0) onSubmit({ entries: all.slice(0, maxEntries) });
  };

  return (
    <div className="space-y-4 w-full">
      {/* Active word chips */}
      <div className="flex flex-wrap gap-2 justify-center min-h-[44px] p-2 rounded-2xl border border-dashed border-deck-border/60 bg-deck-surface/30">
        {entries.length === 0 ? (
          <p className="text-xs text-deck-muted-fg self-center">{t("empty", { max: maxEntries })}</p>
        ) : (
          entries.map((entry, i) => (
            <motion.span
              key={i}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              className="inline-flex items-center gap-1.5 rounded-full bg-deck-primary/15 border border-deck-primary/30 px-3 py-1.5 text-sm font-semibold text-deck-primary-ink"
            >
              {entry}
              <button
                type="button"
                onClick={() => setEntries((prev) => prev.filter((_, j) => j !== i))}
                disabled={locked}
                aria-label={t("remove", { word: entry })}
                // 44 px tall touch target; the negative margins keep the chip its size.
                className="-my-3 -mr-3 inline-flex size-11 items-center justify-center rounded-full text-deck-primary-ink transition-colors hover:bg-deck-primary/10"
              >
                <X className="size-3.5" aria-hidden="true" />
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
            addEntry();
          }}
          className="flex gap-2"
        >
          <Input
            value={entryDraft}
            onChange={(e) => setEntryDraft(e.target.value)}
            placeholder={t("placeholder", { n: entries.length + 1, max: maxEntries })}
            aria-label={t("inputLabel", { n: entries.length + 1, max: maxEntries })}
            maxLength={50}
            disabled={locked}
            className="h-12 rounded-2xl bg-deck-surface border-deck-border font-medium text-center"
          />
          <Button
            type="submit"
            variant="outline"
            disabled={locked || !entryDraft.trim()}
            className="h-12 rounded-2xl px-4 shrink-0 border-deck-border hover:bg-deck-secondary font-semibold"
          >
            <Plus className="size-4 mr-1" aria-hidden="true" /> {t("add")}
          </Button>
        </form>
      )}

      <Button
        onClick={submit}
        disabled={locked || (entries.length === 0 && !entryDraft.trim())}
        className="w-full h-12 rounded-2xl bg-deck-primary text-deck-primary-fg font-bold text-base shadow-md transition-all"
      >
        {submitting ? (
          <SendingSpinner />
        ) : (
          <span className="flex items-center gap-2">
            {t("submit")} <Send className="size-4" aria-hidden="true" />
          </span>
        )}
      </Button>
    </div>
  );
}
