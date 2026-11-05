"use client";

import { Trophy, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useRestoreFocus } from "@/components/a11y/restore-focus";
import { useLive } from "../../live/store";
import { Leaderboard } from "../stage/Leaderboard";

/**
 * Host-only overlay with the live standings: a real modal dialog (W4-A) —
 * focus moves into it and stays there, Escape or Close shuts it, and focus
 * returns to the button that opened it. Rendered in place (no portal), so it
 * keeps the deck theme's tokens.
 */
export function LeaderboardModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("presenter.leaderboardModal");
  const leaderboard = useLive((s) => s.leaderboard);
  const restoreFocus = useRestoreFocus();

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-deck-stage-scrim/80 backdrop-blur-md animate-in fade-in duration-200" />
      <DialogPrimitive.Content
        aria-describedby={undefined}
        {...restoreFocus}
        className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 space-y-5 rounded-2xl border border-deck-stage-fg/15 bg-deck-stage-panel p-6 text-deck-stage-fg shadow-[0_32px_64px_-24px_rgb(0_0_0/0.7)] outline-none animate-in fade-in duration-200"
      >
        <div className="flex items-center justify-between border-b border-deck-stage-fg/10 pb-4">
          <DialogPrimitive.Title className="flex items-center gap-2 text-lg font-semibold text-deck-stage-fg">
            <Trophy className="size-5 text-deck-rank-1" aria-hidden="true" /> {t("title")}
          </DialogPrimitive.Title>
          <DialogPrimitive.Close
            aria-label={t("close")}
            className="flex size-11 items-center justify-center rounded-full bg-deck-stage-fg/10 text-deck-stage-fg transition-colors hover:bg-deck-stage-fg/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-deck-accent/60"
          >
            <X className="size-4" aria-hidden="true" />
          </DialogPrimitive.Close>
        </div>
        <Leaderboard entries={leaderboard} />
      </DialogPrimitive.Content>
    </DialogPrimitive.Root>
  );
}
