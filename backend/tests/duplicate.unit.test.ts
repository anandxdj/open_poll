import { describe, expect, it } from 'bun:test';
import { copyTitle } from '../src/common/utils/copyTitle';
import { duplicateExpiresAt } from '../src/modules/polls/polls.service';

/** The pure parts of "Duplicate" (decks and polls); the endpoints are in tests/integration/duplicate.test.ts. */

describe('copyTitle', () => {
  it('prefixes "Copy of", and copies of copies stack', () => {
    expect(copyTitle('Team retro')).toBe('Copy of Team retro');
    expect(copyTitle(copyTitle('Team retro'))).toBe('Copy of Copy of Team retro');
    expect(copyTitle('  padded  ')).toBe('Copy of padded');
  });

  it('cuts to the limit without trailing spaces or half an emoji', () => {
    const long = 'x'.repeat(130);
    expect(copyTitle(long, 120)).toHaveLength(120);
    expect(copyTitle(`${'a'.repeat(103)} ${'b'.repeat(20)}`, 112)).toBe(`Copy of ${'a'.repeat(103)}`);
    // "Copy of " is 8 units; the emoji (2 units) would straddle unit 120.
    const emoji = copyTitle(`${'y'.repeat(111)}😀tail`, 120);
    expect(emoji).toBe(`Copy of ${'y'.repeat(111)}`);
    expect(emoji.length).toBeLessThanOrEqual(120);
  });
});

describe('duplicateExpiresAt', () => {
  const now = new Date('2026-11-01T12:00:00.000Z');
  const DAY = 24 * 60 * 60 * 1000;

  it('keeps an expiry that is still at least a day away', () => {
    const later = new Date(now.getTime() + 3 * DAY);
    expect(duplicateExpiresAt(later, now).toISOString()).toBe(later.toISOString());
    expect(duplicateExpiresAt(new Date(now.getTime() + DAY), now).getTime()).toBe(now.getTime() + DAY);
  });

  it('gives an expired, closing or missing expiry a week from now', () => {
    const week = now.getTime() + 7 * DAY;
    expect(duplicateExpiresAt(new Date(now.getTime() - DAY), now).getTime()).toBe(week);
    expect(duplicateExpiresAt(new Date(now.getTime() + DAY - 1), now).getTime()).toBe(week);
    expect(duplicateExpiresAt(null, now).getTime()).toBe(week);
  });
});
