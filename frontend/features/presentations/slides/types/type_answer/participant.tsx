"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ParticipantViewProps } from "../../runtime";
import { SendingSpinner } from "../../SendingSpinner";

export function TypeAnswerParticipant({ mode, onSubmit, submitting }: ParticipantViewProps) {
  const t = useTranslations("live.slides.typeAnswer");
  const [typedText, setTypedText] = useState("");
  const locked = submitting || mode === "preview";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (typedText.trim() && !locked) {
      onSubmit({ text: typedText });
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
          onChange={(e) => setTypedText(e.target.value)}
          placeholder={t("placeholder")}
          aria-label={t("inputLabel")}
          autoFocus={mode !== "preview"}
          disabled={locked}
          className="h-14 rounded-2xl bg-deck-surface/80 border-deck-border/80 text-center font-bold text-lg tracking-wide placeholder:text-deck-muted-fg focus:ring-2 focus:ring-deck-primary/30"
        />

        <Button
          type="submit"
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
      </motion.div>
    </form>
  );
}
