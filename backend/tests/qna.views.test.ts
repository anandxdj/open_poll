import { describe, expect, it } from 'bun:test';
import mongoose from 'mongoose';
import { DEFAULT_REACTION_EMOJIS } from '../src/modules/presentations/models/presentation.model';
import {
  qnaSettingsOf,
  reactionSettingsOf,
  settingsView,
  toQuestionView,
} from '../src/modules/qna/qna.service';

const oid = () => new mongoose.Types.ObjectId();

const question = (overrides: Record<string, unknown> = {}) => ({
  _id: oid(),
  presentationId: oid(),
  sessionId: oid(),
  slideId: null,
  participantId: oid(),
  text: 'How does it scale?',
  authorName: 'Ada',
  anonymous: false,
  status: 'visible' as const,
  pinned: false,
  upvoteCount: 3,
  createdAt: new Date('2026-03-02T09:00:00.000Z'),
  answeredAt: null,
  highlightedAt: null,
  ...overrides,
});

describe('toQuestionView', () => {
  it('never carries a participant id, even for named questions', () => {
    const q = question();
    const view = toQuestionView(q as never);
    expect(JSON.stringify(view)).not.toContain(String(q.participantId));
    expect(Object.keys(view).sort()).toEqual(
      ['anonymous', 'answeredAt', 'authorName', 'createdAt', 'id', 'pinned', 'sessionId', 'slideId', 'status', 'text', 'upvoteCount'].sort(),
    );
    expect(view).toMatchObject({ id: String(q._id), authorName: 'Ada', anonymous: false, slideId: null, answeredAt: null });
    expect(view.createdAt).toBe('2026-03-02T09:00:00.000Z');
  });

  it('hides the name of an anonymous question, whatever is stored', () => {
    const view = toQuestionView(question({ anonymous: true, authorName: 'Ada' }) as never);
    expect(view.authorName).toBeNull();
    expect(view.anonymous).toBe(true);
  });

  it('stringifies ids, serializes dates and never reports a negative count', () => {
    const slideId = oid();
    const answeredAt = new Date('2026-03-02T09:05:00.000Z');
    const view = toQuestionView(question({ slideId, answeredAt, upvoteCount: -2, status: 'answered' }) as never);
    expect(view).toMatchObject({ slideId: String(slideId), answeredAt: answeredAt.toISOString(), upvoteCount: 0, status: 'answered' });
  });
});

describe('qnaSettingsOf', () => {
  it('fills the defaults for sessions without settings', () => {
    const defaults = { enabled: false, moderation: false, anonymousAllowed: true, upvotes: true };
    expect(qnaSettingsOf(undefined)).toEqual(defaults);
    expect(qnaSettingsOf(null)).toEqual(defaults);
    expect(qnaSettingsOf({})).toEqual(defaults);
  });

  it('keeps what the deck set', () => {
    expect(
      qnaSettingsOf({ qna: { enabled: true, moderation: true, anonymousAllowed: false, upvotes: false } } as never),
    ).toEqual({ enabled: true, moderation: true, anonymousAllowed: false, upvotes: false });
    expect(qnaSettingsOf({ qna: { enabled: true } } as never)).toMatchObject({ enabled: true, anonymousAllowed: true });
  });
});

describe('reactionSettingsOf', () => {
  it('defaults to off with the default emoji set', () => {
    expect(reactionSettingsOf(undefined)).toEqual({ enabled: false, emojis: DEFAULT_REACTION_EMOJIS });
  });

  it('keeps at most six emojis and drops blanks and non-strings', () => {
    const settings = { reactions: { enabled: true, emojis: ['1', '2', '', 3, '3', '4', '5', '6', '7'] } } as never;
    expect(reactionSettingsOf(settings)).toEqual({ enabled: true, emojis: ['1', '2', '3', '4', '5', '6'] });
  });

  it('honors an explicitly empty list', () => {
    expect(reactionSettingsOf({ reactions: { enabled: true, emojis: [] } } as never).emojis).toEqual([]);
  });
});

describe('settingsView', () => {
  const live = { isLive: true, qnaSlideId: null, hasBoard: false };

  it('is open only while the session is live and Q&A is enabled', () => {
    const on = { qna: { enabled: true } } as never;
    expect(settingsView({ ...live, settings: on })).toMatchObject({ open: true, onBoard: false, hasBoard: false });
    expect(settingsView({ ...live, settings: undefined })).toMatchObject({ open: false });
    expect(settingsView({ ...live, isLive: false, settings: on })).toMatchObject({ open: false });
  });

  it('a Q&A slide on screen opens Q&A even when the deck setting is off', () => {
    const view = settingsView({ isLive: true, qnaSlideId: 'abc', hasBoard: true, settings: undefined });
    expect(view).toMatchObject({ enabled: false, open: true, onBoard: true, hasBoard: true });
  });

  it('an ended session is never open, board or not', () => {
    const view = settingsView({ isLive: false, qnaSlideId: 'abc', hasBoard: true, settings: { qna: { enabled: true } } as never });
    expect(view).toMatchObject({ open: false, onBoard: false, hasBoard: true });
  });
});
