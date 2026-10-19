import { describe, expect, it } from 'bun:test';
import {
  askQuestionSchema,
  hostHighlightSchema,
  hostListStatusSchema,
  hostUpdateQuestionSchema,
} from '../src/modules/qna/qna.schema';
import { QNA_TEXT_MAX } from '../src/modules/qna/qna.contract';

describe('askQuestionSchema', () => {
  it('trims and collapses whitespace, anonymous defaults to false', () => {
    expect(askQuestionSchema.parse({ text: '  Why   is\n the sky\tblue?  ' })).toEqual({
      text: 'Why is the sky blue?',
      anonymous: false,
    });
  });

  it('rejects empty, whitespace-only and over-long text', () => {
    expect(askQuestionSchema.safeParse({ text: '' }).success).toBe(false);
    expect(askQuestionSchema.safeParse({ text: '   \n ' }).success).toBe(false);
    expect(askQuestionSchema.safeParse({ text: 'x'.repeat(QNA_TEXT_MAX) }).success).toBe(true);
    expect(askQuestionSchema.safeParse({ text: 'x'.repeat(QNA_TEXT_MAX + 1) }).success).toBe(false);
  });

  it('is strict: the author can never come from the body', () => {
    for (const extra of [{ participantId: 'abc' }, { authorName: 'Ada' }, { status: 'visible' }, { sessionId: 'x' }]) {
      expect(askQuestionSchema.safeParse({ text: 'Hi', ...extra }).success).toBe(false);
    }
  });

  it('requires a boolean for anonymous', () => {
    expect(askQuestionSchema.safeParse({ text: 'Hi', anonymous: 'yes' }).success).toBe(false);
    expect(askQuestionSchema.parse({ text: 'Hi', anonymous: true }).anonymous).toBe(true);
  });
});

describe('hostUpdateQuestionSchema', () => {
  it('accepts a status, a pin, or both', () => {
    expect(hostUpdateQuestionSchema.parse({ status: 'answered' })).toEqual({ status: 'answered' });
    expect(hostUpdateQuestionSchema.parse({ pinned: false })).toEqual({ pinned: false });
    expect(hostUpdateQuestionSchema.parse({ status: 'visible', pinned: true })).toEqual({ status: 'visible', pinned: true });
  });

  it('refuses an empty patch, `pending` and unknown fields', () => {
    expect(hostUpdateQuestionSchema.safeParse({}).success).toBe(false);
    expect(hostUpdateQuestionSchema.safeParse({ status: 'pending' }).success).toBe(false);
    expect(hostUpdateQuestionSchema.safeParse({ status: 'nope' }).success).toBe(false);
    expect(hostUpdateQuestionSchema.safeParse({ pinned: true, text: 'edit' }).success).toBe(false);
  });
});

describe('hostHighlightSchema', () => {
  it('defaults to highlighting, also without a body', () => {
    expect(hostHighlightSchema.parse(undefined)).toEqual({ highlighted: true });
    expect(hostHighlightSchema.parse({})).toEqual({ highlighted: true });
    expect(hostHighlightSchema.parse({ highlighted: false })).toEqual({ highlighted: false });
  });

  it('rejects other fields', () => {
    expect(hostHighlightSchema.safeParse({ highlighted: true, extra: 1 }).success).toBe(false);
  });
});

describe('hostListStatusSchema', () => {
  it('takes one status or `all`, defaulting to all', () => {
    expect(hostListStatusSchema.parse(undefined)).toBe('all');
    for (const status of ['pending', 'visible', 'answered', 'archived', 'rejected', 'all'] as const) {
      expect(hostListStatusSchema.parse(status)).toBe(status);
    }
    expect(hostListStatusSchema.safeParse('bogus').success).toBe(false);
    expect(hostListStatusSchema.safeParse(['pending', 'visible']).success).toBe(false);
  });
});
