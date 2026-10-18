import { ApiError } from '../../../common/utils/ApiError';
import { redisClient } from '../../../common/config/redis';
import { PresentationParticipantModel } from '../models/participant.model';
import { PresentationAnswerModel } from '../models/answer.model';
import { getSlideType, type RedisOp } from '../slides';
import type { SubmitPresentationAnswerInput } from '../presentations.schema';
import { LIVE_ERROR_CODES } from './contract';
import { ACTIVE_DISTRIBUTIONS_KEY, k, slideKey } from './keys';
import { loadAnswerWindow, resolveLiveSessionId, type StoredAnswerResult } from './state';
import { verifyParticipant } from './participant.service';
import { publishAnswerReceived } from './events';

// Answers arriving slightly after the deadline (network latency) are still accepted
const ANSWER_GRACE_MS = 750;

const notAccepting = () => ApiError.badRequest('This slide is no longer accepting answers');

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

const queueOp = (pipeline: ReturnType<typeof redisClient.multi>, sessionId: string, slideId: string, op: RedisOp) => {
  const key = slideKey(sessionId, slideId, op.key);
  switch (op.op) {
    case 'hincrby':
      pipeline.hIncrBy(key, op.field, op.by);
      break;
    case 'hsetnx':
      pipeline.hSetNX(key, op.field, op.value);
      break;
    case 'lpush_trim':
      pipeline.lPush(key, op.value);
      pipeline.lTrim(key, 0, op.max - 1);
      break;
  }
};

/**
 * HOT PATH — runs entirely on Redis; Mongo writes are async write-behind.
 * The slide type grades the answer (`accept`) and scores it (`score`); this
 * function owns windowing, dedup, auth and the atomic write of the type's ops.
 * Answers go to the deck's live session (or the session the client names).
 */
export const submitAnswer = async (presentationId: string, data: SubmitPresentationAnswerInput) => {
  const sessionId = data.sessionId ?? (await resolveLiveSessionId(presentationId));
  if (!sessionId) throw notAccepting();

  // The window and the participant's credentials are independent lookups; run
  // them together but report window problems first.
  const [windowResult, authResult] = await Promise.allSettled([
    loadAnswerWindow(sessionId, data.slideId),
    verifyParticipant(presentationId, data.participantId, data.participantToken, sessionId),
  ]);
  if (windowResult.status === 'rejected') throw windowResult.reason;
  const window = windowResult.value;
  const def = window ? getSlideType(window.type) : undefined;
  if (!window || !def?.accept || !window.open || window.slideIndex !== data.slideIndex) {
    throw notAccepting();
  }

  const now = Date.now();
  if (window.endsAtMs !== null && now > window.endsAtMs + ANSWER_GRACE_MS) {
    throw ApiError.badRequest("Time's up — response not accepted");
  }

  if (authResult.status === 'rejected') throw authResult.reason;
  if (authResult.value.sessionId !== sessionId) {
    throw new ApiError(
      409,
      'Your session has ended — rejoin the presentation deck',
      LIVE_ERROR_CODES.participantStale
    );
  }

  const { slideId, slideIndex } = window;
  const answeredKey = k.answered(sessionId, slideId);
  const added = await redisClient.sAdd(answeredKey, data.participantId);
  if (added === 0) {
    throw ApiError.conflict('You already responded to this slide');
  }

  const elapsedMs = Math.max(0, now - window.startedAtMs);
  let accepted: ReturnType<NonNullable<typeof def.accept>>;
  try {
    const rawPayload = answerPayloadOf(data);
    let payload: unknown = rawPayload;
    if (def.answerSchema) {
      const parsed = def.answerSchema.safeParse(rawPayload);
      if (!parsed.success) {
        throw ApiError.badRequest(
          parsed.error.issues.map((i) => `${['payload', ...i.path].join('.')}: ${i.message}`).join('; ')
        );
      }
      payload = parsed.data;
    }
    accepted = def.accept(window.cfg, payload, { elapsedMs });
  } catch (error) {
    await redisClient.sRem(answeredKey, data.participantId).catch(() => {});
    throw error;
  }

  const { ops, persist } = accepted;
  // Ungraded slides (unscored types, 0-point or answer-less slides) never count as correct.
  const isCorrect = window.scored && accepted.isCorrect;
  const score = window.scored && def.score ? def.score(window.cfg, { isCorrect, elapsedMs }) : 0;
  const stored: StoredAnswerResult = {
    isCorrect,
    score,
    scored: window.scored,
    slideIndex,
    optionIndex: persist.optionIndex,
    text: persist.text,
    payload: persist.payload,
    timeMs: elapsedMs,
    answeredAt: new Date(now).toISOString(),
    clientAnswerId: data.clientAnswerId ?? null,
    via: 'rest',
  };

  // Atomic Redis updates via MULTI — a crash mid-write can't desync
  // leaderboard / distribution / per-participant result.
  const pipeline = redisClient.multi();
  pipeline.zIncrBy(k.scores(sessionId), score, data.participantId);
  if (isCorrect) pipeline.hIncrBy(k.correct(sessionId), data.participantId, 1);
  ops.forEach((op) => queueOp(pipeline, sessionId, slideId, op));
  pipeline.hSet(k.results(sessionId, slideId), data.participantId, JSON.stringify(stored));
  pipeline.sCard(answeredKey);
  const pipelineResults = await pipeline.exec();
  const answeredCount = Number(pipelineResults[pipelineResults.length - 1]);

  await redisClient.sAdd(ACTIVE_DISTRIBUTIONS_KEY, presentationId).catch(() => {});

  await publishAnswerReceived(presentationId, sessionId, { slideId, slideIndex, answeredCount });

  // Write-behind. The participant total follows only a stored answer, so an
  // answer the end-of-session reconciliation already inserted is not counted twice.
  PresentationAnswerModel.create({
    presentationId,
    sessionId,
    participantId: data.participantId,
    slideId,
    slideIndex,
    optionIndex: persist.optionIndex,
    text: persist.text,
    payload: persist.payload,
    isCorrect,
    score,
    timeMs: elapsedMs,
    clientAnswerId: stored.clientAnswerId,
    via: stored.via,
  })
    .then(() =>
      PresentationParticipantModel.updateOne(
        { _id: data.participantId },
        { $inc: { score, correctCount: isCorrect ? 1 : 0 } }
      )
    )
    .catch((error: any) => {
      if (error?.code !== 11000) console.error('[Presentation] Failed to persist answer:', error);
    });

  return { accepted: true };
};
