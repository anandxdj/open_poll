"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { MessageCircleQuestion } from "lucide-react";
import { useTranslations } from "next-intl";

import { useLive } from "@/features/presentations/live/store";
import { highlightedItem } from "../state";
import { selectQna } from "../useQnaSync";

const ease = [0.32, 0.72, 0, 1] as const;

/**
 * The question the host picked ("Show on screen"), over the bottom of the
 * stage. Cleared by the host, or when the question leaves the public lists.
 */
export function HighlightOverlay() {
  const t = useTranslations("qna");
  const item = useLive((s) => highlightedItem(selectQna(s)));
  const reduceMotion = useReducedMotion();

  return (
    <div className="pointer-events-none absolute inset-x-4 bottom-16 z-20 mx-auto flex max-w-4xl justify-center" aria-live="polite">
      <AnimatePresence>
        {item && (
          <motion.figure
            key={item.id}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
            transition={{ duration: 0.45, ease }}
            data-qna-highlight={item.id}
            className="w-full rounded-3xl border border-deck-accent/40 bg-deck-stage-scrim px-8 py-6 text-center shadow-2xl backdrop-blur-xl"
          >
            <figcaption className="mb-2 flex items-center justify-center gap-2 text-sm font-medium text-deck-accent-soft">
              <MessageCircleQuestion className="size-4" aria-hidden /> {t("stage.highlight")}
            </figcaption>
            <blockquote className="text-2xl font-bold leading-snug text-balance break-words text-deck-stage-fg sm:text-3xl">
              {item.text}
            </blockquote>
            <p className="mt-3 text-sm font-semibold text-deck-stage-fg/60">{item.authorName ?? t("list.anonymousAuthor")}</p>
          </motion.figure>
        )}
      </AnimatePresence>
    </div>
  );
}
