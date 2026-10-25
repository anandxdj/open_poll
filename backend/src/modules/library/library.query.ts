import { Types } from 'mongoose';
import { ApiError } from '../../common/utils/ApiError';
import type {
  LibraryCard,
  LibraryStatus,
  PollLibraryCard,
  PresentationLibraryCard,
} from './library.types';

/**
 * Pure building blocks of the library query: cursor codec, Mongo filters and
 * the document → card mappers. `library.service.ts` runs them.
 */

type Filter = Record<string, unknown>;

// ---------- Cursor ----------

/** Position after the last card of a page: sort key `(updatedAt desc, id desc)`. */
export interface LibraryCursor {
  updatedAt: Date;
  id: string;
}

const OBJECT_ID = /^[a-f0-9]{24}$/i;

export const encodeCursor = (cursor: LibraryCursor): string =>
  Buffer.from(JSON.stringify({ u: cursor.updatedAt.getTime(), i: cursor.id })).toString('base64url');

/** Throws 400 on anything `encodeCursor` did not produce. */
export function decodeCursor(value: string): LibraryCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { u?: unknown; i?: unknown };
    if (typeof parsed.u === 'number' && Number.isFinite(parsed.u) && typeof parsed.i === 'string' && OBJECT_ID.test(parsed.i)) {
      return { updatedAt: new Date(parsed.u), id: parsed.i.toLowerCase() };
    }
  } catch {
    // fall through
  }
  throw ApiError.badRequest('Invalid cursor');
}

/** Documents strictly after the cursor in `(updatedAt desc, _id desc)` order. */
export const afterCursorFilter = (cursor: LibraryCursor): Filter => ({
  $or: [
    { updatedAt: { $lt: cursor.updatedAt } },
    { updatedAt: cursor.updatedAt, _id: { $lt: new Types.ObjectId(cursor.id) } },
  ],
});

/** Newest first; ties broken by id so every card has one position. */
export const compareCards = (a: Pick<LibraryCard, 'updatedAt' | 'id'>, b: Pick<LibraryCard, 'updatedAt' | 'id'>) => {
  const byDate = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  if (byDate !== 0) return byDate;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
};

/**
 * Merges the per-collection pages (each sorted, each fetched with `limit + 1`)
 * into one page plus the cursor for the next one.
 */
export function mergePages(pages: LibraryCard[][], limit: number): { items: LibraryCard[]; nextCursor: string | null } {
  const merged = pages.flat().sort(compareCards);
  const items = merged.slice(0, limit);
  const last = items[items.length - 1];
  const nextCursor =
    merged.length > limit && last ? encodeCursor({ updatedAt: new Date(last.updatedAt), id: last.id }) : null;
  return { items, nextCursor };
}

// ---------- Filters ----------

/** Escapes RegExp metacharacters so user input matches literally. */
export const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const titleFilter = (q: string): Filter => ({ title: { $regex: escapeRegex(q), $options: 'i' } });

export const folderFilter = (folderId: string): Filter =>
  folderId === 'root' ? { folderId: null } : { folderId: new Types.ObjectId(folderId) };

export interface ScopeSubject {
  userId: string;
  workspace: { _id: Types.ObjectId | string; type?: string; ownerId?: Types.ObjectId | string | null };
}

/**
 * Items of the current workspace. Polls and decks saved before workspaces
 * (no `workspaceId` until migration 020 backfills it) belong to their creator's
 * personal workspace, so they are listed there, and only for their creator.
 */
export function scopeFilter({ userId, workspace }: ScopeSubject): Filter {
  const clauses: Filter[] = [{ workspaceId: new Types.ObjectId(String(workspace._id)) }];
  if (workspace.type === 'personal' && String(workspace.ownerId) === userId) {
    clauses.push({ workspaceId: null, creatorId: userId });
  }
  return { $or: clauses };
}

/** Poll documents in a library status at `now`. */
export function pollStatusFilter(status: LibraryStatus, now: Date): Filter {
  switch (status) {
    case 'draft':
      return { isPublished: { $ne: true } };
    case 'live':
      return { isPublished: true, isClosed: { $ne: true }, expiresAt: { $gt: now } };
    case 'ended':
      return { isPublished: true, $or: [{ isClosed: true }, { expiresAt: { $lte: now } }] };
  }
}

export const LIVE_PRESENTATION_STATUSES = ['lobby', 'active'] as const;

export function presentationStatusFilter(status: LibraryStatus): Filter {
  switch (status) {
    case 'draft':
      return { status: 'draft' };
    case 'live':
      return { status: { $in: [...LIVE_PRESENTATION_STATUSES] } };
    case 'ended':
      return { status: 'ended' };
  }
}

/** `$and` of the non-empty clauses (one clause stays as is). */
export const allOf = (...clauses: Array<Filter | null | undefined | false>): Filter => {
  const present = clauses.filter((clause): clause is Filter => Boolean(clause));
  if (present.length === 0) return {};
  if (present.length === 1) return present[0]!;
  return { $and: present };
};

// ---------- Cards ----------

const iso = (value: unknown): string => {
  const date = value instanceof Date ? value : new Date(String(value ?? 0));
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
};

const idOf = (value: unknown): string | null => (value == null ? null : String(value));

/** Fields read from `polls` (see `POLL_CARD_PROJECTION`). */
export interface PollCardSource {
  _id: Types.ObjectId | string;
  title?: string;
  pollType?: 'POLL' | 'TRIAL';
  isPublished?: boolean;
  isClosed?: boolean;
  isAnonymous?: boolean;
  isResultsPublished?: boolean;
  expiresAt?: Date | null;
  convertedPresentationId?: Types.ObjectId | string | null;
  questions?: unknown[];
  createdAt?: Date;
  updatedAt?: Date;
}

export const POLL_CARD_PROJECTION = {
  title: 1,
  pollType: 1,
  isPublished: 1,
  isClosed: 1,
  isAnonymous: 1,
  isResultsPublished: 1,
  expiresAt: 1,
  convertedPresentationId: 1,
  'questions._id': 1,
  createdAt: 1,
  updatedAt: 1,
} as const;

export function pollStatus(poll: Pick<PollCardSource, 'isPublished' | 'isClosed' | 'expiresAt'>, now: Date): LibraryStatus {
  if (!poll.isPublished) return 'draft';
  const expired = poll.expiresAt != null && new Date(poll.expiresAt).getTime() <= now.getTime();
  return poll.isClosed || expired ? 'ended' : 'live';
}

export function toPollCard(poll: PollCardSource, responseCount: number, now: Date): PollLibraryCard {
  return {
    entityType: 'poll',
    id: String(poll._id),
    title: poll.title ?? '',
    status: pollStatus(poll, now),
    createdAt: iso(poll.createdAt),
    updatedAt: iso(poll.updatedAt),
    stats: { questionCount: poll.questions?.length ?? 0, responseCount },
    details: {
      pollType: poll.pollType === 'TRIAL' ? 'TRIAL' : 'POLL',
      isAnonymous: poll.isAnonymous !== false,
      expiresAt: poll.expiresAt ? iso(poll.expiresAt) : null,
      isResultsPublished: poll.isResultsPublished === true,
      convertedPresentationId: idOf(poll.convertedPresentationId),
    },
  };
}

/** Fields read from `presentations` (see `PRESENTATION_CARD_PROJECTION`). */
export interface PresentationCardSource {
  _id: Types.ObjectId | string;
  title?: string;
  status?: string;
  joinCode?: string;
  pace?: string | null;
  legacy?: { source?: string | null } | null;
  slides?: Array<{ type?: string }>;
  createdAt?: Date;
  updatedAt?: Date;
}

export const PRESENTATION_CARD_PROJECTION = {
  title: 1,
  status: 1,
  joinCode: 1,
  pace: 1,
  legacy: 1,
  'slides.type': 1,
  createdAt: 1,
  updatedAt: 1,
} as const;

const PHASES = ['draft', 'lobby', 'active', 'ended'] as const;
type Phase = (typeof PHASES)[number];

export function presentationStatus(phase: Phase): LibraryStatus {
  if (phase === 'draft') return 'draft';
  if (phase === 'ended') return 'ended';
  return 'live';
}

export function toPresentationCard(deck: PresentationCardSource): PresentationLibraryCard {
  const phase: Phase = (PHASES as readonly string[]).includes(deck.status ?? '') ? (deck.status as Phase) : 'draft';
  const slides = deck.slides ?? [];
  const legacySource = deck.legacy?.source;
  return {
    entityType: 'presentation',
    id: String(deck._id),
    title: deck.title ?? '',
    status: presentationStatus(phase),
    createdAt: iso(deck.createdAt),
    updatedAt: iso(deck.updatedAt),
    stats: { slideCount: slides.length },
    details: {
      phase,
      joinCode: deck.joinCode ?? '',
      pace: deck.pace === 'audience' ? 'audience' : 'presenter',
      legacySource: legacySource === 'poll' || legacySource === 'quiz' ? legacySource : null,
      slideTypes: [...new Set(slides.map((slide) => slide.type).filter((type): type is string => Boolean(type)))].slice(
        0,
        6,
      ),
    },
  };
}
