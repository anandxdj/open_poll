import crypto from 'crypto';
import mongoose from 'mongoose';
import { ApiError } from '../../common/utils/ApiError';
import { copyTitle } from '../../common/utils/copyTitle';
import { redisClient } from '../../common/config/redis';
import { assertCan, type PolicyContext } from '../../common/tenancy/policy';
import {
  PresentationModel,
  type IPresentation,
  type IPresentationSlide,
  type IPresentationSlideOption,
} from './models/presentation.model';
import { PresentationParticipantModel } from './models/participant.model';
import { PresentationAnswerModel } from './models/answer.model';
import { PresentationSessionModel } from './models/session.model';
import { ResourceShareModel } from '../workspaces/resourceShare.model';
import { authorizeDeck, type Actor } from './access';
import { allSessionKeys, k } from './live/keys';
import { assertContentMediaInWorkspace } from './slides/types/content/media';
import { assertThemeChoice, type ThemeChoice } from '../themes/themes.service';
import { WorkspaceModel } from '../workspaces/workspace.model';
import { announceScreensRevoked } from '../embeds/screenTokens.service';
import {
  MAX_DECK_SLIDES,
  presentationSlideSchema,
  type CreatePresentationInput,
  type EditableSlide,
  type InsertSlideInput,
  type PatchSlideInput,
  type ReorderSlidesInput,
  type UpdatePresentationInput,
} from './presentations.schema';
import { deckChanged } from './revision';

const generateJoinCode = () => crypto.randomInt(100000, 1000000).toString();

/** Nested plain objects → `a.b.c` paths (arrays and scalars are leaves), for partial updates. */
const toPaths = (value: Record<string, unknown>, prefix: string): [string, unknown][] =>
  Object.entries(value).flatMap(([key, child]) =>
    child !== null && typeof child === 'object' && !Array.isArray(child)
      ? toPaths(child as Record<string, unknown>, `${prefix}.${key}`)
      : [[`${prefix}.${key}`, child] as [string, unknown]]
  );

/**
 * Creates a deck in the actor's current workspace. A bare user id (scripts,
 * tests) creates a deck without a workspace, which only its creator can reach.
 */
export const createPresentation = async (data: CreatePresentationInput, actor: Actor) => {
  let creatorId = typeof actor === 'string' ? actor : '';
  let workspaceId: string | undefined;
  if (typeof actor !== 'string') {
    assertCan(actor, 'deck:create');
    creatorId = actor.user!.id;
    workspaceId = actor.workspace ? String(actor.workspace._id) : undefined;
  }
  // Uploaded media must belong to the deck's workspace (the request schema cannot query).
  if (workspaceId && data.slides) await assertContentMediaInWorkspace(data.slides, workspaceId);
  // A new deck starts on the workspace's default theme unless the request picks one.
  const workspace = typeof actor === 'string' ? null : (actor.workspace ?? null);
  const defaultTheme = (workspace as { settings?: { defaultTheme?: ThemeChoice | null } } | null)?.settings?.defaultTheme;
  const themeChoice: ThemeChoice | undefined = data.theme ?? (defaultTheme ? { ...defaultTheme } : undefined);
  const theme = themeChoice ? await assertThemeChoice(themeChoice, workspace as Parameters<typeof assertThemeChoice>[1]) : undefined;
  return createWithJoinCode({
    ...data,
    ...(theme ? { theme: theme as Record<string, unknown> } : {}),
    creatorId,
    ...(workspaceId ? { workspaceId } : {}),
  });
};

/** Saves a new deck under a fresh join code, retrying the rare collision. */
const createWithJoinCode = async (deck: Record<string, unknown>) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await PresentationModel.create({ ...deck, joinCode: generateJoinCode() });
    } catch (error: any) {
      if (error?.code !== 11000) throw error;
    }
  }
  throw ApiError.internal('Could not allocate a unique join code, please retry');
};

/** createPresentationSchema's title limit. */
const MAX_DECK_TITLE = 120;

type StoredSlide = IPresentationSlide & { options?: Array<IPresentationSlideOption & { _id?: unknown }> };

/** A stored slide as a new one: no `_id` (on the slide or its options), everything else as is. */
const copySlide = ({ _id, ...slide }: StoredSlide) => ({
  ...slide,
  options: (slide.options ?? []).map(({ text, isCorrect }) => ({ text, isCorrect })),
});

/**
 * Copies a deck into the caller's current workspace as a new draft with its
 * own join code: title "Copy of …", every slide (new slide ids; settings,
 * speaker notes and media references kept), pace, deck settings, theme and
 * folder. Sessions, participants and answers stay with the original.
 *
 * Needs `deck:read` on the source (share grants count) and `deck:create` in
 * the current workspace. The policy keeps the source in that workspace, except
 * a deck from before workspaces, which only its creator reaches: its media is
 * checked against the new workspace and it keeps no brand kit or folder.
 */
export const duplicatePresentation = async (presentationId: string, ctx: PolicyContext) => {
  assertCan(ctx, 'deck:create');
  const source = await authorizeDeck(presentationId, ctx, 'deck:read');
  return copyDeckForWorkspace(source, ctx, { title: copyTitle(source.title, MAX_DECK_TITLE), keepFolder: true });
};

export interface DeckCopyOptions {
  title: string;
  /** Keep the source's folder (same workspace only). */
  keepFolder?: boolean;
  /** Make the copy a workspace template (W3-B2), hidden from the library. */
  isTemplate?: boolean;
  /** The template the copy was made from or the deck a template was saved from. */
  templateSourceId?: mongoose.Types.ObjectId | null;
}

/**
 * A new draft deck in the caller's current workspace with the content of
 * `source`: every slide (new slide and option ids), pace, settings and theme.
 * The caller has checked `deck:create` and read access to `source`. A source
 * from another workspace (a pre-workspace deck) has its media checked against
 * the new one and keeps no brand kit or folder. Shared by duplicate and the
 * templates module ("Save as template", "Use template").
 */
export const copyDeckForWorkspace = async (source: IPresentation, ctx: PolicyContext, options: DeckCopyOptions) => {
  const plain = (typeof source.toObject === 'function' ? source.toObject() : source) as IPresentation;
  // assertCan('deck:create') only passes with an active membership of a workspace.
  const workspaceId = String(ctx.workspace!._id);
  const sameWorkspace = plain.workspaceId != null && String(plain.workspaceId) === workspaceId;

  const slides = (plain.slides as StoredSlide[]).map(copySlide);
  if (!sameWorkspace) await assertContentMediaInWorkspace(slides, workspaceId);
  const theme = plain.theme ?? null;

  return createWithJoinCode({
    title: options.title,
    slides,
    pace: plain.pace,
    settings: plain.settings,
    ...(theme
      ? { theme: { presetId: theme.presetId, brandKitId: sameWorkspace ? theme.brandKitId : null, overrides: theme.overrides } }
      : {}),
    folderId: options.keepFolder && sameWorkspace ? plain.folderId : null,
    isTemplate: options.isTemplate ?? false,
    templateSourceId: options.templateSourceId ?? null,
    creatorId: ctx.user!.id,
    workspaceId,
  });
};

/**
 * Decks of the actor's current workspace, most recently updated first. In
 * their personal workspace a user also sees their own decks that predate
 * workspaces (no `workspaceId` until migration 020 backfills it).
 */
export interface ListContext extends PolicyContext {
  workspace?: { _id: { toString(): string }; type?: string; ownerId?: unknown } | null;
}

export const listPresentations = async (ctx: ListContext) => {
  assertCan(ctx, 'deck:read');
  const userId = ctx.user!.id;
  const workspace = ctx.workspace!;
  const scopes: Record<string, unknown>[] = [{ workspaceId: workspace._id }];
  if (workspace.type === 'personal' && String(workspace.ownerId) === userId) {
    scopes.push({ workspaceId: null, creatorId: userId });
  }
  // Templates live on the templates page (`modules/templates`), not among the decks.
  return PresentationModel.find({ $or: scopes, deletedAt: null, isTemplate: { $ne: true } }).sort({ updatedAt: -1 });
};

/** Edits are refused while a session is live (the session runs on a snapshot, but the mirror would drift). */
const assertEditable = (presentation: IPresentation) => {
  if (presentation.status !== 'draft' && presentation.status !== 'ended') {
    throw ApiError.badRequest('Cannot edit a presentation deck while a live session is running');
  }
};

const currentRevision = (presentation: IPresentation) => presentation.revision ?? 0;

/** The deck's workspace (or, for a deck from before workspaces, the actor's) for media checks. */
const mediaWorkspaceOf = (presentation: IPresentation, actor: Actor) =>
  presentation.workspaceId ?? (typeof actor !== 'string' && actor.workspace ? actor.workspace._id : undefined);

/**
 * Request slides as stored slides. A slide that names the id of one of the
 * deck's slides keeps it (co-editors and the slide-level routes address
 * slides by id); unknown and repeated ids are dropped and get a new one.
 */
const withKnownIds = (presentation: IPresentation, slides: EditableSlide[]): IPresentationSlide[] => {
  const known = new Set(presentation.slides.map((slide) => String(slide._id)));
  const used = new Set<string>();
  // Request slides carry a string id; MCP passes stored slides with their ObjectId.
  return slides.map(({ _id, ...slide }) => {
    const id = _id == null ? null : String(_id).toLowerCase();
    if (id && known.has(id) && !used.has(id)) {
      used.add(id);
      return { ...slide, _id: new mongoose.Types.ObjectId(id) } as unknown as IPresentationSlide;
    }
    return slide as unknown as IPresentationSlide;
  });
};

export interface UpdateOptions {
  /** The `__v` the caller read (MCP): any save in between is a 409. */
  expectedVersion?: number;
  /** The `revision` the caller read (`If-Match`): a title or slide save in between is a 409. */
  expectedRevision?: number;
}

/**
 * Whether a patch only switches embedding (`settings.embed`): the one deck
 * setting a presenter may change while a session is live (W4-D), e.g. to put
 * the stage on a second screen mid-session. It changes nothing the running
 * session reads (that runs from its snapshot).
 */
export const isEmbedOnlyPatch = (data: UpdatePresentationInput): boolean => {
  const fields = Object.entries(data).filter(([, value]) => value !== undefined);
  if (fields.length !== 1 || fields[0]![0] !== 'settings') return false;
  const settings = Object.entries(data.settings ?? {}).filter(([, value]) => value !== undefined);
  return settings.length === 1 && settings[0]![0] === 'embed';
};

/** Turning embedding off sends the deck's connected screens away at once, on every instance (W4-D). */
const afterUpdate = async (presentationId: string, data: UpdatePresentationInput) => {
  if (data.settings?.embed?.allowed === false) {
    await announceScreensRevoked({ presentationId, reason: 'embed_disabled' });
  }
};

/**
 * `expectedVersion` (the `__v` the caller read) and `expectedRevision` (the
 * `revision`, from `If-Match`) turn a read-modify-write of the slides into a
 * compare-and-set: another save in between is a 409 instead of a silent lost
 * update. Saves are versioned (optimisticConcurrency), so two writers that
 * both read the same revision cannot both win.
 */
export const updatePresentation = async (
  presentationId: string,
  actor: Actor,
  data: UpdatePresentationInput,
  options: UpdateOptions = {},
) => {
  const presentation = await authorizeDeck(presentationId, actor, 'deck:edit');
  const live = presentation.status !== 'draft' && presentation.status !== 'ended';
  // While live, only the embedding switch may change (W4-D).
  if (!live || !isEmbedOnlyPatch(data)) assertEditable(presentation);
  if (options.expectedVersion !== undefined && presentation.get('__v') !== options.expectedVersion) throw deckChanged();
  if (options.expectedRevision !== undefined && currentRevision(presentation) !== options.expectedRevision) {
    throw deckChanged(currentRevision(presentation));
  }
  if (live) {
    // One atomic $set: the live session's deck mirror (status, current slide) is written by
    // host commands at the same time, and a whole-document save could race them. Settings
    // are not content: the revision stays.
    const $set = Object.fromEntries(toPaths(data.settings ?? {}, 'settings'));
    const updated = await PresentationModel.findOneAndUpdate({ _id: presentation._id }, { $set }, { returnDocument: 'after' });
    if (!updated) throw ApiError.notFound('Presentation deck not found');
    await afterUpdate(presentationId, data);
    return updated;
  }
  if (data.slides !== undefined) {
    const workspaceId = mediaWorkspaceOf(presentation, actor);
    if (workspaceId) await assertContentMediaInWorkspace(data.slides, String(workspaceId));
  }
  const contentChanged = data.slides !== undefined || (data.title !== undefined && data.title !== presentation.title);
  if (data.title !== undefined) presentation.title = data.title;
  if (data.slides !== undefined) presentation.slides = withKnownIds(presentation, data.slides);
  if (contentChanged) presentation.revision = currentRevision(presentation) + 1;
  if (data.pace !== undefined) presentation.pace = data.pace;
  // Settings are patched field by field: omitted fields keep their value.
  for (const [path, value] of toPaths(data.settings ?? {}, 'settings')) {
    presentation.set(path, value);
  }
  // Theme fields are replaced whole (overrides is one object), after checking them against the deck's workspace.
  if (data.theme) {
    const workspace = presentation.workspaceId ? await WorkspaceModel.findById(presentation.workspaceId).lean() : null;
    const theme = await assertThemeChoice(data.theme, workspace);
    for (const key of ['presetId', 'brandKitId', 'overrides'] as const) {
      if (theme[key] !== undefined) presentation.set(`theme.${key}`, theme[key]);
    }
  }
  try {
    await presentation.save();
  } catch (error) {
    if (error instanceof mongoose.Error.VersionError) throw deckChanged();
    throw error;
  }
  await afterUpdate(presentationId, data);
  return presentation;
};

// ---------- Slide-level edits (W3-B2) ----------

/** Retries of a slide edit sent without `If-Match` when a concurrent save won the race. */
const SLIDE_EDIT_ATTEMPTS = 3;

const slideNotFound = () => new ApiError(404, 'Slide not found', 'SLIDE_NOT_FOUND');

/**
 * Runs one slide edit as a compare-and-set on the deck. With `expectedRevision`
 * a save in between is a 409; without it the edit is re-applied on the fresh
 * deck (it only touches the slide it names, so other people's edits survive).
 * Every edit bumps `revision`.
 */
async function editSlides<T>(
  presentationId: string,
  actor: Actor,
  expectedRevision: number | undefined,
  apply: (presentation: IPresentation) => Promise<T> | T,
): Promise<{ presentation: IPresentation; result: T }> {
  for (let attempt = 1; ; attempt++) {
    const presentation = await authorizeDeck(presentationId, actor, 'deck:edit');
    assertEditable(presentation);
    if (expectedRevision !== undefined && currentRevision(presentation) !== expectedRevision) {
      throw deckChanged(currentRevision(presentation));
    }
    const result = await apply(presentation);
    presentation.revision = currentRevision(presentation) + 1;
    try {
      await presentation.save();
      return { presentation, result };
    } catch (error) {
      if (!(error instanceof mongoose.Error.VersionError)) throw error;
      if (expectedRevision !== undefined || attempt >= SLIDE_EDIT_ATTEMPTS) throw deckChanged();
    }
  }
}

const indexOfSlide = (presentation: IPresentation, slideId: string) =>
  mongoose.isValidObjectId(slideId)
    ? presentation.slides.findIndex((slide) => String(slide._id) === slideId.toLowerCase())
    : -1;

/** Issues of a slide schema as one 400 message (the format `validate()` uses). */
const invalidSlide = (issues: { path: PropertyKey[]; message: string }[]) =>
  ApiError.badRequest(issues.map((issue) => `${issue.path.map(String).join('.')}: ${issue.message}`).join('; '));

type StoredSlideDoc = IPresentationSlide & { toObject?: () => Record<string, unknown> };

const plainSlide = (slide: StoredSlideDoc): Record<string, unknown> =>
  slide.toObject ? slide.toObject() : { ...(slide as unknown as Record<string, unknown>) };

/** Adds one slide at `index` (default: the end). Returns the deck and the new slide's id. */
export const insertSlide = async (
  presentationId: string,
  actor: Actor,
  input: InsertSlideInput,
  expectedRevision?: number,
) => {
  const { presentation, result } = await editSlides(presentationId, actor, expectedRevision, async (deck) => {
    if (deck.slides.length >= MAX_DECK_SLIDES) {
      throw new ApiError(400, `A presentation deck holds at most ${MAX_DECK_SLIDES} slides`, 'TOO_MANY_SLIDES');
    }
    const workspaceId = mediaWorkspaceOf(deck, actor);
    if (workspaceId) await assertContentMediaInWorkspace([input.slide], String(workspaceId));
    const index = Math.min(input.index ?? deck.slides.length, deck.slides.length);
    const _id = new mongoose.Types.ObjectId();
    deck.slides.splice(index, 0, { ...input.slide, _id } as unknown as IPresentationSlide);
    return String(_id);
  });
  return { presentation, slideId: result };
};

/**
 * Changes some fields of one slide: they are merged onto the stored slide and
 * the whole slide is validated again by its type (a `type` change included).
 * The slide keeps its id and position.
 */
export const updateSlide = async (
  presentationId: string,
  actor: Actor,
  slideId: string,
  patch: PatchSlideInput,
  expectedRevision?: number,
) => {
  const { presentation } = await editSlides(presentationId, actor, expectedRevision, async (deck) => {
    const index = indexOfSlide(deck, slideId);
    if (index < 0) throw slideNotFound();
    const stored = deck.slides[index]! as StoredSlideDoc;
    const { _id, kind, ...current } = plainSlide(stored);
    const parsed = presentationSlideSchema.safeParse({ ...current, ...patch });
    if (!parsed.success) throw invalidSlide(parsed.error.issues);
    const workspaceId = mediaWorkspaceOf(deck, actor);
    if (workspaceId) await assertContentMediaInWorkspace([parsed.data], String(workspaceId));
    deck.slides.splice(index, 1, { ...parsed.data, _id: stored._id } as unknown as IPresentationSlide);
  });
  return presentation;
};

/** Removes one slide; a deck keeps at least one. */
export const deleteSlide = async (presentationId: string, actor: Actor, slideId: string, expectedRevision?: number) => {
  const { presentation } = await editSlides(presentationId, actor, expectedRevision, (deck) => {
    const index = indexOfSlide(deck, slideId);
    if (index < 0) throw slideNotFound();
    if (deck.slides.length === 1) {
      throw new ApiError(400, 'A presentation deck must contain at least one slide', 'LAST_SLIDE');
    }
    deck.slides.splice(index, 1);
  });
  return presentation;
};

/**
 * Puts the slides in `order` (every slide id of the deck, once). An order that
 * names other slides than the deck has now (someone added or removed one) is
 * a 409 `DECK_CHANGED`: the caller is reordering a deck it has not seen.
 */
export const reorderSlides = async (
  presentationId: string,
  actor: Actor,
  input: ReorderSlidesInput,
  expectedRevision?: number,
) => {
  const { presentation } = await editSlides(presentationId, actor, expectedRevision, (deck) => {
    const byId = new Map(deck.slides.map((slide) => [String(slide._id), slide as StoredSlideDoc]));
    if (input.order.length !== byId.size || input.order.some((id) => !byId.has(id))) {
      throw deckChanged(currentRevision(deck));
    }
    deck.slides = input.order.map((id) => plainSlide(byId.get(id)!)) as unknown as IPresentationSlide[];
  });
  return presentation;
};

/** Deletes the deck with every session, participant, answer and Redis key it has. */
export const deletePresentation = async (presentationId: string, actor: Actor) => {
  await authorizeDeck(presentationId, actor, 'deck:delete');
  const sessions = await PresentationSessionModel.find({ presentationId }).select('_id deckSnapshot').lean();
  const keys = [
    k.active(presentationId),
    ...sessions.flatMap((session) =>
      allSessionKeys(
        String(session._id),
        (session.deckSnapshot ?? []).map((slide) => String(slide._id))
      )
    ),
  ];
  await Promise.all([
    PresentationModel.findByIdAndDelete(presentationId),
    PresentationSessionModel.deleteMany({ presentationId }),
    PresentationParticipantModel.deleteMany({ presentationId }),
    PresentationAnswerModel.deleteMany({ presentationId }),
    ResourceShareModel.deleteMany({ resourceType: 'presentation', resourceId: presentationId }),
    redisClient.del(keys).catch(() => {}),
  ]);
};
