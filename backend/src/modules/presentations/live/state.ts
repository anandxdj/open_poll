import { redisClient } from '../../../common/config/redis';
import type { AnswerChannel } from '../models/answer.model';
import type { IPresentationSlide } from '../models/presentation.model';
import { PresentationSessionModel, type IPresentationSession, type ISlideState } from '../models/session.model';
import { getSlideType, isSlideScored, requireSlideType, type SlideLifecycle } from '../slides';
import type { SlidePhase } from './contract';
import { syncAutoReveal } from './autoReveal';
import { SESSION_KEY_TTL_SEC, k } from './keys';

/**
 * Session state shared by the host commands, the answer hot path and the
 * participant reads: slide states and phases, the Redis answer windows, and
 * the lookup of a deck's live session.
 */

export type Slide = IPresentationSlide;

export const slideIdOf = (slide: Pick<Slide, '_id'>) => String(slide._id);

/** The slides a session runs: its deck snapshot. */
export const sessionSlides = (session: Pick<IPresentationSession, 'deckSnapshot'>): Slide[] =>
  (session.deckSnapshot ?? []) as Slide[];

export const lifecycleOf = (type: unknown): SlideLifecycle => getSlideType(type)?.lifecycle ?? 'content';

export const findSlide = (session: Pick<IPresentationSession, 'deckSnapshot'>, slideId: string) => {
  const slides = sessionSlides(session);
  const index = slides.findIndex((slide) => slideIdOf(slide) === slideId);
  return index >= 0 ? { slide: slides[index]!, index } : null;
};

// ---------------------------------------------------------------------------
// Slide states (stored on the session) and phases
// ---------------------------------------------------------------------------

const EMPTY_STATE: ISlideState = {
  openedAt: null,
  endsAt: null,
  pausedRemainingMs: null,
  pausedAt: null,
  pausedMs: 0,
  closedAt: null,
  revealedAt: null,
};

/** A visited slide's stored state as a plain object; null when never visited. */
export const readSlideState = (
  session: Pick<IPresentationSession, 'slideStates'>,
  slideId: string
): ISlideState | null => {
  const states = session.slideStates as Map<string, ISlideState> | Record<string, ISlideState> | undefined;
  const state = states instanceof Map ? states.get(slideId) : states?.[slideId];
  if (!state) return null;
  return {
    openedAt: state.openedAt ?? null,
    endsAt: state.endsAt ?? null,
    pausedRemainingMs: state.pausedRemainingMs ?? null,
    pausedAt: state.pausedAt ?? null,
    pausedMs: state.pausedMs ?? 0,
    closedAt: state.closedAt ?? null,
    revealedAt: state.revealedAt ?? null,
  };
};

export const writeSlideState = (session: IPresentationSession, slideId: string, patch: Partial<ISlideState>) => {
  session.slideStates.set(slideId, { ...(readSlideState(session, slideId) ?? EMPTY_STATE), ...patch });
};

/** Accepting answers by state (the clock is checked separately, with grace). */
export const isOpenState = (state: ISlideState | null) =>
  !!state?.openedAt && !state.closedAt && !state.revealedAt;

/** When the answer window ended or will end: the deadline, or the close time when earlier; null while untimed and open. */
export const windowEnd = (state: ISlideState | null): Date | null => {
  if (!state) return null;
  const { endsAt, closedAt } = state;
  if (closedAt && (!endsAt || closedAt.getTime() < endsAt.getTime())) return closedAt;
  return endsAt;
};

/** A paused timer: the remaining time is frozen in `pausedRemainingMs` and `endsAt` is null. */
export const isPausedState = (state: ISlideState | null) => state?.pausedRemainingMs != null;

/** Whether the window has a timer (running or paused). */
export const isTimedState = (state: ISlideState | null) => Boolean(state?.endsAt) || isPausedState(state);

/**
 * The window's whole timer budget in ms — the slide's time limit plus every
 * extension — derived from the stored state: running, `endsAt − openedAt −
 * pausedMs`; paused, the time it ran before the pause plus what is left. Null
 * while untimed.
 */
export const timerBudgetMs = (state: ISlideState | null): number | null => {
  if (!state?.openedAt) return null;
  const opened = state.openedAt.getTime();
  if (state.pausedRemainingMs != null && state.pausedAt) {
    return Math.max(0, state.pausedAt.getTime() - opened - state.pausedMs) + state.pausedRemainingMs;
  }
  if (!state.endsAt) return null;
  return Math.max(0, state.endsAt.getTime() - opened - state.pausedMs);
};

/** Patch that ends a running pause (or nothing): used whenever a window closes. */
export const endPausePatch = (state: ISlideState | null, now: Date): Partial<ISlideState> =>
  state?.pausedAt
    ? { pausedAt: null, pausedRemainingMs: null, pausedMs: state.pausedMs + Math.max(0, now.getTime() - state.pausedAt.getTime()) }
    : { pausedAt: null, pausedRemainingMs: null };

export const slidePhase = (lifecycle: SlideLifecycle, state: ISlideState | null, now = Date.now()): SlidePhase => {
  if (lifecycle !== 'response') return 'shown';
  if (state?.revealedAt) return 'revealed';
  if (!isOpenState(state)) return 'closed';
  if (state!.endsAt && now > state!.endsAt.getTime()) return 'closed';
  return 'open';
};

// ---------------------------------------------------------------------------
// Answer windows — a response slide's accept config, cached in the session's
// `slides` hash for the answer hot path. Written on every transition; a
// missing or outdated entry is rebuilt from the session document, so a Redis
// restart degrades but never reopens a closed slide.
// ---------------------------------------------------------------------------

export const ANSWER_WINDOW_VERSION = 5;

export interface AnswerWindow {
  v: typeof ANSWER_WINDOW_VERSION;
  slideId: string;
  slideIndex: number;
  type: string;
  scored: boolean;
  /** False once closed, revealed, left, or when the session is not presenting. */
  open: boolean;
  startedAtMs: number;
  /** null = untimed. */
  endsAtMs: number | null;
  pausedRemainingMs: number | null;
  /** When the running pause began (ms); null while the timer runs. Answers are refused while paused. */
  pausedAtMs: number | null;
  /** Time spent in finished pauses (ms): speed scoring counts only the time the timer ran. */
  pausedMs: number;
  /** Mask profanity in this window's text answers (deck setting `profanityFilter`, word clouds and open answers). */
  profanityFilter: boolean;
  /**
   * Audience pace (W2-F): one of the session's open-at-once slides. Answers are
   * per attempt (the script checks the participant's attempt), score without
   * speed points, and never auto-reveal; `endsAtMs` is the session's closing time.
   */
  audience: boolean;
  /** The slide type's `acceptConfig(slide)` snapshot (answer keys, counts, points). */
  cfg: unknown;
}

/** Slide types whose free-text answers the deck's profanity filter masks. */
export const PROFANITY_FILTERED_TYPES = new Set(['wordcloud', 'open_ended']);

export interface AnswerWindowOptions {
  /** The session's `settingsSnapshot.profanityFilter`. */
  profanityFilter?: boolean;
  /** The session is audience-paced (W2-F). */
  audience?: boolean;
}

/** Window options from the session's settings snapshot and pace. */
export const windowOptions = (
  session: Pick<IPresentationSession, 'settingsSnapshot'> & Partial<Pick<IPresentationSession, 'pace'>>
): AnswerWindowOptions => ({
  profanityFilter: Boolean(session.settingsSnapshot?.profanityFilter),
  audience: session.pace === 'audience',
});

export const buildAnswerWindow = (
  slide: Slide,
  slideIndex: number,
  state: ISlideState,
  presenting: boolean,
  options: AnswerWindowOptions = {}
): AnswerWindow => {
  const def = requireSlideType(slide.type);
  return {
    v: ANSWER_WINDOW_VERSION,
    slideId: slideIdOf(slide),
    slideIndex,
    type: def.type,
    scored: isSlideScored(slide),
    open: presenting && isOpenState(state),
    startedAtMs: (state.openedAt ?? new Date(0)).getTime(),
    endsAtMs: state.endsAt ? state.endsAt.getTime() : null,
    pausedRemainingMs: state.pausedRemainingMs,
    pausedAtMs: state.pausedAt ? state.pausedAt.getTime() : null,
    pausedMs: state.pausedMs ?? 0,
    profanityFilter: Boolean(options.profanityFilter) && PROFANITY_FILTERED_TYPES.has(def.type),
    audience: Boolean(options.audience),
    cfg: def.acceptConfig ? def.acceptConfig(slide) : null,
  };
};

/**
 * Time the answer window's timer ran before `nowMs` (what speed scoring
 * measures): paused time is left out, and an answer that lands during a pause
 * counts as arriving when the pause began.
 */
export const activeElapsedMs = (window: Pick<AnswerWindow, 'startedAtMs' | 'pausedAtMs' | 'pausedMs'>, nowMs: number) => {
  const until = window.pausedAtMs != null ? Math.min(nowMs, window.pausedAtMs) : nowMs;
  return Math.max(0, until - window.startedAtMs - (window.pausedMs ?? 0));
};

/**
 * Writes a window to the session's `slides` hash (and keeps the auto-reveal
 * schedule in step). `rebuilt` windows come from a Mongo read on a cache miss:
 * they are written only while the entry is still missing, so a host
 * transition cached meanwhile is never overwritten by the older read (and
 * then leaves the schedule alone too).
 */
export const cacheAnswerWindow = async (sessionId: string, window: AnswerWindow, rebuilt = false) => {
  let written = true;
  try {
    const json = JSON.stringify(window);
    if (rebuilt) written = Boolean(await redisClient.hSetNX(k.slides(sessionId), window.slideId, json));
    else await redisClient.hSet(k.slides(sessionId), window.slideId, json);
    await redisClient.expire(k.slides(sessionId), SESSION_KEY_TTL_SEC);
  } catch (error) {
    console.error('[Presentation] Failed to cache answer window:', error);
  }
  if (written) await syncAutoReveal(sessionId, window);
};

/** The window of a session's slide (default: the current one), Redis-first. Null when the slide has none. */
export const loadAnswerWindow = async (sessionId: string, slideIdHint?: string): Promise<AnswerWindow | null> => {
  let slideId = slideIdHint ?? null;
  try {
    slideId ??= await redisClient.get(k.current(sessionId));
    if (slideId) {
      const raw = await redisClient.hGet(k.slides(sessionId), slideId);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<AnswerWindow>;
        if (parsed.v === ANSWER_WINDOW_VERSION) return parsed as AnswerWindow;
        // An entry from an older release: drop it so the rebuild below can replace it.
        await redisClient.hDel(k.slides(sessionId), slideId);
      }
    }
  } catch (error) {
    console.error('[Presentation] Redis answer window lookup failed:', error);
  }

  const session = await PresentationSessionModel.findById(sessionId);
  if (!session) return null;
  const targetId = slideId ?? (session.currentSlideId ? String(session.currentSlideId) : null);
  const found = targetId ? findSlide(session, targetId) : null;
  if (!found || lifecycleOf(found.slide.type) !== 'response') return null;
  const state = readSlideState(session, targetId!);
  if (!state?.openedAt) return null;
  const window = buildAnswerWindow(found.slide, found.index, state, isPresenting(session), windowOptions(session));
  await cacheAnswerWindow(sessionId, window, true);
  return window;
};

/**
 * One accepted answer as kept in `psess:{sid}:results:{slideId}` (participantId
 * → JSON): enough for `/me` and to rebuild the answer document when the Mongo
 * write-behind lost it.
 */
export interface StoredAnswerResult {
  isCorrect: boolean;
  score: number;
  scored: boolean;
  slideIndex: number;
  optionIndex: number | null;
  text: string | null;
  payload: unknown;
  timeMs: number;
  answeredAt: string;
  clientAnswerId: string | null;
  via: AnswerChannel;
}

// ---------------------------------------------------------------------------
// Live session lookup
// ---------------------------------------------------------------------------

export const isPresenting = (session: Pick<IPresentationSession, 'isLive' | 'status'>) =>
  session.isLive && session.status === 'active';

/** The deck's live session document (lobby or active), if any. */
export const findLiveSession = (presentationId: string) =>
  PresentationSessionModel.findOne({ presentationId, isLive: true });

/** The newest session of a deck, live or ended. */
export const findLatestSession = (presentationId: string) =>
  PresentationSessionModel.findOne({ presentationId }).sort({ startedAt: -1 });

/** Id of the deck's live session: Redis pointer first, Mongo (and re-cache) on a miss. */
export const resolveLiveSessionId = async (presentationId: string): Promise<string | null> => {
  try {
    const cached = await redisClient.get(k.active(presentationId));
    if (cached) return cached;
  } catch (error) {
    console.error('[Presentation] Redis live-session lookup failed:', error);
  }
  const live = await PresentationSessionModel.findOne({ presentationId, isLive: true }).select('_id').lean();
  if (!live) return null;
  const sessionId = String(live._id);
  void redisClient.set(k.active(presentationId), sessionId, { EX: SESSION_KEY_TTL_SEC }).catch(() => {});
  return sessionId;
};
