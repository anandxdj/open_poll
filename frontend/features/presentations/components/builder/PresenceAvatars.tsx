"use client";

import { MonitorSmartphone } from "lucide-react";

import type { DeckPresence } from "./useDeckPresence";

const MAX_AVATARS = 4;

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";

/**
 * Who else has the deck open in the builder: their initials (names on hover and
 * for screen readers), and a note when the signed-in user has it open in
 * another tab too. Informational only: overlapping saves are caught by the
 * deck revision (the conflict banner), not by this.
 */
export function PresenceAvatars({ presence }: { presence: DeckPresence }) {
  const { others, selfElsewhere } = presence;
  if (others.length === 0 && !selfElsewhere) return null;
  const shown = others.slice(0, MAX_AVATARS);
  const more = others.length - shown.length;
  const label = [
    others.length ? `Also editing: ${others.map((editor) => editor.name).join(", ")}` : null,
    selfElsewhere ? "You have this deck open in another tab" : null,
  ]
    .filter(Boolean)
    .join(". ");

  return (
    <div role="status" aria-label={label} title={label} className="flex shrink-0 items-center gap-2">
      {shown.length ? (
        <div className="flex -space-x-2" aria-hidden="true">
          {shown.map((editor) => (
            <span
              key={editor.userId}
              className="flex size-8 items-center justify-center rounded-full border-2 border-background bg-secondary text-xs font-semibold text-foreground"
            >
              {initials(editor.name)}
            </span>
          ))}
          {more > 0 ? (
            <span className="flex size-8 items-center justify-center rounded-full border-2 border-background bg-muted font-mono text-xs text-muted-foreground">
              +{more}
            </span>
          ) : null}
        </div>
      ) : null}
      {selfElsewhere ? (
        <span aria-hidden="true" className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <MonitorSmartphone className="size-4" />
          <span className="hidden lg:inline">Open in another tab</span>
        </span>
      ) : null}
    </div>
  );
}
