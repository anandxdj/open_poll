import { redisClient } from '../../../common/config/redis';
import { PresentationAnswerModel } from '../models/answer.model';
import { PresentationParticipantModel, type IAudienceAttempt } from '../models/participant.model';
import type { IPresentationSession } from '../models/session.model';
import { getSlideType, isSlideScored, toParticipantSlide } from '../slides';
import { selectAnswerSettings } from '../slides/types/select_answer';
import {
  AUDIENCE_UNLIMITED_ATTEMPTS,
  type AudienceAssessmentSettings,
  type AudienceAttemptResult,
  type AudienceParticipantView,
  type AudienceSlideView,
  type AudienceWindowView,
  type HostAudienceView,
  type ResultsVisibility,
  type SlideResultsView,
} from './contract';
import { FIRST_ATTEMPT, parseAttemptState, type AttemptState } from './attempts';
import { computeSlideDistributionHelper } from './distribution';
import { k } from './keys';
import { attemptFilter } from './snapshot';
import { issueSlideTicket } from './ticket';
import { isOpenState, lifecycleOf, readSlideState, sessionSlides, slideIdOf, type Slide, type StoredAnswerResult } from './state';

/**
 * Audience pace (W2-F) read side: the session's answer window, the deck's
 * `settings.audiencePaced` (as snapshotted), attempt results, and the views
 * the participant (`live-state.audience`) and the host (`host/state.audience`)
 * render. No writes here; the commands live in `audience.service.ts`.
 */

const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);

// ---------------------------------------------------------------------------
// Settings and the answer window
// ---------------------------------------------------------------------------

export interface AudienceSettings {
  resultsVisibility: ResultsVisibility;
  assessment: AudienceAssessmentSettings;
}

const RESULTS_VISIBILITY = new Set<ResultsVisibility>(['never', 'after_submit', 'after_close']);

/** `settings.audiencePaced` of the session's snapshot, defaulted (results after close, no assessment). */
export const audienceSettingsOf = (session: Pick<IPresentationSession, 'settingsSnapshot'>): AudienceSettings => {
  const paced = (session.settingsSnapshot?.audiencePaced ?? {}) as Partial<AudienceSettings>;
  const assessment = (paced.assessment ?? {}) as Partial<AudienceAssessmentSettings>;
  const maxAttempts = assessment.maxAttempts;
  return {
    resultsVisibility: RESULTS_VISIBILITY.has(paced.resultsVisibility as ResultsVisibility)
      ? (paced.resultsVisibility as ResultsVisibility)
      : 'after_close',
    assessment: {
      enabled: assessment.enabled === true,
      passingScorePercentage:
        typeof assessment.passingScorePercentage === 'number' ? assessment.passingScorePercentage : 70,
      maxAttempts: maxAttempts === null ? null : typeof maxAttempts === 'number' && maxAttempts >= 1 ? maxAttempts : 1,
    },
  };
};

/** Attempts a participant may make: 1 without an assessment, else `maxAttempts` (unlimited is capped). */
export const attemptsAllowed = (settings: AudienceSettings) =>
  settings.assessment.enabled ? (settings.assessment.maxAttempts ?? AUDIENCE_UNLIMITED_ATTEMPTS) : 1;

export const audienceWindowView = (session: Pick<IPresentationSession, 'audience'>): AudienceWindowView => ({
  openedAt: iso(session.audience?.openedAt),
  closesAt: iso(session.audience?.closesAt),
  closedAt: iso(session.audience?.closedAt),
  closeReason: session.audience?.closeReason ?? null,
});

/** No more answers: closed by the host or the schedule, past the closing time, or the session ended. */
export const isAudienceClosed = (
  session: Pick<IPresentationSession, 'audience' | 'status' | 'isLive'>,
  now = Date.now()
): boolean =>
  !session.isLive ||
  session.status === 'ended' ||
  Boolean(session.audience?.closedAt) ||
  Boolean(session.audience?.closesAt && now > session.audience.closesAt.getTime());

export const audienceStatusOf = (
  session: Pick<IPresentationSession, 'audience' | 'status' | 'isLive'>,
  now = Date.now()
): AudienceParticipantView['status'] => {
  if (session.isLive && !session.audience?.openedAt) return 'waiting';
  return isAudienceClosed(session, now) ? 'closed' : 'open';
};

export interface ResponseSlide {
  slide: Slide;
  index: number;
  slideId: string;
  scored: boolean;
}

/** The deck's response slides, in order. */
export const responseSlidesOf = (session: Pick<IPresentationSession, 'deckSnapshot'>): ResponseSlide[] =>
  sessionSlides(session).flatMap((slide, index) =>
    lifecycleOf(slide.type) === 'response' ? [{ slide, index, slideId: slideIdOf(slide), scored: isSlideScored(slide) }] : []
  );

/** Points a graded slide is worth (no speed bonus in audience pace). */
const pointsOf = (slide: Slide) => Math.max(0, Number(slide.points ?? 0));

// ---------------------------------------------------------------------------
// Attempts
// ---------------------------------------------------------------------------

/** The participant's attempt state: Redis while the session lasts, never behind what Mongo recorded. */
export const readAttemptState = async (
  sessionId: string,
  participantId: string,
  stored?: { attempt: number; attempts: { number: number }[] } | null
): Promise<AttemptState> => {
  const raw = await redisClient.hGet(k.attempts(sessionId), participantId).catch(() => null);
  const live = raw ? parseAttemptState(raw) : FIRST_ATTEMPT;
  const recorded = stored?.attempt ?? 1;
  if (recorded > live.number) {
    return { number: recorded, submitted: Boolean(stored?.attempts.some((a) => a.number === recorded)) };
  }
  const submittedInMongo = Boolean(stored?.attempts.some((a) => a.number === live.number));
  return { number: live.number, submitted: live.submitted || submittedInMongo };
};

const parseStored = (raw: string | null | undefined): Partial<StoredAnswerResult> | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Partial<StoredAnswerResult>;
  } catch {
    return null;
  }
};

/**
 * The participant's stored answer per response slide in one attempt, by
 * slideId: Redis results while live (Mongo when Redis cannot be read), Mongo
 * once the session ended.
 */
export const attemptAnswers = async (
  session: IPresentationSession,
  participantId: string,
  attempt: number
): Promise<Map<string, Partial<StoredAnswerResult>>> => {
  const sid = String(session._id);
  const slides = responseSlidesOf(session);
  const answers = new Map<string, Partial<StoredAnswerResult>>();
  if (session.isLive) {
    try {
      const raws = await Promise.all(slides.map(({ slideId }) => redisClient.hGet(k.resultsInAttempt(sid, slideId, attempt), participantId)));
      raws.forEach((raw, i) => {
        const parsed = parseStored(raw);
        if (parsed) answers.set(slides[i]!.slideId, parsed);
      });
      return answers;
    } catch (error) {
      console.error('[Presentation] Redis attempt read failed, reading Mongo:', error);
    }
  }
  const rows = await PresentationAnswerModel.find({ sessionId: sid, participantId, ...attemptFilter(attempt) })
    .select('slideId slideIndex optionIndex text payload isCorrect score')
    .lean();
  for (const row of rows) {
    if (!row.slideId) continue;
    answers.set(String(row.slideId), {
      isCorrect: row.isCorrect,
      score: row.score,
      slideIndex: row.slideIndex,
      optionIndex: row.optionIndex ?? null,
      text: row.text ?? null,
      payload: row.payload ?? null,
    });
  }
  return answers;
};

/** Scores one attempt from its stored answers (graded slides only count towards the score). */
export const scoreAttempt = (
  session: IPresentationSession,
  answers: Map<string, Partial<StoredAnswerResult>>,
  settings: AudienceSettings
): Omit<AudienceAttemptResult, 'number' | 'submittedAt'> => {
  const slides = responseSlidesOf(session);
  let score = 0;
  let maxScore = 0;
  let correctCount = 0;
  let answeredCount = 0;
  for (const { slide, slideId, scored } of slides) {
    const answer = answers.get(slideId);
    if (answer) answeredCount += 1;
    if (!scored) continue;
    maxScore += pointsOf(slide);
    if (answer) {
      score += Number(answer.score ?? 0);
      if (answer.isCorrect) correctCount += 1;
    }
  }
  const percentage = maxScore > 0 ? Math.round((score / maxScore) * 100) : null;
  const passed = settings.assessment.enabled
    ? (percentage ?? 0) >= settings.assessment.passingScorePercentage
    : null;
  return { score, maxScore, percentage, correctCount, answeredCount, totalQuestions: slides.length, passed };
};

export const attemptView = (attempt: IAudienceAttempt): AudienceAttemptResult => ({
  number: attempt.number,
  submittedAt: new Date(attempt.submittedAt).toISOString(),
  score: attempt.score,
  maxScore: attempt.maxScore,
  percentage: attempt.percentage ?? null,
  correctCount: attempt.correctCount,
  answeredCount: attempt.answeredCount,
  totalQuestions: attempt.totalQuestions,
  passed: attempt.passed ?? null,
});

// ---------------------------------------------------------------------------
// Participant view
// ---------------------------------------------------------------------------

/** A slide's results: live counters, or the stored snapshot once the session ended. */
const slideResults = async (session: IPresentationSession, slide: Slide, index: number): Promise<SlideResultsView> => {
  const slideId = slideIdOf(slide);
  if (!session.isLive) {
    const stat = session.slideStats.find((s) => String(s.slideId) === slideId);
    return {
      slideId,
      slideIndex: index,
      type: slide.type,
      scored: isSlideScored(slide),
      answeredCount: stat?.answeredCount ?? 0,
      participantCount: session.participantCount,
      distribution: stat?.distribution ?? {},
    };
  }
  const live = await computeSlideDistributionHelper(String(session._id), slideId, slide);
  return {
    slideId,
    slideIndex: index,
    type: slide.type,
    scored: isSlideScored(slide),
    answeredCount: live.answeredCount,
    participantCount: live.participantCount,
    distribution: live.distribution,
  };
};

const explanationOf = (slide: Slide) =>
  slide.type === 'select_answer' ? selectAnswerSettings(slide).explanation.trim() || null : null;

/**
 * What one participant sees of an audience-paced session: every slide with
 * its phase, the participant's own answers in the current attempt, results
 * when `resultsVisibility` allows, the attempt history and whether a retry is
 * possible. Answer keys (right/wrong, explanations, the results of graded
 * slides in an assessment) show only once nothing can change any more.
 */
export const participantAudienceView = async (
  session: IPresentationSession,
  participantId: string,
  now = Date.now()
): Promise<AudienceParticipantView> => {
  const sid = String(session._id);
  const settings = audienceSettingsOf(session);
  const status = audienceStatusOf(session, now);
  const closed = status === 'closed';
  const participant = await PresentationParticipantModel.findById(participantId).select('audience').lean();
  const progress = participant?.audience ?? null;
  const state = await readAttemptState(sid, participantId, progress);
  const attempts = (progress?.attempts ?? []).map(attemptView).sort((a, b) => a.number - b.number);
  const current = attempts.find((a) => a.number === state.number) ?? null;
  const submitted = state.submitted || current !== null;
  const last = attempts.at(-1) ?? null;
  const allowed = attemptsAllowed(settings);
  const outOfAttempts = state.number >= allowed;
  const passed = last?.passed === true;

  const canRetry =
    settings.assessment.enabled &&
    !closed &&
    submitted &&
    last?.number === state.number &&
    last.passed === false &&
    !outOfAttempts;
  const final = closed || (submitted && (!settings.assessment.enabled || passed || outOfAttempts));
  const attemptsLeft = !settings.assessment.enabled
    ? 0
    : settings.assessment.maxAttempts === null
      ? null
      : Math.max(0, allowed - state.number);

  const slides: AudienceSlideView[] = [];
  if (status !== 'waiting') {
    const deck = sessionSlides(session);
    const answers = await attemptAnswers(session, participantId, state.number);
    for (const [index, slide] of deck.entries()) {
      const slideId = slideIdOf(slide);
      const lifecycle = lifecycleOf(slide.type);
      const participantSlide = toParticipantSlide(slide, index, deck.length);
      if (lifecycle !== 'response') {
        slides.push({
          slideId,
          slideIndex: index,
          lifecycle,
          slide: participantSlide,
          phase: 'shown',
          slideTicket: null,
          answered: false,
          response: null,
          isCorrect: null,
          score: null,
          explanation: null,
          results: null,
        });
        continue;
      }
      const slideState = readSlideState(session, slideId);
      const open = !closed && session.isLive && isOpenState(slideState);
      const answer = answers.get(slideId) ?? null;
      const scored = isSlideScored(slide);
      const showKey = final && scored;
      const resultsAllowed =
        (settings.resultsVisibility === 'after_submit' && (answer !== null || submitted || closed)) ||
        (settings.resultsVisibility === 'after_close' && closed);
      const keyOk = !scored || !settings.assessment.enabled || final;
      slides.push({
        slideId,
        slideIndex: index,
        lifecycle,
        slide: participantSlide,
        phase: open ? 'open' : 'closed',
        slideTicket: open && slideState?.openedAt ? issueSlideTicket(sid, slideId, slideState.openedAt.getTime()) : null,
        answered: answer !== null,
        response: answer
          ? { optionIndex: answer.optionIndex ?? null, text: answer.text ?? null, payload: answer.payload ?? null }
          : null,
        isCorrect: showKey && answer ? Boolean(answer.isCorrect) : null,
        score: showKey && answer ? Number(answer.score ?? 0) : null,
        explanation: showKey ? explanationOf(slide) : null,
        results: resultsAllowed && keyOk ? await slideResults(session, slide, index) : null,
      });
    }
  }

  return {
    status,
    window: audienceWindowView(session),
    resultsVisibility: settings.resultsVisibility,
    assessment: settings.assessment,
    attempt: { number: state.number, submitted, submittedAt: current?.submittedAt ?? null },
    attempts,
    attemptsLeft,
    canRetry,
    final,
    slides,
  };
};

// ---------------------------------------------------------------------------
// Host view
// ---------------------------------------------------------------------------

/**
 * Which response slides each participant answered in their current attempt:
 * the Redis dedup sets while live, the stored answers once ended.
 */
const currentAnswers = async (
  session: IPresentationSession,
  currentAttempt: Map<string, number>
): Promise<Map<string, Set<string>>> => {
  const sid = String(session._id);
  const slides = responseSlidesOf(session);
  const answered = new Map<string, Set<string>>();
  const add = (participantId: string, slideId: string) => {
    let set = answered.get(participantId);
    if (!set) answered.set(participantId, (set = new Set()));
    set.add(slideId);
  };

  if (session.isLive) {
    const inUse = [...new Set([1, ...currentAttempt.values()])];
    try {
      const reads = slides.flatMap(({ slideId }) => inUse.map((attempt) => ({ slideId, attempt })));
      const members = await Promise.all(reads.map(({ slideId, attempt }) => redisClient.sMembers(k.answeredInAttempt(sid, slideId, attempt))));
      reads.forEach(({ slideId, attempt }, i) => {
        for (const participantId of members[i]!) {
          if ((currentAttempt.get(participantId) ?? 1) === attempt) add(participantId, slideId);
        }
      });
      return answered;
    } catch (error) {
      console.error('[Presentation] Redis progress read failed, reading Mongo:', error);
    }
  }
  const rows = await PresentationAnswerModel.find({ sessionId: sid }).select('participantId slideId attempt').lean();
  for (const row of rows) {
    if (!row.slideId) continue;
    const participantId = String(row.participantId);
    if ((row.attempt ?? 1) === (currentAttempt.get(participantId) ?? 1)) add(participantId, String(row.slideId));
  }
  return answered;
};

/** The host's audience dashboard: who is in, where each participant is, completions, pass/fail, progress per slide. */
export const hostAudienceView = async (session: IPresentationSession): Promise<HostAudienceView> => {
  const sid = String(session._id);
  const settings = audienceSettingsOf(session);
  const slides = responseSlidesOf(session);
  const [participants, states, kicked] = await Promise.all([
    PresentationParticipantModel.find({ sessionId: sid }).sort({ joinedAt: 1 }).lean(),
    session.isLive ? redisClient.hGetAll(k.attempts(sid)).catch(() => ({}) as Record<string, string>) : Promise.resolve({} as Record<string, string>),
    session.isLive ? redisClient.sMembers(k.kicked(sid)).catch(() => [] as string[]) : Promise.resolve([] as string[]),
  ]);
  const kickedIds = new Set(kicked);

  const stateOf = new Map<string, AttemptState>();
  for (const p of participants) {
    const id = String(p._id);
    const live = parseAttemptState(states[id]);
    const recorded = p.audience?.attempt ?? 1;
    const number = Math.max(live.number, recorded);
    const submitted =
      (live.number === number && live.submitted) || Boolean(p.audience?.attempts?.some((a) => a.number === number));
    stateOf.set(id, { number, submitted });
  }
  const answered = await currentAnswers(session, new Map([...stateOf].map(([id, s]) => [id, s.number])));

  const perSlide = new Map<string, number>();
  let startedCount = 0;
  let completedCount = 0;
  let passedCount = 0;
  let failedCount = 0;
  const rows = participants.map((p) => {
    const id = String(p._id);
    const state = stateOf.get(id)!;
    const isKicked = Boolean(p.kickedAt) || kickedIds.has(id);
    const mine = answered.get(id) ?? new Set<string>();
    const history = (p.audience?.attempts ?? []).map(attemptView).sort((a, b) => a.number - b.number);
    const lastResult = history.at(-1) ?? null;
    if (!isKicked) {
      for (const slideId of mine) perSlide.set(slideId, (perSlide.get(slideId) ?? 0) + 1);
      if (mine.size > 0 || state.submitted || history.length > 0) startedCount += 1;
      if (state.submitted) completedCount += 1;
      if (lastResult?.passed === true) passedCount += 1;
      else if (lastResult?.passed === false) failedCount += 1;
    }
    return {
      participantId: id,
      name: p.name,
      joinedAt: new Date(p.joinedAt).toISOString(),
      kicked: isKicked,
      attempt: state.number,
      answeredCount: mine.size,
      submitted: state.submitted,
      lastResult,
    };
  });

  return {
    window: audienceWindowView(session),
    resultsVisibility: settings.resultsVisibility,
    assessment: settings.assessment,
    totalQuestions: slides.length,
    participantCount: rows.filter((row) => !row.kicked).length,
    startedCount,
    completedCount,
    passedCount,
    failedCount,
    slides: slides.map(({ slide, index, slideId, scored }) => ({
      slideId,
      slideIndex: index,
      type: slide.type,
      label: getSlideType(slide.type)?.label(slide) ?? slide.type,
      scored,
      answeredCount: perSlide.get(slideId) ?? 0,
    })),
    participants: rows,
  };
};
