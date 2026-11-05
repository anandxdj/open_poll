import { hasSlideType } from '../../presentations/slides';
import type { GeneratedSlide } from './deck.schema';
import { DECK_SLIDE_MAPPERS, NOTES_MAX, cleanList, cleanText, type DeckSlideMapper } from './slideMappers';

/**
 * Deck kinds that only agents author (MCP `create_deck` and friends). The
 * in-app AI keeps offering `DECK_SLIDE_MAPPERS` alone (`availableKinds`), so
 * its prompts and outlines do not change; an agent gets those kinds plus the
 * registry types below, which need fields an LLM batch does not fill (image
 * addresses, axes, correct areas).
 *
 * Same contract as `slideMappers.ts`: `map` builds a request-shaped slide and
 * `toRegistrySlide` validates it with the registry type's own schema.
 */

/** A slide as an agent writes it: the AI fields plus the ones the kinds below read. */
export type AuthoredSlide = GeneratedSlide & {
  imageUrl?: string;
  alt?: string;
  caption?: string;
  fit?: 'contain' | 'cover';
  videoUrl?: string;
  start?: number;
  showQr?: boolean;
  showCode?: boolean;
  min?: number;
  max?: number;
  step?: number;
  correct?: number | null;
  tolerance?: number;
  xAxis?: { label: string; min?: number; max?: number };
  yAxis?: { label: string; min?: number; max?: number };
  corners?: { topLeft?: string; topRight?: string; bottomLeft?: string; bottomRight?: string };
  correctArea?: { x: number; y: number; width: number; height: number } | null;
};

export type AgentSlideMapper = Omit<DeckSlideMapper, 'map'> & { map(slide: AuthoredSlide): Record<string, unknown> };

const QUIZ_TIME_LIMIT = 30;
const POLL_TIME_LIMIT = 45;
/** Placing items on a board or splitting points takes longer than a tap. */
const BOARD_TIME_LIMIT = 60;

const notesOf = (slide: AuthoredSlide) => cleanText(slide.notes, NOTES_MAX, { multiline: true });

/** YouTube / Vimeo address → the provider and the bare id the video type stores. */
export const parseVideoUrl = (raw: unknown): { provider: 'youtube' | 'vimeo'; id: string } | null => {
  if (typeof raw !== 'string') return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m)\./, '');
  const path = url.pathname.split('/').filter(Boolean);
  if (host === 'youtu.be' && path[0]) return { provider: 'youtube', id: path[0] };
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const id = url.searchParams.get('v') ?? (['embed', 'shorts', 'live'].includes(path[0] ?? '') ? path[1] : undefined);
    return id ? { provider: 'youtube', id } : null;
  }
  if (host === 'vimeo.com' && path[0] && /^\d+$/.test(path[0])) return { provider: 'vimeo', id: path[0] };
  if (host === 'player.vimeo.com' && path[0] === 'video' && path[1]) return { provider: 'vimeo', id: path[1] };
  return null;
};

const axisOf = (axis: AuthoredSlide['xAxis']) => ({
  label: cleanText(axis?.label, 40),
  ...(typeof axis?.min === 'number' ? { min: axis.min } : {}),
  ...(typeof axis?.max === 'number' ? { max: axis.max } : {}),
});

export const AGENT_SLIDE_MAPPERS: readonly AgentSlideMapper[] = [
  {
    kind: 'image',
    type: 'image',
    category: 'content',
    hint: 'One picture. Fields: imageUrl (https), alt (describe it for people who cannot see it), caption, fit.',
    map: (slide) => ({
      type: 'image',
      notes: notesOf(slide),
      content: {
        url: typeof slide.imageUrl === 'string' ? slide.imageUrl.trim() : null,
        alt: cleanText(slide.alt, 500),
        caption: cleanText(slide.caption, 300),
        ...(slide.fit ? { fit: slide.fit } : {}),
      },
    }),
  },
  {
    kind: 'video',
    type: 'video',
    category: 'content',
    hint: 'An embedded YouTube or Vimeo video. Fields: videoUrl, start (seconds, optional).',
    map: (slide) => {
      const video = parseVideoUrl(slide.videoUrl);
      return {
        type: 'video',
        notes: notesOf(slide),
        content: { provider: video?.provider, id: video?.id ?? null, start: slide.start ?? 0 },
      };
    },
  },
  {
    kind: 'instructions',
    type: 'instructions',
    category: 'content',
    hint: 'How to join: the join address, code and QR code on the stage. Fields: text (optional extra line).',
    map: (slide) => ({
      type: 'instructions',
      notes: notesOf(slide),
      content: {
        text: cleanText(slide.text, 300),
        ...(typeof slide.showQr === 'boolean' ? { showQr: slide.showQr } : {}),
        ...(typeof slide.showCode === 'boolean' ? { showCode: slide.showCode } : {}),
      },
    }),
  },
  {
    kind: 'qna',
    type: 'qna',
    category: 'poll',
    hint: 'Audience Q&A board: people ask and upvote questions while it is on screen. Fields: question (optional heading).',
    map: (slide) => ({ type: 'qna', question: cleanText(slide.question, 500), notes: notesOf(slide) }),
  },
  {
    kind: 'hundred_points',
    type: 'hundred_points',
    category: 'poll',
    hint: 'Each person splits 100 points across items to show priorities. Fields: question, items (2 to 10).',
    map: (slide) => ({
      type: 'hundred_points',
      question: cleanText(slide.question, 500),
      notes: notesOf(slide),
      timeLimit: BOARD_TIME_LIMIT,
      config: { items: cleanList(slide.items, 10, 200) },
    }),
  },
  {
    kind: 'grid_2x2',
    type: 'grid_2x2',
    category: 'poll',
    hint:
      'Each person places items on a 2x2 board (e.g. effort vs impact). Fields: question, items (1 to 10), xAxis and ' +
      'yAxis ({label, min, max}), corners (optional names, e.g. "Quick wins").',
    map: (slide) => ({
      type: 'grid_2x2',
      question: cleanText(slide.question, 500),
      notes: notesOf(slide),
      timeLimit: BOARD_TIME_LIMIT,
      config: {
        items: cleanList(slide.items, 10, 200),
        x: axisOf(slide.xAxis),
        y: axisOf(slide.yAxis),
        quadrants: {
          topLeft: cleanText(slide.corners?.topLeft, 40),
          topRight: cleanText(slide.corners?.topRight, 40),
          bottomLeft: cleanText(slide.corners?.bottomLeft, 40),
          bottomRight: cleanText(slide.corners?.bottomRight, 40),
        },
      },
    }),
  },
  {
    kind: 'guess_number',
    type: 'guess_number',
    category: 'quiz',
    hint:
      'People guess a number on a slider. Fields: question, min, max, step, correct (scores the closest guesses; ' +
      'omit for an estimate with no right answer), tolerance.',
    map: (slide) => {
      const graded = typeof slide.correct === 'number';
      return {
        type: 'guess_number',
        question: cleanText(slide.question, 500),
        notes: notesOf(slide),
        timeLimit: QUIZ_TIME_LIMIT,
        points: graded ? 1000 : 0,
        scoreDependsOnTime: graded,
        config: {
          min: slide.min,
          max: slide.max,
          step: slide.step,
          correct: graded ? slide.correct : null,
          tolerance: slide.tolerance ?? 0,
        },
      };
    },
  },
  {
    kind: 'pin_on_image',
    type: 'pin_on_image',
    category: 'quiz',
    hint:
      'People drop a pin on a picture. Fields: question, imageUrl (https), alt, correctArea ({x, y, width, height} as ' +
      'shares of the image from the top-left, scores pins inside it; omit for a heatmap with no right answer).',
    map: (slide) => {
      const graded = Boolean(slide.correctArea);
      return {
        type: 'pin_on_image',
        question: cleanText(slide.question, 500),
        notes: notesOf(slide),
        timeLimit: QUIZ_TIME_LIMIT,
        points: graded ? 1000 : 0,
        scoreDependsOnTime: graded,
        content: { url: typeof slide.imageUrl === 'string' ? slide.imageUrl.trim() : null, alt: cleanText(slide.alt, 500) },
        config: { region: slide.correctArea ?? null },
      };
    },
  },
  {
    kind: 'leaderboard',
    type: 'leaderboard',
    category: 'quiz',
    hint: 'Standings of the scored questions so far. Put one after a run of quiz slides. Fields: title (optional).',
    map: (slide) => ({
      type: 'leaderboard',
      question: cleanText(slide.title, 500) || 'Leaderboard',
      notes: notesOf(slide),
      timeLimit: 0,
    }),
  },
];

/** Every kind an agent may author whose registry type is registered right now. */
export const agentKinds = (registered: (type: string) => boolean = hasSlideType): AgentSlideMapper[] =>
  [...DECK_SLIDE_MAPPERS, ...AGENT_SLIDE_MAPPERS].filter((mapper) => registered(mapper.type));

export const findAgentMapper = (kind: string): AgentSlideMapper | undefined =>
  agentKinds().find((mapper) => mapper.kind === kind);
