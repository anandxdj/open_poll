"use client";

import { useCallback, useEffect, useState } from "react";

import { fetchLibraryPage } from "@/features/library/api/library";
import { cardKey, DEFAULT_FILTERS, replaceLibraryItem } from "@/features/library/query";
import type { LibraryCard, LibraryCounts, PresentationLibraryCard } from "@/features/library/types";
import { useWorkspaceStore } from "@/features/workspaces/store/useWorkspaceStore";

/** Cards in "Recent work": two rows of three on wide screens. */
export const RECENT_LIMIT = 6;

interface Loaded {
  key: string;
  recent: LibraryCard[];
  live: PresentationLibraryCard[];
  counts: LibraryCounts | null;
  error: boolean;
}

async function loadSlices(): Promise<Omit<Loaded, "key" | "error">> {
  const [recent, live] = await Promise.all([
    fetchLibraryPage(DEFAULT_FILTERS, null, RECENT_LIMIT),
    fetchLibraryPage({ type: "presentation", status: "live", q: "" }, null, 3),
  ]);
  return {
    recent: recent.items,
    live: live.items.filter((card): card is PresentationLibraryCard => card.entityType === "presentation"),
    counts: recent.counts ?? null,
  };
}

/**
 * The library slices Home shows: the latest edited items (any kind, any status)
 * and the decks that are live right now (lobby open or presenting).
 */
export function useHomeLibrary() {
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const key = `${workspaceId ?? ""}:${attempt}`;

  useEffect(() => {
    let cancelled = false;
    loadSlices().then(
      (slices) => {
        if (cancelled) return;
        setLoaded({ key, ...slices, error: false });
      },
      (error: unknown) => {
        if (cancelled) return;
        console.error(error);
        setLoaded({ key, recent: [], live: [], counts: null, error: true });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key]);

  const current = loaded?.key === key ? loaded : null;

  /** Loads the slices again in place (no skeletons), e.g. after a duplicate added an item. */
  const refresh = useCallback(() => {
    loadSlices().then(
      (slices) => setLoaded((prev) => (prev && prev.key === key ? { ...prev, ...slices, error: false } : prev)),
      (error: unknown) => console.error(error),
    );
  }, [key]);

  const remove = useCallback((card: LibraryCard) => {
    setLoaded((prev) =>
      prev
        ? {
            ...prev,
            recent: prev.recent.filter((item) => cardKey(item) !== cardKey(card)),
            live: prev.live.filter((item) => cardKey(item) !== cardKey(card)),
          }
        : prev,
    );
  }, []);

  const replace = useCallback((card: LibraryCard) => {
    setLoaded((prev) => (prev ? { ...prev, recent: replaceLibraryItem(prev.recent, card) } : prev));
  }, []);

  return {
    status: !current ? ("loading" as const) : current.error ? ("error" as const) : ("ready" as const),
    recent: current?.recent ?? [],
    live: current?.live ?? [],
    counts: current?.counts ?? null,
    retry: () => setAttempt((n) => n + 1),
    refresh,
    remove,
    replace,
  };
}
