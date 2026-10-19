import { z } from 'zod';

/**
 * Contracts of AI whole-deck authoring (`POST /api/ai/generate-deck`):
 * the request, the outline (returned by the outline step and accepted back
 * after the author edits it), and the LLM output shapes.
 *
 * The LLM shapes are deliberately lenient (every field optional, no length
 * rules): a structured-output parse failure loses a whole batch, while a loose
 * shape lets each slide be checked on its own by the slide registry and
 * repaired or dropped individually (`slideMappers.ts`, `deck.service.ts`).
 */

export const DECK_TONES = ['professional', 'casual', 'educational', 'inspiring', 'funny'] as const;
export type DeckTone = (typeof DECK_TONES)[number];

export const DECK_LIMITS = {
  minSlides: 3,
  maxSlides: 30,
  defaultSlides: 10,
  topicMax: 200,
  audienceMax: 200,
  sourceTextMax: 20_000,
  titleMax: 120,
  sectionTitleMax: 120,
  intentMax: 300,
  maxSections: 12,
} as const;

/** A language name as the model should read it ("English", "Português (Brasil)"). */
const languageSchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[\p{L}\p{M}][\p{L}\p{M} ()-]*$/u, 'Use a language name, e.g. "English"');

// ---------- Outline (request + response) ----------

export const deckOutlineSlideSchema = z.object({
  /** A deck slide kind (`slideMappers.ts`), e.g. `bullets` or `multiple_choice_quiz`. */
  type: z.string().trim().min(1).max(40),
  /** One sentence: what the slide shows or asks. */
  intent: z.string().trim().min(1, 'Describe what the slide covers').max(DECK_LIMITS.intentMax),
});

export const deckOutlineSectionSchema = z.object({
  title: z.string().trim().min(1, 'Section title is required').max(DECK_LIMITS.sectionTitleMax),
  slides: z.array(deckOutlineSlideSchema).min(1, 'A section needs at least one slide').max(DECK_LIMITS.maxSlides),
});

export const deckOutlineSchema = z
  .object({
    title: z.string().trim().min(1, 'Deck title is required').max(DECK_LIMITS.titleMax),
    sections: z.array(deckOutlineSectionSchema).min(1).max(DECK_LIMITS.maxSections),
  })
  .refine((outline) => countOutlineSlides(outline) <= DECK_LIMITS.maxSlides, {
    message: `An outline holds at most ${DECK_LIMITS.maxSlides} slides`,
    path: ['sections'],
  });

export type DeckOutline = z.infer<typeof deckOutlineSchema>;
export type DeckOutlineSlide = z.infer<typeof deckOutlineSlideSchema>;

export const countOutlineSlides = (outline: { sections: { slides: unknown[] }[] }) =>
  outline.sections.reduce((total, section) => total + section.slides.length, 0);

// ---------- Request ----------

const includeSchema = z
  .object({
    content: z.boolean().default(true),
    polls: z.boolean().default(true),
    quiz: z.boolean().default(true),
  })
  .default({ content: true, polls: true, quiz: true })
  .refine((include) => include.content || include.polls || include.quiz, {
    message: 'Include at least one of content, polls or quiz',
  });

export const DECK_STEPS = ['outline', 'deck'] as const;
export type DeckStep = (typeof DECK_STEPS)[number];

export const generateDeckRequestSchema = z
  .object({
    topic: z.string().trim().min(3, 'Topic must be at least 3 characters').max(DECK_LIMITS.topicMax),
    audience: z.string().trim().max(DECK_LIMITS.audienceMax).default(''),
    slideCount: z.number().int().min(DECK_LIMITS.minSlides).max(DECK_LIMITS.maxSlides).default(DECK_LIMITS.defaultSlides),
    tone: z.enum(DECK_TONES).default('professional'),
    language: languageSchema.default('English'),
    include: includeSchema,
    /** Optional reference material pasted by the author. Untrusted: delimited in prompts and treated as data. */
    sourceText: z.string().max(DECK_LIMITS.sourceTextMax).default('').transform((text) => text.trim()),
    /** Deck title; defaults to the outline's. */
    title: z.string().trim().min(1).max(DECK_LIMITS.titleMax).optional(),
    /**
     * `outline` returns an outline to review (nothing stored, no usage);
     * `deck` writes the slides and creates the deck, from `outline` when given.
     */
    step: z.enum(DECK_STEPS).default('deck'),
    outline: deckOutlineSchema.optional(),
  })
  .refine((input) => !(input.step === 'outline' && input.outline), {
    message: 'An outline is accepted only with step "deck"',
    path: ['outline'],
  });

export type GenerateDeckInput = z.infer<typeof generateDeckRequestSchema>;
export type DeckInclude = GenerateDeckInput['include'];

// ---------- LLM output (lenient) ----------

/** Outline as the model returns it; normalized by the service. */
export const llmOutlineSchema = (kinds: readonly string[]) =>
  z.object({
    title: z.string().describe('Deck title, at most 80 characters'),
    sections: z
      .array(
        z.object({
          title: z.string().describe('Section title'),
          slides: z.array(
            z.object({
              type: z.string().describe(`Slide type, exactly one of: ${kinds.join(', ')}`),
              intent: z.string().describe('One sentence: what this slide shows or asks'),
            }),
          ),
        }),
      )
      .describe('Sections in presentation order'),
  });

export type LlmOutline = z.infer<ReturnType<typeof llmOutlineSchema>>;

const llmOptionSchema = z.object({
  text: z.string(),
  isCorrect: z.boolean(),
});

/** One slide as the model writes it; the slide kind picks which fields matter. */
export const llmSlideSchema = z.object({
  title: z.string().optional().describe('heading, paragraph, bullets: slide title'),
  subtitle: z.string().optional().describe('heading: subtitle'),
  body: z.string().optional().describe('paragraph: the text'),
  items: z.array(z.string()).optional().describe('bullets: the bullets; ranking: the items to order'),
  text: z.string().optional().describe('quote: the quotation'),
  attribution: z.string().optional().describe('quote: who said it'),
  value: z.number().optional().describe('big_number: the number'),
  prefix: z.string().optional().describe('big_number: shown before the number, e.g. "$"'),
  suffix: z.string().optional().describe('big_number: shown after the number, e.g. "%"'),
  label: z.string().optional().describe('big_number: what the number means'),
  question: z.string().optional().describe('interactive slides: the question'),
  options: z.array(llmOptionSchema).optional().describe('multiple choice: the choices'),
  explanation: z.string().optional().describe('multiple_choice_quiz: why the answer is right'),
  acceptedAnswers: z.array(z.string()).optional().describe('type_answer: accepted answers'),
  statements: z.array(z.string()).optional().describe('scales: statements to rate'),
  minLabel: z.string().optional().describe('scales: label of the lowest rating'),
  maxLabel: z.string().optional().describe('scales: label of the highest rating'),
  notes: z.string().optional().describe('Speaker notes: what the presenter says on this slide'),
});

export type GeneratedSlide = z.infer<typeof llmSlideSchema>;

export const llmSlidesSchema = z.object({
  slides: z.array(llmSlideSchema).describe('The requested slides, in the order they were listed'),
});

export const llmRepairSchema = z.object({ slide: llmSlideSchema });

// ---------- Response ----------

export type DeckSource = 'llm' | 'mock';

export type DeckWarningCode =
  | 'SLIDE_DROPPED'
  | 'SLIDE_WITHOUT_NOTES'
  | 'OUTLINE_SHORT'
  | 'OUTLINE_TRIMMED'
  | 'SOURCE_IGNORED';

export interface DeckWarning {
  code: DeckWarningCode;
  message: string;
  /** 1-based position in the outline, for slide warnings. */
  position?: number;
}
