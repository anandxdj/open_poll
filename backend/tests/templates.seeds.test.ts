import { describe, expect, it } from 'bun:test';
import { createPresentationSchema } from '../src/modules/presentations/presentations.schema';
import { findSeedTemplate, SEED_CATEGORIES, SEED_TEMPLATES } from '../src/modules/templates/seeds';
import { patchSlideSchema, reorderSlidesSchema, updatePresentationSchema } from '../src/modules/presentations/presentations.schema';
import { parseIfMatch } from '../src/modules/presentations/revision';
import { moveItemsSchema, createFolderSchema } from '../src/modules/folders/folders.schema';

/**
 * The starter templates (W3-B2) are create requests written in code: every one
 * must pass the same validation a user's deck does, or "Use template" would
 * fail for everyone after a deploy.
 */
describe('starter templates', () => {
  it('has the four starter decks with unique slug ids', () => {
    expect(SEED_TEMPLATES.map((seed) => seed.id)).toEqual(['team-retro', 'conference-talk', 'classroom-quiz', 'all-hands-pulse']);
    for (const seed of SEED_TEMPLATES) {
      expect(seed.id).toMatch(/^[a-z][a-z-]+$/);
      expect(SEED_CATEGORIES).toContain(seed.category);
      expect(seed.description.length).toBeGreaterThan(40);
      expect(findSeedTemplate(seed.id)).toBe(seed);
    }
    expect(findSeedTemplate('nope')).toBeNull();
  });

  for (const seed of SEED_TEMPLATES) {
    it(`"${seed.title}" is a valid deck`, () => {
      const result = createPresentationSchema.safeParse(seed.deck);
      if (!result.success) throw new Error(result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
      expect(result.data.slides.length).toBeGreaterThanOrEqual(6);
      expect(result.data.title.length).toBeGreaterThan(0);
    });
  }

  it('makes the classroom quiz a scored quiz and the others polls', () => {
    const quiz = createPresentationSchema.parse(findSeedTemplate('classroom-quiz')!.deck);
    const scored = quiz.slides.filter((slide) => (slide as { points?: number }).points! > 0);
    expect(scored.length).toBeGreaterThanOrEqual(5);
    const retro = createPresentationSchema.parse(findSeedTemplate('team-retro')!.deck);
    const retroPolls = retro.slides.filter((slide) => slide.type === 'select_answer');
    expect(retroPolls.length).toBeGreaterThan(0);
    expect(retroPolls.every((slide) => (slide as { points?: number }).points === 0)).toBe(true);
  });
});

describe('co-editing request parsing', () => {
  it('reads If-Match revisions', () => {
    expect(parseIfMatch(undefined)).toBeUndefined();
    expect(parseIfMatch('')).toBeUndefined();
    expect(parseIfMatch('*')).toBeUndefined();
    expect(parseIfMatch('"7"')).toBe(7);
    expect(parseIfMatch('7')).toBe(7);
    expect(parseIfMatch('W/"12"')).toBe(12);
    expect(() => parseIfMatch('"abc"')).toThrow();
    expect(() => parseIfMatch('1.5')).toThrow();
  });

  it('keeps a valid slide id in updates only', () => {
    const id = 'a'.repeat(24);
    const parsed = updatePresentationSchema.parse({
      slides: [
        { _id: id, type: 'heading', content: { title: 'Hi' } },
        { _id: 'not-an-id', type: 'heading', content: { title: 'There' } },
      ],
    });
    expect((parsed.slides![0] as { _id?: string })._id).toBe(id);
    expect((parsed.slides![1] as { _id?: string })._id).toBeUndefined();
    expect(createPresentationSchema.parse({ title: 't', slides: [{ _id: id, type: 'heading', content: { title: 'Hi' } }] }).slides[0]).not.toHaveProperty('_id');
  });

  it('validates slide patches and reorders', () => {
    expect(patchSlideSchema.parse({ question: 'New', _id: 'x', kind: 'content' })).toEqual({ question: 'New' });
    expect(patchSlideSchema.safeParse({}).success).toBe(false);
    const a = 'a'.repeat(24);
    const b = 'B'.repeat(24);
    expect(reorderSlidesSchema.parse({ order: [a, b] })).toEqual({ order: [a, b.toLowerCase()] });
    expect(reorderSlidesSchema.safeParse({ order: [a, a] }).success).toBe(false);
    expect(reorderSlidesSchema.safeParse({ order: [] }).success).toBe(false);
  });
});

describe('folder request schemas', () => {
  it('trims names and limits their length', () => {
    expect(createFolderSchema.parse({ name: '  Q3 planning ' })).toEqual({ name: 'Q3 planning' });
    expect(createFolderSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(createFolderSchema.safeParse({ name: 'x'.repeat(61) }).success).toBe(false);
    expect(createFolderSchema.safeParse({ name: 'ok', workspaceId: 'x' }).success).toBe(false);
  });

  it('accepts a folder or the top level and up to 100 items', () => {
    const id = 'c'.repeat(24);
    expect(moveItemsSchema.parse({ folderId: null, items: [{ entityType: 'poll', id }] }).folderId).toBeNull();
    expect(moveItemsSchema.safeParse({ folderId: id, items: [] }).success).toBe(false);
    expect(moveItemsSchema.safeParse({ folderId: id, items: [{ entityType: 'quiz', id }] }).success).toBe(false);
    expect(moveItemsSchema.safeParse({ folderId: id, items: Array.from({ length: 101 }, () => ({ entityType: 'poll', id })) }).success).toBe(false);
  });
});
