import { describe, expect, it } from 'bun:test';
import { LIVE_EVENTS, SOCKET_EVENTS } from '../src/common/realtime/events';
import { resolveAudience } from '../src/common/realtime/publish';
import {
  getSlideType,
  isSlideScored,
  requireSlideType,
  toParticipantSlide,
  type Slide,
} from '../src/modules/presentations/slides';
import { presentationSlideSchema } from '../src/modules/presentations/presentations.schema';

describe('Q&A and reaction live events', () => {
  it('declares the qna:* types with their default audiences', () => {
    expect(LIVE_EVENTS['qna:question']).toEqual({ audience: 'host' });
    expect(LIVE_EVENTS['qna:updated']).toEqual({ audience: 'all' });
    expect(LIVE_EVENTS['qna:votes']).toEqual({ audience: 'all' });
    expect(LIVE_EVENTS['qna:highlight']).toEqual({ audience: 'all' });
  });

  it('sends reaction bursts to the host room only', () => {
    expect(LIVE_EVENTS['reaction:burst']).toEqual({ audience: 'host' });
    // Not `hostOnly`-forced, but never defaulted to participants either.
    expect(resolveAudience('reaction:burst')).toBe('host');
  });

  it('a pending question defaults to the host, a visible one is published to everyone', () => {
    expect(resolveAudience('qna:question')).toBe('host');
    expect(resolveAudience('qna:question', 'all')).toBe('all');
    expect(resolveAudience('qna:updated', 'participant:64b7f0c2a1b2c3d4e5f6071a')).toBe('participant:64b7f0c2a1b2c3d4e5f6071a');
  });

  it('names the client event reaction:send', () => {
    expect(SOCKET_EVENTS.reactionSend).toBe('reaction:send');
  });
});

describe('qna slide type', () => {
  const parse = (slide: Record<string, unknown>) => presentationSlideSchema.safeParse({ type: 'qna', ...slide });

  it('is a registered interactive board slide that is never scored', () => {
    const def = requireSlideType('qna');
    expect(def).toMatchObject({ type: 'qna', kind: 'interactive', lifecycle: 'board', scored: false });
    expect(getSlideType('qna')).toBe(def);
    expect(isSlideScored({ type: 'qna' } as Slide)).toBe(false);
  });

  it('needs no question and defaults to an untimed, unscored slide', () => {
    const result = parse({});
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ type: 'qna', question: '', timeLimit: 0, points: 0, scoreDependsOnTime: false });
  });

  it('forces timeLimit, points and speed scoring off whatever the client sends', () => {
    const result = parse({ question: ' Ask us anything ', timeLimit: 90, points: 5000, scoreDependsOnTime: true });
    expect(result.data).toMatchObject({ question: 'Ask us anything', timeLimit: 0, points: 0, scoreDependsOnTime: false });
  });

  it('caps the heading at 500 characters', () => {
    expect(parse({ question: 'x'.repeat(500) }).success).toBe(true);
    expect(parse({ question: 'x'.repeat(501) }).success).toBe(false);
  });

  it('sanitizes to the participant allow-list: notes never leak', () => {
    const parsed = parse({ question: 'Questions?', notes: 'secret speaker notes' }).data as Slide;
    const view = toParticipantSlide(parsed, 2, 5);
    expect(view).toMatchObject({ type: 'qna', kind: 'interactive', question: 'Questions?', slideIndex: 2, totalSlides: 5, scored: false });
    expect(JSON.stringify(view)).not.toContain('secret speaker notes');
  });
});
