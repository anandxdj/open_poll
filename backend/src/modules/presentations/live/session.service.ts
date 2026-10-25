import mongoose from 'mongoose';
import { ApiError } from '../../../common/utils/ApiError';
import { redisClient } from '../../../common/config/redis';
import { getEntitlements } from '../../../common/plans/entitlements';
import { WorkspaceModel } from '../../workspaces/workspace.model';
import { resolveTheme } from '../../themes/resolve';
import { PresentationModel, type IPresentation } from '../models/presentation.model';
import { PresentationParticipantModel } from '../models/participant.model';
import {
  PresentationSessionModel,
  type IPresentationSession,
  type ISessionEntitlements,
  type ISlideState,
} from '../models/session.model';
import { isSlideScored, requireSlideType, toParticipantSlide } from '../slides';
import { actorUserId, authorizeDeck, getPresentationById, type Actor } from '../access';
import {
  LIVE_ERROR_CODES,
  type HostStateResponse,
  type SessionListItem,
  type SessionView,
  type SlideResultsView,
} from './contract';
import { SESSION_KEY_TTL_SEC, allSessionKeys, k, slideKeys, touchTtls } from './keys';
import { computeSlideDistributionHelper, getLeaderboard } from './distribution';
import {
  publishLeaderboardShown,
  publishQuestionRevealed,
  publishQuestionStarted,
  publishSessionEnded,
  publishSessionLobby,
  publishSlideClosed,
  publishSlideShown,
} from './events';
import {
  buildAnswerWindow,
  cacheAnswerWindow,
  findLatestSession,
  findLiveSession,
  isOpenState,
  lifecycleOf,
  readSlideState,
  sessionSlides,
  slideIdOf,
  slidePhase,
  windowEnd,
  writeSlideState,
  type Slide,
} from './state';
import { answeredCounts, buildSessionView, sessionListItem, slideStateView, visitedSlides } from './views';
import { buildSessionSnapshot } from './snapshot';
import { issueSlideTicket } from './ticket';
import { flushDirty } from './coalescer';
import { AUTO_REVEAL_DELAY_MS } from './autoReveal';
import { autoReveals } from '../../../common/observability/metrics';

export { loadAnswerWindow, type AnswerWindow } from './state';

/**
 * The session engine. Every run of a deck is a PresentationSession; the deck
 * keeps a mirror of its live session (status, current slide, timing) that only
 * this file writes. Host commands load the deck (policy `deck:host`) and its
 * live session, change the session document (optimistic concurrency guards
 * double clicks), mirror the deck, refresh the Redis answer windows, then
 * publish one event.
 */

export interface HostCommandResult {
  presentation: IPresentation;
  session: SessionView;
}

const busy = () =>
  new ApiError(409, 'Another host action changed this session; retry', LIVE_ERROR_CODES.sessionBusy);

const noLiveSession = () =>
  new ApiError(400, 'This presentation has no live session', LIVE_ERROR_CODES.noLiveSession);

const saveSession = async (session: IPresentationSession) => {
  try {
    await session.save();
  } catch (error) {
    if (error instanceof mongoose.Error.VersionError) throw busy();
    throw error;
  }
};

const result = async (presentation: IPresentation, session: IPresentationSession): Promise<HostCommandResult> => ({
  presentation,
  session: await buildSessionView(session),
});

// ---------------------------------------------------------------------------
// Deck mirror
// ---------------------------------------------------------------------------

/** Copies the session's state onto the deck (in memory and in Mongo). */
const mirrorDeck = async (presentation: IPresentation, session: IPresentationSession) => {
  const slides = sessionSlides(session);
  const currentId = session.currentSlideId ? String(session.currentSlideId) : null;
  const current = currentId ? slides.find((slide) => slideIdOf(slide) === currentId) : undefined;
  const state = currentId ? readSlideState(session, currentId) : null;
  const timed = current && lifecycleOf(current.type) === 'response' && state?.openedAt;

  const mirror = {
    status: session.isLive ? session.status : ('ended' as const),
    currentSlideIndex: session.currentSlideIndex,
    questionStartedAt: timed ? state!.openedAt : null,
    questionEndsAt: timed ? windowEnd(state) : null,
    activeSessionId: session.isLive ? session._id : null,
    lastSessionAt: session.startedAt,
    sessionCount: Math.max(presentation.sessionCount ?? 0, session.runNumber),
  };
  Object.assign(presentation, mirror);
  await PresentationModel.updateOne({ _id: presentation._id }, { $set: mirror });
};

// ---------------------------------------------------------------------------
// Opening and ending sessions
// ---------------------------------------------------------------------------

/**
 * The deck's workspace entitlements, snapshotted at open. Decks without a
 * workspace use the actor's current workspace when there is one, else the free
 * plan. Retention is the workspace's setting capped by the plan.
 */
const sessionEntitlements = async (presentation: IPresentation, actor: Actor): Promise<ISessionEntitlements> => {
  const workspaceId =
    presentation.workspaceId ?? (typeof actor === 'string' ? null : (actor.workspace?._id ?? null));
  const workspace = workspaceId ? await WorkspaceModel.findById(workspaceId).lean() : null;
  const { plan, limits } = getEntitlements(workspace ?? { plan: 'free' });
  const chosen = workspace?.settings?.retentionDays ?? null;
  const retentionDays =
    limits.retentionDays === null ? chosen : Math.min(chosen ?? limits.retentionDays, limits.retentionDays);
  return { plan, audienceCap: limits.audienceCap, retentionDays };
};

const createSession = async (presentation: IPresentation, actor: Actor): Promise<IPresentationSession> => {
  const [themeSnapshot, entitlementsSnapshot] = await Promise.all([
    resolveTheme(presentation.theme),
    sessionEntitlements(presentation, actor),
  ]);
  const runNumber = (presentation.sessionCount ?? 0) + 1;
  let session: IPresentationSession;
  try {
    session = await PresentationSessionModel.create({
      presentationId: presentation._id,
      workspaceId: presentation.workspaceId ?? null,
      hostUserId: actorUserId(actor),
      runNumber,
      pace: presentation.pace ?? 'presenter',
      status: 'lobby',
      isLive: true,
      joinCode: presentation.joinCode,
      startedAt: new Date(),
      currentSlideId: null,
      currentSlideIndex: -1,
      deckSnapshot: presentation.slides.map((slide) =>
        typeof (slide as any).toObject === 'function' ? (slide as any).toObject() : slide
      ),
      themeSnapshot,
      settingsSnapshot: (presentation.settings as any)?.toObject?.() ?? presentation.settings ?? null,
      entitlementsSnapshot,
    });
  } catch (error: any) {
    // The one-live-session index: another open won the race.
    if (error?.code === 11000) throw busy();
    throw error;
  }

  const sid = String(session._id);
  try {
    await Promise.all([
      redisClient.set(k.active(String(presentation._id)), sid, { EX: SESSION_KEY_TTL_SEC }),
      redisClient.hSet(k.meta(sid), {
        presentationId: String(presentation._id),
        pace: session.pace,
        status: session.status,
        cap: entitlementsSnapshot.audienceCap === null ? '' : String(entitlementsSnapshot.audienceCap),
        runNumber: String(runNumber),
        totalSlides: String(session.deckSnapshot.length),
      }),
    ]);
    await touchTtls([k.meta(sid)]);
  } catch (error) {
    console.error('[Presentation] Failed to cache the new session:', error);
  }
  return session;
};

/** The window entry of an open response slide after it closes (left, closed, revealed or ended). */
const cacheClosedWindow = async (session: IPresentationSession, slideId: string) => {
  const slides = sessionSlides(session);
  const index = slides.findIndex((slide) => slideIdOf(slide) === slideId);
  const state = readSlideState(session, slideId);
  if (index < 0 || !state?.openedAt || lifecycleOf(slides[index]!.type) !== 'response') return;
  await cacheAnswerWindow(String(session._id), buildAnswerWindow(slides[index]!, index, state, false));
};

/** Closes the current slide when it is an open response slide. Returns its id when it did. */
const closeCurrentIfOpen = (session: IPresentationSession, now: Date): string | null => {
  const slideId = session.currentSlideId ? String(session.currentSlideId) : null;
  if (!slideId) return null;
  const state = readSlideState(session, slideId);
  if (!isOpenState(state)) return null;
  writeSlideState(session, slideId, { closedAt: now, pausedRemainingMs: null });
  return slideId;
};

const retainUntilFor = (session: IPresentationSession, endedAt: Date) => {
  const days = session.entitlementsSnapshot?.retentionDays;
  return days == null ? null : new Date(endedAt.getTime() + days * 24 * 3600 * 1000);
};

/**
 * Ends a live session: closes its current slide, reconciles Redis into Mongo,
 * stores the snapshot and retention, keeps the Redis keys readable for final
 * screens, and publishes `session:ended` (+ legacy `quiz:ended`).
 */
const finishSession = async (presentation: IPresentation, session: IPresentationSession) => {
  const now = new Date();
  const closed = closeCurrentIfOpen(session, now);
  session.status = 'ended';
  session.isLive = false;
  session.endedAt = now;
  session.retainUntil = retainUntilFor(session, now);
  await saveSession(session);

  const sid = String(session._id);
  const pid = String(presentation._id);
  if (closed) await cacheClosedWindow(session, closed);
  try {
    await redisClient.hSet(k.meta(sid), 'status', 'ended');
    if ((await redisClient.get(k.active(pid))) === sid) await redisClient.del(k.active(pid));
  } catch (error) {
    console.error('[Presentation] Failed to update the ended session in Redis:', error);
  }

  await flushDirty(pid, sid); // last host update goes out before session:ended
  const snapshot = await buildSessionSnapshot(session);
  Object.assign(session, snapshot);
  await saveSession(session);
  await touchTtls(allSessionKeys(sid, sessionSlides(session).map(slideIdOf)));

  await publishSessionEnded(pid, sid, {
    runNumber: session.runNumber,
    endedAt: now.toISOString(),
    leaderboard: snapshot.finalLeaderboard,
    participantCount: snapshot.participantCount,
    answerCount: snapshot.answerCount,
  });
};

const requireLiveSession = async (presentationId: string) => {
  const session = await findLiveSession(presentationId);
  if (!session) throw noLiveSession();
  return session;
};

// ---------------------------------------------------------------------------
// Moving between slides
// ---------------------------------------------------------------------------

const resultsOf = async (session: IPresentationSession, slide: Slide, slideIndex: number): Promise<SlideResultsView> => {
  const slideId = slideIdOf(slide);
  const { distribution, answeredCount, participantCount } = await computeSlideDistributionHelper(
    String(session._id),
    slideId,
    slide
  );
  return {
    slideId,
    slideIndex,
    type: slide.type,
    scored: isSlideScored(slide),
    answeredCount,
    participantCount,
    distribution,
  };
};

const publishRevealed = async (
  pid: string,
  session: IPresentationSession,
  slide: Slide,
  slideIndex: number,
  state: ISlideState,
  revisit: boolean
) => {
  const slides = sessionSlides(session);
  const results = await resultsOf(session, slide, slideIndex);
  await touchTtls(slideKeys(String(session._id), results.slideId));
  await publishQuestionRevealed(pid, String(session._id), {
    slideId: results.slideId,
    slideIndex,
    slide: toParticipantSlide(slide, slideIndex, slides.length),
    question: slide.question,
    type: slide.type,
    scored: results.scored,
    distribution: results.distribution,
    answeredCount: results.answeredCount,
    participantCount: results.participantCount,
    isLastSlide: slideIndex === slides.length - 1,
    auto: true,
    revealedAt: (state.revealedAt ?? new Date()).toISOString(),
    revisit,
  });
};

const publishClosed = async (
  pid: string,
  session: IPresentationSession,
  slide: Slide,
  slideIndex: number,
  state: ISlideState,
  revisit: boolean
) => {
  const slides = sessionSlides(session);
  const results = await resultsOf(session, slide, slideIndex);
  await publishSlideClosed(pid, String(session._id), {
    slideId: results.slideId,
    slideIndex,
    slide: toParticipantSlide(slide, slideIndex, slides.length),
    closedAt: (windowEnd(state) ?? new Date()).toISOString(),
    answeredCount: results.answeredCount,
    participantCount: results.participantCount,
    isLastSlide: slideIndex === slides.length - 1,
    revisit,
    serverNow: new Date().toISOString(),
  });
};

const publishOpened = async (
  pid: string,
  session: IPresentationSession,
  slide: Slide,
  slideIndex: number,
  state: ISlideState,
  reopened: boolean
) => {
  const slides = sessionSlides(session);
  await publishQuestionStarted(pid, String(session._id), {
    slideId: slideIdOf(slide),
    slideIndex,
    slide: toParticipantSlide(slide, slideIndex, slides.length),
    startedAt: state.openedAt!.toISOString(),
    endsAt: state.endsAt ? state.endsAt.toISOString() : null,
    serverNow: new Date().toISOString(),
    isLastSlide: slideIndex === slides.length - 1,
    reopened,
    slideTicket: issueSlideTicket(String(session._id), slideIdOf(slide), state.openedAt!.getTime()),
  });
};

/** A fresh answer window for a response slide: the slide's timer, or untimed when 0. */
const openState = (slide: Slide, now: Date): Partial<ISlideState> => ({
  openedAt: now,
  endsAt: slide.timeLimit > 0 ? new Date(now.getTime() + slide.timeLimit * 1000) : null,
  pausedRemainingMs: null,
  closedAt: null,
  revealedAt: null,
});

const resolveTarget = (session: IPresentationSession, target: { slideIndex?: number; slideId?: string }) => {
  const slides = sessionSlides(session);
  const index =
    target.slideId !== undefined
      ? slides.findIndex((slide) => slideIdOf(slide) === target.slideId)
      : (target.slideIndex ?? -1);
  if (!Number.isInteger(index) || index < 0 || index >= slides.length) {
    throw ApiError.badRequest('Slide index out of bounds');
  }
  return { slide: slides[index]!, index };
};

/**
 * Makes a slide current, in either direction. The slide's lifecycle and stored
 * state decide what happens:
 * - `response`, first visit: opens its answer window → `question:started`;
 * - `response`, revisited: comes back closed with its stored results →
 *   `question:revealed` (after a reveal) or `slide:closed`;
 * - `system` (leaderboard) → `leaderboard:shown`; `content`/`board` → `slide:shown`.
 * Leaving an open response slide closes it.
 */
const moveTo = async (
  presentation: IPresentation,
  session: IPresentationSession,
  target: { slideIndex?: number; slideId?: string }
): Promise<HostCommandResult> => {
  const { slide, index } = resolveTarget(session, target);
  const slideId = slideIdOf(slide);
  if (session.status === 'active' && String(session.currentSlideId) === slideId) {
    return result(presentation, session);
  }
  const def = requireSlideType(slide.type);
  const now = new Date();
  const left = closeCurrentIfOpen(session, now);

  const visited = readSlideState(session, slideId);
  if (!visited) {
    writeSlideState(session, slideId, def.lifecycle === 'response' ? openState(slide, now) : { openedAt: now });
  }
  session.status = 'active';
  session.currentSlideId = slide._id as mongoose.Types.ObjectId;
  session.currentSlideIndex = index;
  await saveSession(session);
  await mirrorDeck(presentation, session);

  const sid = String(session._id);
  const pid = String(presentation._id);
  const state = readSlideState(session, slideId)!;
  try {
    await Promise.all([
      redisClient.set(k.current(sid), slideId, { EX: SESSION_KEY_TTL_SEC }),
      redisClient.hSet(k.meta(sid), 'status', 'active'),
    ]);
  } catch (error) {
    console.error('[Presentation] Failed to cache the current slide:', error);
  }
  if (left) {
    await cacheClosedWindow(session, left);
    await flushDirty(pid, sid); // the host sees the last counts of the slide it leaves, before the move
  }
  if (def.lifecycle === 'response') {
    await cacheAnswerWindow(sid, buildAnswerWindow(slide, index, state, true));
  }

  const slides = sessionSlides(session);
  const isLastSlide = index === slides.length - 1;
  if (def.lifecycle === 'system') {
    const [leaderboard, participantCount] = await Promise.all([
      getLeaderboard(sid),
      redisClient.hLen(k.names(sid)).catch(() => 0),
    ]);
    await publishLeaderboardShown(pid, sid, {
      slideId,
      slideIndex: index,
      slide: toParticipantSlide(slide, index, slides.length),
      leaderboard,
      participantCount:
        participantCount > 0 ? participantCount : await PresentationParticipantModel.countDocuments({ sessionId: sid }),
      isLastSlide,
    });
  } else if (def.lifecycle !== 'response') {
    await publishSlideShown(pid, sid, {
      slideId,
      slideIndex: index,
      slide: toParticipantSlide(slide, index, slides.length),
      isLastSlide,
      serverNow: new Date().toISOString(),
    });
  } else if (!visited) {
    await publishOpened(pid, session, slide, index, state, false);
  } else if (state.revealedAt) {
    await publishRevealed(pid, session, slide, index, state, true);
  } else {
    await publishClosed(pid, session, slide, index, state, true);
  }
  return result(presentation, session);
};

// ---------------------------------------------------------------------------
// Host commands
// ---------------------------------------------------------------------------

/**
 * Opens a new session in the lobby. A live session is ended first (snapshot
 * included); nothing is ever deleted, so every run stays in the history.
 */
export const openLobby = async (presentationId: string, actor: Actor): Promise<HostCommandResult> => {
  const presentation = await authorizeDeck(presentationId, actor, 'deck:host');
  const live = await findLiveSession(presentationId);
  if (live) await finishSession(presentation, live);

  const session = await createSession(presentation, actor);
  await mirrorDeck(presentation, session);
  await publishSessionLobby(presentationId, String(session._id), {
    runNumber: session.runNumber,
    joinCode: session.joinCode,
    pace: session.pace,
  });
  return result(presentation, session);
};

/**
 * Presents without a lobby: a session waiting in its lobby starts at slide 0;
 * without a live session a new one opens straight on slide 0.
 */
export const startSession = async (presentationId: string, actor: Actor): Promise<HostCommandResult> => {
  const presentation = await authorizeDeck(presentationId, actor, 'deck:host');
  const live: IPresentationSession | null = await findLiveSession(presentationId);
  if (live?.status === 'active') {
    throw new ApiError(
      409,
      'This presentation is already being presented; end it or open a new lobby',
      LIVE_ERROR_CODES.sessionAlreadyLive
    );
  }
  const session = live ?? (await createSession(presentation, actor));
  return moveTo(presentation, session, { slideIndex: 0 });
};

/** Moves the live session to any slide, forwards or backwards (from the lobby too). */
export const gotoSlide = async (
  presentationId: string,
  actor: Actor,
  target: { slideIndex?: number; slideId?: string }
): Promise<HostCommandResult> => {
  const presentation = await authorizeDeck(presentationId, actor, 'deck:host');
  const session = await requireLiveSession(presentationId);
  return moveTo(presentation, session, target);
};

/** Legacy `advance`: `goto` the given index, default the next slide. */
export const advanceSlide = async (
  presentationId: string,
  actor: Actor,
  targetIndex?: number
): Promise<HostCommandResult> => {
  const presentation = await authorizeDeck(presentationId, actor, 'deck:host');
  const session = await requireLiveSession(presentationId);
  return moveTo(presentation, session, { slideIndex: targetIndex ?? session.currentSlideIndex + 1 });
};

/** The live session's current slide, which must be a response slide. */
const currentResponseSlide = (session: IPresentationSession, verb: string) => {
  const slides = sessionSlides(session);
  const index = session.currentSlideIndex;
  const slide = slides[index];
  if (session.status !== 'active' || !slide) throw ApiError.badRequest(`No live slide to ${verb}`);
  const def = requireSlideType(slide.type);
  if (def.lifecycle !== 'response') throw ApiError.badRequest(`${def.name} slides have nothing to ${verb}`);
  const slideId = slideIdOf(slide);
  return { slide, index, slideId, state: readSlideState(session, slideId) };
};

/** Stops answers on the current response slide without revealing results. No-op once closed. */
export const closeCurrentSlide = async (presentationId: string, actor: Actor): Promise<HostCommandResult> => {
  const presentation = await authorizeDeck(presentationId, actor, 'deck:host');
  const session = await requireLiveSession(presentationId);
  const { slide, index, slideId, state } = currentResponseSlide(session, 'close');
  if (!isOpenState(state)) return result(presentation, session);

  writeSlideState(session, slideId, { closedAt: new Date(), pausedRemainingMs: null });
  await saveSession(session);
  await mirrorDeck(presentation, session);
  await cacheClosedWindow(session, slideId);
  await flushDirty(String(presentation._id), String(session._id));
  await publishClosed(String(presentation._id), session, slide, index, readSlideState(session, slideId)!, false);
  return result(presentation, session);
};

/**
 * Re-opens the current closed or revealed response slide with a fresh timer.
 * Answers already given stay (and those participants cannot answer again).
 */
export const reopenCurrentSlide = async (presentationId: string, actor: Actor): Promise<HostCommandResult> => {
  const presentation = await authorizeDeck(presentationId, actor, 'deck:host');
  const session = await requireLiveSession(presentationId);
  const { slide, index, slideId, state } = currentResponseSlide(session, 'reopen');
  if (slidePhase('response', state) === 'open') return result(presentation, session);

  writeSlideState(session, slideId, openState(slide, new Date()));
  await saveSession(session);
  await mirrorDeck(presentation, session);
  const opened = readSlideState(session, slideId)!;
  await cacheAnswerWindow(String(session._id), buildAnswerWindow(slide, index, opened, true));
  await publishOpened(String(presentation._id), session, slide, index, opened, true);
  return result(presentation, session);
};

/**
 * Reveals the current response slide's results. Closes it first, so no answer
 * is accepted after a reveal. Repeatable: later calls re-broadcast.
 */
export const revealCurrentSlide = async (presentationId: string, actor: Actor): Promise<HostCommandResult> => {
  const presentation = await authorizeDeck(presentationId, actor, 'deck:host');
  const session = await findLiveSession(presentationId);
  if (!session) throw new ApiError(400, 'No live slide to reveal', LIVE_ERROR_CODES.noLiveSession);
  const { slide, index, slideId, state } = currentResponseSlide(session, 'reveal');

  if (!state?.revealedAt) {
    const now = new Date();
    writeSlideState(session, slideId, {
      closedAt: state?.closedAt ?? now,
      revealedAt: now,
      pausedRemainingMs: null,
    });
    await saveSession(session);
    await mirrorDeck(presentation, session);
    await cacheClosedWindow(session, slideId);
  }
  await flushDirty(String(presentation._id), String(session._id));
  await publishRevealed(String(presentation._id), session, slide, index, readSlideState(session, slideId)!, false);
  return result(presentation, session);
};

/**
 * Reveals a scored, timed slide on its own once its timer plus the auto-reveal
 * delay has passed (`autoReveal.ts` schedules it; the poller calls this). It
 * does what the host's reveal does, without a host: the slide must still be the
 * current open one, so a host who closed, revealed, paused or moved on first
 * wins. `retry` means "try again shortly" (not due yet, or a host command held
 * the session); the caller reschedules.
 */
export const autoRevealSlide = async (sessionId: string, slideId: string): Promise<'revealed' | 'skipped' | 'retry'> => {
  const session: IPresentationSession | null = await PresentationSessionModel.findById(sessionId);
  if (!session || !session.isLive || session.status !== 'active' || session.pace !== 'presenter') return 'skipped';
  if (!session.currentSlideId || String(session.currentSlideId) !== slideId) return 'skipped';

  const slides = sessionSlides(session);
  const index = slides.findIndex((slide) => slideIdOf(slide) === slideId);
  const slide = slides[index];
  const state = readSlideState(session, slideId);
  if (!slide || lifecycleOf(slide.type) !== 'response' || !isSlideScored(slide)) return 'skipped';
  if (!isOpenState(state) || !state?.endsAt || state.pausedRemainingMs !== null) return 'skipped';
  if (Date.now() < state.endsAt.getTime() + AUTO_REVEAL_DELAY_MS) return 'retry';

  let presentation: IPresentation;
  try {
    presentation = await getPresentationById(String(session.presentationId));
  } catch {
    return 'skipped';
  }
  const now = new Date();
  writeSlideState(session, slideId, { closedAt: now, revealedAt: now, pausedRemainingMs: null });
  try {
    await saveSession(session);
  } catch (error) {
    if (error instanceof ApiError && error.code === LIVE_ERROR_CODES.sessionBusy) return 'retry';
    throw error;
  }
  await mirrorDeck(presentation, session);
  await cacheClosedWindow(session, slideId);
  await flushDirty(String(presentation._id), String(session._id));
  await publishRevealed(String(presentation._id), session, slide, index, readSlideState(session, slideId)!, false);
  autoReveals.inc();
  return 'revealed';
};

/** Ends the live session (snapshot, reconciliation, retention). Idempotent once ended. */
export const endPresentation = async (presentationId: string, actor: Actor): Promise<HostCommandResult> => {
  const presentation = await authorizeDeck(presentationId, actor, 'deck:host');
  const live = await findLiveSession(presentationId);
  if (!live) {
    const latest = presentation.status === 'draft' ? null : await findLatestSession(presentationId);
    if (!latest) throw ApiError.badRequest('Presentation has not been started');
    return result(presentation, latest);
  }
  await finishSession(presentation, live);
  await mirrorDeck(presentation, live);
  return result(presentation, live);
};

// ---------------------------------------------------------------------------
// Host reads
// ---------------------------------------------------------------------------

/**
 * Everything the host console renders: the deck, the live (else latest)
 * session, its participants, the current slide's live results, standings,
 * every visited slide's state and results.
 */
export const getHostState = async (
  presentationId: string,
  actor: Actor
): Promise<HostStateResponse<IPresentation>> => {
  const presentation = await authorizeDeck(presentationId, actor, 'deck:host');
  const session = (await findLiveSession(presentationId)) ?? (await findLatestSession(presentationId));
  const base = { quiz: presentation, presentation, serverNow: new Date().toISOString() };
  if (!session) {
    return {
      ...base,
      session: null,
      participants: [],
      answeredCount: 0,
      liveDistribution: null,
      leaderboard: [],
      slideStates: [],
      distributions: {},
    };
  }

  const sid = String(session._id);
  const now = Date.now();
  const counts = await answeredCounts(session);
  const view = await buildSessionView(session, now, counts);
  const visited = visitedSlides(session);
  const responseSlides = visited.filter(({ slide }) => lifecycleOf(slide.type) === 'response');

  const distributions: Record<string, SlideResultsView> = {};
  if (session.isLive) {
    const live = await Promise.all(responseSlides.map(({ slide, index }) => resultsOf(session, slide, index)));
    for (const results of live) distributions[results.slideId] = results;
  } else {
    const slides = sessionSlides(session);
    for (const stat of session.slideStats ?? []) {
      const slideId = String(stat.slideId);
      const slide = slides.find((s) => slideIdOf(s) === slideId);
      distributions[slideId] = {
        slideId,
        slideIndex: stat.slideIndex,
        type: stat.type,
        scored: slide ? isSlideScored(slide) : false,
        answeredCount: stat.answeredCount,
        participantCount: session.participantCount,
        distribution: stat.distribution,
      };
    }
  }

  const [participants, kicked, leaderboard] = await Promise.all([
    PresentationParticipantModel.find({ sessionId: sid }).sort({ joinedAt: 1 }).lean(),
    redisClient.sMembers(k.kicked(sid)).catch(() => [] as string[]),
    session.isLive ? getLeaderboard(sid) : Promise.resolve(session.finalLeaderboard.slice(0, 10)),
  ]);
  const kickedIds = new Set(kicked);
  const currentId = view.currentSlideId;

  return {
    ...base,
    session: view,
    participants: participants.map((p) => ({
      participantId: String(p._id),
      name: p.name,
      score: p.score,
      correctCount: p.correctCount,
      joinedAt: new Date(p.joinedAt).toISOString(),
      kicked: Boolean(p.kickedAt) || kickedIds.has(String(p._id)),
    })),
    answeredCount: currentId ? (counts.get(currentId) ?? 0) : 0,
    liveDistribution: currentId ? (distributions[currentId]?.distribution ?? null) : null,
    leaderboard,
    slideStates: visited.map(({ slide, index, state }) =>
      slideStateView(slide, index, state, counts.get(slideIdOf(slide)) ?? 0, now)
    ),
    distributions,
  };
};

/** The deck's sessions, newest first (the heavy snapshots stay out of the list). */
export const listSessions = async (presentationId: string, actor: Actor): Promise<SessionListItem[]> => {
  await authorizeDeck(presentationId, actor, 'session:read');
  const sessions: IPresentationSession[] = await PresentationSessionModel.find({ presentationId })
    .sort({ startedAt: -1 })
    .select('-deckSnapshot -slideStats -finalLeaderboard -themeSnapshot -settingsSnapshot');
  return Promise.all(
    sessions.map(async (session) => {
      const full = session.isLive ? await PresentationSessionModel.findById(session._id) : null;
      return sessionListItem(full ?? session);
    })
  );
};

// ---------- Participant-facing deck lookup (public) ----------

/**
 * Resolves a join code. While a slide is live the sanitized current slide is
 * included whatever its lifecycle, with its phase; timing fields only when it
 * has an answer window.
 */
export const getPresentationByCode = async (joinCode: string) => {
  const presentation = await PresentationModel.findOne({ joinCode: joinCode.trim() });
  if (!presentation || presentation.status === 'draft' || presentation.deletedAt) {
    throw ApiError.notFound('No active presentation deck with that code');
  }

  const result: Record<string, unknown> = {
    quizId: String(presentation._id),
    presentationId: String(presentation._id),
    sessionId: presentation.activeSessionId ? String(presentation.activeSessionId) : null,
    title: presentation.title,
    status: presentation.status,
    pace: presentation.pace ?? 'presenter',
    totalSlides: presentation.slides.length,
    currentSlideIndex: presentation.currentSlideIndex,
    serverNow: new Date().toISOString(),
  };

  if (presentation.status === 'active' && presentation.currentSlideIndex >= 0 && presentation.activeSessionId) {
    const session = await PresentationSessionModel.findById(presentation.activeSessionId);
    const slides = session ? sessionSlides(session) : [];
    const slide = slides[presentation.currentSlideIndex];
    const def = slide ? requireSlideType(slide.type) : null;
    if (session && slide && def) {
      const slideId = slideIdOf(slide);
      const state = readSlideState(session, slideId);
      result.totalSlides = slides.length;
      result.currentSlide = toParticipantSlide(slide, presentation.currentSlideIndex, slides.length);
      result.currentSlideId = slideId;
      result.currentSlidePhase = slidePhase(def.lifecycle, state);
      if (def.lifecycle === 'response' && state?.openedAt) {
        result.questionStartedAt = state.openedAt.toISOString();
        result.questionEndsAt = windowEnd(state)?.toISOString() ?? null;
      }
    }
  }

  return result;
};

/** Live session of a deck for participant flows (lobby or active), with its deck. */
export const requireJoinableSession = async (presentationId: string) => {
  const presentation = await getPresentationById(presentationId);
  if (presentation.status === 'draft') throw ApiError.badRequest('This presentation is not open yet');
  const session = presentation.status === 'ended' ? null : await findLiveSession(presentationId);
  if (!session) throw ApiError.badRequest('This presentation has already ended');
  return { presentation, session };
};

