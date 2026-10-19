import { describe, expect, it } from 'bun:test';
import mongoose from 'mongoose';
import { ApiError } from '../src/common/utils/ApiError';
import { isShareActive, newShareToken, shareView } from '../src/modules/sessions/share.service';
import { decodeCursor, encodeCursor, secretsMatch } from '../src/modules/sessions/sessions.service';
import { listSessionsQuerySchema, shareSchema, takeHomeQuerySchema } from '../src/modules/sessions/sessions.schema';
import type { ISessionShare } from '../src/modules/presentations/models/session.model';

/** Share links, cursors, secret comparison and request schemas: no database needed. */

const share = (overrides: Partial<ISessionShare> = {}): ISessionShare => ({
  token: 'abcdefghijklmnopqrstuv',
  enabled: true,
  includeNames: false,
  createdAt: new Date('2026-03-02T09:00:00Z'),
  expiresAt: null,
  ...overrides,
});

describe('share tokens', () => {
  it('are URL-safe and carry at least 128 random bits', () => {
    const token = newShareToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    // base64url: 6 bits per character.
    expect(token.length * 6).toBeGreaterThanOrEqual(128);
    expect(new Set(Array.from({ length: 500 }, newShareToken)).size).toBe(500);
  });

  it('are active only while enabled and not expired', () => {
    const now = Date.parse('2026-03-02T12:00:00Z');
    expect(isShareActive(share(), now)).toBe(true);
    expect(isShareActive(share({ enabled: false }), now)).toBe(false);
    expect(isShareActive(share({ expiresAt: new Date(now + 1000) }), now)).toBe(true);
    expect(isShareActive(share({ expiresAt: new Date(now) }), now)).toBe(false);
    expect(isShareActive(share({ expiresAt: new Date(now - 1) }), now)).toBe(false);
    expect(isShareActive(share({ token: '' }), now)).toBe(false);
    expect(isShareActive(null, now)).toBe(false);
    expect(isShareActive(undefined, now)).toBe(false);
  });

  it('show the token only to members allowed to share', () => {
    const owner = shareView(share({ includeNames: true }), true);
    expect(owner).toMatchObject({ token: 'abcdefghijklmnopqrstuv', enabled: true, includeNames: true, active: true });
    expect(shareView(share(), false)).toMatchObject({ token: null, active: true });
    expect(shareView(null, true)).toBeNull();
    expect(shareView({ ...share(), token: '' }, true)).toBeNull();
  });

  it('serialize dates as ISO strings', () => {
    const view = shareView(share({ expiresAt: new Date('2027-01-01T00:00:00Z') }), true)!;
    expect(view.createdAt).toBe('2026-03-02T09:00:00.000Z');
    expect(view.expiresAt).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('secretsMatch', () => {
  it('accepts only the exact secret', () => {
    expect(secretsMatch('s3cret-token-value', 's3cret-token-value')).toBe(true);
    expect(secretsMatch('s3cret-token-value', 's3cret-token-valuE')).toBe(false);
    expect(secretsMatch('s3cret-token-value', 's3cret')).toBe(false);
    expect(secretsMatch('s3cret', 's3cret-token-value')).toBe(false);
    expect(secretsMatch('s3cret', '')).toBe(false);
  });
});

describe('list cursors', () => {
  it('round-trip a session position', () => {
    const session = { startedAt: new Date('2026-03-02T09:00:00.123Z'), _id: new mongoose.Types.ObjectId() };
    const decoded = decodeCursor(encodeCursor(session));
    expect(decoded.startedAt.toISOString()).toBe('2026-03-02T09:00:00.123Z');
    expect(String(decoded.id)).toBe(String(session._id));
  });

  it.each([
    ['not base64 json', '!!!'],
    ['empty object', Buffer.from('{}').toString('base64url')],
    ['bad date', Buffer.from(JSON.stringify({ s: 'nope', i: String(new mongoose.Types.ObjectId()) })).toString('base64url')],
    ['bad id', Buffer.from(JSON.stringify({ s: new Date().toISOString(), i: 'zz' })).toString('base64url')],
    ['an operator injection', Buffer.from(JSON.stringify({ s: { $gt: '' }, i: { $ne: 1 } })).toString('base64url')],
  ])('reject %s with 400', (_label, cursor) => {
    try {
      decodeCursor(cursor);
      throw new Error('expected a 400');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).statusCode).toBe(400);
    }
  });
});

describe('request schemas', () => {
  const id = String(new mongoose.Types.ObjectId());

  it('list: needs a deck id, caps the page size and defaults it', () => {
    expect(listSessionsQuerySchema.parse({ presentationId: id })).toEqual({ presentationId: id, limit: 20 });
    expect(listSessionsQuerySchema.parse({ presentationId: id, limit: '50' }).limit).toBe(50);
    expect(listSessionsQuerySchema.safeParse({}).success).toBe(false);
    expect(listSessionsQuerySchema.safeParse({ presentationId: 'x' }).success).toBe(false);
    expect(listSessionsQuerySchema.safeParse({ presentationId: id, limit: '0' }).success).toBe(false);
    expect(listSessionsQuerySchema.safeParse({ presentationId: id, limit: '101' }).success).toBe(false);
    // Objects in the query string ("?presentationId[$ne]=1") are not ids.
    expect(listSessionsQuerySchema.safeParse({ presentationId: { $ne: id } }).success).toBe(false);
  });

  it('share: strict options, ISO expiry or null', () => {
    expect(shareSchema.parse({})).toEqual({});
    expect(shareSchema.parse({ includeNames: true, rotate: true, expiresAt: '2030-01-01T00:00:00Z' })).toBeDefined();
    expect(shareSchema.parse({ expiresAt: null }).expiresAt).toBeNull();
    expect(shareSchema.safeParse({ expiresAt: 'tomorrow' }).success).toBe(false);
    expect(shareSchema.safeParse({ token: 'mine' }).success).toBe(false);
    expect(shareSchema.safeParse({ includeNames: 'yes' }).success).toBe(false);
  });

  it('take-home: both a participant id and a token', () => {
    expect(takeHomeQuerySchema.safeParse({ participantId: id, token: 't'.repeat(40) }).success).toBe(true);
    expect(takeHomeQuerySchema.safeParse({ participantId: id }).success).toBe(false);
    expect(takeHomeQuerySchema.safeParse({ token: 'x' }).success).toBe(false);
    expect(takeHomeQuerySchema.safeParse({ participantId: id, token: ['a', 'b'] }).success).toBe(false);
    expect(takeHomeQuerySchema.safeParse({ participantId: id, token: 'x'.repeat(201) }).success).toBe(false);
  });
});
