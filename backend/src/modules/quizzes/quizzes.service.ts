import crypto from 'crypto';
import { ApiError } from '../../common/utils/ApiError';
import { redisClient } from '../../common/config/redis';
import { REALTIME_CHANNELS, type QuizRealtimeEventType } from '../../common/realtime/events';
import {
  QuizModel,
  QuizParticipantModel,
  QuizAnswerModel,
  isScoredSlideType,
  type IQuiz,
  type IQuizSlide,
  type QuizSlideType,
} from './quizzes.model';
import type {
  CreateQuizInput,
  UpdateQuizInput,
  JoinQuizInput,
  SubmitQuizAnswerInput,
} from './quizzes.schema';

// Answers arriving slightly after the deadline (network latency) are still accepted
const ANSWER_GRACE_MS = 750;
const LEADERBOARD_SIZE = 10;
// Live-session Redis keys self-clean 6h after the last transition
const QUIZ_KEY_TTL_SEC = 6 * 3600;

// ---------------------------------------------------------------------------
// Redis key map — the answer hot path runs entirely on these (no Mongo reads),
// so hundreds of simultaneous clicks don't queue on the database. Mongo stays
// the durable system of record via async write-behind.
// ---------------------------------------------------------------------------
const k = {
  session: (q: string) => `quiz:${q}:session`,
  scores: (q: string) => `quiz:${q}:scores`, // ZSET participantId -> total score
  correct: (q: string) => `quiz:${q}:correct`, // HASH participantId -> correct count
  names: (q: string) => `quiz:${q}:names`, // HASH participantId -> nickname
  tokens: (q: string) => `quiz:${q}:tokens`, // HASH participantId -> secret token
  answered: (q: string, i: number) => `quiz:${q}:answered:${i}`, // SET participantIds
  dist: (q: string, i: number) => `quiz:${q}:dist:${i}`, // HASH option/text -> count (sum/points for scales/ranking)
  disp: (q: string, i: number) => `quiz:${q}:disp:${i}`, // HASH normalized text -> first-seen original casing
  results: (q: string, i: number) => `quiz:${q}:results:${i}`, // HASH pid -> {isCorrect,score,scored}
};

const allQuizKeys = (quizId: string, slideCount: number) => {
  const keys = [
    k.session(quizId),
    k.scores(quizId),
    k.correct(quizId),
    k.names(quizId),
    k.tokens(quizId),
  ];
  for (let i = 0; i < slideCount; i++) {
    keys.push(k.answered(quizId, i), k.dist(quizId, i), k.disp(quizId, i), k.results(quizId, i));
  }
  return keys;
};

/** Snapshot of the live question, cached in Redis for the answer hot path */
interface LiveSession {
  slideIndex: number;
  startedAtMs: number;
  endsAtMs: number;
  type: QuizSlideType;
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

const buildSession = (quiz: IQuiz, slide: IQuizSlide): LiveSession => ({
  slideIndex: quiz.currentSlideIndex,
  startedAtMs: quiz.questionStartedAt!.getTime(),
  endsAtMs: quiz.questionEndsAt!.getTime(),
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

const publishQuizEvent = async (
  quizId: string,
  type: QuizRealtimeEventType,
  payload: Record<string, unknown>
) => {
  try {
    await redisClient.publish(
      REALTIME_CHANNELS.quizEvent,
      JSON.stringify({ quizId, type, payload, emittedAt: new Date().toISOString() })
    );
  } catch (error) {
    console.error('[Quiz] Failed to publish realtime event:', error);
  }
};

const generateJoinCode = () => crypto.randomInt(100000, 1000000).toString();

const generateParticipantToken = () => crypto.randomBytes(24).toString('hex');

// Strip answer keys before sending a slide to participants
const sanitizeSlide = (slide: IQuizSlide, slideIndex: number, totalSlides: number) => ({
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
  // Mentimeter/Kahoot-style: fastest correct ≈ full points, slowest correct ≈ 50%
  return Math.round(points * (1 - ratio / 2));
};

const touchTtls = async (keys: string[]) => {
  try {
    await Promise.all(keys.map((key) => redisClient.expire(key, QUIZ_KEY_TTL_SEC)));
  } catch (error) {
    console.error('[Quiz] Failed to refresh key TTLs:', error);
  }
};

/**
 * Leaderboard from the Redis sorted set (fast, multi-instance safe).
 * Falls back to Mongo if Redis state was lost (restart mid-quiz).
 */
const getLeaderboard = async (quizId: string, limit = LEADERBOARD_SIZE) => {
  try {
    const entries = await redisClient.zRangeWithScores(k.scores(quizId), 0, limit - 1, {
      REV: true,
    });
    if (entries.length > 0) {
      const [names, correct] = await Promise.all([
        redisClient.hGetAll(k.names(quizId)),
        redisClient.hGetAll(k.correct(quizId)),
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
    console.error('[Quiz] Redis leaderboard failed, falling back to Mongo:', error);
  }

  const participants = await QuizParticipantModel.find({ quizId })
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
 * Verifies participantId + token. Redis-first; falls back to Mongo and
 * re-hydrates the Redis hashes if they were lost.
 */
const verifyParticipant = async (quizId: string, participantId: string, token: string) => {
  let stored: string | null | undefined = null;
  try {
    stored = await redisClient.hGet(k.tokens(quizId), participantId);
  } catch (error) {
    console.error('[Quiz] Redis token lookup failed:', error);
  }

  if (!stored) {
    const participant = await QuizParticipantModel.findOne({ _id: participantId, quizId }).lean();
    if (!participant) throw ApiError.notFound('Participant not found — rejoin the quiz');
    stored = participant.token;
    // Re-hydrate Redis so subsequent answers stay on the fast path
    void Promise.all([
      redisClient.hSet(k.tokens(quizId), participantId, participant.token),
      redisClient.hSet(k.names(quizId), participantId, participant.name),
      redisClient.zIncrBy(k.scores(quizId), 0, participantId),
    ]).catch(() => {});
  }

  if (stored !== token) {
    throw ApiError.unauthorized('Invalid participant token');
  }
};

export class QuizService {
  // ---------- CRUD (creator) ----------

  static async createQuiz(data: CreateQuizInput, creatorId: string) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await QuizModel.create({
          ...data,
          creatorId,
          joinCode: generateJoinCode(),
        });
      } catch (error: any) {
        // 11000 = duplicate joinCode collision; retry with a new code
        if (error?.code !== 11000) throw error;
      }
    }
    throw ApiError.internal('Could not allocate a unique join code, please retry');
  }

  static async getQuizById(quizId: string) {
    const quiz = await QuizModel.findById(quizId);
    if (!quiz) throw ApiError.notFound('Quiz not found');
    return quiz;
  }

  static async assertOwnership(quizId: string, userId: string): Promise<IQuiz> {
    const quiz = await QuizService.getQuizById(quizId);
    if (quiz.creatorId !== userId) {
      throw ApiError.forbidden('You do not have permission to manage this quiz');
    }
    return quiz;
  }

  static async listQuizzesByCreator(creatorId: string) {
    return QuizModel.find({ creatorId }).sort({ createdAt: -1 });
  }

  static async updateQuiz(quizId: string, userId: string, data: UpdateQuizInput) {
    const quiz = await QuizService.assertOwnership(quizId, userId);
    if (quiz.status !== 'draft' && quiz.status !== 'ended') {
      throw ApiError.badRequest('Cannot edit a quiz while a live session is running');
    }
    if (data.title !== undefined) quiz.title = data.title;
    if (data.slides !== undefined) quiz.slides = data.slides as IQuizSlide[];
    await quiz.save();
    return quiz;
  }

  static async deleteQuiz(quizId: string, userId: string) {
    const quiz = await QuizService.assertOwnership(quizId, userId);
    await Promise.all([
      QuizModel.findByIdAndDelete(quizId),
      QuizParticipantModel.deleteMany({ quizId }),
      QuizAnswerModel.deleteMany({ quizId }),
      redisClient.del(allQuizKeys(quizId, quiz.slides.length)).catch(() => {}),
    ]);
  }

  // ---------- Host session controls ----------

  static async openLobby(quizId: string, userId: string) {
    const quiz = await QuizService.assertOwnership(quizId, userId);

    // Restarting a finished (or stuck) session wipes previous participants/answers
    await Promise.all([
      QuizParticipantModel.deleteMany({ quizId }),
      QuizAnswerModel.deleteMany({ quizId }),
      redisClient.del(allQuizKeys(quizId, quiz.slides.length)).catch(() => {}),
    ]);

    quiz.status = 'lobby';
    quiz.currentSlideIndex = -1;
    quiz.questionStartedAt = null;
    quiz.questionEndsAt = null;
    await quiz.save();

    await publishQuizEvent(quizId, 'lobby:opened', { joinCode: quiz.joinCode });
    return quiz;
  }

  static async startNextQuestion(quizId: string, userId: string) {
    const quiz = await QuizService.assertOwnership(quizId, userId);
    if (!['lobby', 'reveal', 'leaderboard'].includes(quiz.status)) {
      throw ApiError.badRequest(`Cannot start a question from status "${quiz.status}"`);
    }

    const nextIndex = quiz.currentSlideIndex + 1;
    const slide = quiz.slides[nextIndex];
    if (!slide) throw ApiError.badRequest('No more slides — end the quiz instead');

    const now = new Date();
    quiz.status = 'question';
    quiz.currentSlideIndex = nextIndex;
    quiz.questionStartedAt = now;
    quiz.questionEndsAt = new Date(now.getTime() + slide.timeLimit * 1000);
    await quiz.save();

    // Cache the live session so the answer hot path never touches Mongo
    await redisClient
      .set(k.session(quizId), JSON.stringify(buildSession(quiz, slide)), {
        EX: QUIZ_KEY_TTL_SEC,
      })
      .catch((error) => console.error('[Quiz] Failed to cache session:', error));

    await publishQuizEvent(quizId, 'question:started', {
      slide: sanitizeSlide(slide, nextIndex, quiz.slides.length),
      startedAt: now.toISOString(),
      endsAt: quiz.questionEndsAt.toISOString(),
      serverNow: new Date().toISOString(),
    });
    return quiz;
  }

  static async revealAnswers(quizId: string, userId: string) {
    const quiz = await QuizService.assertOwnership(quizId, userId);
    if (quiz.status !== 'question') {
      throw ApiError.badRequest('No live question to reveal');
    }

    const slideIndex = quiz.currentSlideIndex;
    const slide = quiz.slides[slideIndex];
    if (!slide) throw ApiError.internal('Current slide missing');

    quiz.status = 'reveal';
    await quiz.save();

    // Deleting the session immediately stops the answer fast path,
    // even when the presenter reveals before the timer runs out
    await redisClient.del(k.session(quizId)).catch(() => {});

    const [distHash, dispHash, answeredCount, nameCount] = await Promise.all([
      redisClient.hGetAll(k.dist(quizId, slideIndex)).catch(() => ({}) as Record<string, string>),
      redisClient.hGetAll(k.disp(quizId, slideIndex)).catch(() => ({}) as Record<string, string>),
      redisClient.sCard(k.answered(quizId, slideIndex)).catch(() => 0),
      redisClient.hLen(k.names(quizId)).catch(() => 0),
    ]);
    const participantCount =
      nameCount > 0 ? nameCount : await QuizParticipantModel.countDocuments({ quizId });

    let distribution: Record<string, unknown>;
    switch (slide.type) {
      case 'select_answer': {
        const counts = slide.options.map((_, i) => Number(distHash[String(i)] ?? 0));
        distribution = {
          kind: 'options',
          counts,
          options: slide.options.map((o) => ({ text: o.text, isCorrect: o.isCorrect })),
        };
        break;
      }
      case 'type_answer': {
        const accepted = slide.acceptedAnswers.map(normalizeText);
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
        const statements = (slide.statements ?? []).map((statement, i) => {
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
          .map((text, i) => ({ text, points: Number(distHash[String(i)] ?? 0) }))
          .sort((a, b) => b.points - a.points)
          .map((item, i) => ({ ...item, rank: i + 1 }));
        distribution = { kind: 'ranking', items, voters };
        break;
      }
    }

    await touchTtls([
      k.answered(quizId, slideIndex),
      k.dist(quizId, slideIndex),
      k.disp(quizId, slideIndex),
      k.results(quizId, slideIndex),
    ]);

    await publishQuizEvent(quizId, 'question:revealed', {
      slideIndex,
      question: slide.question,
      type: slide.type,
      scored: isScoredSlideType(slide.type),
      distribution,
      answeredCount,
      participantCount,
      isLastSlide: slideIndex === quiz.slides.length - 1,
    });
    return quiz;
  }

  static async showLeaderboard(quizId: string, userId: string) {
    const quiz = await QuizService.assertOwnership(quizId, userId);
    if (!['reveal', 'question'].includes(quiz.status)) {
      throw ApiError.badRequest('Leaderboard can be shown after revealing a question');
    }

    quiz.status = 'leaderboard';
    await quiz.save();

    const leaderboard = await getLeaderboard(quizId);
    const participantCount = await redisClient
      .hLen(k.names(quizId))
      .catch(() => 0)
      .then((n) => (n > 0 ? n : QuizParticipantModel.countDocuments({ quizId })));

    await publishQuizEvent(quizId, 'leaderboard:shown', {
      leaderboard,
      participantCount,
      isLastSlide: quiz.currentSlideIndex === quiz.slides.length - 1,
    });
    return quiz;
  }

  static async endQuiz(quizId: string, userId: string) {
    const quiz = await QuizService.assertOwnership(quizId, userId);
    if (quiz.status === 'draft') throw ApiError.badRequest('Quiz has not been started');

    quiz.status = 'ended';
    await quiz.save();

    const leaderboard = await getLeaderboard(quizId, 100);
    const participantCount = await QuizParticipantModel.countDocuments({ quizId });

    // Keep Redis state readable for final screens, then self-clean
    await touchTtls(allQuizKeys(quizId, quiz.slides.length));

    await publishQuizEvent(quizId, 'quiz:ended', { leaderboard, participantCount });
    return quiz;
  }

  static async getHostState(quizId: string, userId: string) {
    const quiz = await QuizService.assertOwnership(quizId, userId);

    let answeredCount = 0;
    if (quiz.currentSlideIndex >= 0) {
      answeredCount = await redisClient
        .sCard(k.answered(quizId, quiz.currentSlideIndex))
        .catch(() => 0);
      if (answeredCount === 0) {
        answeredCount = await QuizAnswerModel.countDocuments({
          quizId,
          slideIndex: quiz.currentSlideIndex,
        });
      }
    }

    const participants = await QuizParticipantModel.find({ quizId }).sort({ joinedAt: 1 }).lean();

    return {
      quiz,
      serverNow: new Date().toISOString(),
      participants: participants.map((p) => ({
        participantId: String(p._id),
        name: p.name,
        score: p.score,
      })),
      answeredCount,
      leaderboard: await getLeaderboard(quizId),
    };
  }

  // ---------- Participant flow (public) ----------

  static async getQuizByCode(joinCode: string) {
    const quiz = await QuizModel.findOne({ joinCode: joinCode.trim() });
    if (!quiz || quiz.status === 'draft') {
      throw ApiError.notFound('No active quiz with that code');
    }

    const result: Record<string, unknown> = {
      quizId: String(quiz._id),
      title: quiz.title,
      status: quiz.status,
      totalSlides: quiz.slides.length,
      currentSlideIndex: quiz.currentSlideIndex,
      serverNow: new Date().toISOString(),
    };

    // Late joiners / refreshes need the live question to render immediately
    if (quiz.status === 'question' && quiz.currentSlideIndex >= 0) {
      const slide = quiz.slides[quiz.currentSlideIndex];
      if (slide) {
        result.currentSlide = sanitizeSlide(slide, quiz.currentSlideIndex, quiz.slides.length);
        result.questionStartedAt = quiz.questionStartedAt?.toISOString();
        result.questionEndsAt = quiz.questionEndsAt?.toISOString();
      }
    }

    return result;
  }

  static async joinQuiz(quizId: string, data: JoinQuizInput) {
    const quiz = await QuizService.getQuizById(quizId);
    if (quiz.status === 'draft') throw ApiError.badRequest('This quiz is not open yet');
    if (quiz.status === 'ended') throw ApiError.badRequest('This quiz has already ended');

    // Idempotent join: same device rejoins as the same participant (refresh-safe)
    const participant = await QuizParticipantModel.findOneAndUpdate(
      { quizId, deviceId: data.deviceId },
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

    // Mirror identity into Redis for the answer hot path
    await Promise.all([
      redisClient.hSet(k.names(quizId), participantId, participant.name),
      redisClient.hSet(k.tokens(quizId), participantId, participant.token),
      redisClient.zIncrBy(k.scores(quizId), 0, participantId),
    ]).catch((error) => console.error('[Quiz] Failed to mirror participant to Redis:', error));
    await touchTtls([k.names(quizId), k.tokens(quizId), k.scores(quizId), k.correct(quizId)]);

    const participantCount = await redisClient
      .hLen(k.names(quizId))
      .catch(() => 0)
      .then((n) => (n > 0 ? n : QuizParticipantModel.countDocuments({ quizId })));

    await publishQuizEvent(quizId, 'participant:joined', {
      participantId,
      name: participant.name,
      participantCount,
    });

    // token returned ONLY to the joiner — never broadcast
    return {
      participantId,
      name: participant.name,
      score: participant.score,
      token: participant.token,
    };
  }

  /**
   * HOT PATH — runs entirely on Redis; Mongo writes are async write-behind.
   */
  static async submitAnswer(quizId: string, data: SubmitQuizAnswerInput) {
    // 1. Load the live session (Redis-first, Mongo fallback rebuilds the cache)
    let session: LiveSession | null = null;
    const raw = await redisClient.get(k.session(quizId)).catch(() => null);
    if (raw) {
      session = JSON.parse(raw) as LiveSession;
    } else {
      const quiz = await QuizModel.findById(quizId);
      if (quiz && quiz.status === 'question' && quiz.currentSlideIndex >= 0) {
        const slide = quiz.slides[quiz.currentSlideIndex];
        if (slide && quiz.questionStartedAt && quiz.questionEndsAt) {
          session = buildSession(quiz, slide);
          void redisClient
            .set(k.session(quizId), JSON.stringify(session), { EX: QUIZ_KEY_TTL_SEC })
            .catch(() => {});
        }
      }
    }

    if (!session || session.slideIndex !== data.slideIndex) {
      throw ApiError.badRequest('This question is no longer accepting answers');
    }

    const now = Date.now();
    if (now > session.endsAtMs + ANSWER_GRACE_MS) {
      throw ApiError.badRequest("Time's up — answer not accepted");
    }

    // 2. Authenticate the participant (token issued at join, never broadcast)
    await verifyParticipant(quizId, data.participantId, data.participantToken);

    // 3. Atomic dedup — SADD returns 0 if this participant already answered
    const answeredKey = k.answered(quizId, data.slideIndex);
    const added = await redisClient.sAdd(answeredKey, data.participantId);
    if (added === 0) {
      throw ApiError.conflict('You already answered this question');
    }

    // 4. Grade + build distribution writes (server clock — clients can't cheat timing)
    const elapsedMs = Math.max(0, now - session.startedAtMs);
    let isCorrect = false;
    let distWrites: { field: string; by: number }[] = [];
    // First-seen original casing for text-based reveals (word cloud / card wall)
    let dispWrites: { field: string; value: string }[] = [];

    try {
      switch (session.type) {
        case 'select_answer': {
          if (
            data.optionIndex === undefined ||
            data.optionIndex < 0 ||
            data.optionIndex >= session.optionCount
          ) {
            throw ApiError.badRequest('Invalid option for this question');
          }
          isCorrect = session.correctOptions.includes(data.optionIndex);
          distWrites = [{ field: String(data.optionIndex), by: 1 }];
          break;
        }
        case 'type_answer': {
          if (data.text === undefined) {
            throw ApiError.badRequest('This question expects a typed answer');
          }
          const normalized = normalizeText(data.text);
          isCorrect = session.acceptedNormalized.includes(normalized);
          distWrites = [{ field: normalized, by: 1 }];
          break;
        }
        case 'open_ended': {
          if (data.text === undefined) {
            throw ApiError.badRequest('This question expects a typed response');
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
          // Per-statement running sum + count; averages computed at reveal
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
          // Borda count: top spot earns n points, last spot earns 1
          distWrites = order.map((itemIndex, position) => ({
            field: String(itemIndex),
            by: session.itemCount - position,
          }));
          distWrites.push({ field: 'voters', by: 1 });
          break;
        }
      }
    } catch (error) {
      // Undo the dedup marker so a corrected retry is allowed
      await redisClient.sRem(answeredKey, data.participantId).catch(() => {});
      throw error;
    }

    // Interactive slides never touch the leaderboard
    const score = session.scored
      ? computeScore(
          session.points,
          session.scoreDependsOnTime,
          session.timeLimitMs,
          isCorrect,
          elapsedMs
        )
      : 0;

    // 5. Atomic Redis updates (leaderboard, distribution, per-participant result)
    const distKey = k.dist(quizId, data.slideIndex);
    const dispKey = k.disp(quizId, data.slideIndex);
    const [answeredCount] = await Promise.all([
      redisClient.sCard(answeredKey),
      redisClient.zIncrBy(k.scores(quizId), score, data.participantId),
      isCorrect
        ? redisClient.hIncrBy(k.correct(quizId), data.participantId, 1)
        : Promise.resolve(0),
      ...distWrites.map((w) => redisClient.hIncrBy(distKey, w.field, w.by)),
      ...dispWrites.map((w) => redisClient.hSetNX(dispKey, w.field, w.value)),
      redisClient.hSet(
        k.results(quizId, data.slideIndex),
        data.participantId,
        JSON.stringify({ isCorrect, score, scored: session.scored })
      ),
    ]);

    await publishQuizEvent(quizId, 'answer:received', {
      slideIndex: data.slideIndex,
      answeredCount,
    });

    // 6. Write-behind to Mongo (durable record; off the latency path)
    QuizAnswerModel.create({
      quizId,
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
      if (error?.code !== 11000) console.error('[Quiz] Failed to persist answer:', error);
    });
    QuizParticipantModel.updateOne(
      { _id: data.participantId },
      { $inc: { score, correctCount: isCorrect ? 1 : 0 } }
    ).catch((error) => console.error('[Quiz] Failed to persist participant score:', error));

    // Deliberately no correctness/score leak before reveal
    return { accepted: true };
  }

  static async getParticipantState(quizId: string, participantId: string, token: string) {
    await verifyParticipant(quizId, participantId, token);

    const quiz = await QuizService.getQuizById(quizId);

    // Score + rank from Redis (reveal-time stampede stays off Mongo)
    let totalScore = 0;
    let rank = 1;
    let correctCount = 0;
    try {
      const zScore = await redisClient.zScore(k.scores(quizId), participantId);
      totalScore = zScore ?? 0;
      const higher = await redisClient.zCount(k.scores(quizId), `(${totalScore}`, '+inf');
      rank = higher + 1;
      correctCount = Number(
        (await redisClient.hGet(k.correct(quizId), participantId)) ?? 0
      );
    } catch {
      const participant = await QuizParticipantModel.findOne({ _id: participantId, quizId }).lean();
      if (participant) {
        totalScore = participant.score;
        correctCount = participant.correctCount;
        rank =
          (await QuizParticipantModel.countDocuments({
            quizId,
            score: { $gt: participant.score },
          })) + 1;
      }
    }

    // Last answer result is only exposed once the question has been revealed
    let lastAnswer: {
      slideIndex: number;
      isCorrect: boolean;
      score: number;
      scored: boolean;
    } | null = null;
    if (['reveal', 'leaderboard', 'ended'].includes(quiz.status) && quiz.currentSlideIndex >= 0) {
      const slideType = quiz.slides[quiz.currentSlideIndex]?.type;
      const slideScored = slideType ? isScoredSlideType(slideType) : true;
      const cached = await redisClient
        .hGet(k.results(quizId, quiz.currentSlideIndex), participantId)
        .catch(() => null);
      if (cached) {
        const parsed = JSON.parse(cached) as {
          isCorrect: boolean;
          score: number;
          scored?: boolean;
        };
        lastAnswer = {
          slideIndex: quiz.currentSlideIndex,
          isCorrect: parsed.isCorrect,
          score: parsed.score,
          scored: parsed.scored ?? slideScored,
        };
      } else {
        const answer = await QuizAnswerModel.findOne({
          quizId,
          participantId,
          slideIndex: quiz.currentSlideIndex,
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
      (await redisClient.hGet(k.names(quizId), participantId).catch(() => null)) ?? 'Player';

    return {
      participantId,
      name,
      totalScore,
      correctCount,
      rank,
      lastAnswer,
      quizStatus: quiz.status,
    };
  }
}
