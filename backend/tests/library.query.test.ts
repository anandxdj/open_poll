import { describe, expect, it } from 'bun:test';
import { Types } from 'mongoose';
import { ApiError } from '../src/common/utils/ApiError';
import {
  afterCursorFilter,
  allOf,
  decodeCursor,
  encodeCursor,
  escapeRegex,
  folderFilter,
  mergePages,
  pollStatus,
  pollStatusFilter,
  presentationStatusFilter,
  scopeFilter,
  titleFilter,
  toPollCard,
  toPresentationCard,
} from '../src/modules/library/library.query';
import { convertQuerySchema, libraryQuerySchema } from '../src/modules/library/library.schema';
import type { LibraryCard } from '../src/modules/library/library.types';

const NOW = new Date('2026-10-19T12:00:00.000Z');
const oid = (n: number) => new Types.ObjectId(n.toString(16).padStart(24, '0'));

const card = (n: number, updatedAt: string, entityType: 'poll' | 'presentation' = 'poll') =>
  ({ entityType, id: oid(n).toString(), updatedAt, title: `#${n}` }) as unknown as LibraryCard;

describe('library cursor', () => {
  it('round-trips (updatedAt, id)', () => {
    const cursor = { updatedAt: new Date('2026-10-01T10:00:00.123Z'), id: oid(7).toString() };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('rejects anything it did not encode with 400', () => {
    for (const bad of ['', 'not-base64!', Buffer.from('{"u":"x","i":"y"}').toString('base64url'), Buffer.from('[]').toString('base64url')]) {
      expect(() => decodeCursor(bad)).toThrow(ApiError);
      try {
        decodeCursor(bad);
      } catch (error) {
        expect((error as ApiError).statusCode).toBe(400);
      }
    }
  });

  it('selects documents strictly after the cursor position', () => {
    const at = new Date('2026-10-01T00:00:00.000Z');
    const filter = afterCursorFilter({ updatedAt: at, id: oid(5).toString() }) as { $or: any[] };
    expect(filter.$or[0]).toEqual({ updatedAt: { $lt: at } });
    expect(filter.$or[1].updatedAt).toEqual(at);
    expect(String(filter.$or[1]._id.$lt)).toBe(oid(5).toString());
  });
});

describe('mergePages', () => {
  it('interleaves both collections newest first, ties broken by id, and cuts at limit', () => {
    const polls = [card(1, '2026-10-05T00:00:00.000Z'), card(3, '2026-10-03T00:00:00.000Z'), card(9, '2026-10-01T00:00:00.000Z')];
    const decks = [
      card(4, '2026-10-04T00:00:00.000Z', 'presentation'),
      card(2, '2026-10-03T00:00:00.000Z', 'presentation'),
    ];
    const { items, nextCursor } = mergePages([polls, decks], 3);
    expect(items.map((item) => item.title)).toEqual(['#1', '#4', '#3']);
    expect(decodeCursor(nextCursor!)).toEqual({ updatedAt: new Date('2026-10-03T00:00:00.000Z'), id: oid(3).toString() });
  });

  it('returns no cursor on the last page', () => {
    const { items, nextCursor } = mergePages([[card(1, '2026-10-05T00:00:00.000Z')], []], 3);
    expect(items).toHaveLength(1);
    expect(nextCursor).toBeNull();
  });
});

describe('library filters', () => {
  it('escapes regex metacharacters so search is literal', () => {
    expect(escapeRegex('C++ (beta) [v2]? $5.*')).toBe('C\\+\\+ \\(beta\\) \\[v2\\]\\? \\$5\\.\\*');
    const regex = new RegExp((titleFilter('a.b').title as { $regex: string }).$regex, 'i');
    expect(regex.test('A.B quiz')).toBe(true);
    expect(regex.test('axb')).toBe(false);
  });

  it('scopes to the workspace, and to the creator for pre-workspace items in their personal workspace', () => {
    const userId = oid(42).toString();
    const personal = { _id: oid(100), type: 'personal', ownerId: oid(42) };
    expect(scopeFilter({ userId, workspace: personal })).toEqual({
      $or: [{ workspaceId: oid(100) }, { workspaceId: null, creatorId: userId }],
    });
    const team = { _id: oid(101), type: 'team', ownerId: oid(42) };
    expect(scopeFilter({ userId, workspace: team })).toEqual({ $or: [{ workspaceId: oid(101) }] });
    // Someone else's personal workspace never exposes the caller's legacy items.
    expect(scopeFilter({ userId, workspace: { ...personal, ownerId: oid(43) } })).toEqual({ $or: [{ workspaceId: oid(100) }] });
  });

  it('maps folders and statuses to filters', () => {
    expect(folderFilter('root')).toEqual({ folderId: null });
    expect(folderFilter(oid(8).toString())).toEqual({ folderId: oid(8) });
    expect(pollStatusFilter('draft', NOW)).toEqual({ isPublished: { $ne: true } });
    expect(pollStatusFilter('live', NOW)).toEqual({ isPublished: true, isClosed: { $ne: true }, expiresAt: { $gt: NOW } });
    expect(presentationStatusFilter('live')).toEqual({ status: { $in: ['lobby', 'active'] } });
    expect(presentationStatusFilter('ended')).toEqual({ status: 'ended' });
    expect(allOf(null, { a: 1 }, undefined)).toEqual({ a: 1 });
    expect(allOf({ a: 1 }, { b: 2 })).toEqual({ $and: [{ a: 1 }, { b: 2 }] });
    expect(allOf()).toEqual({});
  });
});

describe('cards', () => {
  it('derives the poll status and card', () => {
    const later = new Date(NOW.getTime() + 60_000);
    const earlier = new Date(NOW.getTime() - 60_000);
    expect(pollStatus({ isPublished: false, expiresAt: later }, NOW)).toBe('draft');
    expect(pollStatus({ isPublished: true, isClosed: false, expiresAt: later }, NOW)).toBe('live');
    expect(pollStatus({ isPublished: true, isClosed: true, expiresAt: later }, NOW)).toBe('ended');
    expect(pollStatus({ isPublished: true, isClosed: false, expiresAt: earlier }, NOW)).toBe('ended');

    const poll = toPollCard(
      {
        _id: oid(1),
        title: 'Lunch',
        pollType: 'TRIAL',
        isPublished: true,
        isAnonymous: false,
        expiresAt: later,
        convertedPresentationId: oid(2),
        questions: [{}, {}],
        createdAt: earlier,
        updatedAt: NOW,
      },
      5,
      NOW,
    );
    expect(poll).toEqual({
      entityType: 'poll',
      id: oid(1).toString(),
      title: 'Lunch',
      status: 'live',
      createdAt: earlier.toISOString(),
      updatedAt: NOW.toISOString(),
      stats: { questionCount: 2, responseCount: 5 },
      details: {
        pollType: 'TRIAL',
        isAnonymous: false,
        expiresAt: later.toISOString(),
        isResultsPublished: false,
        convertedPresentationId: oid(2).toString(),
      },
    });
  });

  it('derives the deck card, defaulting fields older decks lack', () => {
    const deck = toPresentationCard({
      _id: oid(3),
      title: 'Kickoff',
      status: 'lobby',
      joinCode: '123456',
      slides: [{ type: 'select_answer' }, { type: 'wordcloud' }, { type: 'select_answer' }],
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(deck.status).toBe('live');
    expect(deck.stats).toEqual({ slideCount: 3 });
    expect(deck.details).toEqual({
      phase: 'lobby',
      joinCode: '123456',
      pace: 'presenter',
      legacySource: null,
      slideTypes: ['select_answer', 'wordcloud'],
    });

    const converted = toPresentationCard({ _id: oid(4), status: 'ended', pace: 'audience', legacy: { source: 'poll' } });
    expect(converted.status).toBe('ended');
    expect(converted.details.pace).toBe('audience');
    expect(converted.details.legacySource).toBe('poll');
  });
});

describe('query schemas', () => {
  it('defaults type and limit and treats empty values as unset', () => {
    expect(libraryQuerySchema.parse({})).toEqual({ type: 'all', limit: 24 });
    expect(libraryQuerySchema.parse({ type: '', q: '', cursor: '', limit: '' })).toEqual({ type: 'all', limit: 24 });
    expect(libraryQuerySchema.parse({ type: 'poll', q: '  Kick ', limit: '5', folderId: 'root', status: 'live' })).toEqual({
      type: 'poll',
      q: 'Kick',
      limit: 5,
      folderId: 'root',
      status: 'live',
    });
  });

  it('rejects unknown types, bad folder ids, repeated values and oversized limits', () => {
    expect(libraryQuerySchema.safeParse({ type: 'quiz' }).success).toBe(false);
    expect(libraryQuerySchema.safeParse({ folderId: 'abc' }).success).toBe(false);
    expect(libraryQuerySchema.safeParse({ type: ['poll', 'presentation'] }).success).toBe(false);
    expect(libraryQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
    expect(libraryQuerySchema.safeParse({ q: 'x'.repeat(101) }).success).toBe(false);
  });

  it('reads force as a boolean flag', () => {
    expect(convertQuerySchema.parse({})).toEqual({ force: false });
    expect(convertQuerySchema.parse({ force: 'true' })).toEqual({ force: true });
    expect(convertQuerySchema.parse({ force: '1' })).toEqual({ force: true });
    expect(convertQuerySchema.parse({ force: 'false' })).toEqual({ force: false });
    expect(convertQuerySchema.safeParse({ force: 'yes' }).success).toBe(false);
  });
});
