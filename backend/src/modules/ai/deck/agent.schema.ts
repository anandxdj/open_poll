import { z } from 'zod';
import { isHttpsUrl } from '../../presentations/slides/types/content/media';
import { MAX_VIDEO_START } from '../../presentations/slides/types/content/video';
import { findAgentMapper, parseVideoUrl, type AuthoredSlide } from './agentMappers';
import { NOTES_MAX, toRegistrySlide, type MappedSlide } from './slideMappers';
import type { ParsedSlide } from '../../presentations/slides';

/**
 * The slide contract agents author against (MCP deck tools). One variant per
 * deck kind, discriminated by `kind`, each with exactly the fields its mapper
 * reads. Two rules carry the weight:
 *
 * - What a kind needs is `required` in the emitted JSON Schema, so a client
 *   validates it before sending instead of learning it from a rejection.
 * - Lengths equal the caps the mappers cut to (`cleanText`), so agent text is
 *   rejected with a path when too long, never silently shortened.
 *
 * The registry type's own schema still has the last word (`toRegistrySlide`):
 * a slide accepted here is exactly what `POST /api/presentations` stores.
 */

const notes = z
  .string()
  .max(NOTES_MAX)
  .optional()
  .describe('Speaker notes: what the presenter says on this slide. Host only, never shown to the audience.');

const required = (max: number, description: string) => z.string().trim().min(1).max(max).describe(description);
const optional = (max: number, description: string) => z.string().trim().max(max).optional().describe(description);

const question = required(500, 'The question shown on the stage and on phones');

const httpsUrl = (description: string) =>
  z.string().trim().max(2048).refine(isHttpsUrl, 'Use an https:// address').describe(description);

const alt = required(500, 'Describe the image for people who cannot see it');

const textList = (min: number, max: number, description: string) =>
  z.array(z.string().trim().min(1).max(200)).min(min).max(max).describe(description);

/** Unscored audience slides may run without a timer. */
const pollTimer = z
  .number()
  .int()
  .min(0)
  .max(300)
  .refine((value) => value === 0 || value >= 5, 'Use 0 for no timer or at least 5 seconds')
  .optional()
  .describe('Seconds to answer; 0 = no timer, the host closes it (default 45)');

/** Scored slides need a deadline: faster correct answers score more. */
const quizTimer = z
  .number()
  .int()
  .min(5)
  .max(300)
  .optional()
  .describe('Seconds to answer, 5 to 300 (default 30). Faster correct answers score more.');

const points = z
  .number()
  .int()
  .min(0)
  .max(10000)
  .optional()
  .describe('Points for a correct answer (default 1000; 0 = practice question, not scored)');

const axis = (name: string) =>
  z
    .object({
      label: required(40, `${name} axis label, e.g. "Effort"`),
      min: z.number().int().min(-1000).max(1000).optional().describe('Lowest value (default 0)'),
      max: z.number().int().min(-1000).max(1000).optional().describe('Highest value (default 10)'),
    })
    .describe(`${name} axis`);

const region = z
  .object({
    x: z.number().min(0).max(1).describe('Left edge, as a share of the image width (0 = left)'),
    y: z.number().min(0).max(1).describe('Top edge, as a share of the image height (0 = top)'),
    width: z.number().min(0.01).max(1).describe('Width, as a share of the image width'),
    height: z.number().min(0.01).max(1).describe('Height, as a share of the image height'),
  })
  .refine((r) => r.x + r.width <= 1 + 1e-9 && r.y + r.height <= 1 + 1e-9, 'The correct area must lie inside the image');

const uniqueTexts = (texts: string[]) => new Set(texts.map((text) => text.trim().toLowerCase())).size === texts.length;

const kind = <K extends string>(name: K, description: string) => z.literal(name).describe(description);

export const AGENT_SLIDE_VARIANTS = [
  // ---------- Content: shown on the stage, no answers ----------
  z.object({
    kind: kind('heading', 'Title or section divider'),
    title: required(150, 'Heading'),
    subtitle: optional(300, 'Subtitle'),
    notes,
  }),
  z.object({
    kind: kind('paragraph', 'A short explanation'),
    title: optional(150, 'Title'),
    body: required(2000, 'One to three short paragraphs; **bold** and *italic* allowed, links are removed'),
    notes,
  }),
  z.object({
    kind: kind('bullets', 'Key points'),
    title: optional(150, 'Title'),
    items: textList(1, 10, 'The bullets'),
    notes,
  }),
  z.object({
    kind: kind('quote', 'A quotation; only a real one, never invented'),
    text: required(500, 'The quotation'),
    attribution: optional(150, 'Who said it'),
    notes,
  }),
  z.object({
    kind: kind('big_number', 'One striking figure'),
    value: z.number().describe('The number'),
    label: optional(150, 'What the number means'),
    prefix: optional(12, 'Shown before the number, e.g. "$"'),
    suffix: optional(12, 'Shown after the number, e.g. "%"'),
    notes,
  }),
  z.object({
    kind: kind('image', 'One picture'),
    imageUrl: httpsUrl('Public https address of the image'),
    alt,
    caption: optional(300, 'Caption under the image'),
    fit: z.enum(['contain', 'cover']).optional().describe('contain shows all of it (default); cover fills the slide'),
    notes,
  }),
  z.object({
    kind: kind('video', 'An embedded YouTube or Vimeo video'),
    videoUrl: z
      .string()
      .trim()
      .max(2048)
      .refine((url) => parseVideoUrl(url) !== null, 'Use a YouTube or Vimeo video address')
      .describe('YouTube or Vimeo address of the video'),
    start: z.number().int().min(0).max(MAX_VIDEO_START).optional().describe('Seconds into the video to start at'),
    notes,
  }),
  z.object({
    kind: kind('instructions', 'How to join: join address, code and QR code on the stage'),
    text: optional(300, 'Extra line under the join details'),
    showQr: z.boolean().optional().describe('Show the QR code (default true)'),
    showCode: z.boolean().optional().describe('Show the join address and code (default true)'),
    notes,
  }),

  // ---------- Scored quiz ----------
  z.object({
    kind: kind('multiple_choice_quiz', 'Quiz question with right answers; scored'),
    question,
    options: z
      .array(
        z.object({
          text: required(200, 'Choice text'),
          isCorrect: z.boolean().describe('true for a right answer'),
        }),
      )
      .min(2)
      .max(6)
      .refine((options) => options.some((option) => option.isCorrect), 'Mark at least one option isCorrect: true')
      .refine((options) => uniqueTexts(options.map((option) => option.text)), 'Options must differ from each other')
      .describe('2 to 6 choices; several may be correct'),
    explanation: optional(2000, 'Why the answer is right, shown after the reveal'),
    timeLimit: quizTimer,
    points,
    notes,
  }),
  z.object({
    kind: kind('type_answer', 'Quiz question answered by typing a short word or number; scored'),
    question,
    acceptedAnswers: textList(1, 10, 'Accepted spellings, each one to three words'),
    timeLimit: quizTimer,
    points,
    notes,
  }),
  z.object({
    kind: kind('guess_number', 'Guess a number on a slider; closest guesses score when correct is set'),
    question,
    min: z.number().describe('Slider minimum'),
    max: z.number().describe('Slider maximum'),
    step: z.number().positive().optional().describe('Slider step (default 1)'),
    correct: z.number().optional().describe('The right number, on a slider step; omit for an estimate with no right answer'),
    tolerance: z.number().min(0).optional().describe('Guesses this close to correct count as right (default 0)'),
    timeLimit: quizTimer,
    points,
    notes,
  }),
  z.object({
    kind: kind('pin_on_image', 'Drop a pin on a picture; pins inside correctArea score'),
    question,
    imageUrl: httpsUrl('Public https address of the image'),
    alt,
    correctArea: region.optional().describe('The right area; omit for a heatmap with no right answer'),
    timeLimit: quizTimer,
    points,
    notes,
  }),
  z.object({
    kind: kind('leaderboard', 'Standings of the scored questions so far; place after a run of quiz slides'),
    title: optional(120, 'Heading (default "Leaderboard")'),
    notes,
  }),

  // ---------- Audience input, unscored ----------
  z.object({
    kind: kind('multiple_choice_poll', 'Opinion poll, no right answer'),
    question,
    options: z
      .array(z.string().trim().min(1).max(200))
      .min(2)
      .max(6)
      .refine(uniqueTexts, 'Options must differ from each other')
      .describe('2 to 6 choices'),
    timeLimit: pollTimer,
    notes,
  }),
  z.object({
    kind: kind('wordcloud', 'People answer with a word or two, shown as a word cloud'),
    question,
    maxEntries: z.number().int().min(1).max(3).optional().describe('Words each person may send (default 3)'),
    timeLimit: pollTimer,
    notes,
  }),
  z.object({
    kind: kind('open_ended', 'People write a free-text answer'),
    question,
    timeLimit: pollTimer,
    notes,
  }),
  z.object({
    kind: kind('scales', 'People rate statements on a scale'),
    question,
    statements: textList(1, 10, 'Statements to rate'),
    minLabel: optional(40, 'Label of the lowest rating, e.g. "Disagree"'),
    maxLabel: optional(40, 'Label of the highest rating, e.g. "Agree"'),
    scaleMax: z.number().int().min(2).max(10).optional().describe('Highest rating (default 5)'),
    timeLimit: pollTimer,
    notes,
  }),
  z.object({
    kind: kind('ranking', 'People order items by priority'),
    question,
    items: textList(2, 10, 'Items to order'),
    timeLimit: pollTimer,
    notes,
  }),
  z.object({
    kind: kind('hundred_points', 'Each person splits 100 points across items'),
    question,
    items: textList(2, 10, 'Items to split points across'),
    timeLimit: pollTimer,
    notes,
  }),
  z.object({
    kind: kind('grid_2x2', 'Each person places items on a 2x2 board, e.g. effort vs impact'),
    question,
    items: textList(1, 10, 'Items to place'),
    xAxis: axis('Horizontal'),
    yAxis: axis('Vertical'),
    corners: z
      .object({
        topLeft: optional(40, 'Top-left corner name'),
        topRight: optional(40, 'Top-right corner name'),
        bottomLeft: optional(40, 'Bottom-left corner name'),
        bottomRight: optional(40, 'Bottom-right corner name'),
      })
      .optional()
      .describe('Optional corner names, e.g. topRight "Quick wins"'),
    timeLimit: pollTimer,
    notes,
  }),
  z.object({
    kind: kind('qna', 'Audience Q&A board: people ask and upvote questions while it is on screen'),
    question: optional(500, 'Heading of the board'),
    notes,
  }),
] as const;

export const agentSlideSchema = z.discriminatedUnion('kind', AGENT_SLIDE_VARIANTS);

export type AgentSlide = z.infer<typeof agentSlideSchema>;
export type AgentSlideKind = AgentSlide['kind'];

export const AGENT_SLIDE_KINDS = AGENT_SLIDE_VARIANTS.map((variant) => variant.shape.kind.value) as [
  AgentSlideKind,
  ...AgentSlideKind[],
];

/**
 * The advertised shape of a slide in tools that come after create_deck
 * (add_slides, update_slide): the kind plus open fields. The full union is
 * about 17k characters of JSON Schema; listing it once, in create_deck, keeps
 * an agent's tool context small. Handlers still parse with
 * `agentSlideSchema`, so nothing is accepted that create_deck would refuse.
 */
export const agentSlideRefSchema = z
  .object({ kind: z.enum(AGENT_SLIDE_KINDS).describe('Slide kind') })
  .loose()
  .describe('A slide in the create_deck format: "kind" plus that kind\'s fields (list_slide_types has each kind with an example)');

/** Agent fields that replace the mapper's per-kind defaults. */
const OVERRIDES = ['timeLimit', 'points', 'maxEntries', 'scaleMax'] as const;

const toAuthoredSlide = (slide: AgentSlide): AuthoredSlide => {
  const { kind: _kind, ...fields } = slide;
  if (slide.kind === 'multiple_choice_poll') {
    return { ...fields, options: slide.options.map((text) => ({ text, isCorrect: false })) } as AuthoredSlide;
  }
  return fields as AuthoredSlide;
};

/** One agent slide → a registry slide, validated by the registry type's own schema. */
export function buildAgentSlide(slide: AgentSlide): MappedSlide {
  const mapper = findAgentMapper(slide.kind);
  if (!mapper) return { ok: false, issues: [`Slide kind "${slide.kind}" is not available`] };
  const record = slide as Record<string, unknown>;
  const overrides = Object.fromEntries(OVERRIDES.filter((key) => record[key] !== undefined).map((key) => [key, record[key]]));
  return toRegistrySlide({ type: mapper.type, map: (authored) => ({ ...mapper.map(authored), ...overrides }) }, toAuthoredSlide(slide));
}

export type BuiltSlides =
  | { ok: true; slides: ParsedSlide[]; withoutNotes: number[] }
  | { ok: false; issues: string[] };

/**
 * All or nothing: every slide is built, and any failure rejects the batch with
 * one line per issue, prefixed by the slide's position, so the agent can fix
 * them all in one retry.
 */
export function buildAgentSlides(slides: AgentSlide[], offset = 0): BuiltSlides {
  const built: ParsedSlide[] = [];
  const issues: string[] = [];
  const withoutNotes: number[] = [];
  slides.forEach((slide, index) => {
    const result = buildAgentSlide(slide);
    if (!result.ok) {
      issues.push(...result.issues.map((issue) => `slides[${index + offset}] (${slide.kind}): ${issue}`));
      return;
    }
    built.push(result.slide);
    if (result.notesMissing && result.slide.type !== 'leaderboard') withoutNotes.push(index + offset);
  });
  return issues.length ? { ok: false, issues } : { ok: true, slides: built, withoutNotes };
}

/** One example per kind; `list_slide_types` returns them and the tests build each one. */
export const AGENT_SLIDE_EXAMPLES: Record<AgentSlideKind, AgentSlide> = {
  heading: { kind: 'heading', title: 'Sprint 42 retro', subtitle: 'What worked, what did not, what we change' },
  paragraph: { kind: 'paragraph', title: 'Why zero trust', body: 'Every request is checked, wherever it comes from.' },
  bullets: { kind: 'bullets', title: 'Today', items: ['Warm-up', 'Three questions', 'Actions'] },
  quote: { kind: 'quote', text: 'Simplicity is prerequisite for reliability.', attribution: 'Edsger W. Dijkstra' },
  big_number: { kind: 'big_number', value: 87, suffix: '%', label: 'of tickets closed within a day' },
  image: { kind: 'image', imageUrl: 'https://images.example.com/floor-plan.png', alt: 'Floor plan of the venue' },
  video: { kind: 'video', videoUrl: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', start: 30 },
  instructions: { kind: 'instructions', text: 'Join now, we start in a minute' },
  multiple_choice_quiz: {
    kind: 'multiple_choice_quiz',
    question: 'Which planet is closest to the Sun?',
    options: [
      { text: 'Mercury', isCorrect: true },
      { text: 'Venus', isCorrect: false },
      { text: 'Mars', isCorrect: false },
    ],
    explanation: 'Mercury orbits at about 58 million km.',
  },
  type_answer: { kind: 'type_answer', question: 'Chemical symbol for gold?', acceptedAnswers: ['Au'] },
  guess_number: { kind: 'guess_number', question: 'In which year did the Berlin Wall fall?', min: 1950, max: 2000, correct: 1989 },
  pin_on_image: {
    kind: 'pin_on_image',
    question: 'Where is the fire exit?',
    imageUrl: 'https://images.example.com/floor-plan.png',
    alt: 'Floor plan of the venue',
    correctArea: { x: 0.8, y: 0.1, width: 0.15, height: 0.2 },
  },
  leaderboard: { kind: 'leaderboard' },
  multiple_choice_poll: { kind: 'multiple_choice_poll', question: 'Where should the offsite be?', options: ['Lisbon', 'Berlin', 'Online'] },
  wordcloud: { kind: 'wordcloud', question: 'One word for this sprint?' },
  open_ended: { kind: 'open_ended', question: 'What should we stop doing?' },
  scales: {
    kind: 'scales',
    question: 'How do you feel about the team?',
    statements: ['I can ask for help', 'Our goals are clear'],
    minLabel: 'Disagree',
    maxLabel: 'Agree',
  },
  ranking: { kind: 'ranking', question: 'Rank the next steps', items: ['Fix flaky tests', 'Ship search', 'Write docs'] },
  hundred_points: { kind: 'hundred_points', question: 'Split 100 points across next quarter', items: ['Speed', 'Design', 'Reliability'] },
  grid_2x2: {
    kind: 'grid_2x2',
    question: 'Place each idea',
    items: ['Dark mode', 'SSO', 'Offline mode'],
    xAxis: { label: 'Effort' },
    yAxis: { label: 'Impact' },
    corners: { topLeft: 'Quick wins', topRight: 'Big bets' },
  },
  qna: { kind: 'qna', question: 'Ask us anything' },
};

const variantByKind = new Map(AGENT_SLIDE_VARIANTS.map((variant) => [variant.shape.kind.value as string, variant]));

/** Field names of a kind, split by whether the schema requires them. */
export function agentKindFields(kindName: string): { required: string[]; optional: string[] } {
  const variant = variantByKind.get(kindName);
  if (!variant) return { required: [], optional: [] };
  const entries = Object.entries(variant.shape as Record<string, z.ZodType>).filter(([key]) => key !== 'kind');
  return {
    required: entries.filter(([, field]) => !field.safeParse(undefined).success).map(([key]) => key),
    optional: entries.filter(([, field]) => field.safeParse(undefined).success).map(([key]) => key),
  };
}
