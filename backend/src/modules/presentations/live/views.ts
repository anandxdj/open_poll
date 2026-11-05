import { redisClient } from '../../../common/config/redis';
import type { IPresentationSession, ISlideState } from '../models/session.model';
import { isSlideScored } from '../slides';
import type { CurrentSlideView, SessionListItem, SessionView, SlideStateView } from './contract';
import { getParticipantCount } from './distribution';
import { k } from './keys';
import { lifecycleOf, readSlideState, sessionSlides, slideIdOf, slidePhase, type Slide } from './state';

/** Wire views of a session, built for host responses and lists. */

const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);

export const slideStateView = (
  slide: Slide,
  slideIndex: number,
  state: ISlideState | null,
  answeredCount: number,
  now: number
): SlideStateView => {
  const lifecycle = lifecycleOf(slide.type);
  return {
    slideId: slideIdOf(slide),
    slideIndex,
    type: slide.type,
    lifecycle,
    scored: isSlideScored(slide),
    phase: slidePhase(lifecycle, state, now),
    openedAt: iso(state?.openedAt),
    endsAt: iso(state?.endsAt),
    pausedRemainingMs: state?.pausedRemainingMs ?? null,
    closedAt: iso(state?.closedAt),
    revealedAt: iso(state?.revealedAt),
    answeredCount,
  };
};

/** Visited slides in deck order, with their states. */
export const visitedSlides = (session: IPresentationSession) =>
  sessionSlides(session).flatMap((slide, index) => {
    const state = readSlideState(session, slideIdOf(slide));
    return state ? [{ slide, index, state }] : [];
  });

/**
 * Answers per visited response slide: the Redis dedup sets while the data is
 * live, the stored `slideStats` once the session has ended.
 */
export const answeredCounts = async (session: IPresentationSession): Promise<Map<string, number>> => {
  const counts = new Map<string, number>();
  if (!session.isLive) {
    for (const stat of session.slideStats ?? []) counts.set(String(stat.slideId), stat.answeredCount);
    return counts;
  }
  const sid = String(session._id);
  const responseSlides = visitedSlides(session).filter(({ slide }) => lifecycleOf(slide.type) === 'response');
  const sizes = await Promise.all(
    responseSlides.map(({ slide }) => redisClient.sCard(k.answered(sid, slideIdOf(slide))).catch(() => 0))
  );
  responseSlides.forEach(({ slide }, i) => counts.set(slideIdOf(slide), sizes[i]!));
  return counts;
};

export const buildSessionView = async (
  session: IPresentationSession,
  now = Date.now(),
  counts?: Map<string, number>
): Promise<SessionView> => {
  const slides = sessionSlides(session);
  const answered = counts ?? (await answeredCounts(session));
  const sid = String(session._id);

  let current: CurrentSlideView | null = null;
  if (session.currentSlideId) {
    const slideId = String(session.currentSlideId);
    const index = slides.findIndex((slide) => slideIdOf(slide) === slideId);
    if (index >= 0) {
      current = {
        ...slideStateView(slides[index]!, index, readSlideState(session, slideId), answered.get(slideId) ?? 0, now),
        isLastSlide: index === slides.length - 1,
      };
    }
  }

  const participantCount = session.isLive ? await getParticipantCount(sid) : session.participantCount;
  const answerCount = session.isLive ? [...answered.values()].reduce((sum, n) => sum + n, 0) : session.answerCount;

  return {
    sessionId: sid,
    presentationId: String(session.presentationId),
    runNumber: session.runNumber,
    pace: session.pace,
    status: session.status,
    isLive: session.isLive,
    joinCode: session.joinCode,
    hostUserId: session.hostUserId ?? null,
    startedAt: session.startedAt.toISOString(),
    endedAt: iso(session.endedAt),
    totalSlides: slides.length,
    currentSlideId: session.currentSlideId ? String(session.currentSlideId) : null,
    currentSlideIndex: session.currentSlideIndex,
    current,
    participantCount,
    answerCount,
    audienceCap: session.entitlementsSnapshot?.audienceCap ?? null,
    retainUntil: iso(session.retainUntil),
    theme: session.themeSnapshot ?? null,
  };
};

export const sessionListItem = async (session: IPresentationSession): Promise<SessionListItem> => {
  const view = session.isLive ? await buildSessionView(session) : null;
  return {
    sessionId: String(session._id),
    runNumber: session.runNumber,
    pace: session.pace,
    status: session.status,
    isLive: session.isLive,
    hostUserId: session.hostUserId ?? null,
    startedAt: session.startedAt.toISOString(),
    endedAt: iso(session.endedAt),
    participantCount: view?.participantCount ?? session.participantCount,
    answerCount: view?.answerCount ?? session.answerCount,
    retainUntil: iso(session.retainUntil),
  };
};
