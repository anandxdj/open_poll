"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ParticipantViewProps } from "../../runtime";

const MAX_LENGTH = 500;

export function OpenEndedParticipant({ mode, onSubmit, submitting }: ParticipantViewProps) {
  const t = useTranslations("live.slides.openEnded");
  const [typedText, setTypedText] = useState("");
  const locked = submitting || mode === "preview";

  return (
    <div className="space-y-4 w-full">
      <div className="relative">
        <Textarea
          value={typedText}
          onChange={(e) => setTypedText(e.target.value)}
          placeholder={t("placeholder")}
          maxLength={MAX_LENGTH}
          disabled={locked}
          className="min-h-[140px] rounded-2xl bg-deck-surface border-deck-border/80 text-base p-4 resize-none focus:ring-2 focus:ring-deck-primary/30"
        />
        <div className="absolute bottom-3 right-3 text-[11px] font-mono text-deck-muted-fg/60">
          {typedText.length}/{MAX_LENGTH}
        </div>
      </div>

      <Button
        onClick={() => onSubmit({ text: typedText.trim() })}
        disabled={locked || !typedText.trim()}
        className="w-full h-12 rounded-2xl bg-deck-primary text-deck-primary-fg font-bold text-base shadow-md transition-all"
      >
        {submitting ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <span className="flex items-center gap-2">
            {t("submit")} <Send className="size-4" />
          </span>
        )}
      </Button>
    </div>
  );
}
