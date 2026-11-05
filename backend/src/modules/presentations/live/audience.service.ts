import { ApiError } from '../../../common/utils/ApiError';
import { redisClient } from '../../../common/config/redis';
import { authorizeDeck, type Actor } from '../access';
import { PresentationModel, type IPresentation } from '../models/presentation.model';
import { PresentationParticipantModel, type IAudienceAttempt } from '../models/participant.model';
import { PresentationSessionModel, type IPresentationSession } from '../models/session.model';
import { requireSlideType } from '../slides';
import { noteSessionActivity } from './activity';
import { runningAttempt, submittedAttempt } from './attempts';
import {
  attemptAnswers,
  attemptsAllowed,
  audienceSettingsOf,
  isAudienceClosed,
  participantAudienceView,
  readAttemptState,
  responseSlidesOf,
  scoreAttempt,
} from './audienceState';
import { flushDirty } from './coalescer';
import { LIVE_ERROR_CODES, type AudienceCloseReason, type AudienceParticipantView } from './contract';
import { publishAudienceClosed, publishAudienceOpened, publishAudienceProgress } from './events';
import { SESSION_KEY_TTL_SEC, k, touchTtls } from './keys';
import { verifyParticipant } from './participant.service';
import {
  assertPresentable,
  cacheClosedWindow,
  createSession,
  mirrorDeck,
  requireLiveSession,
  result,
  saveSession,
  type HostCommandResult,
} from './session.service';
import {
  buildAnswerWindow,
  cacheAnswerWindow,
  findLiveSession,
  isOpenState,
  readSlideState,
  sessionSlides,
  slideIdOf,
  windowOptions,
  writeSlideState,
} from './state';

/**
 * Audience pace (W2-F): every response slide of the deck opens at once and
 * each participant moves through the deck on their own — no current slide, no
 * timer, no speed points. The host opens the slides (`open-audience`, with an
 * optional closing time) and closes them (`close-audience`, or the
 * `audience-autoclose` job at the closing time). Participants answer any open
 * slide through the normal answer path (one script call; the script also
 * checks their attempt), then **submit** their attempt: it is scored, and with
 * `settings.audiencePaced.assessment` on it passes or fails; a failed attempt
 * may be **retried** up to `maxAttempts`. Reads: `audienceState.ts`.
 */

/** A closing time may be set at most this far ahead. */
export const MAX_CLOSES_IN_MS = 30 * 24 * 3600 * 1000;

const notAudiencePaced = (message = 'This deck is presented at the presenter’s pace; switch it to audience pace first') =>
  new ApiError(409, message, LIVE_ERROR_CODES.notAudiencePaced);
const audienceNotOpen = () =>
  new ApiError(400, 'The host has not opened the slides yet', LIVE_ERROR_CODES.audienceNotOpen);
const retryNotAllowed = (message: string) => new ApiError(409, message, LIVE_ERROR_CODES.retryNotAllowed);
const attemptStale = () =>
  new ApiError(409, 'That attempt is not your current one; reload', LIVE_ERROR_CODES.attemptStale);

const parseClosesAt = (value: string | null | undefined, now: Date): Date | null => {
  if (value === undefined || value === null) return null;
  const closesAt = new Date(value);
  if (Number.isNaN(closesAt.getTime())) throw ApiError.badRequest('closesAt must be a date and time');
  if (closesAt.getTime() <= now.getTime()) throw ApiError.badRequest('Pick a closing time in the future');
  if (closesAt.getTime() - now.getTime() > MAX_CLOSES_IN_MS) {
    throw ApiError.badRequest('Pick a closing time within the next 30 days');
  }
  return closesAt;
};

/** Writes the answer windows of every response slide (open or closed, per its state). */
const cacheAudienceWindows = async (session: IPresentationSession) => {
  const sid = String(session._id);
  for (const { slide, index, slideId } of responseSlidesOf(session)) {
    const state = readSlideState(session, slideId);
    if (state?.openedAt) await cacheAnswerWindow(sid, buildAnswerWindow(slide, index, state, true, windowOptions(session)));
  }
};

// ---------------------------------------------------------------------------
// Host commands
// ---------------------------------------------------------------------------

/**
 * Opens every response slide of an audience-paced deck. From the lobby, or
 * with no live session (a new session opens straight away). On an open session
 * it only changes the closing time; on a closed one it opens the slides again
 * (answers given stay). 409 `NOT_AUDIENCE_PACED` for presenter-paced decks and
 * sessions, `TEMPLATE_NOT_PRESENTABLE` for templates.
 */
export const openAudience = async (
  presentationId: string,
  actor: Actor,
  body: { closesAt?: string | null } = {}
): Promise<HostCommandResult> => {
  const presentation = await authorizeDeck(presentationId, actor, 'deck:host');
  assertPresentable(presentation);
  const now = new Date();
  const explicit = parseClosesAt(body.closesAt, now);

  let session: IPresentationSession | null = await findLiveSession(presentationId);
  if (session && session.pace !== 'audience') {
    throw notAudiencePaced('This session is presenter-paced; end it before opening the slides to the audience');
  }
  if (!session) {
    if ((presentation.pace ?? 'presenter') !== 'audience') throw notAudiencePaced();
    session = await createSession(presentation, actor);
  }
  // No closing time sent: the deck's default duration from the first opening (a later
  // call that sends nothing keeps the closing time already set).
  const closeAfter = audienceSettingsOf(session).closeAfterMinutes;
  const closesAt =
    body.closesAt !== undefined
      ? explicit
      : session.audience?.openedAt && !session.audience.closedAt
        ? (session.audience.closesAt ?? null)
        : closeAfter
          ? new Date(now.getTime() + closeAfter * 60_000)
          : null;

  for (const slide of sessionSlides(session)) {
    const slideId = slideIdOf(slide);
    const state = readSlideState(session, slideId);
    if (requireSlideType(slide.type).lifecycle !== 'response') {
      if (!state) writeSlideState(session, slideId, { openedAt: now });
      continue;
    }
    if (isOpenState(state)) {
      writeSlideState(session, slideId, { endsAt: closesAt });
    } else {
      writeSlideState(session, slideId, {
        openedAt: state?.openedAt ?? now,
        endsAt: closesAt,
        pausedRemainingMs: null,
        pausedAt: null,
        pausedMs: 0,
        closedAt: null,
        revealedAt: null,
      });
    }
  }
  const openedAt = session.audience?.openedAt ?? now;
  session.audience = { openedAt, closesAt, closedAt: null, closeReason: null };
  session.status = 'active';
  session.currentSlideId = null;
  session.currentSlideIndex = -1;
  session.lastActivityAt = now;
  await saveSession(session);
  await mirrorDeck(presentation, session);

  const sid = String(session._id);
  try {
    await Promise.all([redisClient.hSet(k.meta(sid), 'status', 'active'), redisClient.del(k.current(sid))]);
  } catch (error) {
    console.error('[Presentation] Failed to cache the audience session state:', error);
  }
  await cacheAudienceWindows(session);
  await publishAudienceOpened(presentationId, sid, {
    openedAt: openedAt.toISOString(),
    closesAt: closesAt ? closesAt.toISOString() : null,
    serverNow: new Date().toISOString(),
  });
  return result(presentation, session);
};

/**
 * Stops answers on every open slide of an audience-paced session (the host's
 * close, the closing time, or the end of the session). Participants keep the
 * session: results shown "after close" become visible.
 */
export const closeAudienceSession = async (
  presentation: IPresentation,
  session: IPresentationSession,
  reason: Exclude<AudienceCloseReason, 'ended'>,
  now = new Date()
) => {
  const closed: string[] = [];
  for (const { slideId } of responseSlidesOf(session)) {
    if (!isOpenState(readSlideState(session, slideId))) continue;
    writeSlideState(session, slideId, { closedAt: now });
    closed.push(slideId);
  }
  session.audience = {
    openedAt: session.audience?.openedAt ?? null,
    closesAt: session.audience?.closesAt ?? null,
    closedAt: now,
    closeReason: reason,
  };
  // A closing time passing is not someone using the session.
  if (reason === 'host') session.lastActivityAt = now;
  await saveSession(session);
  await mirrorDeck(presentation, session);

  const sid = String(session._id);
  const pid = String(presentation._id);
  for (const slideId of closed) await cacheClosedWindow(session, slideId);
  await flushDirty(pid, sid);
  await publishAudienceClosed(pid, sid, { closedAt: now.toISOString(), reason });
};

/** `POST /:id/host/close-audience`: no more answers. Idempotent once closed. */
export const closeAudience = async (presentationId: string, actor: Actor): Promise<HostCommandResult> => {
  const presentation = await authorizeDeck(presentationId, actor, 'deck:host');
  const session = await requireLiveSession(presentationId);
  if (session.pace !== 'audience') throw notAudiencePaced('This session is presenter-paced');
  if (!session.audience?.openedAt) throw audienceNotOpen();
  if (!session.audience.closedAt) await closeAudienceSession(presentation, session, 'host');
  return result(presentation, session);
};

export interface AutoCloseTotals {
  closed: number;
  skipped: number;
  failed: number;
}

/**
 * The `audience-autoclose` job: closes every live audience-paced session whose
 * closing time has passed. Each session is read again first, so a host who
 * closed it, moved the closing time or ended it meanwhile wins. Idempotent.
 */
export const closeDueAudiences = async (now = new Date(), signal?: AbortSignal): Promise<AutoCloseTotals> => {
  const totals: AutoCloseTotals = { closed: 0, skipped: 0, failed: 0 };
  const due = await PresentationSessionModel.find({
    isLive: true,
    'audience.closesAt': { $lte: now },
    'audience.closedAt': null,
  })
    .select('_id')
    .lean();
  for (const { _id } of due) {
    if (signal?.aborted) break;
    try {
      const session: IPresentationSession | null = await PresentationSessionModel.findById(_id);
      const closesAt = session?.audience?.closesAt;
      if (!session || !session.isLive || session.pace !== 'audience' || session.audience?.closedAt || !closesAt || closesAt > now) {
        totals.skipped += 1;
        continue;
      }
      // Not getPresentationById: a deck in the trash must not keep its slides open either.
      const presentation = await PresentationModel.findById(session.presentationId);
      if (!presentation) {
        totals.skipped += 1;
        continue;
      }
      await closeAudienceSession(presentation, session, 'schedule', now);
      totals.closed += 1;
    } catch (error) {
      if (error instanceof ApiError && error.code === LIVE_ERROR_CODES.sessionBusy) totals.skipped += 1;
      else {
        totals.failed += 1;
        console.error(`[Presentation] Closing audience session ${String(_id)} failed:`, error);
      }
    }
  }
  return totals;
};

// ---------------------------------------------------------------------------
// Participant commands
// ---------------------------------------------------------------------------

/** Compare-and-set of one participant's attempt state (missing = "1"). Replies 'OK' or the current state. */
const LOCK_ATTEMPT_SCRIPT = `
local current = redis.call('HGET', KEYS[1], ARGV[1]) or '1'
if current ~= ARGV[2] then return current end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[4])
return 'OK'
`;

/** A retry: the next attempt starts and the leaderboard score goes back to 0 (the latest attempt counts). */
const RETRY_ATTEMPT_SCRIPT = `
local current = redis.call('HGET', KEYS[1], ARGV[1]) or '1'
if current ~= ARGV[2] then return current end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[3])
redis.call('ZADD', KEYS[2], 0, ARGV[1])
redis.call('HDEL', KEYS[3], ARGV[1])
for i = 1, 3 do redis.call('EXPIRE', KEYS[i], ARGV[4]) end
return 'OK'
`;

interface ParticipantCall {
  participantId: string;
  participantToken: string;
  attempt?: number;
}

const loadAudienceCall = async (presentationId: string, body: ParticipantCall) => {
  const { sessionId } = await verifyParticipant(presentationId, body.participantId, body.participantToken);
  const session: IPresentationSession | null = await PresentationSessionModel.findById(sessionId);
  if (!session) throw ApiError.notFound('Participant not found — rejoin the presentation deck');
  if (session.pace !== 'audience') throw notAudiencePaced('This session is presenter-paced');
  if (!session.audience?.openedAt) throw audienceNotOpen();
  const participant = await PresentationParticipantModel.findOne({ _id: body.participantId, sessionId });
  if (!participant) throw ApiError.notFound('Participant not found — rejoin the presentation deck');
  return { session, participant, sessionId };
};

/** Makes sure the participant has an `audience` progress object to push attempts into. */
const ensureProgress = (participantId: string) =>
  PresentationParticipantModel.updateOne(
    { _id: participantId, audience: null },
    { $set: { audience: { attempt: 1, attempts: [] } } }
  );

/**
 * `POST /:id/audience/submit`: the participant is done with an attempt. The
 * attempt is locked first (the answer script refuses answers for it from then
 * on), then scored from its stored answers; the result is recorded on the
 * participant and told to the host. Submitting again returns the same view.
 */
export const submitAttempt = async (presentationId: string, body: ParticipantCall): Promise<AudienceParticipantView> => {
  const { session, participant, sessionId } = await loadAudienceCall(presentationId, body);
  const participantId = String(participant._id);
  const state = await readAttemptState(sessionId, participantId, participant.audience);
  const attempt = body.attempt ?? state.number;
  if (attempt !== state.number) throw attemptStale();

  const recorded = participant.audience?.attempts.some((a) => a.number === attempt) ?? false;
  if (!recorded) {
    try {
      const reply = String(
        await redisClient.eval(LOCK_ATTEMPT_SCRIPT, {
          keys: [k.attempts(sessionId)],
          arguments: [participantId, runningAttempt(attempt), submittedAttempt(attempt), String(SESSION_KEY_TTL_SEC)],
        })
      );
      if (reply !== 'OK' && reply !== submittedAttempt(attempt)) throw attemptStale();
    } catch (error) {
      // A session that ended takes no answers anyway (the script checks its status).
      if (error instanceof ApiError || session.isLive) throw error;
    }

    const settings = audienceSettingsOf(session);
    const scored = scoreAttempt(session, await attemptAnswers(session, participantId, attempt), settings);
    const record: IAudienceAttempt = { number: attempt, submittedAt: new Date(), ...scored };
    await ensureProgress(participantId);
    const pushed = await PresentationParticipantModel.updateOne(
      { _id: participantId, 'audience.attempts.number': { $ne: attempt } },
      { $set: { 'audience.attempt': attempt }, $push: { 'audience.attempts': record } }
    );
    if (pushed.modifiedCount > 0) {
      void noteSessionActivity(sessionId);
      await publishAudienceProgress(presentationId, sessionId, {
        participantId,
        name: participant.name,
        attempt,
        submitted: true,
        percentage: record.percentage,
        passed: record.passed,
      });
    }
  }
  return participantAudienceView(session, participantId);
};

/**
 * `POST /:id/audience/retry`: starts the next attempt of a failed assessment
 * while attempts are left and the slides are open. The participant answers
 * every slide again; the latest attempt is the one that counts (leaderboard
 * and final score). A double click starts one attempt.
 */
export const retryAttempt = async (presentationId: string, body: ParticipantCall): Promise<AudienceParticipantView> => {
  const { session, participant, sessionId } = await loadAudienceCall(presentationId, body);
  const participantId = String(participant._id);
  const settings = audienceSettingsOf(session);
  if (!settings.assessment.enabled) throw retryNotAllowed('This deck is not an assessment: there is one attempt');
  if (isAudienceClosed(session)) throw retryNotAllowed('The slides are closed');

  const state = await readAttemptState(sessionId, participantId, participant.audience);
  const last = participant.audience?.attempts.at(-1) ?? null;
  const next = state.number + 1;
  // A second click of the same retry: the next attempt already runs.
  const alreadyRetried = !state.submitted && last !== null && last.number === state.number - 1 && last.passed === false;
  if (!alreadyRetried) {
    if (!state.submitted || !last || last.number !== state.number) throw retryNotAllowed('Submit this attempt first');
    if (last.passed) throw retryNotAllowed('You already passed');
    if (state.number >= attemptsAllowed(settings)) throw retryNotAllowed('No attempts left');

    const reply = String(
      await redisClient.eval(RETRY_ATTEMPT_SCRIPT, {
        keys: [k.attempts(sessionId), k.scores(sessionId), k.correct(sessionId)],
        arguments: [participantId, submittedAttempt(state.number), runningAttempt(next), String(SESSION_KEY_TTL_SEC)],
      })
    );
    if (reply !== 'OK' && reply !== runningAttempt(next)) throw retryNotAllowed('Your attempt changed; reload');
    await ensureProgress(participantId);
    await PresentationParticipantModel.updateOne(
      { _id: participantId },
      { $set: { 'audience.attempt': next, score: 0, correctCount: 0 } }
    );
    await touchTtls([k.attempts(sessionId)]);
    void noteSessionActivity(sessionId);
    await publishAudienceProgress(presentationId, sessionId, {
      participantId,
      name: participant.name,
      attempt: next,
      submitted: false,
      percentage: null,
      passed: null,
    });
  }
  return participantAudienceView(session, participantId);
};
