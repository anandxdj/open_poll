import crypto from 'crypto';
import { ApiError } from '../../common/utils/ApiError';
import { redisClient } from '../../common/config/redis';
import { newRandomId, signId, verifySignedId } from '../../common/utils/signedId.utils';
import { REALTIME_CHANNELS, type QuizRealtimeEventType } from '../../common/realtime/events';
import {
  PresentationModel,
  PresentationParticipantModel,
  PresentationAnswerModel,
  isScoredSlideType,
  type IPresentation,
  type IPresentationSlide,
  type PresentationSlideType,
} from './presentations.model';
import type {
  CreatePresentationInput,
  UpdatePresentationInput,
  JoinPresentationInput,
  SubmitPresentationAnswerInput,
} from './presentations.schema';

// Answers arriving slightly after the deadline (network latency) are still accepted
const ANSWER_GRACE_MS = 750;
const LEADERBOARD_SIZE = 10;
// Live-session Redis keys self-clean 6h after the last transition
const PRESENTATION_KEY_TTL_SEC = 6 * 3600;

// ---------------------------------------------------------------------------
// Redis key map — the answer hot path runs entirely on these (no Mongo reads),
// so hundreds of simultaneous clicks don't queue on the database. Mongo stays
// the durable system of record via async write-behind.
// ---------------------------------------------------------------------------
const k = {
  session: (q: string) => `presentation:${q}:session`,
  scores: (q: string) => `presentation:${q}:scores`, // ZSET participantId -> total score
  correct: (q: string) => `presentation:${q}:correct`, // HASH participantId -> correct count
  names: (q: string) => `presentation:${q}:names`, // HASH participantId -> nickname
  tokens: (q: string) => `presentation:${q}:tokens`, // HASH participantId -> secret token
  answered: (q: string, i: number) => `presentation:${q}:answered:${i}`, // SET participantIds
  dist: (q: string, i: number) => `presentation:${q}:dist:${i}`, // HASH option/text -> count (sum/points for scales/ranking)
  disp: (q: string, i: number) => `presentation:${q}:disp:${i}`, // HASH normalized text -> first-seen original casing
  results: (q: string, i: number) => `presentation:${q}:results:${i}`, // HASH pid -> {isCorrect,score,scored}
};

const allPresentationKeys = (presentationId: string, slideCount: number) => {
  const keys = [
    k.session(presentationId),
    k.scores(presentationId),
    k.correct(presentationId),
    k.names(presentationId),
    k.tokens(presentationId),
  ];
  for (let i = 0; i < slideCount; i++) {
    keys.push(
      k.answered(presentationId, i),
      k.dist(presentationId, i),
      k.disp(presentationId, i),
      k.results(presentationId, i)
    );
  }
  return keys;
};

/** Snapshot of the live question, cached in Redis for the answer hot path */
interface LiveSession {
  slideIndex: number;
  startedAtMs: number;
  endsAtMs: number;
  type: PresentationSlideType;
  scored: boolean;
  correctOptions: number[];
  acceptedNormalized: string[];
  optionCount: number;
  statementCount: number;
  scaleMax: number;
  itemCount: number;
  maxEntries: number;
  timeLimitMs: number;
  points: number;
  scoreDependsOnTime: boolean;
}

const buildSession = (presentation: IPresentation, slide: IPresentationSlide): LiveSession => ({
  slideIndex: presentation.currentSlideIndex,
  startedAtMs: presentation.questionStartedAt!.getTime(),
  endsAtMs: presentation.questionEndsAt!.getTime(),
  type: slide.type,
  scored: isScoredSlideType(slide.type),
  correctOptions: slide.options.flatMap((o, i) => (o.isCorrect ? [i] : [])),
  acceptedNormalized: slide.acceptedAnswers.map((a) => normalizeText(a)),
  optionCount: slide.options.length,
  statementCount: slide.statements?.length ?? 0,
  scaleMax: slide.scaleMax ?? 5,
  itemCount: slide.items?.length ?? 0,
  maxEntries: slide.maxEntries ?? 3,
  timeLimitMs: slide.timeLimit * 1000,
  points: slide.points,
  scoreDependsOnTime: slide.scoreDependsOnTime,
});

export const publishPresentationEvent = async (
  presentationId: string,
  type: QuizRealtimeEventType,
  payload: Record<string, unknown>
) => {
  try {
    await redisClient.publish(
      REALTIME_CHANNELS.quizEvent,
      JSON.stringify({ quizId: presentationId, type, payload, emittedAt: new Date().toISOString() })
    );
  } catch (error) {
    console.error('[Presentation] Failed to publish realtime event:', error);
  }
};

export const computeSlideDistributionHelper = async (
  prefix: 'presentation' | 'quiz',
  id: string,
  slideIndex: number,
  slide: any,
  ParticipantModel: any
) => {
  const distKey = `${prefix}:${id}:dist:${slideIndex}`;
  const dispKey = `${prefix}:${id}:disp:${slideIndex}`;
  const answeredKey = `${prefix}:${id}:answered:${slideIndex}`;
  const namesKey = `${prefix}:${id}:names`;

  const [distHash, dispHash, answeredCount, nameCount] = await Promise.all([
    redisClient.hGetAll(distKey).catch(() => ({}) as Record<string, string>),
    redisClient.hGetAll(dispKey).catch(() => ({}) as Record<string, string>),
    redisClient.sCard(answeredKey).catch(() => 0),
    redisClient.hLen(namesKey).catch(() => 0),
  ]);

  const participantCount =
    nameCount > 0
      ? nameCount
      : await ParticipantModel.countDocuments(
          prefix === 'presentation' ? { presentationId: id } : { quizId: id }
        );

  let distribution: Record<string, unknown> = {};
  switch (slide.type) {
    case 'select_answer': {
      const counts = slide.options.map((_: any, i: number) => Number(distHash[String(i)] ?? 0));
      distribution = {
        kind: 'options',
        counts,
        options: slide.options.map((o: any) => ({ text: o.text, isCorrect: o.isCorrect })),
      };
      break;
    }
    case 'type_answer': {
      const accepted = (slide.acceptedAnswers || []).map(normalizeText);
      const answers = Object.entries(distHash)
        .map(([text, count]) => ({
          text,
          count: Number(count),
          isCorrect: accepted.includes(text),
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);
      distribution = { kind: 'text', answers, acceptedAnswers: slide.acceptedAnswers };
      break;
    }
    case 'wordcloud': {
      const words = Object.entries(distHash)
        .map(([norm, count]) => ({ text: dispHash[norm] ?? norm, count: Number(count) }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 100);
      distribution = { kind: 'words', words };
      break;
    }
    case 'open_ended': {
      const responses = Object.entries(distHash)
        .map(([norm, count]) => ({ text: dispHash[norm] ?? norm, count: Number(count) }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 50);
      distribution = { kind: 'responses', responses };
      break;
    }
    case 'scales': {
      const statements = (slide.statements ?? []).map((statement: string, i: number) => {
        const sum = Number(distHash[`s${i}:sum`] ?? 0);
        const count = Number(distHash[`s${i}:count`] ?? 0);
        return {
          statement,
          average: count > 0 ? Math.round((sum / count) * 100) / 100 : 0,
          count,
        };
      });
      distribution = {
        kind: 'scales',
        statements,
        scaleMax: slide.scaleMax ?? 5,
        minLabel: slide.minLabel ?? '',
        maxLabel: slide.maxLabel ?? '',
      };
      break;
    }
    case 'ranking': {
      const voters = Number(distHash['voters'] ?? 0);
      const items = (slide.items ?? [])
        .map((text: string, i: number) => ({ text, points: Number(distHash[String(i)] ?? 0) }))
        .sort((a, b) => b.points - a.points)
        .map((item, i) => ({ ...item, rank: i + 1 }));
      distribution = { kind: 'ranking', items, voters };
      break;
    }
  }

  return { distribution, answeredCount, participantCount };
};

const generateJoinCode = () => crypto.randomInt(100000, 1000000).toString();

const generateParticipantToken = () => crypto.randomBytes(24).toString('hex');

// Strip answer keys before sending a slide to participants
const sanitizeSlide = (slide: IPresentationSlide, slideIndex: number, totalSlides: number) => ({
  slideIndex,
  totalSlides,
  type: slide.type,
  scored: isScoredSlideType(slide.type),
  question: slide.question,
  options: slide.options.map((o) => ({ text: o.text })),
  statements: slide.statements ?? [],
  minLabel: slide.minLabel ?? '',
  maxLabel: slide.maxLabel ?? '',
  scaleMax: slide.scaleMax ?? 5,
  items: slide.items ?? [],
  maxEntries: slide.maxEntries ?? 3,
  timeLimit: slide.timeLimit,
  points: slide.points,
  scoreDependsOnTime: slide.scoreDependsOnTime,
});

const normalizeText = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

const computeScore = (
  points: number,
  scoreDependsOnTime: boolean,
  timeLimitMs: number,
  isCorrect: boolean,
  elapsedMs: number
) => {
  if (!isCorrect) return 0;
  if (!scoreDependsOnTime) return points;
  const ratio = Math.min(Math.max(elapsedMs / timeLimitMs, 0), 1);
  return Math.round(points * (1 - ratio / 2));
};

const touchTtls = async (keys: string[]) => {
  try {
    await Promise.all(keys.map((key) => redisClient.expire(key, PRESENTATION_KEY_TTL_SEC)));
  } catch (error) {
    console.error('[Presentation] Failed to refresh key TTLs:', error);
  }
};

/**
 * Leaderboard from the Redis sorted set (fast, multi-instance safe).
 * Falls back to Mongo if Redis state was lost.
 */
const getLeaderboard = async (presentationId: string, limit = LEADERBOARD_SIZE) => {
  try {
    const entries = await redisClient.zRangeWithScores(k.scores(presentationId), 0, limit - 1, {
      REV: true,
    });
    if (entries.length > 0) {
      const [names, correct] = await Promise.all([
        redisClient.hGetAll(k.names(presentationId)),
        redisClient.hGetAll(k.correct(presentationId)),
      ]);
      return entries.map((entry, i) => ({
        participantId: entry.value,
        name: names[entry.value] ?? 'Player',
        score: entry.score,
        correctCount: Number(correct[entry.value] ?? 0),
        rank: i + 1,
      }));
    }
  } catch (error) {
    console.error('[Presentation] Redis leaderboard failed, falling back to Mongo:', error);
  }

  const participants = await PresentationParticipantModel.find({ presentationId })
    .sort({ score: -1, joinedAt: 1 })
    .limit(limit)
    .lean();
  return participants.map((p, i) => ({
    participantId: String(p._id),
    name: p.name,
    score: p.score,
    correctCount: p.correctCount,
    rank: i + 1,
  }));
};

/**
 * Verifies participantId + token. Redis-first; falls back to Mongo.
 */
const verifyParticipant = async (presentationId: string, participantId: string, token: string) => {
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

export class PresentationService {
  // ---------- CRUD (creator) ----------

  static async createPresentation(data: CreatePresentationInput, creatorId: string) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await PresentationModel.create({
          ...data,
          creatorId,
          joinCode: generateJoinCode(),
        });
      } catch (error: any) {
        if (error?.code !== 11000) throw error;
      }
    }
    throw ApiError.internal('Could not allocate a unique join code, please retry');
  }

  static async getPresentationById(presentationId: string) {
    const presentation = await PresentationModel.findById(presentationId);
    if (!presentation) throw ApiError.notFound('Presentation deck not found');
    return presentation;
  }

  static async assertOwnership(presentationId: string, userId: string): Promise<IPresentation> {
    const presentation = await PresentationService.getPresentationById(presentationId);
    if (presentation.creatorId !== userId) {
      throw ApiError.forbidden('You do not have permission to manage this presentation');
    }
    return presentation;
  }

  // Non-throwing checks for the socket layer, which just needs a yes/no.
  static async isOwner(presentationId: string, userId: string): Promise<boolean> {
    try {
      await PresentationService.assertOwnership(presentationId, userId);
      return true;
    } catch {
      return false;
    }
  }

  static async isAuthorizedParticipant(
    presentationId: string,
    participantId: string,
    token: string
  ): Promise<boolean> {
    try {
      await verifyParticipant(presentationId, participantId, token);
      return true;
    } catch {
      return false;
    }
  }

  static async listPresentationsByCreator(creatorId: string) {
    return PresentationModel.find({ creatorId }).sort({ createdAt: -1 });
  }

  static async updatePresentation(presentationId: string, userId: string, data: UpdatePresentationInput) {
    const presentation = await PresentationService.assertOwnership(presentationId, userId);
    if (presentation.status !== 'draft' && presentation.status !== 'ended') {
      throw ApiError.badRequest('Cannot edit a presentation deck while a live session is running');
    }
    if (data.title !== undefined) presentation.title = data.title;
    if (data.slides !== undefined) presentation.slides = data.slides as IPresentationSlide[];
    await presentation.save();
    return presentation;
  }

  static async deletePresentation(presentationId: string, userId: string) {
    const presentation = await PresentationService.assertOwnership(presentationId, userId);
    await Promise.all([
      PresentationModel.findByIdAndDelete(presentationId),
      PresentationParticipantModel.deleteMany({ presentationId }),
      PresentationAnswerModel.deleteMany({ presentationId }),
      redisClient.del(allPresentationKeys(presentationId, presentation.slides.length)).catch(() => {}),
    ]);
  }

  // ---------- Host session controls ----------

  static async openLobby(presentationId: string, userId: string) {
    const presentation = await PresentationService.assertOwnership(presentationId, userId);

    await Promise.all([
      PresentationParticipantModel.deleteMany({ presentationId }),
      PresentationAnswerModel.deleteMany({ presentationId }),
      redisClient.del(allPresentationKeys(presentationId, presentation.slides.length)).catch(() => {}),
    ]);

    presentation.status = 'lobby';
    presentation.currentSlideIndex = -1;
    presentation.questionStartedAt = null;
    presentation.questionEndsAt = null;
    await presentation.save();

    await publishPresentationEvent(presentationId, 'lobby:opened', { joinCode: presentation.joinCode });
    return presentation;
  }

  static async startNextQuestion(presentationId: string, userId: string) {
    const presentation = await PresentationService.assertOwnership(presentationId, userId);
    if (!['lobby', 'reveal', 'leaderboard'].includes(presentation.status)) {
      throw ApiError.badRequest(`Cannot start a slide from status "${presentation.status}"`);
    }

    const nextIndex = presentation.currentSlideIndex + 1;
    const slide = presentation.slides[nextIndex];
    if (!slide) throw ApiError.badRequest('No more slides — end the presentation instead');

    const now = new Date();
    presentation.status = 'question';
    presentation.currentSlideIndex = nextIndex;
    presentation.questionStartedAt = now;
    presentation.questionEndsAt = new Date(now.getTime() + slide.timeLimit * 1000);
    await presentation.save();

    await redisClient
      .set(k.session(presentationId), JSON.stringify(buildSession(presentation, slide)), {
        EX: PRESENTATION_KEY_TTL_SEC,
      })
      .catch((error) => console.error('[Presentation] Failed to cache session:', error));

    await publishPresentationEvent(presentationId, 'question:started', {
      slide: sanitizeSlide(slide, nextIndex, presentation.slides.length),
      startedAt: now.toISOString(),
      endsAt: presentation.questionEndsAt.toISOString(),
      serverNow: new Date().toISOString(),
    });
    return presentation;
  }

  static async revealAnswers(presentationId: string, userId: string) {
    const presentation = await PresentationService.assertOwnership(presentationId, userId);
    if (presentation.status !== 'question') {
      throw ApiError.badRequest('No live slide to reveal');
    }

    const slideIndex = presentation.currentSlideIndex;
    const slide = presentation.slides[slideIndex];
    if (!slide) throw ApiError.internal('Current slide missing');

    presentation.status = 'reveal';
    await presentation.save();

    await redisClient.del(k.session(presentationId)).catch(() => {});

    const { distribution, answeredCount, participantCount } = await computeSlideDistributionHelper(
      'presentation',
      presentationId,
      slideIndex,
      slide,
      PresentationParticipantModel
    );

    await touchTtls([
      k.answered(presentationId, slideIndex),
      k.dist(presentationId, slideIndex),
      k.disp(presentationId, slideIndex),
      k.results(presentationId, slideIndex),
    ]);

    await publishPresentationEvent(presentationId, 'question:revealed', {
      slideIndex,
      question: slide.question,
      type: slide.type,
      scored: isScoredSlideType(slide.type),
      distribution,
      answeredCount,
      participantCount,
      isLastSlide: slideIndex === presentation.slides.length - 1,
    });
    return presentation;
  }

  static async showLeaderboard(presentationId: string, userId: string) {
    const presentation = await PresentationService.assertOwnership(presentationId, userId);
    if (!['reveal', 'question'].includes(presentation.status)) {
      throw ApiError.badRequest('Leaderboard can be shown after revealing a question');
    }

    presentation.status = 'leaderboard';
    await presentation.save();

    const leaderboard = await getLeaderboard(presentationId);
    const participantCount = await redisClient
      .hLen(k.names(presentationId))
      .catch(() => 0)
      .then((n) => (n > 0 ? n : PresentationParticipantModel.countDocuments({ presentationId })));

    await publishPresentationEvent(presentationId, 'leaderboard:shown', {
      leaderboard,
      participantCount,
      isLastSlide: presentation.currentSlideIndex === presentation.slides.length - 1,
    });
    return presentation;
  }

  static async endPresentation(presentationId: string, userId: string) {
    const presentation = await PresentationService.assertOwnership(presentationId, userId);
    if (presentation.status === 'draft') throw ApiError.badRequest('Presentation has not been started');

    presentation.status = 'ended';
    await presentation.save();

    const leaderboard = await getLeaderboard(presentationId, 100);
    const participantCount = await PresentationParticipantModel.countDocuments({ presentationId });

    // Keep Redis state readable for final screens, then self-clean
    await touchTtls(allPresentationKeys(presentationId, presentation.slides.length));

    await publishPresentationEvent(presentationId, 'quiz:ended', { leaderboard, participantCount });
    return presentation;
  }

  static async getHostState(presentationId: string, userId: string) {
    const presentation = await PresentationService.assertOwnership(presentationId, userId);

    let answeredCount = 0;
    let liveDistribution: Record<string, unknown> | null = null;
    if (presentation.currentSlideIndex >= 0) {
      answeredCount = await redisClient
        .sCard(k.answered(presentationId, presentation.currentSlideIndex))
        .catch(() => 0);
      if (answeredCount === 0) {
        answeredCount = await PresentationAnswerModel.countDocuments({
          presentationId,
          slideIndex: presentation.currentSlideIndex,
        });
      }

      if (presentation.status === 'question' || presentation.status === 'reveal') {
        const slide = presentation.slides[presentation.currentSlideIndex];
        if (slide) {
          const res = await computeSlideDistributionHelper(
            'presentation',
            presentationId,
            presentation.currentSlideIndex,
            slide,
            PresentationParticipantModel
          );
          liveDistribution = res.distribution;
        }
      }
    }

    const participants = await PresentationParticipantModel.find({ presentationId }).sort({ joinedAt: 1 }).lean();

    return {
      quiz: presentation,
      presentation,
      serverNow: new Date().toISOString(),
      participants: participants.map((p) => ({
        participantId: String(p._id),
        name: p.name,
        score: p.score,
      })),
      answeredCount,
      liveDistribution,
      leaderboard: await getLeaderboard(presentationId),
    };
  }

  // ---------- Participant flow (public) ----------

  static async getPresentationByCode(joinCode: string) {
    const presentation = await PresentationModel.findOne({ joinCode: joinCode.trim() });
    if (!presentation || presentation.status === 'draft') {
      throw ApiError.notFound('No active presentation deck with that code');
    }

    const result: Record<string, unknown> = {
      quizId: String(presentation._id),
      presentationId: String(presentation._id),
      title: presentation.title,
      status: presentation.status,
      totalSlides: presentation.slides.length,
      currentSlideIndex: presentation.currentSlideIndex,
      serverNow: new Date().toISOString(),
    };

    if (presentation.status === 'question' && presentation.currentSlideIndex >= 0) {
      const slide = presentation.slides[presentation.currentSlideIndex];
      if (slide) {
        result.currentSlide = sanitizeSlide(slide, presentation.currentSlideIndex, presentation.slides.length);
        result.questionStartedAt = presentation.questionStartedAt?.toISOString();
        result.questionEndsAt = presentation.questionEndsAt?.toISOString();
      }
    }

    return result;
  }

  static async joinPresentation(presentationId: string, data: JoinPresentationInput) {
    const presentation = await PresentationService.getPresentationById(presentationId);
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

    const participantCount = await redisClient
      .hLen(k.names(presentationId))
      .catch(() => 0)
      .then((n) => (n > 0 ? n : PresentationParticipantModel.countDocuments({ presentationId })));

    await publishPresentationEvent(presentationId, 'participant:joined', {
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
  }

  /**
   * HOT PATH — runs entirely on Redis; Mongo writes are async write-behind.
   */
  static async submitAnswer(presentationId: string, data: SubmitPresentationAnswerInput) {
    let session: LiveSession | null = null;
    const raw = await redisClient.get(k.session(presentationId)).catch(() => null);
    if (raw) {
      session = JSON.parse(raw) as LiveSession;
    } else {
      const presentation = await PresentationModel.findById(presentationId);
      if (presentation && presentation.status === 'question' && presentation.currentSlideIndex >= 0) {
        const slide = presentation.slides[presentation.currentSlideIndex];
        if (slide && presentation.questionStartedAt && presentation.questionEndsAt) {
          session = buildSession(presentation, slide);
          void redisClient
            .set(k.session(presentationId), JSON.stringify(session), { EX: PRESENTATION_KEY_TTL_SEC })
            .catch(() => {});
        }
      }
    }

    if (!session || session.slideIndex !== data.slideIndex) {
      throw ApiError.badRequest('This slide is no longer accepting answers');
    }

    const now = Date.now();
    if (now > session.endsAtMs + ANSWER_GRACE_MS) {
      throw ApiError.badRequest("Time's up — response not accepted");
    }

    await verifyParticipant(presentationId, data.participantId, data.participantToken);

    const answeredKey = k.answered(presentationId, data.slideIndex);
    const added = await redisClient.sAdd(answeredKey, data.participantId);
    if (added === 0) {
      throw ApiError.conflict('You already responded to this slide');
    }

    const elapsedMs = Math.max(0, now - session.startedAtMs);
    let isCorrect = false;
    let distWrites: { field: string; by: number }[] = [];
    let dispWrites: { field: string; value: string }[] = [];

    try {
      switch (session.type) {
        case 'select_answer': {
          if (
            data.optionIndex === undefined ||
            data.optionIndex < 0 ||
            data.optionIndex >= session.optionCount
          ) {
            throw ApiError.badRequest('Invalid option for this slide');
          }
          isCorrect = session.correctOptions.includes(data.optionIndex);
          distWrites = [{ field: String(data.optionIndex), by: 1 }];
          break;
        }
        case 'type_answer': {
          if (data.text === undefined) {
            throw ApiError.badRequest('This slide expects a typed answer');
          }
          const normalized = normalizeText(data.text);
          isCorrect = session.acceptedNormalized.includes(normalized);
          distWrites = [{ field: normalized, by: 1 }];
          break;
        }
        case 'open_ended': {
          if (data.text === undefined) {
            throw ApiError.badRequest('This slide expects a typed response');
          }
          const normalized = normalizeText(data.text);
          distWrites = [{ field: normalized, by: 1 }];
          dispWrites = [{ field: normalized, value: data.text.trim() }];
          break;
        }
        case 'wordcloud': {
          const raw = data.entries ?? (data.text !== undefined ? [data.text] : []);
          const seen = new Set<string>();
          for (const entry of raw.slice(0, session.maxEntries)) {
            const normalized = normalizeText(entry);
            if (!normalized || seen.has(normalized)) continue;
            seen.add(normalized);
            distWrites.push({ field: normalized, by: 1 });
            dispWrites.push({ field: normalized, value: entry.trim() });
          }
          if (distWrites.length === 0) {
            throw ApiError.badRequest('Submit at least one word');
          }
          break;
        }
        case 'scales': {
          if (!data.ratings || data.ratings.length !== session.statementCount) {
            throw ApiError.badRequest('Rate every statement');
          }
          if (data.ratings.some((r) => r < 1 || r > session.scaleMax)) {
            throw ApiError.badRequest(`Ratings must be between 1 and ${session.scaleMax}`);
          }
          distWrites = data.ratings.flatMap((rating, i) => [
            { field: `s${i}:sum`, by: rating },
            { field: `s${i}:count`, by: 1 },
          ]);
          break;
        }
        case 'ranking': {
          const order = data.ranking;
          if (!order || order.length !== session.itemCount) {
            throw ApiError.badRequest('Rank every item');
          }
          const unique = new Set(order);
          if (
            unique.size !== session.itemCount ||
            order.some((i) => i < 0 || i >= session.itemCount)
          ) {
            throw ApiError.badRequest('Invalid ranking order');
          }
          distWrites = order.map((itemIndex, position) => ({
            field: String(itemIndex),
            by: session.itemCount - position,
          }));
          distWrites.push({ field: 'voters', by: 1 });
          break;
        }
      }
    } catch (error) {
      await redisClient.sRem(answeredKey, data.participantId).catch(() => {});
      throw error;
    }

    const score = session.scored
      ? computeScore(
          session.points,
          session.scoreDependsOnTime,
          session.timeLimitMs,
          isCorrect,
          elapsedMs
        )
      : 0;

    // Atomic Redis updates via MULTI — a crash mid-write can't desync
    // leaderboard / distribution / per-participant result.
    const distKey = k.dist(presentationId, data.slideIndex);
    const dispKey = k.disp(presentationId, data.slideIndex);
    const pipeline = redisClient.multi();
    pipeline.zIncrBy(k.scores(presentationId), score, data.participantId);
    if (isCorrect) pipeline.hIncrBy(k.correct(presentationId), data.participantId, 1);
    distWrites.forEach((w) => pipeline.hIncrBy(distKey, w.field, w.by));
    dispWrites.forEach((w) => pipeline.hSetNX(dispKey, w.field, w.value));
    pipeline.hSet(
      k.results(presentationId, data.slideIndex),
      data.participantId,
      JSON.stringify({ isCorrect, score, scored: session.scored })
    );
    pipeline.sCard(answeredKey);
    const pipelineResults = await pipeline.exec();
    const answeredCount = Number(pipelineResults[pipelineResults.length - 1]);

    await redisClient.sAdd('buffer:active_presentation_distributions', presentationId).catch(() => {});

    await publishPresentationEvent(presentationId, 'answer:received', {
      slideIndex: data.slideIndex,
      answeredCount,
    });

    PresentationAnswerModel.create({
      presentationId,
      participantId: data.participantId,
      slideIndex: data.slideIndex,
      optionIndex: session.type === 'select_answer' ? data.optionIndex : null,
      text: session.type === 'type_answer' || session.type === 'open_ended' ? data.text : null,
      payload:
        session.type === 'wordcloud'
          ? { entries: data.entries ?? (data.text ? [data.text] : []) }
          : session.type === 'scales'
            ? { ratings: data.ratings }
            : session.type === 'ranking'
              ? { ranking: data.ranking }
              : null,
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
  }

  static async getParticipantState(presentationId: string, participantId: string, token: string) {
    await verifyParticipant(presentationId, participantId, token);

    const presentation = await PresentationService.getPresentationById(presentationId);

    let totalScore = 0;
    let rank = 1;
    let correctCount = 0;
    try {
      const zScore = await redisClient.zScore(k.scores(presentationId), participantId);
      totalScore = zScore ?? 0;
      const higher = await redisClient.zCount(k.scores(presentationId), `(${totalScore}`, '+inf');
      rank = higher + 1;
      correctCount = Number(
        (await redisClient.hGet(k.correct(presentationId), participantId)) ?? 0
      );
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
    if (['reveal', 'leaderboard', 'ended'].includes(presentation.status) && presentation.currentSlideIndex >= 0) {
      const slideType = presentation.slides[presentation.currentSlideIndex]?.type;
      const slideScored = slideType ? isScoredSlideType(slideType) : true;
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

    const name =
      (await redisClient.hGet(k.names(presentationId), participantId).catch(() => null)) ?? 'Player';

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
  }
}
