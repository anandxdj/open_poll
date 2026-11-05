import { ApiError } from '../../../common/utils/ApiError';
import type { IPresentationSession, ISlideState } from '../models/session.model';
import { authorizeDeck, type Actor } from '../access';
import { LIVE_ERROR_CODES, type TimerAction } from './contract';
import { flushDirty } from './coalescer';
import { publishSlideTiming } from './events';
import {
  currentResponseSlide,
  mirrorDeck,
  requireLiveSession,
  result,
  saveSession,
  type HostCommandResult,
} from './session.service';
import {
  buildAnswerWindow,
  cacheAnswerWindow,
  isOpenState,
  isPausedState,
  readSlideState,
  timerBudgetMs,
  writeSlideState,
} from './state';

/**
 * Presenter timer tools (W2-A): pause, resume, extend and skip the current
 * response slide's timer. Each one changes the slide's stored state (the
 * session document, optimistic concurrency like every host command), rewrites
 * the Redis answer window (which also re-times or cancels the auto-reveal) and
 * publishes one `slide:timing`.
 *
 * - **pause**: the remaining time is frozen in `pausedRemainingMs`, `endsAt`
 *   goes null and `pausedAt` is set. The answer script refuses answers while
 *   paused (409 `SLIDE_PAUSED`, after the usual 750 ms grace for answers already
 *   on their way), scored slides do not auto-reveal, and speed scoring leaves
 *   paused time out (`activeElapsedMs`), so a pause neither costs nor earns points.
 * - **resume**: `endsAt` = now + the frozen time; the pause joins `pausedMs`.
 * - **extend**: adds seconds to the deadline (or to the frozen time while
 *   paused). A timer that already ran out but whose slide is still open (the
 *   few seconds before the auto-reveal) restarts from now. Speed points stay
 *   measured against the slide's own time limit, so a late answer in extra time
 *   gets the minimum speed share, never more.
 * - **skip**: time's up now — the deadline becomes now (a running pause ends);
 *   what follows is what a timer running out does (late-answer grace, the
 *   auto-reveal of scored slides).
 *
 * Only an open response slide with a timer qualifies (400 `NO_TIMER` otherwise:
 * untimed slides have `close` instead).
 */

export const EXTEND_MIN_SECONDS = 5;
export const EXTEND_MAX_SECONDS = 600;
export const DEFAULT_EXTEND_SECONDS = 30;

const noTimer = (message: string) => new ApiError(400, message, LIVE_ERROR_CODES.noTimer);
const timerState = (status: number, message: string) => new ApiError(status, message, LIVE_ERROR_CODES.timerState);

const iso = (date: Date | null) => (date ? date.toISOString() : null);

/** The patch one timer action writes to an open, timed slide state, or an error. */
export const timerPatch = (
  state: ISlideState,
  action: TimerAction,
  now: Date,
  seconds = DEFAULT_EXTEND_SECONDS
): Partial<ISlideState> => {
  const nowMs = now.getTime();
  const paused = isPausedState(state);

  switch (action) {
    case 'pause': {
      if (paused) throw timerState(409, 'The timer is already paused');
      const remaining = state.endsAt!.getTime() - nowMs;
      if (remaining <= 0) throw noTimer("Time is already up on this slide");
      return { endsAt: null, pausedRemainingMs: remaining, pausedAt: now };
    }
    case 'resume': {
      if (!paused) throw timerState(400, 'The timer is not paused');
      const pausedFor = state.pausedAt ? Math.max(0, nowMs - state.pausedAt.getTime()) : 0;
      return {
        endsAt: new Date(nowMs + state.pausedRemainingMs!),
        pausedRemainingMs: null,
        pausedAt: null,
        pausedMs: state.pausedMs + pausedFor,
      };
    }
    case 'extend': {
      const addMs = seconds * 1000;
      if (paused) return { pausedRemainingMs: state.pausedRemainingMs! + addMs };
      // A timer that ran out (slide still open, auto-reveal pending) restarts from now.
      return { endsAt: new Date(Math.max(state.endsAt!.getTime(), nowMs) + addMs) };
    }
    case 'skip': {
      const pausedFor = paused && state.pausedAt ? Math.max(0, nowMs - state.pausedAt.getTime()) : 0;
      return {
        endsAt: now,
        pausedRemainingMs: null,
        pausedAt: null,
        pausedMs: state.pausedMs + pausedFor,
      };
    }
  }
};

const runTimerAction = async (
  presentationId: string,
  actor: Actor,
  action: TimerAction,
  seconds = DEFAULT_EXTEND_SECONDS
): Promise<HostCommandResult> => {
  const presentation = await authorizeDeck(presentationId, actor, 'deck:host');
  const session: IPresentationSession = await requireLiveSession(presentationId);
  const verb = action === 'skip' ? 'skip' : `${action} the timer of`;
  const { slide, index, slideId, state } = currentResponseSlide(session, verb);
  if (!state || !isOpenState(state)) throw noTimer('Voting is closed on this slide');
  if (!state.endsAt && !isPausedState(state)) {
    throw noTimer('This slide has no timer; close voting instead');
  }

  const now = new Date();
  writeSlideState(session, slideId, timerPatch(state, action, now, seconds));
  session.lastActivityAt = now;
  await saveSession(session);
  await mirrorDeck(presentation, session);

  const sid = String(session._id);
  const pid = String(presentation._id);
  const next = readSlideState(session, slideId)!;
  await cacheAnswerWindow(sid, buildAnswerWindow(slide, index, next, true));
  // A pause stops answers: the host gets the last counts before the timing event.
  if (action === 'pause' || action === 'skip') await flushDirty(pid, sid);
  await publishSlideTiming(pid, sid, {
    slideId,
    slideIndex: index,
    action,
    startedAt: next.openedAt!.toISOString(),
    endsAt: iso(next.endsAt),
    pausedRemainingMs: next.pausedRemainingMs,
    durationMs: timerBudgetMs(next),
    addedSeconds: action === 'extend' ? seconds : 0,
    serverNow: new Date().toISOString(),
  });
  return result(presentation, session);
};

export const pauseTimer = (presentationId: string, actor: Actor) => runTimerAction(presentationId, actor, 'pause');

export const resumeTimer = (presentationId: string, actor: Actor) => runTimerAction(presentationId, actor, 'resume');

export const extendTimer = (presentationId: string, actor: Actor, seconds = DEFAULT_EXTEND_SECONDS) =>
  runTimerAction(presentationId, actor, 'extend', seconds);

/** Time's up now on the current slide (its late-answer grace and auto-reveal follow). */
export const skipTimer = (presentationId: string, actor: Actor) => runTimerAction(presentationId, actor, 'skip');

/** `POST /:id/host/timer {action, seconds?}`. */
export const timerCommand = (
  presentationId: string,
  actor: Actor,
  body: { action: 'pause' | 'resume' | 'extend'; seconds?: number }
) => {
  if (body.action === 'pause') return pauseTimer(presentationId, actor);
  if (body.action === 'resume') return resumeTimer(presentationId, actor);
  return extendTimer(presentationId, actor, body.seconds ?? DEFAULT_EXTEND_SECONDS);
};
