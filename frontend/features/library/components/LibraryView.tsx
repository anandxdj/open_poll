"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { FileText, Layers, Plus, Presentation, Radio, RefreshCw, Search, X } from "lucide-react";

import { ProductLogo } from "@/components/ui/ProductLogo";
import { useCreatePollModal } from "@/features/polls/components/CreatePollModalProvider";
import { useCreatePresentationModal } from "@/features/presentations/components/CreatePresentationModalProvider";
import { cn } from "@/lib/utils";
import { useLibrary } from "../hooks/useLibrary";
import { cardKey, emptyStateCopy, filtersToSearch, MAX_SEARCH_LENGTH, parseLibraryFilters } from "../query";
import type { LibraryCounts, LibraryFilters, LibraryStatus, LibraryType } from "../types";
import { LibraryCard } from "./LibraryCard";

const ease = [0.32, 0.72, 0, 1] as const;
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
  const stats = [
    {
      label: "Total",
      value: counts?.all,
      desc: "Polls and presentations",
      icon: Layers,
      color: "text-primary bg-primary/10 border-primary/20",
      glow: "bg-primary/5",
    },
    {
      label: "Live now",
      value: counts?.live,
      desc: "Open polls and running sessions",
      icon: Radio,
      color: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20",
      glow: "bg-emerald-500/5",
    },
    {
      label: "Drafts",
      value: counts?.draft,
      desc: "Work in progress",
      icon: FileText,
      color: "text-amber-500 bg-amber-500/10 border-amber-500/20",
      glow: "bg-amber-500/5",
    },
  ];

  const empty = emptyStateCopy(filters);
  const filtered = filters.type !== "all" || filters.status !== "all" || filters.q.trim() !== "";

  return (
    <>
      <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-background/95 px-4 backdrop-blur-xl md:px-6">
        <h1 className="text-sm font-semibold text-foreground/90">Library</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => openCreatePollModal()}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground/80 transition-colors duration-200 hover:border-primary/30 hover:text-primary"
          >
            <Plus className="size-3.5" />
            New poll
          </button>
          <button
            type="button"
            onClick={() => openCreatePresentationModal()}
            className="flex items-center gap-1.5 rounded-xl border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors duration-200 hover:bg-primary hover:text-primary-foreground"
          >
            <Presentation className="size-3.5" />
            New deck
          </button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 md:px-6">
        <div className="grid grid-cols-3 gap-4">
          {stats.map((stat, i) => {
            const Icon = stat.icon;
            return (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease, delay: i * 0.08 }}
                className="group relative overflow-hidden rounded-[2rem] border border-border bg-card p-5 transition-all duration-300 hover:border-primary/30"
              >
                <div
                  className={cn(
                    "pointer-events-none absolute -bottom-4 -right-4 size-32 rounded-full blur-3xl transition-all duration-500 group-hover:scale-110",
                    stat.glow,
                  )}
                />
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">{stat.label}</p>
                    <h3 className="text-2xl font-extrabold tabular-nums tracking-tight text-foreground/90">
                      {stat.value === undefined ? (
                        <span className="inline-block h-6 w-8 animate-pulse rounded bg-secondary/50" />
                      ) : (
                        stat.value
                      )}
                    </h3>
                    <p className="hidden text-[10px] font-medium text-muted-foreground/40 sm:block">{stat.desc}</p>
                  </div>
                  <div
                    className={cn(
                      "hidden size-10 shrink-0 items-center justify-center rounded-2xl border transition-transform duration-300 group-hover:scale-105 sm:flex",
                      stat.color,
                    )}
                  >
                    <Icon className="size-5" />
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-1.5 md:flex-row md:items-center">
          <div role="tablist" aria-label="Item type" className="flex flex-wrap items-center gap-1">
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
                    "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-all",
                    active ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "text-muted-foreground hover:text-foreground/75",
                  )}
                >
                  <span>{tab.label}</span>
                  {count ? (
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px] tabular-nums",
                        active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="flex flex-1 flex-wrap items-center gap-2 md:justify-end">
            <label className="sr-only" htmlFor="library-status">
              Status
            </label>
            <select
              id="library-status"
              value={filters.status}
              onChange={(event) => setFilters({ status: event.target.value as LibraryFilters["status"] })}
              className="h-9 rounded-xl border border-border bg-background px-2.5 text-xs font-semibold text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
            <div className="relative min-w-0 flex-1 md:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
              <input
                type="search"
                value={searchDraft}
                maxLength={MAX_SEARCH_LENGTH}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="Search by title"
                aria-label="Search by title"
                className="h-9 w-full rounded-xl border border-border bg-background pl-8 pr-8 text-xs text-foreground outline-none placeholder:text-muted-foreground/50 focus-visible:ring-2 focus-visible:ring-primary/40"
              />
              {searchDraft ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => {
                    setSearchDraft("");
                    setFilters({ q: "" });
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground/60 hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {library.loading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((key) => (
              <div key={key} className="h-52 animate-pulse rounded-[2rem] border border-border bg-secondary/30" />
            ))}
          </div>
        ) : null}

        {!library.loading && library.error ? (
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-red-500/30 bg-red-500/[0.07] p-4 text-sm text-red-500">
            <span>{library.error}</span>
            <button
              type="button"
              onClick={() => (library.items.length ? library.loadMore() : library.reload())}
              className="inline-flex items-center gap-1.5 rounded-xl border border-red-500/30 px-3 py-1.5 text-xs font-semibold hover:bg-red-500/10"
            >
              <RefreshCw className="size-3.5" /> Retry
            </button>
          </div>
        ) : null}

        {!library.loading && !library.error && library.items.length === 0 ? (
          <div className="rounded-[2rem] border border-border bg-card p-12 text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-3xl bg-primary/15 ring-1 ring-primary/25">
              <ProductLogo size={32} />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-foreground/85">{empty.title}</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{empty.body}</p>
            {filtered ? (
              <button
                type="button"
                onClick={() => {
                  setSearchDraft("");
                  setFilters({ type: "all", status: "all", q: "" });
                }}
                className="mt-5 inline-flex items-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-semibold text-foreground/80 transition-colors hover:border-primary/30 hover:text-primary"
              >
                Clear filters
              </button>
            ) : (
              <div className="mt-5 flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  onClick={() => openCreatePollModal()}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition-all duration-200 hover:opacity-90 active:scale-[0.98]"
                >
                  <Plus className="size-4" /> Create poll
                </button>
                <button
                  type="button"
                  onClick={() => openCreatePresentationModal()}
                  className="inline-flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-5 py-2.5 text-sm font-bold text-primary transition-all duration-200 hover:bg-primary hover:text-primary-foreground active:scale-[0.98]"
                >
                  <Presentation className="size-4" /> Create deck
                </button>
              </div>
            )}
          </div>
        ) : null}

        {!library.loading && library.items.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {library.items.map((card) => (
              <LibraryCard key={cardKey(card)} card={card} onRemoved={library.remove} onChanged={library.replace} />
            ))}
          </div>
        ) : null}

        {!library.loading && library.hasMore ? (
          <div ref={sentinelRef} className="flex justify-center py-4">
            <button
              type="button"
              disabled={library.loadingMore}
              onClick={() => library.loadMore()}
              className="rounded-xl border border-border px-4 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
            >
              {library.loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
