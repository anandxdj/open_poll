import crypto from 'crypto';
import { ApiError } from '../../../common/utils/ApiError';
import { redisClient } from '../../../common/config/redis';
import { newRandomId, signId, verifySignedId } from '../../../common/utils/signedId.utils';
import { PresentationParticipantModel } from '../models/participant.model';
import { PresentationAnswerModel } from '../models/answer.model';
import { getSlideType } from '../slides';
import { getPresentationById } from '../crud.service';
import type { JoinPresentationInput } from '../presentations.schema';
import { k, touchTtls } from './keys';
import { getParticipantCount } from './distribution';
import { publishParticipantJoined } from './events';

const generateParticipantToken = () => crypto.randomBytes(24).toString('hex');

/**
 * Verifies participantId + token. Redis-first; falls back to Mongo.
 */
export const verifyParticipant = async (presentationId: string, participantId: string, token: string) => {
  let stored: string | null | undefined = null;
  try {
    stored = await redisClient.hGet(k.tokens(presentationId), participantId);
  } catch (error) {
    console.error('[Presentation] Redis token lookup failed:', error);
  }

  if (!stored) {
    const participant = await PresentationParticipantModel.findOne({ _id: participantId, presentationId }).lean();
    if (!participant) throw ApiError.notFound('Participant not found — rejoin the presentation deck');
    stored = participant.token;
    void Promise.all([
      redisClient.hSet(k.tokens(presentationId), participantId, participant.token),
      redisClient.hSet(k.names(presentationId), participantId, participant.name),
      redisClient.zIncrBy(k.scores(presentationId), 0, participantId),
    ]).catch(() => {});
  }

  if (stored !== token) {
    throw ApiError.unauthorized('Invalid participant token');
  }
};

/** Non-throwing participant check for the socket layer, which just needs a yes/no. */
export const isAuthorizedParticipant = async (
  presentationId: string,
  participantId: string,
  token: string
): Promise<boolean> => {
  try {
    await verifyParticipant(presentationId, participantId, token);
    return true;
  } catch {
    return false;
  }
};

export const joinPresentation = async (presentationId: string, data: JoinPresentationInput) => {
  const presentation = await getPresentationById(presentationId);
  if (presentation.status === 'draft') throw ApiError.badRequest('This presentation is not open yet');
  if (presentation.status === 'ended') throw ApiError.badRequest('This presentation has already ended');

  const rejoinDeviceId = verifySignedId(data.deviceToken);
  const deviceId = rejoinDeviceId ?? newRandomId();

  const participant = await PresentationParticipantModel.findOneAndUpdate(
    { presentationId, deviceId },
    {
      $setOnInsert: {
        name: data.name,
        token: generateParticipantToken(),
        score: 0,
        correctCount: 0,
        joinedAt: new Date(),
      },
    },
    { returnDocument: 'after', upsert: true }
  );

  const participantId = String(participant._id);

  await Promise.all([
    redisClient.hSet(k.names(presentationId), participantId, participant.name),
    redisClient.hSet(k.tokens(presentationId), participantId, participant.token),
    redisClient.zIncrBy(k.scores(presentationId), 0, participantId),
  ]).catch((error) => console.error('[Presentation] Failed to mirror participant to Redis:', error));
  await touchTtls([k.names(presentationId), k.tokens(presentationId), k.scores(presentationId), k.correct(presentationId)]);

  const participantCount = await getParticipantCount(presentationId);

  await publishParticipantJoined(presentationId, {
    participantId,
    name: participant.name,
    participantCount,
  });

  return {
    participantId,
    name: participant.name,
    score: participant.score,
    token: participant.token,
    deviceToken: signId(deviceId),
  };
};

export const getParticipantState = async (presentationId: string, participantId: string, token: string) => {
  await verifyParticipant(presentationId, participantId, token);

  const presentation = await getPresentationById(presentationId);

  let totalScore = 0;
  let rank = 1;
  let correctCount = 0;
  try {
    const zScore = await redisClient.zScore(k.scores(presentationId), participantId);
    totalScore = zScore ?? 0;
    const higher = await redisClient.zCount(k.scores(presentationId), `(${totalScore}`, '+inf');
    rank = higher + 1;
    correctCount = Number((await redisClient.hGet(k.correct(presentationId), participantId)) ?? 0);
  } catch {
    const participant = await PresentationParticipantModel.findOne({ _id: participantId, presentationId }).lean();
    if (participant) {
      totalScore = participant.score;
      correctCount = participant.correctCount;
      rank =
        (await PresentationParticipantModel.countDocuments({
          presentationId,
          score: { $gt: participant.score },
        })) + 1;
    }
  }

  let lastAnswer: {
    slideIndex: number;
    isCorrect: boolean;
    score: number;
    scored: boolean;
  } | null = null;
  // Reveal is clock-derived: expose the participant's result once the current
  // slide's answer window has closed, or after the deck ends.
  const answerWindowClosed =
    presentation.status === 'ended' ||
    (presentation.status === 'active' &&
      !!presentation.questionEndsAt &&
      Date.now() > presentation.questionEndsAt.getTime());
  if (answerWindowClosed && presentation.currentSlideIndex >= 0) {
    const slideType = presentation.slides[presentation.currentSlideIndex]?.type;
    const slideScored = slideType ? (getSlideType(slideType)?.scored ?? false) : true;
    const cached = await redisClient
      .hGet(k.results(presentationId, presentation.currentSlideIndex), participantId)
      .catch(() => null);
    if (cached) {
      const parsed = JSON.parse(cached) as {
        isCorrect: boolean;
        score: number;
        scored?: boolean;
      };
      lastAnswer = {
        slideIndex: presentation.currentSlideIndex,
        isCorrect: parsed.isCorrect,
        score: parsed.score,
        scored: parsed.scored ?? slideScored,
      };
    } else {
      const answer = await PresentationAnswerModel.findOne({
        presentationId,
        participantId,
        slideIndex: presentation.currentSlideIndex,
      }).lean();
      if (answer) {
        lastAnswer = {
          slideIndex: answer.slideIndex,
          isCorrect: answer.isCorrect,
          score: answer.score,
          scored: slideScored,
        };
      }
    }
  }

  const name = (await redisClient.hGet(k.names(presentationId), participantId).catch(() => null)) ?? 'Player';

  return {
    participantId,
    name,
    totalScore,
    correctCount,
    rank,
    lastAnswer,
    quizStatus: presentation.status,
    presentationStatus: presentation.status,
  };
};
