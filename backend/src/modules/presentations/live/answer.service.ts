import { ApiError } from '../../../common/utils/ApiError';
import { redisClient } from '../../../common/config/redis';
import { PresentationParticipantModel } from '../models/participant.model';
import { PresentationAnswerModel } from '../models/answer.model';
import { getSlideType, type RedisOp } from '../slides';
import type { SubmitPresentationAnswerInput } from '../presentations.schema';
import { ACTIVE_DISTRIBUTIONS_KEY, k, slideKey } from './keys';
import { loadAnswerWindow } from './session.service';
import { verifyParticipant } from './participant.service';
import { publishAnswerReceived } from './events';

// Answers arriving slightly after the deadline (network latency) are still accepted
const ANSWER_GRACE_MS = 750;

/** The answer a slide type grades: the per-type request fields gathered into one object. */
const answerPayloadOf = (data: SubmitPresentationAnswerInput): Record<string, unknown> => {
  const legacy: Record<string, unknown> = {};
  if (data.optionIndex !== undefined) legacy.optionIndex = data.optionIndex;
  if (data.text !== undefined) legacy.text = data.text;
  if (data.entries !== undefined) legacy.entries = data.entries;
  if (data.ratings !== undefined) legacy.ratings = data.ratings;
  if (data.ranking !== undefined) legacy.ranking = data.ranking;
  return legacy;
};

const queueOp = (
  pipeline: ReturnType<typeof redisClient.multi>,
  presentationId: string,
  slideIndex: number,
  op: RedisOp
) => {
  const key = slideKey(presentationId, slideIndex, op.key);
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
 */
export const submitAnswer = async (presentationId: string, data: SubmitPresentationAnswerInput) => {
  const window = await loadAnswerWindow(presentationId);
  const def = window ? getSlideType(window.type) : undefined;
  if (!window || !def?.accept || window.slideIndex !== data.slideIndex) {
    throw ApiError.badRequest('This slide is no longer accepting answers');
  }

  const now = Date.now();
  if (now > window.endsAtMs + ANSWER_GRACE_MS) {
    throw ApiError.badRequest("Time's up — response not accepted");
  }

  await verifyParticipant(presentationId, data.participantId, data.participantToken);

  const answeredKey = k.answered(presentationId, data.slideIndex);
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

  const { isCorrect, ops, persist } = accepted;
  const score = window.scored && def.score ? def.score(window.cfg, { isCorrect, elapsedMs }) : 0;

  // Atomic Redis updates via MULTI — a crash mid-write can't desync
  // leaderboard / distribution / per-participant result.
  const pipeline = redisClient.multi();
  pipeline.zIncrBy(k.scores(presentationId), score, data.participantId);
  if (isCorrect) pipeline.hIncrBy(k.correct(presentationId), data.participantId, 1);
  ops.forEach((op) => queueOp(pipeline, presentationId, data.slideIndex, op));
  pipeline.hSet(
    k.results(presentationId, data.slideIndex),
    data.participantId,
    JSON.stringify({ isCorrect, score, scored: window.scored })
  );
  pipeline.sCard(answeredKey);
  const pipelineResults = await pipeline.exec();
  const answeredCount = Number(pipelineResults[pipelineResults.length - 1]);

  await redisClient.sAdd(ACTIVE_DISTRIBUTIONS_KEY, presentationId).catch(() => {});

  await publishAnswerReceived(presentationId, {
    slideIndex: data.slideIndex,
    answeredCount,
  });

  PresentationAnswerModel.create({
    presentationId,
    participantId: data.participantId,
    slideIndex: data.slideIndex,
    optionIndex: persist.optionIndex,
    text: persist.text,
    payload: persist.payload,
    isCorrect,
    score,
    timeMs: elapsedMs,
  }).catch((error: any) => {
    if (error?.code !== 11000) console.error('[Presentation] Failed to persist answer:', error);
  });
  PresentationParticipantModel.updateOne(
    { _id: data.participantId },
    { $inc: { score, correctCount: isCorrect ? 1 : 0 } }
  ).catch((error) => console.error('[Presentation] Failed to persist participant score:', error));

  return { accepted: true };
};
