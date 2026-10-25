import { ApiError } from '../../../common/utils/ApiError';
import { redisClient } from '../../../common/config/redis';
import { answerDuration, answersAccepted, answersRejected } from '../../../common/observability/metrics';
import { timeRedis } from '../../../common/observability/redisTiming';
import type { AnswerChannel } from '../models/answer.model';
import { getSlideType, type AcceptResult, type SlideTypeDef } from '../slides';
import type { SubmitPresentationAnswerInput } from '../presentations.schema';
import { LIVE_ERROR_CODES, type AnswerResult } from './contract';
import { runAnswerScript } from './answerScript';
import { scheduleDirtyFlush } from './coalescer';
import { k, touchTtls } from './keys';
import { kickedError, verifyParticipant } from './participant.service';
import { loadAnswerWindow, resolveLiveSessionId, type AnswerWindow, type StoredAnswerResult } from './state';
import { verifySlideTicket } from './ticket';
import { enqueueAnswerWrite } from './writeBehind';

/**
 * HOT PATH. One answer = grade in JS (the slide type owns grading), then ONE
 * Redis script call (`lua/answer.lua`: window and grace, participant auth,
 * rate limit, dedup, the type's ops, scores, stored result, coalescer mark).
 * Mongo is filled by batched write-behind, host updates go out through the
 * coalescer, so nothing here waits on the database or on a publish.
 *
 * Used by `POST /:id/answer` (`via: 'rest'`) and the socket `answer:submit`
 * (`via: 'socket'`); clients replaying an offline queue send `offline: true`.
 */

export interface SubmitContext {
  /** The channel the call arrived on; default `rest`. */
  via?: Exclude<AnswerChannel, 'offline'>;
}

const notAccepting = () =>
  new ApiError(400, 'This slide is no longer accepting answers', LIVE_ERROR_CODES.notAccepting);
const timeUp = () => new ApiError(400, "Time's up — response not accepted", LIVE_ERROR_CODES.timeUp);
const alreadyAnswered = () =>
  new ApiError(409, 'You already responded to this slide', LIVE_ERROR_CODES.alreadyAnswered);
const tooManyAnswers = () =>
  new ApiError(429, 'Too many answers, slow down', LIVE_ERROR_CODES.answerRateLimited);
const staleParticipant = () =>
  new ApiError(409, 'Your session has ended — rejoin the presentation deck', LIVE_ERROR_CODES.participantStale);

/**
 * The answer a slide type grades: the generic `payload` when sent, else the
 * legacy per-type request fields gathered into one object.
 */
const answerPayloadOf = (data: SubmitPresentationAnswerInput): Record<string, unknown> => {
  if (data.payload !== undefined) return data.payload;
  const legacy: Record<string, unknown> = {};
  if (data.optionIndex !== undefined) legacy.optionIndex = data.optionIndex;
  if (data.text !== undefined) legacy.text = data.text;
  if (data.entries !== undefined) legacy.entries = data.entries;
  if (data.ratings !== undefined) legacy.ratings = data.ratings;
  if (data.ranking !== undefined) legacy.ranking = data.ranking;
  return legacy;
};

/** Validates and grades the payload. Throws 400 for a malformed or ungradeable answer; writes nothing. */
const grade = (
  def: SlideTypeDef,
  window: AnswerWindow,
  data: SubmitPresentationAnswerInput,
  elapsedMs: number
) => {
  let payload: unknown = answerPayloadOf(data);
  if (def.answerSchema) {
    const parsed = def.answerSchema.safeParse(payload);
    if (!parsed.success) {
      throw ApiError.badRequest(
        parsed.error.issues.map((i) => `${['payload', ...i.path].join('.')}: ${i.message}`).join('; ')
      );
    }
    payload = parsed.data;
  }
  const accepted: AcceptResult = def.accept!(window.cfg, payload, { elapsedMs });
  // Ungraded slides (unscored types, 0-point or answer-less slides) never count as correct.
  const isCorrect = window.scored && accepted.isCorrect;
  const score = window.scored && def.score ? def.score(window.cfg, { isCorrect, elapsedMs }) : 0;
  return { accepted, isCorrect, score };
};

/**
 * The token was not in the session's Redis mirror (Redis restarted, or the
 * participant joined through another path): check Mongo, and put the token
 * back so the script finds it.
 */
const mirrorParticipant = async (
  presentationId: string,
  data: SubmitPresentationAnswerInput,
  sessionId: string
) => {
  const owner = await verifyParticipant(presentationId, data.participantId, data.participantToken, sessionId);
  if (owner.sessionId !== sessionId) throw staleParticipant();
  await redisClient.hSet(k.tokens(sessionId), data.participantId, data.participantToken);
  await touchTtls([k.tokens(sessionId)]);
};

const parseStored = (json: string): Partial<StoredAnswerResult> | null => {
  try {
    return JSON.parse(json) as Partial<StoredAnswerResult>;
  } catch {
    return null;
  }
};

const processAnswer = async (
  presentationId: string,
  data: SubmitPresentationAnswerInput,
  via: AnswerChannel
): Promise<AnswerResult> => {
  const sessionId = data.sessionId ?? (await resolveLiveSessionId(presentationId));
  if (!sessionId) throw notAccepting();

  let mirrored = false;
  // At most: one reload after a reopen raced us, one token mirror, one final try.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const window = await timeRedis('answer_window', () => loadAnswerWindow(sessionId, data.slideId));
    const def = window ? getSlideType(window.type) : undefined;
    if (!window || !def?.accept || window.slideIndex !== data.slideIndex) throw notAccepting();

    const nowMs = Date.now();
    const elapsedMs = Math.max(0, nowMs - window.startedAtMs);
    const { accepted, isCorrect, score } = grade(def, window, data, elapsedMs);
    const { persist } = accepted;
    const stored: StoredAnswerResult = {
      isCorrect,
      score,
      scored: window.scored,
      slideIndex: window.slideIndex,
      optionIndex: persist.optionIndex,
      text: persist.text,
      payload: persist.payload,
      timeMs: elapsedMs,
      answeredAt: new Date(nowMs).toISOString(),
      clientAnswerId: data.clientAnswerId ?? null,
      via,
    };

    const reply = await runAnswerScript({
      sessionId,
      slideId: window.slideId,
      participantId: data.participantId,
      participantToken: data.participantToken,
      slideIndex: window.slideIndex,
      startedAtMs: window.startedAtMs,
      nowMs,
      ticketOk: verifySlideTicket(data.slideTicket, sessionId, window.slideId, window.startedAtMs),
      score,
      isCorrect,
      storedJson: JSON.stringify(stored),
      ops: accepted.ops,
    });

    switch (reply.status) {
      case 'OK':
        enqueueAnswerWrite({
          presentationId,
          sessionId,
          participantId: data.participantId,
          slideId: window.slideId,
          slideIndex: window.slideIndex,
          optionIndex: persist.optionIndex,
          text: persist.text,
          payload: persist.payload,
          isCorrect,
          score,
          timeMs: elapsedMs,
          clientAnswerId: stored.clientAnswerId,
          via,
        });
        if (reply.ownsDirtyWindow) scheduleDirtyFlush(presentationId, sessionId);
        return {
          accepted: true,
          replay: false,
          slideId: window.slideId,
          slideIndex: window.slideIndex,
          clientAnswerId: stored.clientAnswerId,
          via,
          answeredAt: stored.answeredAt,
        };

      case 'DUP': {
        // The same client retrying (lost ack, offline queue) gets its original result back.
        const original = parseStored(reply.storedJson);
        if (data.clientAnswerId && original?.clientAnswerId === data.clientAnswerId) {
          return {
            accepted: true,
            replay: true,
            slideId: window.slideId,
            slideIndex: window.slideIndex,
            clientAnswerId: data.clientAnswerId,
            via: original.via ?? via,
            answeredAt: original.answeredAt ?? stored.answeredAt,
          };
        }
        throw alreadyAnswered();
      }

      case 'STALE':
        continue; // the slide was reopened while we graded; grade against the new run

      case 'NO_TOKEN':
        if (mirrored) throw ApiError.unauthorized('Invalid participant token');
        mirrored = true;
        await mirrorParticipant(presentationId, data, sessionId);
        continue;

      case 'BAD_TOKEN':
        throw ApiError.unauthorized('Invalid participant token');
      case 'KICKED':
        throw kickedError();
      case 'RATE_LIMITED':
        throw tooManyAnswers();
      case 'TIME_UP':
        throw timeUp();
      case 'BAD_OP':
        throw ApiError.internal('The slide type produced an operation the answer path cannot run');
      case 'CLOSED':
      case 'NO_WINDOW':
        throw notAccepting();
    }
  }
  throw new ApiError(409, 'The slide changed while answering; try again', LIVE_ERROR_CODES.sessionBusy);
};

const rejectionReason = (error: unknown) => {
  if (error instanceof ApiError) return (error.code ?? `http_${error.statusCode}`).toLowerCase();
  return 'error';
};

/**
 * Accepts one answer (or replays it). Throws `ApiError`s the same way for both
 * channels: 400 `NOT_ACCEPTING`/`TIME_UP`/validation, 401 bad token, 403
 * `PARTICIPANT_KICKED`, 409 `ALREADY_ANSWERED`/`PARTICIPANT_STALE`, 429.
 */
export const submitAnswer = async (
  presentationId: string,
  data: SubmitPresentationAnswerInput,
  context: SubmitContext = {}
): Promise<AnswerResult> => {
  const channel = context.via ?? 'rest';
  const via: AnswerChannel = data.offline ? 'offline' : channel;
  const started = performance.now();
  try {
    const result = await processAnswer(presentationId, data, via);
    answersAccepted.inc({ via, replay: String(result.replay) });
    return result;
  } catch (error) {
    answersRejected.inc({ via, reason: rejectionReason(error) });
    throw error;
  } finally {
    answerDuration.observe({ via }, (performance.now() - started) / 1000);
  }
};
