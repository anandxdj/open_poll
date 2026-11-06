"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ParticipantViewProps } from "../../runtime";
import { SendingSpinner } from "../../SendingSpinner";

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
          aria-label={t("inputLabel")}
          aria-describedby="open-ended-count"
          maxLength={MAX_LENGTH}
          disabled={locked}
          className="min-h-[140px] rounded-2xl bg-deck-surface border-deck-border/80 text-base p-4 resize-none focus:ring-2 focus:ring-deck-primary/30"
        />
        <div id="open-ended-count" className="absolute bottom-3 right-3 font-mono text-xs text-deck-muted-fg">
          {typedText.length}/{MAX_LENGTH}
        </div>
      </div>

      <Button
        onClick={() => onSubmit({ text: typedText.trim() })}
        disabled={locked || !typedText.trim()}
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
