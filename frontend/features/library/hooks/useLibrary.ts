"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getApiErrorMessage } from "@/lib/api-error";
import { fetchLibraryPage } from "../api/library";
import { countsWithout, countsWithStatus, filtersKey, mergeLibraryItems, replaceLibraryItem } from "../query";
import type { LibraryCard, LibraryCounts, LibraryFilters } from "../types";

interface Loaded {
  /** `filtersKey` + reload generation the data belongs to. */
  key: string;
  items: LibraryCard[];
  counts: LibraryCounts | null;
  nextCursor: string | null;
  error: string | null;
}

export interface LibraryState {
  items: LibraryCard[];
  counts: LibraryCounts | null;
  /** First page for the current filters is loading. */
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  loadMore: () => void;
  reload: () => void;
  /** Drops a deleted card and adjusts the counts. */
  remove: (card: LibraryCard) => void;
  /** Swaps in an updated card (same entity and id). */
  replace: (card: LibraryCard) => void;
}

/** First page on every filter change, then cursor pages on demand (infinite scroll). */
export function useLibrary(filters: LibraryFilters): LibraryState {
  const [generation, setGeneration] = useState(0);
  const key = `${filtersKey(filters)}#${generation}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const filtersRef = useRef(filters);
  const loadingMoreRef = useRef(false);

  // Declared before the fetch effect, so that effect reads the filters of this render.
  useEffect(() => {
    filtersRef.current = filters;
  });

  useEffect(() => {
    let cancelled = false;
    fetchLibraryPage(filtersRef.current).then(
      (page) => {
        if (cancelled) return;
        setLoaded({ key, items: page.items, counts: page.counts ?? null, nextCursor: page.nextCursor, error: null });
      },
      (error: unknown) => {
        if (cancelled) return;
        setLoaded({
          key,
          items: [],
          counts: null,
          nextCursor: null,
          error: getApiErrorMessage(error) ?? "Could not load your library.",
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key]);

  const current = loaded?.key === key ? loaded : null;

  const loadMore = useCallback(() => {
    if (!current?.nextCursor || loadingMoreRef.current) return;
    const forKey = current.key;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    fetchLibraryPage(filtersRef.current, current.nextCursor)
      .then(
        (page) =>
          setLoaded((prev) =>
            prev && prev.key === forKey
              ? { ...prev, items: mergeLibraryItems(prev.items, page.items), nextCursor: page.nextCursor, error: null }
              : prev,
          ),
        (error: unknown) =>
          setLoaded((prev) =>
            prev && prev.key === forKey
              ? { ...prev, error: getApiErrorMessage(error) ?? "Could not load more items." }
              : prev,
          ),
      )
      .finally(() => {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  }, [current]);

  const reload = useCallback(() => setGeneration((value) => value + 1), []);

  const remove = useCallback((card: LibraryCard) => {
    setLoaded((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.filter((item) => !(item.entityType === card.entityType && item.id === card.id)),
            counts: prev.counts ? countsWithout(prev.counts, card) : prev.counts,
          }
        : prev,
    );
  }, []);

  const replace = useCallback((card: LibraryCard) => {
    setLoaded((prev) => {
      if (!prev) return prev;
      const before = prev.items.find((item) => item.entityType === card.entityType && item.id === card.id);
      return {
        ...prev,
        items: replaceLibraryItem(prev.items, card),
        counts: prev.counts && before ? countsWithStatus(prev.counts, before.status, card.status) : prev.counts,
      };
    });
  }, []);

  return {
    items: current?.items ?? [],
    counts: current?.counts ?? null,
    loading: current === null,
    loadingMore,
    hasMore: Boolean(current?.nextCursor),
    error: current?.error ?? null,
    loadMore,
    reload,
    remove,
    replace,
  };
}
