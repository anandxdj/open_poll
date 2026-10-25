import {
  LIBRARY_STATUSES,
  LIBRARY_TYPES,
  type LibraryCard,
  type LibraryCounts,
  type LibraryFilters,
  type LibraryStatus,
  type LibraryType,
} from "./types";

// Pure library logic: URL ⇄ filters, request params, page merging, card
// links and labels. No React, no network — unit tested in tests/unit.

export const DEFAULT_FILTERS: LibraryFilters = { type: "all", status: "all", q: "" };
export const LIBRARY_PAGE_SIZE = 24;
/** Backend limit on `q`. */
export const MAX_SEARCH_LENGTH = 100;
/** Where the library lives (the dashboard URL predates the library). */
export const LIBRARY_PATH = "/polls";

type SearchParamsLike =
  | URLSearchParams
  | { get(name: string): string | null }
  | Record<string, string | string[] | undefined>;

function readParam(params: SearchParamsLike, name: string): string | undefined {
  if (typeof (params as URLSearchParams).get === "function") {
    return (params as URLSearchParams).get(name) ?? undefined;
  }
  const value = (params as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(value) ? value[0] : value;
}

const oneOf = <T extends string>(values: readonly T[], value: string | undefined): T | undefined =>
  value !== undefined && (values as readonly string[]).includes(value) ? (value as T) : undefined;

/** Filters from the URL; unknown values fall back to the defaults. */
export function parseLibraryFilters(params: SearchParamsLike): LibraryFilters {
  return {
    type: oneOf<LibraryType>(LIBRARY_TYPES, readParam(params, "type")) ?? DEFAULT_FILTERS.type,
    status: oneOf<LibraryStatus>(LIBRARY_STATUSES, readParam(params, "status")) ?? DEFAULT_FILTERS.status,
    q: (readParam(params, "q") ?? "").slice(0, MAX_SEARCH_LENGTH),
  };
}

/** Query string for the library URL; defaults are left out (`""` when everything is default). */
export function filtersToSearch(filters: LibraryFilters): string {
  const params = new URLSearchParams();
  if (filters.type !== "all") params.set("type", filters.type);
  if (filters.status !== "all") params.set("status", filters.status);
  const q = filters.q.trim();
  if (q) params.set("q", q);
  const search = params.toString();
  return search ? `?${search}` : "";
}

/** Stable identity of a filter set (effect dependency, request de-duplication). */
export const filtersKey = (filters: LibraryFilters) => filtersToSearch(filters) || "?";

/** Query parameters of `GET /api/library` for one page. */
export function libraryRequestParams(
  filters: LibraryFilters,
  cursor: string | null = null,
  limit = LIBRARY_PAGE_SIZE,
): Record<string, string> {
  const params: Record<string, string> = { limit: String(limit) };
  if (filters.type !== "all") params.type = filters.type;
  if (filters.status !== "all") params.status = filters.status;
  const q = filters.q.trim();
  if (q) params.q = q;
  if (cursor) params.cursor = cursor;
  return params;
}

export const cardKey = (card: Pick<LibraryCard, "entityType" | "id">) => `${card.entityType}:${card.id}`;

/**
 * Appends a page to the loaded cards. A card that moved (edited between two
 * page loads) is kept once, at its newest position.
 */
export function mergeLibraryItems(loaded: LibraryCard[], page: LibraryCard[]): LibraryCard[] {
  const incoming = new Map(page.map((card) => [cardKey(card), card]));
  return [...loaded.filter((card) => !incoming.has(cardKey(card))), ...page];
}

/** Replaces one card in place (after a mutation such as close or convert). */
export const replaceLibraryItem = (items: LibraryCard[], next: LibraryCard): LibraryCard[] =>
  items.map((card) => (cardKey(card) === cardKey(next) ? next : card));

/** Counts after `card` is deleted, so the tabs and stats stay right without a refetch. */
export function countsWithout(counts: LibraryCounts, card: LibraryCard): LibraryCounts {
  const dec = (value: number) => Math.max(0, value - 1);
  return {
    all: dec(counts.all),
    poll: card.entityType === "poll" ? dec(counts.poll) : counts.poll,
    presentation: card.entityType === "presentation" ? dec(counts.presentation) : counts.presentation,
    live: card.status === "live" ? dec(counts.live) : counts.live,
    draft: card.status === "draft" ? dec(counts.draft) : counts.draft,
  };
}

/** Counts after a card's status changed (e.g. a poll closed early). */
export function countsWithStatus(counts: LibraryCounts, from: LibraryStatus, to: LibraryStatus): LibraryCounts {
  if (from === to) return counts;
  const next = { ...counts };
  if (from === "live") next.live = Math.max(0, next.live - 1);
  if (from === "draft") next.draft = Math.max(0, next.draft - 1);
  if (to === "live") next.live += 1;
  if (to === "draft") next.draft += 1;
  return next;
}

// ---------- Card presentation ----------

export interface CardLinks {
  /** Main destination of the card. */
  open: string;
  /** Absolute URL participants use. */
  share: string;
  /** Poll voting page / deck host console. */
  run: string;
}

export function cardLinks(card: LibraryCard, origin: string): CardLinks {
  if (card.entityType === "poll") {
    return {
      open: card.status === "draft" ? `/create?draftId=${card.id}` : `/analytics/${card.id}`,
      share: `${origin}/p/${card.id}`,
      run: `/p/${card.id}`,
    };
  }
  return {
    open: `/presentation/create?id=${card.id}`,
    share: `${origin}/live/${card.details.joinCode}`,
    run: `/presentation/host/${card.id}`,
  };
}

/** Deck builder URL of a converted poll's deck. */
export const deckBuilderPath = (presentationId: string) => `/presentation/create?id=${presentationId}`;

export function statusLabel(card: LibraryCard): string {
  if (card.entityType === "poll") {
    return card.status === "draft" ? "Draft" : card.status === "live" ? "Active" : "Closed";
  }
  switch (card.details.phase) {
    case "lobby":
      return "Lobby open";
    case "active":
      return "Live";
    case "ended":
      return "Ended";
    default:
      return "Draft";
  }
}

export function kindLabel(card: LibraryCard): string {
  if (card.entityType === "poll") return card.details.pollType === "TRIAL" ? "Assessment" : "Poll";
  return card.details.pace === "audience" ? "Self-paced deck" : "Deck";
}

export function emptyStateCopy(filters: LibraryFilters): { title: string; body: string } {
  if (filters.q.trim()) {
    return { title: "No matches", body: `Nothing in your library matches “${filters.q.trim()}”.` };
  }
  const noun = filters.type === "poll" ? "polls" : filters.type === "presentation" ? "presentations" : "items";
  if (filters.status !== "all") {
    const status = filters.status === "live" ? "live" : filters.status === "draft" ? "draft" : "ended";
    return { title: `No ${status} ${noun}`, body: `You have no ${status} ${noun} right now.` };
  }
  if (filters.type === "all") {
    return { title: "Your library is empty", body: "Create a poll or a presentation deck to get started." };
  }
  return { title: `No ${noun} yet`, body: `Create your first ${filters.type === "poll" ? "poll" : "deck"} to see it here.` };
}
