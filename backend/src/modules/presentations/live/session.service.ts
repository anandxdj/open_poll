import { ApiError } from '../../../common/utils/ApiError';
import { redisClient } from '../../../common/config/redis';
import { PresentationModel, type IPresentation, type IPresentationSlide } from '../models/presentation.model';
import { PresentationParticipantModel } from '../models/participant.model';
import { PresentationAnswerModel } from '../models/answer.model';
import { getSlideType, hasSlideType, requireSlideType, toParticipantSlide } from '../slides';
import { assertOwnership } from '../crud.service';
import { PRESENTATION_KEY_TTL_SEC, allPresentationKeys, k, slideKeys, touchTtls } from './keys';
import { computeSlideDistributionHelper, getLeaderboard, getParticipantCount } from './distribution';
import {
  publishLeaderboardShown,
  publishLobbyOpened,
  publishPresentationEnded,
  publishQuestionRevealed,
  publishQuestionStarted,
  publishSlideShown,
} from './events';

// ---------------------------------------------------------------------------
// Answer window — the live slide's accept config, cached in Redis for the
// answer hot path. Present only while a `response` slide is accepting answers.
// ---------------------------------------------------------------------------

const ANSWER_WINDOW_VERSION = 2;

export interface AnswerWindow {
  v: typeof ANSWER_WINDOW_VERSION;
  slideIndex: number;
  type: string;
  scored: boolean;
  startedAtMs: number;
  endsAtMs: number;
  /** The slide type's `acceptConfig(slide)` snapshot (answer keys, counts, points). */
  cfg: unknown;
}

const opensAnswerWindow = (type: unknown) => getSlideType(type)?.lifecycle === 'response';

const buildAnswerWindow = (presentation: IPresentation, slide: IPresentationSlide): AnswerWindow => {
  const def = requireSlideType(slide.type);
  return {
    v: ANSWER_WINDOW_VERSION,
    slideIndex: presentation.currentSlideIndex,
    type: def.type,
    scored: def.scored,
    startedAtMs: presentation.questionStartedAt!.getTime(),
    endsAtMs: presentation.questionEndsAt!.getTime(),
    cfg: def.acceptConfig ? def.acceptConfig(slide) : null,
  };
};

/**
 * The open answer window, Redis-first. Rebuilt from Mongo (and re-cached) when
 * the key is missing or was written in an older format, so a Redis restart
 * mid-session degrades instead of breaking.
 */
export const loadAnswerWindow = async (presentationId: string): Promise<AnswerWindow | null> => {
  const raw = await redisClient.get(k.session(presentationId)).catch(() => null);
  if (raw) {
    const parsed = JSON.parse(raw) as Partial<AnswerWindow>;
    if (parsed.v === ANSWER_WINDOW_VERSION) return parsed as AnswerWindow;
  }

  const presentation = await PresentationModel.findById(presentationId);
  if (!presentation || presentation.status !== 'active' || presentation.currentSlideIndex < 0) return null;
  const slide = presentation.slides[presentation.currentSlideIndex];
  if (!slide || !opensAnswerWindow(slide.type) || !presentation.questionStartedAt || !presentation.questionEndsAt) {
    return null;
  }
  const window = buildAnswerWindow(presentation, slide);
  void redisClient
    .set(k.session(presentationId), JSON.stringify(window), { EX: PRESENTATION_KEY_TTL_SEC })
    .catch(() => {});
  return window;
};

// ---------------------------------------------------------------------------
// Host session controls
// ---------------------------------------------------------------------------

export const openLobby = async (presentationId: string, userId: string) => {
  const presentation = await assertOwnership(presentationId, userId);

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

  await publishLobbyOpened(presentationId, { joinCode: presentation.joinCode });
  return presentation;
};

/**
 * Advance to a slide (forward-only during a live session). What happens next
 * is the slide type's lifecycle:
 * - `response` opens a timed answer window and emits `question:started`;
 * - `system` (leaderboard) emits `leaderboard:shown`, no timer;
 * - `content` / `board` emit `slide:shown` with the sanitized slide, no timer,
 *   and answers are rejected.
 * Status stays `active` throughout — the answering-vs-revealed sub-state is
 * derived from the clock on the client, not stored here.
 */
export const advanceSlide = async (presentationId: string, userId: string, targetIndex?: number) => {
  const presentation = await assertOwnership(presentationId, userId);
  if (!['lobby', 'active'].includes(presentation.status)) {
    throw ApiError.badRequest(`Cannot advance a slide from status "${presentation.status}"`);
  }

  const nextIndex = targetIndex !== undefined ? targetIndex : presentation.currentSlideIndex + 1;
  if (nextIndex < 0 || nextIndex >= presentation.slides.length) {
    throw ApiError.badRequest('Slide index out of bounds');
  }
  // Forward-only: a live session never revisits a slide it already ran.
  if (presentation.status === 'active' && nextIndex <= presentation.currentSlideIndex) {
    throw ApiError.badRequest('Cannot navigate backwards during a live session');
  }
  const slide = presentation.slides[nextIndex];
  if (!slide) throw ApiError.badRequest('Slide missing');
  const def = requireSlideType(slide.type);

  const now = new Date();
  const isLastSlide = nextIndex === presentation.slides.length - 1;
  presentation.status = 'active';
  presentation.currentSlideIndex = nextIndex;

  if (def.lifecycle !== 'response') {
    presentation.questionStartedAt = null;
    presentation.questionEndsAt = null;
    await presentation.save();
    await redisClient.del(k.session(presentationId)).catch(() => {});

    if (def.lifecycle === 'system') {
      const leaderboard = await getLeaderboard(presentationId);
      const participantCount = await getParticipantCount(presentationId);
      await publishLeaderboardShown(presentationId, {
        slideIndex: nextIndex,
        leaderboard,
        participantCount,
        isLastSlide,
      });
    } else {
      await publishSlideShown(presentationId, {
        slideIndex: nextIndex,
        slide: toParticipantSlide(slide, nextIndex, presentation.slides.length),
        isLastSlide,
        serverNow: new Date().toISOString(),
      });
    }
    return presentation;
  }

  presentation.questionStartedAt = now;
  presentation.questionEndsAt = new Date(now.getTime() + slide.timeLimit * 1000);
  await presentation.save();

  await redisClient
    .set(k.session(presentationId), JSON.stringify(buildAnswerWindow(presentation, slide)), {
      EX: PRESENTATION_KEY_TTL_SEC,
    })
    .catch((error) => console.error('[Presentation] Failed to cache session:', error));

  await publishQuestionStarted(presentationId, {
    slide: toParticipantSlide(slide, nextIndex, presentation.slides.length),
    startedAt: now.toISOString(),
    endsAt: presentation.questionEndsAt.toISOString(),
    serverNow: new Date().toISOString(),
  });
  return presentation;
};

/**
 * Broadcast the results distribution for the current slide. Fired by the host
 * client when the timer hits 0 (auto) or manually. Does NOT change status — the
 * deck stays `active` on the same slide until the host advances. Safe to call
 * more than once (idempotent re-broadcast).
 */
export const revealCurrentSlide = async (presentationId: string, userId: string) => {
  const presentation = await assertOwnership(presentationId, userId);
  if (presentation.status !== 'active') {
    throw ApiError.badRequest('No live slide to reveal');
  }

  const slideIndex = presentation.currentSlideIndex;
  const slide = presentation.slides[slideIndex];
  if (!slide) throw ApiError.internal('Current slide missing');
  const def = requireSlideType(slide.type);
  if (def.lifecycle !== 'response') {
    throw ApiError.badRequest(`${def.name} slides have nothing to reveal`);
  }

  // Drop the cached answer window so late clicks stop hitting the hot path.
  await redisClient.del(k.session(presentationId)).catch(() => {});

  const { distribution, answeredCount, participantCount } = await computeSlideDistributionHelper(
    presentationId,
    slideIndex,
    slide
  );

  await touchTtls(slideKeys(presentationId, slideIndex));

  await publishQuestionRevealed(presentationId, {
    slideIndex,
    question: slide.question,
    type: slide.type,
    scored: def.scored,
    distribution,
    answeredCount,
    participantCount,
    isLastSlide: slideIndex === presentation.slides.length - 1,
    auto: true,
  });
  return presentation;
};

export const endPresentation = async (presentationId: string, userId: string) => {
  const presentation = await assertOwnership(presentationId, userId);
  if (presentation.status === 'draft') throw ApiError.badRequest('Presentation has not been started');

  presentation.status = 'ended';
  await presentation.save();

  const leaderboard = await getLeaderboard(presentationId, 100);
  const participantCount = await PresentationParticipantModel.countDocuments({ presentationId });

  // Keep Redis state readable for final screens, then self-clean
  await touchTtls(allPresentationKeys(presentationId, presentation.slides.length));

  await publishPresentationEnded(presentationId, { leaderboard, participantCount });
  return presentation;
};

export const getHostState = async (presentationId: string, userId: string) => {
  const presentation = await assertOwnership(presentationId, userId);

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

    if (presentation.status === 'active') {
      const slide = presentation.slides[presentation.currentSlideIndex];
      if (slide && opensAnswerWindow(slide.type)) {
        const res = await computeSlideDistributionHelper(presentationId, presentation.currentSlideIndex, slide);
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
};

// ---------- Participant-facing deck lookup (public) ----------

/**
 * Resolves a join code. While a slide is live the sanitized current slide is
 * included whatever its lifecycle; timing fields only when it has an answer window.
 */
export const getPresentationByCode = async (joinCode: string) => {
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

  if (presentation.status === 'active' && presentation.currentSlideIndex >= 0) {
    const slide = presentation.slides[presentation.currentSlideIndex];
    if (slide && hasSlideType(slide.type)) {
      result.currentSlide = toParticipantSlide(slide, presentation.currentSlideIndex, presentation.slides.length);
      if (presentation.questionStartedAt && presentation.questionEndsAt) {
        result.questionStartedAt = presentation.questionStartedAt.toISOString();
        result.questionEndsAt = presentation.questionEndsAt.toISOString();
      }
    }
  }

  return result;
};
