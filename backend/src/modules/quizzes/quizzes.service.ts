import crypto from 'crypto';
import { ApiError } from '../../common/utils/ApiError';
import { redisClient } from '../../common/config/redis';
import { REALTIME_CHANNELS, type QuizRealtimeEventType } from '../../common/realtime/events';
import {
  QuizModel,
  QuizParticipantModel,
  QuizAnswerModel,
  type IQuiz,
  type IQuizSlide,
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

const generateJoinCode = () => {
  // 6-digit numeric code, no leading-zero ambiguity issues since it's a string
  return crypto.randomInt(100000, 1000000).toString();
};

// Strip answer keys before sending a slide to participants
const sanitizeSlide = (slide: IQuizSlide, slideIndex: number, totalSlides: number) => ({
  slideIndex,
  totalSlides,
  type: slide.type,
  question: slide.question,
  options: slide.options.map((o) => ({ text: o.text })),
  timeLimit: slide.timeLimit,
  points: slide.points,
  scoreDependsOnTime: slide.scoreDependsOnTime,
});

const normalizeText = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

const computeScore = (slide: IQuizSlide, isCorrect: boolean, elapsedMs: number) => {
  if (!isCorrect) return 0;
  if (!slide.scoreDependsOnTime) return slide.points;
  const timeLimitMs = slide.timeLimit * 1000;
  const ratio = Math.min(Math.max(elapsedMs / timeLimitMs, 0), 1);
  // Mentimeter/Kahoot-style: fastest correct ≈ full points, slowest correct ≈ 50%
  return Math.round(slide.points * (1 - ratio / 2));
};

const getLeaderboard = async (quizId: string, limit = LEADERBOARD_SIZE) => {
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
    await QuizService.assertOwnership(quizId, userId);
    await Promise.all([
      QuizModel.findByIdAndDelete(quizId),
      QuizParticipantModel.deleteMany({ quizId }),
      QuizAnswerModel.deleteMany({ quizId }),
    ]);
  }

  // ---------- Host session controls ----------

  static async openLobby(quizId: string, userId: string) {
    const quiz = await QuizService.assertOwnership(quizId, userId);

    // Restarting a finished (or stuck) session wipes previous participants/answers
    await Promise.all([
      QuizParticipantModel.deleteMany({ quizId }),
      QuizAnswerModel.deleteMany({ quizId }),
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

    const answers = await QuizAnswerModel.find({ quizId, slideIndex }).lean();
    const participantCount = await QuizParticipantModel.countDocuments({ quizId });

    let distribution: Record<string, unknown>;
    if (slide.type === 'select_answer') {
      const counts = slide.options.map(
        (_, i) => answers.filter((a) => a.optionIndex === i).length
      );
      distribution = {
        kind: 'options',
        counts,
        options: slide.options.map((o) => ({ text: o.text, isCorrect: o.isCorrect })),
      };
    } else {
      // Group typed answers, flag whether each group matched
      const groups = new Map<string, { text: string; count: number; isCorrect: boolean }>();
      const accepted = slide.acceptedAnswers.map(normalizeText);
      for (const a of answers) {
        const key = normalizeText(a.text || '');
        const existing = groups.get(key);
        if (existing) existing.count += 1;
        else groups.set(key, { text: a.text || '', count: 1, isCorrect: accepted.includes(key) });
      }
      distribution = {
        kind: 'text',
        answers: [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 20),
        acceptedAnswers: slide.acceptedAnswers,
      };
    }

    await publishQuizEvent(quizId, 'question:revealed', {
      slideIndex,
      question: slide.question,
      distribution,
      answeredCount: answers.length,
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

    const [leaderboard, participantCount] = await Promise.all([
      getLeaderboard(quizId),
      QuizParticipantModel.countDocuments({ quizId }),
    ]);

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

    const [leaderboard, participantCount] = await Promise.all([
      getLeaderboard(quizId, 100),
      QuizParticipantModel.countDocuments({ quizId }),
    ]);

    await publishQuizEvent(quizId, 'quiz:ended', { leaderboard, participantCount });
    return quiz;
  }

  static async getHostState(quizId: string, userId: string) {
    const quiz = await QuizService.assertOwnership(quizId, userId);
    const [participants, answeredCount] = await Promise.all([
      QuizParticipantModel.find({ quizId }).sort({ joinedAt: 1 }).lean(),
      quiz.currentSlideIndex >= 0
        ? QuizAnswerModel.countDocuments({ quizId, slideIndex: quiz.currentSlideIndex })
        : Promise.resolve(0),
    ]);

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
      { $setOnInsert: { name: data.name, score: 0, correctCount: 0, joinedAt: new Date() } },
      { new: true, upsert: true }
    );

    const participantCount = await QuizParticipantModel.countDocuments({ quizId });
    await publishQuizEvent(quizId, 'participant:joined', {
      participantId: String(participant._id),
      name: participant.name,
      participantCount,
    });

    return {
      participantId: String(participant._id),
      name: participant.name,
      score: participant.score,
    };
  }

  static async submitAnswer(quizId: string, data: SubmitQuizAnswerInput) {
    const quiz = await QuizService.getQuizById(quizId);

    if (quiz.status !== 'question' || quiz.currentSlideIndex !== data.slideIndex) {
      throw ApiError.badRequest('This question is no longer accepting answers');
    }
    const slide = quiz.slides[data.slideIndex];
    if (!slide || !quiz.questionStartedAt || !quiz.questionEndsAt) {
      throw ApiError.internal('Question timing state is missing');
    }

    const now = Date.now();
    if (now > quiz.questionEndsAt.getTime() + ANSWER_GRACE_MS) {
      throw ApiError.badRequest("Time's up — answer not accepted");
    }

    const participant = await QuizParticipantModel.findOne({ _id: data.participantId, quizId });
    if (!participant) throw ApiError.notFound('Participant not found — rejoin the quiz');

    // Server-clock scoring: clients can't cheat by reporting their own elapsed time
    const elapsedMs = Math.max(0, now - quiz.questionStartedAt.getTime());

    let isCorrect = false;
    if (slide.type === 'select_answer') {
      if (data.optionIndex === undefined || !slide.options[data.optionIndex]) {
        throw ApiError.badRequest('Invalid option for this question');
      }
      isCorrect = slide.options[data.optionIndex]!.isCorrect;
    } else {
      if (data.text === undefined) {
        throw ApiError.badRequest('This question expects a typed answer');
      }
      isCorrect = slide.acceptedAnswers.map(normalizeText).includes(normalizeText(data.text));
    }

    const score = computeScore(slide, isCorrect, elapsedMs);

    try {
      await QuizAnswerModel.create({
        quizId,
        participantId: participant._id,
        slideIndex: data.slideIndex,
        optionIndex: slide.type === 'select_answer' ? data.optionIndex : null,
        text: slide.type === 'type_answer' ? data.text : null,
        isCorrect,
        score,
        timeMs: elapsedMs,
      });
    } catch (error: any) {
      if (error?.code === 11000) {
        throw ApiError.conflict('You already answered this question');
      }
      throw error;
    }

    await QuizParticipantModel.updateOne(
      { _id: participant._id },
      { $inc: { score, correctCount: isCorrect ? 1 : 0 } }
    );

    const answeredCount = await QuizAnswerModel.countDocuments({
      quizId,
      slideIndex: data.slideIndex,
    });
    await publishQuizEvent(quizId, 'answer:received', {
      slideIndex: data.slideIndex,
      answeredCount,
    });

    // Deliberately no correctness/score leak before reveal
    return { accepted: true };
  }

  static async getParticipantState(quizId: string, participantId: string) {
    const quiz = await QuizService.getQuizById(quizId);
    const participant = await QuizParticipantModel.findOne({ _id: participantId, quizId }).lean();
    if (!participant) throw ApiError.notFound('Participant not found');

    const rank =
      (await QuizParticipantModel.countDocuments({ quizId, score: { $gt: participant.score } })) +
      1;

    // Last answer result is only exposed once the question has been revealed
    let lastAnswer: { slideIndex: number; isCorrect: boolean; score: number } | null = null;
    if (['reveal', 'leaderboard', 'ended'].includes(quiz.status) && quiz.currentSlideIndex >= 0) {
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
        };
      }
    }

    return {
      participantId: String(participant._id),
      name: participant.name,
      totalScore: participant.score,
      correctCount: participant.correctCount,
      rank,
      lastAnswer,
      quizStatus: quiz.status,
    };
  }
}
