"use client";

import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

interface ConflictBannerProps {
  busy: boolean;
  onReload: () => void;
  onSaveCopy: () => void;
}

/**
 * Shown under the builder header when a save was refused because someone else
 * saved the deck first (409 `DECK_CHANGED`). Nothing was overwritten; the
 * editor chooses between their version and keeping theirs apart as a copy.
 */
export function ConflictBanner({ busy, onReload, onSaveCopy }: ConflictBannerProps) {
  return (
    <div role="alert" className="border-b border-warning/40 bg-warning/10 px-4 py-3 sm:px-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 gap-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-foreground">Someone else saved this deck while you were editing</p>
            <p className="mt-0.5 text-muted-foreground">
              Your changes were not saved, so their edits are safe. Reload to continue from their version (your unsaved changes here
              are discarded), or keep your version as a separate deck.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="outline" size="sm" className="bg-card" disabled={busy} onClick={onSaveCopy}>
            Save mine as a copy
          </Button>
          <Button type="button" variant="ink" size="sm" disabled={busy} onClick={onReload}>
            {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />} Reload latest version
          </Button>
        </div>
      </div>
    </div>
  );
}
