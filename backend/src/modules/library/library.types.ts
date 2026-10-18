/**
 * Wire types of the unified library (`GET /api/library`): polls and
 * presentation decks of the caller's workspace as one list of cards.
 */

export const LIBRARY_ENTITY_TYPES = ['poll', 'presentation'] as const;
export type LibraryEntityType = (typeof LIBRARY_ENTITY_TYPES)[number];

/**
 * One status vocabulary for both entities:
 * - poll: `draft` = unpublished, `live` = published and open, `ended` = closed or expired;
 * - deck: `draft`, `live` = lobby or active, `ended`.
 */
export const LIBRARY_STATUSES = ['draft', 'live', 'ended'] as const;
export type LibraryStatus = (typeof LIBRARY_STATUSES)[number];

interface LibraryCardBase {
  id: string;
  title: string;
  status: LibraryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PollLibraryCard extends LibraryCardBase {
  entityType: 'poll';
  stats: { questionCount: number; responseCount: number };
  details: {
    pollType: 'POLL' | 'TRIAL';
    isAnonymous: boolean;
    expiresAt: string | null;
    isResultsPublished: boolean;
    /** The deck made by "Convert to presentation", if any. */
    convertedPresentationId: string | null;
  };
}

export interface PresentationLibraryCard extends LibraryCardBase {
  entityType: 'presentation';
  stats: { slideCount: number };
  details: {
    /** The deck's own status (`lobby` and `active` both map to `live`). */
    phase: 'draft' | 'lobby' | 'active' | 'ended';
    joinCode: string;
    pace: 'presenter' | 'audience';
    /** Set on decks converted from a poll or copied from a legacy quiz. */
    legacySource: 'poll' | 'quiz' | null;
    /** Distinct slide types, in deck order, at most six (card icons). */
    slideTypes: string[];
  };
}

export type LibraryCard = PollLibraryCard | PresentationLibraryCard;

/** Totals for the current filters except `type` and `status` (tab badges, dashboard stats). */
export interface LibraryCounts {
  all: number;
  poll: number;
  presentation: number;
  live: number;
  draft: number;
}

export interface LibraryPage {
  items: LibraryCard[];
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: string | null;
  /** First page only (no `cursor`). */
  counts?: LibraryCounts;
}
