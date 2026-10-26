import { z } from 'zod';
import { ApiError } from '../../../common/utils/ApiError';
import { hasFeature } from '../../../common/plans/entitlements';
import { PresentationService } from '../../presentations/presentations.service';
import { SESSION_PACES, type IPresentation } from '../../presentations/models/presentation.model';
import { deckSettingsPatchSchema, deckThemePatchSchema } from '../../presentations/presentations.schema';
import type { ParsedSlide } from '../../presentations/slides';
import { BrandKitService, presetViews } from '../../themes/themes.service';
import { agentKinds } from '../../ai/deck/agentMappers';
import {
  AGENT_SLIDE_EXAMPLES,
  agentKindFields,
  agentSlideSchema,
  buildAgentSlides,
  type AgentSlide,
  type AgentSlideKind,
} from '../../ai/deck/agent.schema';
import {
  asWorkspaceRequest,
  auditMcp,
  frontendUrl,
  parseObjectId,
  serialize,
  workspaceScope,
  type McpScopeContext,
  type McpUserContext,
} from '../mcp.context';
import { defineTool } from './types';

/** Slides a deck may hold (`createPresentationSchema`). */
const MAX_SLIDES = 50;

// ---------------------------------------------------------------------------
// Views: what an agent reads back. Compact (no empty legacy fields), with the
// slide ids the edit tools take.
// ---------------------------------------------------------------------------

export const deckLinks = (deck: Pick<IPresentation, '_id' | 'joinCode'>) => {
  const web = frontendUrl();
  const id = String(deck._id);
  return {
    builder: `${web}/presentation/create?id=${id}`,
    host: `${web}/presentation/host/${id}`,
    join: `${web}/live/${deck.joinCode}`,
    sessions: `${web}/presentations/${id}/sessions`,
  };
};

export const deckSummary = (deck: IPresentation) => ({
  id: String(deck._id),
  title: deck.title,
  status: deck.status,
  isLive: deck.status === 'lobby' || deck.status === 'active',
  slideCount: deck.slides.length,
  joinCode: deck.joinCode,
  pace: deck.pace,
  updatedAt: deck.updatedAt,
  links: deckLinks(deck),
});

/** Stored fields worth showing per registry type; content types show `content`. */
const VIEW_FIELDS: Record<string, readonly string[]> = {
  select_answer: ['question', 'options', 'timeLimit', 'points', 'config'],
  type_answer: ['question', 'acceptedAnswers', 'timeLimit', 'points'],
  wordcloud: ['question', 'maxEntries', 'timeLimit'],
  open_ended: ['question', 'timeLimit'],
  scales: ['question', 'statements', 'minLabel', 'maxLabel', 'scaleMax', 'timeLimit'],
  ranking: ['question', 'items', 'timeLimit'],
  leaderboard: ['question'],
  qna: ['question'],
  guess_number: ['question', 'timeLimit', 'points', 'config'],
  hundred_points: ['question', 'timeLimit', 'config'],
  grid_2x2: ['question', 'timeLimit', 'config'],
  pin_on_image: ['question', 'timeLimit', 'points', 'config', 'content'],
};

const isEmpty = (value: unknown) =>
  value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);

/** The agent kind a stored slide reads as (`select_answer` is a quiz when worth points). */
export const agentKindOf = (slide: { type: string; points?: number | null }): string =>
  slide.type === 'select_answer' ? ((slide.points ?? 1000) > 0 ? 'multiple_choice_quiz' : 'multiple_choice_poll') : slide.type;

type StoredSlide = Record<string, unknown> & { _id?: unknown; type: string };

const plainSlide = (slide: unknown): StoredSlide =>
  (typeof (slide as { toObject?: unknown }).toObject === 'function'
    ? (slide as { toObject(): StoredSlide }).toObject()
    : slide) as StoredSlide;

export function slideView(raw: unknown, position: number) {
  const slide = plainSlide(raw);
  const view: Record<string, unknown> = {
    id: String(slide._id),
    position,
    kind: agentKindOf(slide as { type: string; points?: number }),
    type: slide.type,
  };
  for (const key of [...(VIEW_FIELDS[slide.type] ?? ['content']), 'notes', 'media']) {
    if (!isEmpty(slide[key])) view[key] = serialize(slide[key]);
  }
  return view;
}

const deckDetail = (deck: IPresentation) => ({
  ...deckSummary(deck),
  theme: serialize(deck.theme ?? null),
  settings: serialize(deck.settings ?? null),
  slides: deck.slides.map((slide, index) => slideView(slide, index)),
});

// ---------------------------------------------------------------------------
// Input shapes
// ---------------------------------------------------------------------------

const deckId = z.string().min(1).describe('Deck id (from list_decks or create_deck)');

const slidesDescription =
  'Slides in order, at most 50. Each has a "kind" (heading, bullets, multiple_choice_quiz, wordcloud, grid_2x2, ...) and that kind\'s fields; list_slide_types lists every kind with an example.';

const themeShape = deckThemePatchSchema.describe(
  'Look of the deck: presetId from list_themes, optionally a brandKitId (paid plans) and accent/accentText overrides (#rrggbb, readable together). Omitted: the workspace default theme.',
);

const settingsShape = deckSettingsPatchSchema.describe(
  'Optional deck settings; omitted fields keep their default. Common ones: qna.enabled (audience questions during the whole session), reactions.enabled, quiz.leaderboard, nickname ("required", "optional", "off"), showResultsOnDevices.',
);

const paceShape = z
  .enum(SESSION_PACES)
  .describe('presenter (default): the host moves everyone together; audience: each person goes at their own pace');

export const createDeckInputShape = {
  title: z.string().trim().min(1).max(120).describe('Deck title'),
  slides: z.array(agentSlideSchema).min(1).max(MAX_SLIDES).describe(slidesDescription),
  theme: themeShape.optional(),
  settings: settingsShape.optional(),
  pace: paceShape.optional(),
};

export const updateDeckInputShape = {
  deckId,
  title: z.string().trim().min(1).max(120).optional().describe('New title'),
  theme: themeShape.optional(),
  settings: settingsShape.optional(),
  pace: paceShape.optional(),
};

export const addSlidesInputShape = {
  deckId,
  slides: z.array(agentSlideSchema).min(1).max(MAX_SLIDES).describe(slidesDescription),
  position: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('0-based position to insert at; omitted = at the end. 0 puts them first.'),
};

export const updateSlideInputShape = {
  deckId,
  slideId: z.string().min(1).describe('Id of the slide to replace (from get_deck)'),
  slide: agentSlideSchema.describe('The new slide; it replaces the old one whole and keeps its position and id'),
};

export const removeSlidesInputShape = {
  deckId,
  slideIds: z.array(z.string().min(1)).min(1).describe('Ids of the slides to remove; at least one slide must remain'),
};

export const reorderSlidesInputShape = {
  deckId,
  slideIds: z
    .array(z.string().min(1))
    .min(1)
    .describe('Every slide id of the deck, in the new order (get_deck lists them)'),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildOrThrow(slides: AgentSlide[], offset = 0) {
  const built = buildAgentSlides(slides, offset);
  if (!built.ok) {
    throw ApiError.badRequest(`Some slides are not valid. Fix these and call again:\n${built.issues.join('\n')}`);
  }
  return built;
}

const notesWarning = (positions: number[]) =>
  positions.length
    ? [`Slides at positions ${positions.join(', ')} have no speaker notes. The presenter reads notes on the host screen; add them with update_slide if useful.`]
    : [];

/**
 * Slide edits read the stored slides, change the array and save it whole (the
 * deck API replaces slides as one array). Untouched slides keep their `_id`,
 * so ids from get_deck stay valid across agent edits.
 */
async function editSlides(
  ctx: McpUserContext,
  rawDeckId: unknown,
  action: string,
  edit: (slides: StoredSlide[]) => StoredSlide[],
) {
  const id = parseObjectId(rawDeckId, 'deck id');
  const scope = await workspaceScope(ctx);
  const deck = await PresentationService.getPresentationFor(id, scope);
  const next = edit(deck.slides.map(plainSlide));
  if (next.length === 0) throw ApiError.badRequest('A deck needs at least one slide');
  if (next.length > MAX_SLIDES) throw ApiError.badRequest(`A deck holds at most ${MAX_SLIDES} slides`);
  const updated = await PresentationService.updatePresentation(id, scope, { slides: next as unknown as ParsedSlide[] });
  auditMcp(ctx, scope, action, { type: 'presentation', id }, { slides: updated.slides.length });
  return updated;
}

const findSlideIndex = (slides: StoredSlide[], slideId: string) => {
  const index = slides.findIndex((slide) => String(slide._id) === slideId);
  if (index === -1) {
    throw ApiError.notFound(
      `No slide ${slideId} in this deck. Slide ids change when the deck is saved in the web builder; call get_deck for the current ids.`,
    );
  }
  return index;
};

async function themeChoices(scope: McpScopeContext) {
  const brandKitsAvailable = hasFeature(scope.workspace, 'brand_kits');
  const brandKits = brandKitsAvailable ? await BrandKitService.list(asWorkspaceRequest(scope) as never) : [];
  return {
    presets: presetViews().map((preset) => ({ id: preset.id, name: preset.name })),
    brandKits: brandKits.map((kit) => ({ id: kit.id, name: kit.name })),
    brandKitsAvailable,
    workspaceDefault: serialize(scope.workspace.settings?.defaultTheme ?? null),
  };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const DECK_TOOLS = [
  defineTool({
    name: 'list_slide_types',
    scope: 'deck:read',
    description:
      'Every slide kind a deck can hold, with what it is for, its required and optional fields and one example. Read it before create_deck.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async handler() {
      return {
        kinds: agentKinds().map((mapper) => ({
          kind: mapper.kind,
          category: mapper.category,
          description: mapper.hint,
          fields: agentKindFields(mapper.kind),
          example: AGENT_SLIDE_EXAMPLES[mapper.kind as AgentSlideKind],
        })),
        notes: [
          'content kinds are shown on the stage; poll kinds collect opinions (unscored); quiz kinds score correct answers and feed the leaderboard.',
          'Images and pin_on_image need a public https image address; uploads happen in the web app.',
          'Speaker notes (notes) are shown to the presenter only.',
        ],
      };
    },
  }),

  defineTool({
    name: 'list_themes',
    scope: 'deck:read',
    description:
      'Themes a deck can use: built-in presets, the workspace brand kits (paid plans), and the workspace default theme new decks get.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async handler(_args, ctx) {
      return themeChoices(await workspaceScope(ctx));
    },
  }),

  defineTool({
    name: 'list_decks',
    scope: 'deck:read',
    description: 'Decks in this workspace, most recently edited first, with status (draft, lobby, active, ended), join code and links.',
    inputShape: {
      search: z.string().trim().max(120).optional().describe('Only decks whose title contains this text'),
      limit: z.number().int().min(1).max(50).optional().describe('At most this many (default 20)'),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async handler(args, ctx) {
      const { search, limit } = z
        .object({ search: z.string().trim().max(120).optional(), limit: z.number().int().min(1).max(50).optional() })
        .parse(args ?? {});
      const scope = await workspaceScope(ctx);
      const decks = await PresentationService.listPresentations(scope);
      const needle = search?.toLowerCase();
      const matching = needle ? decks.filter((deck) => deck.title.toLowerCase().includes(needle)) : decks;
      return { decks: matching.slice(0, limit ?? 20).map(deckSummary), total: matching.length };
    },
  }),

  defineTool({
    name: 'get_deck',
    scope: 'deck:read',
    description: 'One deck with its slides (ids, kinds, fields), theme, settings and links. Slide ids are what the edit tools take.',
    inputShape: { deckId },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async handler(args, ctx) {
      const id = parseObjectId(args?.deckId, 'deck id');
      const deck = await PresentationService.getPresentationFor(id, await workspaceScope(ctx));
      return { deck: deckDetail(deck) };
    },
  }),

  defineTool({
    name: 'create_deck',
    scope: 'deck:write',
    description:
      'Create a deck for a live session from slides you write: content, polls, word clouds, Q&A, 2x2 grids, scored quiz questions, leaderboards (list_slide_types has every kind). It is saved as a draft in this workspace: nobody can join until open_lobby. Every slide is checked; if any is invalid nothing is created and you get every issue by position. Returns the deck, its slides with ids, and links: share links.builder with the user to review it.',
    inputShape: createDeckInputShape,
    annotations: { readOnlyHint: false, destructiveHint: false },
    async handler(args, ctx) {
      const parsed = z.object(createDeckInputShape).parse(args);
      const built = buildOrThrow(parsed.slides);
      const scope = await workspaceScope(ctx);
      const deck = await PresentationService.createPresentation(
        { title: parsed.title, slides: built.slides, theme: parsed.theme, settings: parsed.settings, pace: parsed.pace },
        scope,
      );
      auditMcp(ctx, scope, 'deck.create', { type: 'presentation', id: deck._id }, { slides: deck.slides.length });
      return {
        deck: deckDetail(deck),
        warnings: notesWarning(built.withoutNotes),
        next: 'Share deck.links.builder with the user to review. When they are ready, open_lobby gives the join code and link for the room.',
      };
    },
  }),

  defineTool({
    name: 'update_deck',
    scope: 'deck:write',
    description: 'Change a deck\'s title, theme, settings or pace. Slides are changed with add_slides, update_slide, remove_slides and reorder_slides. Not while a session is live.',
    inputShape: updateDeckInputShape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async handler(args, ctx) {
      const parsed = z
        .object(updateDeckInputShape)
        .refine((data) => Object.keys(data).length > 1, 'Supply at least one field besides deckId')
        .parse(args);
      const { deckId: rawId, ...updates } = parsed;
      const id = parseObjectId(rawId, 'deck id');
      const scope = await workspaceScope(ctx);
      const deck = await PresentationService.updatePresentation(id, scope, updates);
      auditMcp(ctx, scope, 'deck.update', { type: 'presentation', id }, { fields: Object.keys(updates) });
      return { deck: deckSummary(deck), theme: serialize(deck.theme ?? null), settings: serialize(deck.settings ?? null) };
    },
  }),

  defineTool({
    name: 'add_slides',
    scope: 'deck:write',
    description: 'Insert new slides into a deck at a position (default: the end). Same slide format as create_deck. Not while a session is live.',
    inputShape: addSlidesInputShape,
    annotations: { readOnlyHint: false, destructiveHint: false },
    async handler(args, ctx) {
      const parsed = z.object(addSlidesInputShape).parse(args);
      let at = 0;
      let warnings: string[] = [];
      const deck = await editSlides(ctx, parsed.deckId, 'deck.slides_add', (slides) => {
        at = Math.min(parsed.position ?? slides.length, slides.length);
        const built = buildOrThrow(parsed.slides, at);
        warnings = notesWarning(built.withoutNotes);
        return [...slides.slice(0, at), ...(built.slides as unknown as StoredSlide[]), ...slides.slice(at)];
      });
      return {
        deck: deckSummary(deck),
        added: deck.slides.slice(at, at + parsed.slides.length).map((slide, index) => slideView(slide, at + index)),
        warnings,
      };
    },
  }),

  defineTool({
    name: 'update_slide',
    scope: 'deck:write',
    description: 'Replace one slide (any kind, same format as create_deck); it keeps its position and id. Not while a session is live.',
    inputShape: updateSlideInputShape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async handler(args, ctx) {
      const parsed = z.object(updateSlideInputShape).parse(args);
      let at = 0;
      const deck = await editSlides(ctx, parsed.deckId, 'deck.slide_update', (slides) => {
        at = findSlideIndex(slides, parsed.slideId);
        const [replacement] = buildOrThrow([parsed.slide], at).slides;
        const next = [...slides];
        next[at] = { ...(replacement as unknown as StoredSlide), _id: slides[at]!._id };
        return next;
      });
      return { deck: deckSummary(deck), slide: slideView(deck.slides[at], at) };
    },
  }),

  defineTool({
    name: 'remove_slides',
    scope: 'deck:write',
    description: 'Remove slides from a deck by id. At least one slide must remain; deleting a whole deck is only possible in the web app. Not while a session is live.',
    inputShape: removeSlidesInputShape,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    async handler(args, ctx) {
      const parsed = z.object(removeSlidesInputShape).parse(args);
      const remove = new Set(parsed.slideIds);
      const deck = await editSlides(ctx, parsed.deckId, 'deck.slides_remove', (slides) => {
        for (const slideId of remove) findSlideIndex(slides, slideId);
        if (remove.size >= slides.length) throw ApiError.badRequest('A deck needs at least one slide; remove fewer');
        return slides.filter((slide) => !remove.has(String(slide._id)));
      });
      return { deck: deckSummary(deck), removed: remove.size, slides: deck.slides.map((slide, index) => slideView(slide, index)) };
    },
  }),

  defineTool({
    name: 'reorder_slides',
    scope: 'deck:write',
    description: 'Put a deck\'s slides in a new order: pass every slide id once, in the order you want. Not while a session is live.',
    inputShape: reorderSlidesInputShape,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async handler(args, ctx) {
      const parsed = z.object(reorderSlidesInputShape).parse(args);
      const deck = await editSlides(ctx, parsed.deckId, 'deck.slides_reorder', (slides) => {
        const order = parsed.slideIds;
        if (new Set(order).size !== order.length || order.length !== slides.length) {
          throw ApiError.badRequest(`Pass each of the deck's ${slides.length} slide ids exactly once`);
        }
        return order.map((slideId) => slides[findSlideIndex(slides, slideId)]!);
      });
      return { deck: deckSummary(deck), slides: deck.slides.map((slide, index) => slideView(slide, index)) };
    },
  }),
];
