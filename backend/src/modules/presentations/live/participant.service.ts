import crypto from 'crypto';
import mongoose from 'mongoose';
import { ApiError } from '../../../common/utils/ApiError';
import { redisClient } from '../../../common/config/redis';
import { newRandomId, signId, verifySignedId } from '../../../common/utils/signedId.utils';
import { PresentationParticipantModel } from '../models/participant.model';
import { PresentationAnswerModel } from '../models/answer.model';
import { PresentationSessionModel, type IPresentationSession } from '../models/session.model';
import { isSlideScored, requireSlideType, toParticipantSlide } from '../slides';
import { getPresentationById } from '../access';
import type { JoinPresentationInput } from '../presentations.schema';
import {
  LIVE_ERROR_CODES,
  type DeckSettings,
  type JoinResponse,
  type LastAnswerView,
  type ParticipantLiveState,
  type ParticipantMeResponse,
} from './contract';
import { k, touchTtls } from './keys';
import { issueSlideTicket } from './ticket';
import { computeSlideDistributionHelper, getLeaderboard, getParticipantCount } from './distribution';
import { publishParticipantJoined } from './events';
import {
  findLiveSession,
  isOpenState,
  lifecycleOf,
  readSlideState,
  resolveLiveSessionId,
  sessionSlides,
  slideIdOf,
  slidePhase,
  windowEnd,
  type StoredAnswerResult,
} from './state';

const generateParticipantToken = () => crypto.randomBytes(24).toString('hex');

const participantNotFound = () => ApiError.notFound('Participant not found — rejoin the presentation deck');

export const kickedError = () =>
  new ApiError(403, 'You were removed from this session', LIVE_ERROR_CODES.participantKicked);

/**
 * Verifies participantId + token and returns the participant's session.
 * Redis-first against the live session (or `sessionIdHint`); falls back to
 * Mongo, which also finds participants of ended sessions.
 */
export const verifyParticipant = async (
  presentationId: string,
  participantId: string,
  token: string,
  sessionIdHint?: string
): Promise<{ sessionId: string }> => {
  if (!mongoose.isValidObjectId(participantId)) throw participantNotFound();

  let sessionId = sessionIdHint ?? (await resolveLiveSessionId(presentationId).catch(() => null));
  let stored: string | null = null;
  let kicked = false;
  if (sessionId) {
    try {
      const [cachedToken, isKicked] = await Promise.all([
        redisClient.hGet(k.tokens(sessionId), participantId),
        redisClient.sIsMember(k.kicked(sessionId), participantId),
      ]);
      stored = cachedToken ?? null;
      kicked = Boolean(isKicked);
    } catch (error) {
      console.error('[Presentation] Redis token lookup failed:', error);
    }
  }

  if (!stored) {
    const participant = await PresentationParticipantModel.findOne({ _id: participantId, presentationId }).lean();
    if (!participant?.sessionId) throw participantNotFound();
    stored = participant.token;
    kicked = Boolean(participant.kickedAt);
    sessionId = String(participant.sessionId);
    const sid = sessionId;
    void Promise.all([
      redisClient.hSet(k.tokens(sid), participantId, participant.token),
      redisClient.hSet(k.names(sid), participantId, participant.name),
      redisClient.zIncrBy(k.scores(sid), 0, participantId),
    ])
      .then(() => touchTtls([k.tokens(sid), k.names(sid), k.scores(sid)]))
      .catch(() => {});
  }

  if (stored !== token) throw ApiError.unauthorized('Invalid participant token');
  if (kicked) throw kickedError();
  return { sessionId: sessionId! };
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

/**
 * Takes a seat for a device in a capped session. SADD-then-SCARD never admits
 * more than `cap` devices, even under a burst of concurrent joins (a join that
 * sees the set over the cap gives its seat back). A device already seated, or
 * already a participant, always gets back in.
 */
const claimSeat = async (sessionId: string, deviceId: string, cap: number | null) => {
  if (cap === null) return;
  let full: boolean;
  try {
    const added = await redisClient.sAdd(k.seats(sessionId), deviceId);
    if (added === 0) return;
    await touchTtls([k.seats(sessionId)]);
    full = (await redisClient.sCard(k.seats(sessionId))) > cap;
    if (full) await redisClient.sRem(k.seats(sessionId), deviceId);
  } catch (error) {
    console.error('[Presentation] Redis seat check failed, counting in Mongo:', error);
    full = (await PresentationParticipantModel.countDocuments({ sessionId })) >= cap;
  }
  if (full && !(await PresentationParticipantModel.exists({ sessionId, deviceId }))) {
    throw new ApiError(403, 'This session is full', LIVE_ERROR_CODES.sessionFull, { audienceCap: cap });
  }
};

export const joinPresentation = async (presentationId: string, data: JoinPresentationInput): Promise<JoinResponse> => {
  const presentation = await getPresentationById(presentationId);
  if (presentation.status === 'draft') throw ApiError.badRequest('This presentation is not open yet');
  const session = presentation.status === 'ended' ? null : await findLiveSession(presentationId);
  if (!session) throw ApiError.badRequest('This presentation has already ended');
  const sessionId = String(session._id);

  const rejoinDeviceId = verifySignedId(data.deviceToken);
  const deviceId = rejoinDeviceId ?? newRandomId();
  await claimSeat(sessionId, deviceId, session.entitlementsSnapshot?.audienceCap ?? null);

  const participant = await PresentationParticipantModel.findOneAndUpdate(
    { sessionId, deviceId },
    {
      $setOnInsert: {
        presentationId,
        name: data.name,
        token: generateParticipantToken(),
        score: 0,
        correctCount: 0,
        joinedAt: new Date(),
        kickedAt: null,
        locale: data.locale ?? null,
      },
    },
    { returnDocument: 'after', upsert: true }
  );
  if (participant.kickedAt) throw kickedError();

  const participantId = String(participant._id);

  await Promise.all([
    redisClient.hSet(k.names(sessionId), participantId, participant.name),
    redisClient.hSet(k.tokens(sessionId), participantId, participant.token),
    redisClient.zIncrBy(k.scores(sessionId), 0, participantId),
  ]).catch((error) => console.error('[Presentation] Failed to mirror participant to Redis:', error));
  await touchTtls([k.names(sessionId), k.tokens(sessionId), k.scores(sessionId), k.correct(sessionId)]);

  const participantCount = await getParticipantCount(sessionId);

  await publishParticipantJoined(presentationId, sessionId, {
    participantId,
    name: participant.name,
    participantCount,
  });

  return {
    participantId,
    sessionId,
    name: participant.name,
    score: participant.score,
    token: participant.token,
    deviceToken: signId(deviceId),
  };
};

// ---------------------------------------------------------------------------
// Participant reads
// ---------------------------------------------------------------------------

const loadSession = async (sessionId: string) => {
  const session = await PresentationSessionModel.findById(sessionId);
  if (!session) throw participantNotFound();
  return session;
};

/** Total score, rank and correct count: Redis-first, Mongo on failure. */
const standingOf = async (sessionId: string, participantId: string) => {
  try {
    const zScore = await redisClient.zScore(k.scores(sessionId), participantId);
    const totalScore = zScore ?? 0;
    const higher = await redisClient.zCount(k.scores(sessionId), `(${totalScore}`, '+inf');
    const correctCount = Number((await redisClient.hGet(k.correct(sessionId), participantId)) ?? 0);
    return { totalScore, rank: higher + 1, correctCount };
  } catch {
    const participant = await PresentationParticipantModel.findOne({ _id: participantId, sessionId }).lean();
    if (!participant) return { totalScore: 0, rank: 1, correctCount: 0 };
    const higher = await PresentationParticipantModel.countDocuments({ sessionId, score: { $gt: participant.score } });
    return { totalScore: participant.score, rank: higher + 1, correctCount: participant.correctCount };
  }
};

/**
 * The participant's result on the session's current slide, once that slide no
 * longer accepts answers (or the session ended). Null otherwise.
 */
const lastAnswerOf = async (
  session: IPresentationSession,
  participantId: string,
  now = Date.now()
): Promise<LastAnswerView | null> => {
  const slides = sessionSlides(session);
  const slide = slides[session.currentSlideIndex];
  if (!slide) return null;
  const slideId = slideIdOf(slide);
  const lifecycle = lifecycleOf(slide.type);
  if (lifecycle !== 'response') return null;
  const phase = slidePhase(lifecycle, readSlideState(session, slideId), now);
  if (session.status !== 'ended' && phase === 'open') return null;

  const slideScored = isSlideScored(slide);
  const cached = await redisClient
    .hGet(k.results(String(session._id), slideId), participantId)
    .catch(() => null);
  if (cached) {
    const parsed = JSON.parse(cached) as Partial<StoredAnswerResult>;
    return {
      slideId,
      slideIndex: session.currentSlideIndex,
      isCorrect: Boolean(parsed.isCorrect),
      score: parsed.score ?? 0,
      scored: parsed.scored ?? slideScored,
    };
  }
  const answer = await PresentationAnswerModel.findOne({ sessionId: session._id, slideId, participantId }).lean();
  return answer
    ? { slideId, slideIndex: answer.slideIndex, isCorrect: answer.isCorrect, score: answer.score, scored: slideScored }
    : null;
};

const nameOf = async (sessionId: string, participantId: string) =>
  (await redisClient.hGet(k.names(sessionId), participantId).catch(() => null)) ??
  (await PresentationParticipantModel.findById(participantId).select('name').lean())?.name ??
  'Player';

export const getParticipantState = async (
  presentationId: string,
  participantId: string,
  token: string
): Promise<ParticipantMeResponse> => {
  const { sessionId } = await verifyParticipant(presentationId, participantId, token);
  const session = await loadSession(sessionId);
  const [standing, lastAnswer, name] = await Promise.all([
    standingOf(sessionId, participantId),
    lastAnswerOf(session, participantId),
    nameOf(sessionId, participantId),
  ]);

  return {
    participantId,
    sessionId,
    name,
    ...standing,
    lastAnswer,
    quizStatus: session.status,
    presentationStatus: session.status,
  };
};

/**
 * Everything a participant client needs to re-render after a reconnect: the
 * session, settings and theme, the current slide (sanitized) with its phase and
 * timing, revealed results, standings, and the participant's own position.
 */
export const getParticipantLiveState = async (
  presentationId: string,
  participantId: string,
  token: string
): Promise<ParticipantLiveState> => {
  const { sessionId } = await verifyParticipant(presentationId, participantId, token);
  const [session, presentation] = await Promise.all([loadSession(sessionId), getPresentationById(presentationId)]);
  const now = Date.now();
  const slides = sessionSlides(session);
  const slide = session.currentSlideIndex >= 0 ? slides[session.currentSlideIndex] : undefined;

  let current: ParticipantLiveState['current'] = null;
  let answeredCurrent = false;
  if (slide && session.status !== 'lobby') {
    const def = requireSlideType(slide.type);
    const slideId = slideIdOf(slide);
    const state = readSlideState(session, slideId);
    const phase = slidePhase(def.lifecycle, state, now);
    let results: NonNullable<ParticipantLiveState['current']>['results'] = null;
    if (phase === 'revealed') {
      const stat = session.isLive ? null : session.slideStats.find((s) => String(s.slideId) === slideId);
      const live = stat ? null : await computeSlideDistributionHelper(sessionId, slideId, slide);
      results = {
        slideId,
        slideIndex: session.currentSlideIndex,
        type: slide.type,
        scored: isSlideScored(slide),
        answeredCount: stat?.answeredCount ?? live!.answeredCount,
        participantCount: stat ? session.participantCount : live!.participantCount,
        distribution: stat?.distribution ?? live!.distribution,
      };
    }
    if (def.lifecycle === 'response') {
      answeredCurrent = await redisClient
        .sIsMember(k.answered(sessionId, slideId), participantId)
        .then(Boolean)
        .catch(async () => Boolean(await PresentationAnswerModel.exists({ sessionId, slideId, participantId })));
    }
    current = {
      slideId,
      slideIndex: session.currentSlideIndex,
      phase,
      isLastSlide: session.currentSlideIndex === slides.length - 1,
      slide: toParticipantSlide(slide, session.currentSlideIndex, slides.length),
      startedAt: def.lifecycle === 'response' && state?.openedAt ? state.openedAt.toISOString() : null,
      endsAt: def.lifecycle === 'response' ? (windowEnd(state)?.toISOString() ?? null) : null,
      // Handed out while the window is open (the host has not closed or revealed it), even past the timer.
      slideTicket:
        def.lifecycle === 'response' && session.isLive && isOpenState(state) && state?.openedAt
          ? issueSlideTicket(sessionId, slideId, state.openedAt.getTime())
          : null,
      results,
      leaderboard: def.lifecycle === 'system' ? await getLeaderboard(sessionId) : null,
    };
  }

  const [standing, lastAnswer, name] = await Promise.all([
    standingOf(sessionId, participantId),
    lastAnswerOf(session, participantId, now),
    nameOf(sessionId, participantId),
  ]);

  return {
    presentationId,
    sessionId,
    title: presentation.title,
    status: session.status,
    pace: session.pace,
    joinCode: session.joinCode,
    totalSlides: slides.length,
    serverNow: new Date(now).toISOString(),
    settings: (session.settingsSnapshot ?? presentation.settings) as DeckSettings,
    theme: session.themeSnapshot ?? null,
    current,
    me: { participantId, name, ...standing, answeredCurrent, lastAnswer },
    finalLeaderboard: session.status === 'ended' ? session.finalLeaderboard : null,
  };
};
