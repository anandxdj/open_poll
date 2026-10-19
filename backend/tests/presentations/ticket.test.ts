import { describe, expect, it } from 'bun:test';
import { scopedHmac, signId } from '../../src/common/utils/signedId.utils';
import { issueSlideTicket, verifySlideTicket } from '../../src/modules/presentations/live/ticket';

const SID = '6a1d58203572176b307a39bc';
const SLIDE = '6a1d58203572176b307a39bd';
const STARTED = 1_790_000_000_000;

describe('slide tickets', () => {
  it('is st1. plus 32 hex characters, stable for one window', () => {
    const ticket = issueSlideTicket(SID, SLIDE, STARTED);
    expect(ticket).toMatch(/^st1\.[a-f0-9]{32}$/);
    expect(issueSlideTicket(SID, SLIDE, STARTED)).toBe(ticket);
  });

  it('verifies only for the exact session, slide and run it was issued for', () => {
    const ticket = issueSlideTicket(SID, SLIDE, STARTED);
    expect(verifySlideTicket(ticket, SID, SLIDE, STARTED)).toBe(true);
    expect(verifySlideTicket(ticket, '6a1d58203572176b307a39be', SLIDE, STARTED)).toBe(false);
    expect(verifySlideTicket(ticket, SID, '6a1d58203572176b307a39be', STARTED)).toBe(false);
    expect(verifySlideTicket(ticket, SID, SLIDE, STARTED + 1)).toBe(false);
  });

  it('rejects anything that is not a well-formed ticket without throwing', () => {
    const ticket = issueSlideTicket(SID, SLIDE, STARTED);
    const bad: unknown[] = [
      undefined,
      null,
      42,
      {},
      '',
      'st1.',
      ticket.slice(0, -1),
      `${ticket}0`,
      ticket.replace('st1.', 'st2.'),
      ticket.toUpperCase(),
      `st1.${'z'.repeat(32)}`,
      ` ${ticket}`,
    ];
    for (const value of bad) expect(verifySlideTicket(value, SID, SLIDE, STARTED)).toBe(false);
  });

  it('is scoped: a signature minted for another purpose never works as a ticket', () => {
    const body = `${SID}|${SLIDE}|${STARTED}`;
    // The same HMAC input under no scope, another scope, or as a signed id.
    expect(verifySlideTicket(`st1.${scopedHmac('other.v1', body).slice(0, 32)}`, SID, SLIDE, STARTED)).toBe(false);
    expect(verifySlideTicket(`st1.${signId(body).slice(-32)}`, SID, SLIDE, STARTED)).toBe(false);
    expect(scopedHmac('slide-ticket.v1', body)).not.toBe(scopedHmac('slide-ticket.v2', body));
  });
});
