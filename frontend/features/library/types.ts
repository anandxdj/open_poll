// Wire types of the unified library (`GET /api/library`), mirroring
// backend/src/modules/library/library.types.ts.

export const LIBRARY_TYPES = ["all", "poll", "presentation"] as const;
export type LibraryType = (typeof LIBRARY_TYPES)[number];
export type LibraryEntityType = Exclude<LibraryType, "all">;

/** poll: draft / live (published, open) / ended (closed or expired); deck: draft / live (lobby, active) / ended. */
export const LIBRARY_STATUSES = ["draft", "live", "ended"] as const;
export type LibraryStatus = (typeof LIBRARY_STATUSES)[number];

interface LibraryCardBase {
  id: string;
  title: string;
  status: LibraryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PollLibraryCard extends LibraryCardBase {
  entityType: "poll";
  stats: { questionCount: number; responseCount: number };
  details: {
    pollType: "POLL" | "TRIAL";
    isAnonymous: boolean;
    expiresAt: string | null;
    isResultsPublished: boolean;
    convertedPresentationId: string | null;
  };
}

export type PresentationPhase = "draft" | "lobby" | "active" | "ended";

export interface PresentationLibraryCard extends LibraryCardBase {
  entityType: "presentation";
  stats: { slideCount: number };
  details: {
    phase: PresentationPhase;
    joinCode: string;
    pace: "presenter" | "audience";
    legacySource: "poll" | "quiz" | null;
    slideTypes: string[];
  };
}

export type LibraryCard = PollLibraryCard | PresentationLibraryCard;

export interface LibraryCounts {
  all: number;
  poll: number;
  presentation: number;
  live: number;
  draft: number;
}

export interface LibraryPage {
  items: LibraryCard[];
  nextCursor: string | null;
  /** Only on the first page. */
  counts?: LibraryCounts;
}

/** What the library page filters on (kept in the URL). */
export interface LibraryFilters {
  type: LibraryType;
  status: LibraryStatus | "all";
  q: string;
}
