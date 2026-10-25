"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Plus, Presentation, RefreshCw, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ProductLogo } from "@/components/ui/ProductLogo";
import { ImportButton } from "@/features/imports";
import { useCreatePollModal } from "@/features/polls/components/CreatePollModalProvider";
import { useCreatePresentationModal } from "@/features/presentations/components/CreatePresentationModalProvider";
import { cn } from "@/lib/utils";
import { useLibrary } from "../hooks/useLibrary";
import { cardKey, emptyStateCopy, filtersToSearch, MAX_SEARCH_LENGTH, parseLibraryFilters } from "../query";
import type { LibraryCounts, LibraryFilters, LibraryStatus, LibraryType } from "../types";
import { LibraryCard } from "./LibraryCard";

const SEARCH_DEBOUNCE_MS = 300;

const TYPE_TABS: { key: LibraryType; label: string; count: keyof LibraryCounts }[] = [
  { key: "all", label: "All", count: "all" },
  { key: "poll", label: "Polls", count: "poll" },
  { key: "presentation", label: "Presentations", count: "presentation" },
];

const STATUS_OPTIONS: { key: LibraryStatus | "all"; label: string }[] = [
  { key: "all", label: "Any status" },
  { key: "live", label: "Live" },
  { key: "draft", label: "Drafts" },
  { key: "ended", label: "Ended" },
];

/**
 * The unified library at /polls: polls and decks of the current workspace as
 * one list. Filters live in the URL (`?type=&status=&q=`) and are updated with
 * history.replaceState, which keeps useSearchParams in sync without a server
 * round trip.
 */
export function LibraryView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = parseLibraryFilters(searchParams);
  const library = useLibrary(filters);
  const { open: openCreatePollModal } = useCreatePollModal();
  const { open: openCreatePresentationModal } = useCreatePresentationModal();

  const setFilters = (patch: Partial<LibraryFilters>) => {
    const next = { ...filters, ...patch };
    window.history.replaceState(null, "", `${pathname}${filtersToSearch(next)}`);
  };

  // Search box: typed text, pushed to the URL after a pause.
  const [searchDraft, setSearchDraft] = useState(filters.q);
  const [syncedQ, setSyncedQ] = useState(filters.q);
  if (syncedQ !== filters.q) {
    setSyncedQ(filters.q);
    // Only a change from outside (navigation) replaces what is typed; our own
    // debounced update matches the box already (modulo outer spaces).
    if (searchDraft.trim() !== filters.q.trim()) setSearchDraft(filters.q);
  }
  const setFiltersRef = useRef(setFilters);
  useEffect(() => {
    setFiltersRef.current = setFilters;
  });
  useEffect(() => {
    if (searchDraft.trim() === filters.q.trim()) return;
    const timer = window.setTimeout(() => setFiltersRef.current({ q: searchDraft }), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchDraft, filters.q]);

  // Infinite scroll: load the next page when the sentinel nears the viewport.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const { hasMore, loadMore, loading } = library;
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || loading) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    }, { rootMargin: "400px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadMore, loading]);

  const counts = library.counts;
  const stats: { label: string; value: number | undefined; live?: boolean }[] = [
    { label: "All items", value: counts?.all },
    { label: "Live now", value: counts?.live, live: true },
    { label: "Drafts", value: counts?.draft },
  ];

  const empty = emptyStateCopy(filters);
  const filtered = filters.type !== "all" || filters.status !== "all" || filters.q.trim() !== "";

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pb-16 pt-8 sm:px-6 md:pt-12 lg:px-8">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-4xl font-semibold leading-none tracking-[-0.04em] sm:text-5xl">Library</h1>
          <p className="mt-3 text-base text-muted-foreground">Every poll and deck in this workspace.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="bg-card" onClick={() => openCreatePollModal()}>
            <Plus /> New poll
          </Button>
          <ImportButton />
          <Button onClick={() => openCreatePresentationModal()}>
            <Presentation /> New deck
          </Button>
        </div>
      </header>

      {/* Counts as one hairline strip, not cards: they are facts about the list below. */}
      <dl className="mt-8 grid grid-cols-3 border-y border-border">
        {stats.map((stat, i) => (
          <div key={stat.label} className={cn("py-4 sm:py-5", i > 0 && "border-l border-border pl-4 sm:pl-6")}>
            <dt className="flex items-center gap-2 text-sm text-muted-foreground">
              {stat.live ? (
                <span
                  aria-hidden="true"
                  className={cn("size-1.5 rounded-full", stat.value ? "bg-success motion-safe:animate-pulse" : "bg-faint")}
                />
              ) : null}
              {stat.label}
            </dt>
            <dd className="mt-1.5 text-3xl font-semibold leading-none tabular-nums tracking-[-0.03em] sm:text-4xl">
              {stat.value === undefined ? <span className="inline-block h-8 w-10 animate-pulse rounded-md bg-muted" /> : stat.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-8 flex flex-col gap-3 border-b border-border md:flex-row md:items-end md:justify-between">
        <div role="tablist" aria-label="Item type" className="-mb-px flex gap-6">
          {TYPE_TABS.map((tab) => {
            const active = filters.type === tab.key;
            const count = counts?.[tab.count];
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilters({ type: tab.key })}
                className={cn(
                  "flex items-center gap-2 border-b-2 pb-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  active ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
                {count ? <span className="font-mono text-xs tabular-nums text-muted-foreground">{count}</span> : null}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 pb-3">
          <label className="sr-only" htmlFor="library-status">
            Status
          </label>
          <select
            id="library-status"
            value={filters.status}
            onChange={(event) => setFilters({ status: event.target.value as LibraryFilters["status"] })}
            className="h-9 rounded-md border border-input bg-card px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="relative min-w-0 flex-1 md:w-64 md:flex-none">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={searchDraft}
              maxLength={MAX_SEARCH_LENGTH}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="Search by title"
              aria-label="Search by title"
              className="h-9 w-full rounded-md border border-input bg-card pl-9 pr-8 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25 [&::-webkit-search-cancel-button]:hidden"
            />
            {searchDraft ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  setSearchDraft("");
                  setFilters({ q: "" });
                }}
                className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {library.loading ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((key) => (
            <LibraryCardSkeleton key={key} />
          ))}
        </div>
      ) : null}

      {!library.loading && library.error ? (
        <div className="mt-6 flex items-center justify-between gap-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <span>{library.error}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => (library.items.length ? library.loadMore() : library.reload())}
            className="border-destructive/30 text-destructive hover:bg-destructive/10"
          >
            <RefreshCw /> Retry
          </Button>
        </div>
      ) : null}

      {!library.loading && !library.error && library.items.length === 0 ? (
        <div className="relative mt-6 overflow-hidden rounded-2xl border border-border bg-card px-6 py-16 text-center">
          <div aria-hidden="true" className="mk-grid mk-grid-flat pointer-events-none absolute inset-0" />
          <div className="relative">
            <ProductLogo size={40} className="mx-auto" decorative />
            <h2 className="mt-5 text-2xl font-semibold tracking-[-0.03em]">{empty.title}</h2>
            <p className="mx-auto mt-2 max-w-md text-base text-muted-foreground">{empty.body}</p>
            {filtered ? (
              <Button
                variant="outline"
                className="mt-6 bg-card"
                onClick={() => {
                  setSearchDraft("");
                  setFilters({ type: "all", status: "all", q: "" });
                }}
              >
                Clear filters
              </Button>
            ) : (
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                <Button variant="outline" className="bg-card" onClick={() => openCreatePollModal()}>
                  <Plus /> Create poll
                </Button>
                <Button onClick={() => openCreatePresentationModal()}>
                  <Presentation /> Create deck
                </Button>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {!library.loading && library.items.length > 0 ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {library.items.map((card) => (
            <LibraryCard key={cardKey(card)} card={card} onRemoved={library.remove} onChanged={library.replace} />
          ))}
        </div>
      ) : null}

      {!library.loading && library.hasMore ? (
        <div ref={sentinelRef} className="flex justify-center py-6">
          <Button variant="outline" size="sm" className="bg-card" disabled={library.loadingMore} onClick={() => library.loadMore()}>
            {library.loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Same outline as a card while the first page loads. */
export function LibraryCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="h-32 animate-pulse border-b border-border bg-muted/60" />
      <div className="space-y-3 p-4">
        <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
        <div className="flex justify-end pt-3">
          <div className="h-8 w-28 animate-pulse rounded-md bg-muted" />
        </div>
      </div>
    </div>
  );
}
