import { describe, expect, test } from "bun:test";

import {
  cardInFolder,
  cardKey,
  cardLinks,
  countsWithout,
  countsWithStatus,
  DEFAULT_FILTERS,
  duplicateOpenPath,
  emptyStateCopy,
  filtersKey,
  filtersToSearch,
  kindLabel,
  libraryRequestParams,
  mergeLibraryItems,
  parseLibraryFilters,
  replaceLibraryItem,
  statusLabel,
  withFreshFirstPage,
} from "@/features/library/query";
import type { LibraryCard, LibraryCounts, PollLibraryCard, PresentationLibraryCard } from "@/features/library/types";

const poll = (id: string, overrides: Partial<PollLibraryCard> = {}): PollLibraryCard => ({
  entityType: "poll",
  id,
  title: `Poll ${id}`,
  status: "live",
  folderId: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  stats: { questionCount: 2, responseCount: 0 },
  details: {
    pollType: "POLL",
    isAnonymous: true,
    expiresAt: "2026-12-01T00:00:00.000Z",
    isResultsPublished: false,
    convertedPresentationId: null,
  },
  ...overrides,
});

const deck = (id: string, overrides: Partial<PresentationLibraryCard["details"]> = {}): PresentationLibraryCard => ({
  entityType: "presentation",
  id,
  title: `Deck ${id}`,
  status: overrides.phase === "lobby" || overrides.phase === "active" ? "live" : overrides.phase === "ended" ? "ended" : "draft",
  folderId: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  stats: { slideCount: 3 },
  details: { phase: "draft", joinCode: "123456", pace: "presenter", legacySource: null, slideTypes: [], ...overrides },
});

const COUNTS: LibraryCounts = { all: 10, poll: 6, presentation: 4, live: 3, draft: 5 };

describe("filters in the URL", () => {
  test("parses search params, falling back to defaults for unknown values", () => {
    expect(parseLibraryFilters(new URLSearchParams(""))).toEqual(DEFAULT_FILTERS);
    expect(parseLibraryFilters(new URLSearchParams("type=presentation&status=live&q=kick"))).toEqual({
      type: "presentation",
      status: "live",
      q: "kick",
      folder: "all",
    });
    expect(parseLibraryFilters(new URLSearchParams("folder=root")).folder).toBe("root");
    expect(parseLibraryFilters(new URLSearchParams("folder=ABCDEF0123456789abcdef01")).folder).toBe("abcdef0123456789abcdef01");
    expect(parseLibraryFilters(new URLSearchParams("folder=nope")).folder).toBe("all");
    expect(parseLibraryFilters(new URLSearchParams("type=quiz&status=open"))).toEqual(DEFAULT_FILTERS);
    // Server-component style searchParams objects, including repeated keys.
    expect(parseLibraryFilters({ type: ["poll", "presentation"], q: undefined })).toEqual({ ...DEFAULT_FILTERS, type: "poll" });
    expect(parseLibraryFilters({ q: "x".repeat(150) }).q).toHaveLength(100);
  });

  test("serialises only non-default filters, trimming the search", () => {
    expect(filtersToSearch(DEFAULT_FILTERS)).toBe("");
    expect(filtersToSearch({ ...DEFAULT_FILTERS, type: "presentation" })).toBe("?type=presentation");
    expect(filtersToSearch({ ...DEFAULT_FILTERS, status: "draft", q: "  C++ (beta) " })).toBe("?status=draft&q=C%2B%2B+%28beta%29");
    expect(filtersToSearch({ ...DEFAULT_FILTERS, folder: "root", type: "poll" })).toBe("?folder=root&type=poll");
    const roundTrip = { type: "poll", status: "ended", q: "retro", folder: "abcdef0123456789abcdef01" } as const;
    expect(parseLibraryFilters(new URLSearchParams(filtersToSearch(roundTrip).slice(1)))).toEqual(roundTrip);
  });

  test("keys filter sets so a whitespace-only change does not refetch", () => {
    expect(filtersKey({ ...DEFAULT_FILTERS, q: "a " })).toBe(filtersKey({ ...DEFAULT_FILTERS, q: "a" }));
    expect(filtersKey(DEFAULT_FILTERS)).not.toBe(filtersKey({ ...DEFAULT_FILTERS, type: "poll" }));
  });

  test("builds GET /api/library params", () => {
    expect(libraryRequestParams(DEFAULT_FILTERS)).toEqual({ limit: "24" });
    expect(libraryRequestParams({ type: "poll", status: "live", q: " lunch ", folder: "root" }, "abc", 10)).toEqual({
      limit: "10",
      type: "poll",
      status: "live",
      folderId: "root",
      q: "lunch",
      cursor: "abc",
    });
  });
});

describe("folders", () => {
  test("tells whether a moved card still belongs in the folder filter", () => {
    const filed = poll("1", { folderId: "f1" });
    expect(cardInFolder(filed, "all")).toBe(true);
    expect(cardInFolder(filed, "f1")).toBe(true);
    expect(cardInFolder(filed, "f2")).toBe(false);
    expect(cardInFolder(filed, "root")).toBe(false);
    expect(cardInFolder(poll("2"), "root")).toBe(true);
  });
});

describe("pages and mutations", () => {
  test("appends pages without duplicating cards that moved between loads", () => {
    const first = [poll("1"), deck("1"), poll("2")];
    const second = [poll("2", { title: "edited" }), deck("3")];
    const merged = mergeLibraryItems(first, second);
    expect(merged.map(cardKey)).toEqual(["poll:1", "presentation:1", "poll:2", "presentation:3"]);
    expect(merged.find((card) => cardKey(card) === "poll:2")!.title).toBe("edited");
    // A poll and a deck may share nothing but the id string; they stay distinct.
    expect(mergeLibraryItems([poll("7")], [deck("7")]).map(cardKey)).toEqual(["poll:7", "presentation:7"]);
  });

  test("puts a refetched first page on top and keeps the cards loaded after it", () => {
    // A duplicate went to the top and pushed deck 2 off the first page.
    const loaded = [poll("1"), deck("2"), poll("3"), deck("4")];
    const firstPage = [deck("copy"), poll("1", { title: "edited" })];
    const merged = withFreshFirstPage(loaded, firstPage);
    expect(merged.map(cardKey)).toEqual(["presentation:copy", "poll:1", "presentation:2", "poll:3", "presentation:4"]);
    expect(merged[1]!.title).toBe("edited");
    expect(withFreshFirstPage([], firstPage).map(cardKey)).toEqual(["presentation:copy", "poll:1"]);
  });

  test("opens a duplicate where its draft is edited", () => {
    expect(duplicateOpenPath("presentation", "d1")).toBe("/presentation/create?id=d1");
    expect(duplicateOpenPath("poll", "p1")).toBe("/create?draftId=p1");
  });

  test("replaces one card in place", () => {
    const items: LibraryCard[] = [poll("1"), poll("2")];
    expect(replaceLibraryItem(items, poll("2", { status: "ended" })).map((card) => card.status)).toEqual(["live", "ended"]);
  });

  test("adjusts counts when a card is deleted", () => {
    expect(countsWithout(COUNTS, poll("1"))).toEqual({ all: 9, poll: 5, presentation: 4, live: 2, draft: 5 });
    expect(countsWithout(COUNTS, deck("1"))).toEqual({ all: 9, poll: 6, presentation: 3, live: 3, draft: 4 });
    expect(countsWithout({ all: 0, poll: 0, presentation: 0, live: 0, draft: 0 }, poll("1")).all).toBe(0);
  });

  test("moves the live count when a poll closes", () => {
    expect(countsWithStatus(COUNTS, "live", "ended")).toEqual({ ...COUNTS, live: 2 });
    expect(countsWithStatus(COUNTS, "draft", "live")).toEqual({ ...COUNTS, live: 4, draft: 4 });
    expect(countsWithStatus(COUNTS, "ended", "ended")).toBe(COUNTS);
  });
});

describe("cards", () => {
  const origin = "https://openpoll.test";

  test("links polls to their editor or analytics, voting page and share URL", () => {
    expect(cardLinks(poll("p1", { status: "draft" }), origin)).toEqual({
      open: "/create?draftId=p1",
      share: "https://openpoll.test/p/p1",
      run: "/p/p1",
    });
    expect(cardLinks(poll("p1"), origin).open).toBe("/analytics/p1");
  });

  test("links decks to the builder, the host console and the join URL", () => {
    expect(cardLinks(deck("d1", { joinCode: "654321" }), origin)).toEqual({
      open: "/presentation/create?id=d1",
      share: "https://openpoll.test/live/654321",
      run: "/presentation/host/d1",
    });
  });

  test("labels status and kind", () => {
    expect(statusLabel(poll("1", { status: "draft" }))).toBe("Draft");
    expect(statusLabel(poll("1"))).toBe("Active");
    expect(statusLabel(poll("1", { status: "ended" }))).toBe("Closed");
    expect(statusLabel(deck("1", { phase: "lobby" }))).toBe("Lobby open");
    expect(statusLabel(deck("1", { phase: "active" }))).toBe("Live");
    expect(statusLabel(deck("1", { phase: "ended" }))).toBe("Ended");
    expect(kindLabel(poll("1"))).toBe("Poll");
    expect(kindLabel(poll("1", { details: { ...poll("1").details, pollType: "TRIAL" } }))).toBe("Assessment");
    expect(kindLabel(deck("1", { pace: "audience" }))).toBe("Self-paced deck");
  });

  test("explains empty results for the active filters", () => {
    expect(emptyStateCopy(DEFAULT_FILTERS).title).toBe("Your library is empty");
    expect(emptyStateCopy({ ...DEFAULT_FILTERS, q: " zzz " }).body).toContain("“zzz”");
    expect(emptyStateCopy({ ...DEFAULT_FILTERS, type: "presentation", status: "live" }).title).toBe("No live presentations");
    expect(emptyStateCopy({ ...DEFAULT_FILTERS, type: "poll" }).title).toBe("No polls yet");
    expect(emptyStateCopy({ ...DEFAULT_FILTERS, folder: "abcdef0123456789abcdef01" }).title).toBe("This folder is empty");
    expect(emptyStateCopy({ ...DEFAULT_FILTERS, folder: "root" }).title).toBe("Everything is in a folder");
  });
});
