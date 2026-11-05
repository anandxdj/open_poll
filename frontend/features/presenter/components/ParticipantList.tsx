"use client";

import { useState } from "react";
import { UserX, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useLive } from "@/features/presentations/live/store";

interface ParticipantListProps {
  /** Removes a participant; resolves when the server answered. */
  onKick: (participantId: string, name: string) => Promise<boolean>;
}

/**
 * Who joined the live session, newest last, each with a Remove button. Removing
 * asks first in the app's own dialog (never `confirm()`, which embedded
 * browsers suppress); a removed phone sees that it was removed and cannot
 * answer or rejoin this session.
 */
export function ParticipantList({ onKick }: ParticipantListProps) {
  const t = useTranslations("presenter.console");
  const tDialog = useTranslations("presenter.kickDialog");
  const participants = useLive((s) => s.participants);
  const status = useLive((s) => s.status);
  const scores = useLive((s) => s.leaderboard);
  const [target, setTarget] = useState<{ participantId: string; name: string } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const live = status === "lobby" || status === "active";
  const scoreOf = new Map(scores.map((entry) => [entry.participantId, entry.score]));

  const confirm = async () => {
    if (!target) return;
    const { participantId, name } = target;
    setTarget(null);
    setPending(participantId);
    try {
      await onKick(participantId, name);
    } finally {
      setPending(null);
    }
  };

  return (
    <section aria-labelledby="presenter-participants-title" className="flex min-h-0 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="presenter-participants-title" className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-deck-stage-muted">
          <Users className="size-3.5" aria-hidden="true" /> {t("participants")}
        </h2>
        <span className="font-mono text-xs tabular-nums text-deck-stage-muted" data-testid="participant-count">
          {t("participantsCount", { count: participants.length })}
        </span>
      </div>
      {participants.length === 0 ? (
        <p className="text-sm text-deck-stage-muted">{t("noParticipants")}</p>
      ) : (
        <ul className="max-h-72 space-y-1 overflow-y-auto pr-1" aria-label={t("participants")} tabIndex={0}>
          {participants.map((p) => (
            <li
              key={p.participantId}
              className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-deck-stage-fg/5"
            >
              <span className="min-w-0 truncate text-sm text-deck-stage-fg">{p.name}</span>
              <span className="flex shrink-0 items-center gap-2">
                {scoreOf.has(p.participantId) && (
                  <span className="font-mono text-xs tabular-nums text-deck-stage-muted">{scoreOf.get(p.participantId)}</span>
                )}
                {live && (
                  <button
                    type="button"
                    onClick={() => setTarget({ participantId: p.participantId, name: p.name })}
                    disabled={pending === p.participantId}
                    aria-label={t("kickLabel", { name: p.name })}
                    className="inline-flex h-8 items-center gap-1 rounded-full border border-deck-stage-fg/15 px-2.5 text-xs font-medium text-deck-stage-fg/80 transition-colors hover:border-deck-danger/50 hover:text-deck-danger-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-deck-accent/50 disabled:opacity-50"
                  >
                    <UserX className="size-3.5" aria-hidden="true" /> {t("kick")}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-semibold">{tDialog("title", { name: target?.name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground">{tDialog("body")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-3">
            <AlertDialogCancel>{tDialog("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirm()}>{tDialog("confirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
