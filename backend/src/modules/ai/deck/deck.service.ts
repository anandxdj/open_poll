import { ApiError } from '../../../common/utils/ApiError';
import { assertCan } from '../../../common/tenancy/policy';
import type { WorkspaceRequest } from '../../../common/tenancy/workspaceContext.middleware';
import { consumeUsage, getUsage, type UsageResult } from '../../../common/plans/usage';
import { PresentationModel } from '../../presentations/models/presentation.model';
import { PresentationService } from '../../presentations/presentations.service';
import type { ParsedSlide } from '../../presentations/slides';
import {
  DECK_LIMITS,
  llmOutlineSchema,
  llmRepairSchema,
  llmSlidesSchema,
  type DeckOutline,
  type DeckSource,
  type DeckWarning,
  type GeneratedSlide,
  type GenerateDeckInput,
  type LlmOutline,
} from './deck.schema';
import { resolveDeckLlm, type DeckLlm, type DeckLlmTask } from './llm';
import { buildMockOutline, buildMockSlide } from './mock';
import { buildOutlinePrompt, buildRepairPrompt, buildSlidesPrompt, newDelimiterId, type PositionedSlide } from './prompts';
import { availableKinds, cleanText, findMapper, toRegistrySlide, type DeckSlideMapper } from './slideMappers';

/**
 * AI whole-deck authoring: outline → slides with speaker notes → a draft deck
 * in the caller's workspace.
 *
 * - `step: 'outline'` returns the outline for review (nothing stored, no usage).
 * - `step: 'deck'` writes the slides (from the reviewed outline when given),
 *   validates each one with the slide registry, re-prompts once for each
 *   invalid or missing slide, drops what still fails (with a warning), creates
 *   the deck and only then counts usage (`ai_deck`). An invalid slide is never
 *   stored: the deck is created through the same schema as `POST /api/presentations`.
 * - Without an AI provider every step runs on deterministic placeholders and
 *   the response says `source: 'mock'`; mock decks do not count against the plan.
 */

/** Slides per generation call, and how many calls run at once. */
export const SLIDE_BATCH_SIZE = 8;
const CONCURRENCY = 3;
/** At most this many targeted re-prompts per deck; anything beyond is dropped. */
export const MAX_REPAIRS = 10;
/** Whole request budget, and the cap of a single call within it. */
const TOTAL_BUDGET_MS = 150_000;
const CALL_TIMEOUT_MS = 60_000;
/** A call is not started with less time than this left. */
const MIN_CALL_MS = 3_000;

export interface DeckKindInfo {
  kind: string;
  type: string;
  category: DeckSlideMapper['category'];
}

export interface DeckOutlineResult {
  step: 'outline';
  outline: DeckOutline;
  /** Kinds the outline may use on this server (the registry decides). */
  availableKinds: DeckKindInfo[];
  warnings: DeckWarning[];
  source: DeckSource;
}

export interface DeckCreatedResult {
  step: 'deck';
  /** The created draft deck (owner view: notes and answer keys included). */
  presentation: unknown;
  outline: DeckOutline;
  warnings: DeckWarning[];
  source: DeckSource;
  /** The plan counter after this deck; null in mock mode (not counted). */
  usage: UsageResult | null;
}

export interface DeckGenerationOptions {
  /** Defaults to the configured providers (`resolveDeckLlm`); null forces mock mode. */
  llm?: DeckLlm | null;
  now?: () => number;
}

const providerFailed = (message = 'The AI provider did not respond. Try again in a moment.') =>
  new ApiError(502, message, 'AI_PROVIDER_FAILED');

const kindInfo = (mapper: DeckSlideMapper): DeckKindInfo => ({ kind: mapper.kind, type: mapper.type, category: mapper.category });

/** Runs `fn` over `items` with at most `limit` in flight. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export class Budget {
  private readonly deadline: number;
  constructor(private readonly now: () => number) {
    this.deadline = now() + TOTAL_BUDGET_MS;
  }
  /** Timeout for the next call, or 0 when there is no time left for one. */
  callTimeout(): number {
    const left = this.deadline - this.now();
    return left < MIN_CALL_MS ? 0 : Math.min(CALL_TIMEOUT_MS, left);
  }
}

async function call<T>(
  llm: DeckLlm,
  budget: Budget,
  task: DeckLlmTask,
  schema: Parameters<DeckLlm['generate']>[0],
  prompt: string,
): Promise<T> {
  const timeoutMs = budget.callTimeout();
  if (timeoutMs === 0) throw new Error(`No time left for the ${task} call`);
  return (await llm.generate(schema, prompt, { task, timeoutMs })) as T;
}

// ---------- Outline ----------

/** Picks a kind for an outline slide the model labelled with something we do not offer. */
const fallbackKind = (allowed: readonly DeckSlideMapper[]) =>
  (allowed.find((mapper) => mapper.kind === 'bullets') ?? allowed[0]!).kind;

/**
 * Model outline → clean outline: known kinds only (unknown ones fall back to an
 * allowed kind), trimmed text, empty slides/sections dropped, at most
 * `slideCount` slides. Throws when nothing usable is left.
 */
export function normalizeLlmOutline(
  raw: LlmOutline,
  input: Pick<GenerateDeckInput, 'topic' | 'slideCount' | 'title'>,
  allowed: readonly DeckSlideMapper[],
  warnings: DeckWarning[],
): DeckOutline {
  const kinds = new Set(allowed.map((mapper) => mapper.kind));
  let remaining = input.slideCount;
  let total = 0;
  const sections: DeckOutline['sections'] = [];
  for (const section of Array.isArray(raw?.sections) ? raw.sections : []) {
    const slides: DeckOutline['sections'][number]['slides'] = [];
    for (const slide of Array.isArray(section?.slides) ? section.slides : []) {
      const intent = cleanText(slide?.intent, DECK_LIMITS.intentMax);
      if (!intent) continue;
      total += 1;
      if (remaining === 0) continue;
      const type = typeof slide?.type === 'string' && kinds.has(slide.type.trim()) ? slide.type.trim() : fallbackKind(allowed);
      slides.push({ type, intent });
      remaining -= 1;
    }
    if (slides.length === 0) continue;
    sections.push({ title: cleanText(section?.title, DECK_LIMITS.sectionTitleMax) || `Part ${sections.length + 1}`, slides });
    if (sections.length === DECK_LIMITS.maxSections) break;
  }
  const kept = input.slideCount - remaining;
  if (kept === 0) throw providerFailed('The AI provider returned an empty outline. Try again.');
  if (total > input.slideCount) {
    warnings.push({
      code: 'OUTLINE_TRIMMED',
      message: `The outline had ${total} slides; the last ${total - input.slideCount} were left out.`,
    });
  } else if (kept < input.slideCount) {
    warnings.push({ code: 'OUTLINE_SHORT', message: `The outline has ${kept} slides instead of ${input.slideCount}.` });
  }
  const title = input.title ?? (cleanText(raw?.title, DECK_LIMITS.titleMax) || cleanText(input.topic, DECK_LIMITS.titleMax));
  return { title, sections };
}

async function generateOutline(
  llm: DeckLlm,
  budget: Budget,
  input: GenerateDeckInput,
  allowed: readonly DeckSlideMapper[],
  warnings: DeckWarning[],
): Promise<DeckOutline> {
  const schema = llmOutlineSchema(allowed.map((mapper) => mapper.kind));
  const prompt = buildOutlinePrompt(input, allowed);
  let lastError: unknown;
  // One retry: a malformed outline (parse failure) is usually a one-off.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await call<LlmOutline>(llm, budget, 'outline', schema, prompt);
      return normalizeLlmOutline(raw, input, allowed, warnings);
    } catch (error) {
      lastError = error;
      console.error(`[AiDeck] outline attempt ${attempt + 1} failed:`, (error as Error)?.message ?? error);
    }
  }
  throw lastError instanceof ApiError ? lastError : providerFailed();
}

/** Checks an outline the author edited: every slide must use a kind this server offers. */
export function assertOutlineKinds(outline: DeckOutline) {
  outline.sections.forEach((section, s) =>
    section.slides.forEach((slide, i) => {
      if (!findMapper(slide.type)) {
        throw ApiError.badRequest(`outline.sections.${s}.slides.${i}.type: Unknown slide type "${slide.type}"`);
      }
    }),
  );
}

export const flattenOutline = (outline: DeckOutline): PositionedSlide[] => {
  const positioned: PositionedSlide[] = [];
  for (const section of outline.sections) {
    for (const slide of section.slides) {
      positioned.push({ position: positioned.length + 1, section: section.title, type: slide.type, intent: slide.intent });
    }
  }
  return positioned;
};

// ---------- Slides ----------

const describe = (slide: PositionedSlide) => `Slide ${slide.position} ("${cleanText(slide.intent, 60)}")`;

/**
 * Writes, validates and repairs the slides of an outline. Returns the valid
 * slides in outline order; adds a warning for every slide dropped or left
 * without notes.
 */
export async function generateSlides(
  llm: DeckLlm | null,
  input: GenerateDeckInput,
  outline: DeckOutline,
  warnings: DeckWarning[],
  budget: Budget = new Budget(Date.now),
): Promise<ParsedSlide[]> {
  const positioned = flattenOutline(outline);
  const generated: (GeneratedSlide | undefined)[] = new Array(positioned.length);

  if (!llm) {
    positioned.forEach((slide, i) => (generated[i] = buildMockSlide(slide, input.topic)));
  } else {
    const allowed = availableKinds();
    const batches: PositionedSlide[][] = [];
    for (let i = 0; i < positioned.length; i += SLIDE_BATCH_SIZE) batches.push(positioned.slice(i, i + SLIDE_BATCH_SIZE));
    const delimiterId = newDelimiterId();
    const outcomes = await mapLimit(batches, CONCURRENCY, async (batch) => {
      try {
        const out = await call<{ slides?: GeneratedSlide[] }>(
          llm,
          budget,
          'slides',
          llmSlidesSchema,
          buildSlidesPrompt(input, outline, batch, allowed, delimiterId),
        );
        const slides = Array.isArray(out?.slides) ? out.slides : [];
        // Extra slides beyond the batch are ignored (output size cap).
        batch.forEach((slide, i) => (generated[slide.position - 1] = slides[i]));
        return true;
      } catch (error) {
        console.error(`[AiDeck] slides batch from ${batch[0]!.position} failed:`, (error as Error)?.message ?? error);
        return false;
      }
    });
    // Nothing came back at all: the provider is down; do not burn the repair budget on it.
    if (!outcomes.some(Boolean)) throw providerFailed();
  }

  const results: (ParsedSlide | null)[] = new Array(positioned.length).fill(null);
  const toRepair: { slide: PositionedSlide; mapper: DeckSlideMapper; issues: string[]; fallback: ParsedSlide | null }[] = [];

  positioned.forEach((slide, i) => {
    const mapper = findMapper(slide.type)!;
    const mapped = toRegistrySlide(mapper, generated[i]);
    if (mapped.ok && !mapped.notesMissing) {
      results[i] = mapped.slide;
    } else if (mapped.ok) {
      toRepair.push({ slide, mapper, issues: ['notes: Speaker notes are missing'], fallback: mapped.slide });
    } else {
      toRepair.push({ slide, mapper, issues: mapped.issues, fallback: null });
    }
  });

  await mapLimit(toRepair, CONCURRENCY, async (item, index) => {
    const i = item.slide.position - 1;
    let repaired: ReturnType<typeof toRegistrySlide> | null = null;
    if (llm && index < MAX_REPAIRS) {
      try {
        const out = await call<{ slide?: GeneratedSlide }>(
          llm,
          budget,
          'repair',
          llmRepairSchema,
          buildRepairPrompt(input, item.slide, item.mapper, item.issues, generated[i]),
        );
        repaired = toRegistrySlide(item.mapper, out?.slide);
      } catch (error) {
        console.error(`[AiDeck] repair of slide ${item.slide.position} failed:`, (error as Error)?.message ?? error);
      }
    }
    if (repaired?.ok && !repaired.notesMissing) {
      results[i] = repaired.slide;
      return;
    }
    // Still without notes, but otherwise valid: keep the slide and say so.
    const keep = item.fallback ?? (repaired?.ok ? repaired.slide : null);
    if (keep) {
      results[i] = keep;
      warnings.push({
        code: 'SLIDE_WITHOUT_NOTES',
        message: `${describe(item.slide)} has no speaker notes.`,
        position: item.slide.position,
      });
      return;
    }
    const issues = repaired && !repaired.ok ? repaired.issues : item.issues;
    warnings.push({
      code: 'SLIDE_DROPPED',
      message: `${describe(item.slide)} was left out: ${issues[0] ?? 'it could not be generated'}.`,
      position: item.slide.position,
    });
  });

  warnings.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return results.filter((slide): slide is ParsedSlide => slide !== null);
}

// ---------- Entry point ----------

async function assertUsageLeft(req: WorkspaceRequest) {
  const usage = await getUsage(req.workspace!, 'ai_deck');
  if (usage.remaining === 0) {
    throw new ApiError(403, 'Your plan limit has been reached', 'PLAN_LIMIT_REACHED', {
      limit: 'aiDecksPerMonth',
      max: usage.limit,
      used: usage.used,
      period: usage.period,
    });
  }
}

export class DeckService {
  /** `POST /api/ai/generate-deck`. Needs authenticate() + workspaceContext(). */
  static async generate(
    req: WorkspaceRequest,
    input: GenerateDeckInput,
    options: DeckGenerationOptions = {},
  ): Promise<DeckOutlineResult | DeckCreatedResult> {
    if (!req.workspace) throw ApiError.internal('generate-deck needs workspaceContext() mounted before it');
    assertCan(req, 'deck:create');

    const allowed = availableKinds(input.include);
    if (allowed.length === 0) throw ApiError.badRequest('None of the requested slide categories is available');
    if (input.outline) assertOutlineKinds(input.outline);

    const llm = options.llm !== undefined ? options.llm : resolveDeckLlm();
    const source: DeckSource = llm ? 'llm' : 'mock';
    // Do not spend model calls on a deck the plan would refuse.
    if (llm) await assertUsageLeft(req);

    const warnings: DeckWarning[] = [];
    if (!llm && input.sourceText) {
      warnings.push({ code: 'SOURCE_IGNORED', message: 'Mock mode does not read the pasted source text.' });
    }
    const budget = new Budget(options.now ?? Date.now);

    let outline: DeckOutline;
    if (input.outline) {
      outline = input.title ? { ...input.outline, title: input.title } : input.outline;
    } else if (llm) {
      outline = await generateOutline(llm, budget, input, allowed, warnings);
    } else {
      outline = buildMockOutline(input, allowed);
    }

    if (input.step === 'outline') {
      return { step: 'outline', outline, availableKinds: availableKinds().map(kindInfo), warnings, source };
    }

    const slides = await generateSlides(llm, input, outline, warnings, budget);
    if (slides.length === 0) {
      throw new ApiError(502, 'No valid slides could be generated. Try again or change the outline.', 'AI_DECK_EMPTY', {
        warnings,
      });
    }

    const deck = await PresentationService.createPresentation(
      { title: cleanText(outline.title, DECK_LIMITS.titleMax) || 'AI deck', slides },
      req,
    );

    let usage: UsageResult | null = null;
    if (llm) {
      try {
        usage = await consumeUsage(req.workspace, 'ai_deck');
      } catch (error) {
        // A concurrent generation took the last unit: no deck without counted usage.
        await PresentationModel.deleteOne({ _id: deck._id }).catch((cleanupError) =>
          console.error('[AiDeck] could not remove an uncounted deck:', cleanupError),
        );
        throw error;
      }
    }

    return { step: 'deck', presentation: deck, outline, warnings, source, usage };
  }
}
