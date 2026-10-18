import type { LiveEventType, QuizRealtimeEventType } from '../../../common/realtime/events';
import { publishLiveEvent } from '../../../common/realtime/publish';

/**
 * Every live event the presentations module emits goes through one function per
 * event below, and all of them through `publishPresentationEvent`, so the
 * envelope fields (sessionId, audience) can be added in one place.
 */

/** `slide:shown` is new with the registry (content lifecycle); the rest are the legacy wire names. */
export type PresentationEventType = QuizRealtimeEventType | 'slide:shown';

export const publishPresentationEvent = async (
  presentationId: string,
  type: PresentationEventType,
  payload: Record<string, unknown>
) => {
  // `slide:shown` is not declared in common/realtime/events/presentation.ts yet;
  // undeclared types publish to the default `all` audience, which is what it needs.
  await publishLiveEvent({ presentationId, type: type as LiveEventType, payload });
};

type LeaderboardEntry = {
  participantId: string;
  name: string;
  score: number;
  correctCount: number;
  rank: number;
};

export const publishLobbyOpened = (presentationId: string, payload: { joinCode: string }) =>
  publishPresentationEvent(presentationId, 'lobby:opened', payload);

export const publishParticipantJoined = (
  presentationId: string,
  payload: { participantId: string; name: string; participantCount: number }
) => publishPresentationEvent(presentationId, 'participant:joined', payload);

export const publishQuestionStarted = (
  presentationId: string,
  payload: { slide: Record<string, unknown>; startedAt: string; endsAt: string; serverNow: string }
) => publishPresentationEvent(presentationId, 'question:started', payload);

/** A slide with no answer window (content/board lifecycle) is on screen. */
export const publishSlideShown = (
  presentationId: string,
  payload: { slideIndex: number; slide: Record<string, unknown>; isLastSlide: boolean; serverNow: string }
) => publishPresentationEvent(presentationId, 'slide:shown', payload);

/**
 * Host-only (the socket layer never sends it to participants): the light
 * per-answer count, or the worker's coalesced count + distribution.
 */
export const publishAnswerReceived = (
  presentationId: string,
  payload: {
    slideIndex: number;
    answeredCount: number;
    participantCount?: number;
    distribution?: Record<string, unknown>;
  }
) => publishPresentationEvent(presentationId, 'answer:received', payload);

export const publishQuestionRevealed = (
  presentationId: string,
  payload: {
    slideIndex: number;
    question: string;
    type: string;
    scored: boolean;
    distribution: Record<string, unknown>;
    answeredCount: number;
    participantCount: number;
    isLastSlide: boolean;
    auto: boolean;
  }
) => publishPresentationEvent(presentationId, 'question:revealed', payload);

export const publishLeaderboardShown = (
  presentationId: string,
  payload: { slideIndex: number; leaderboard: LeaderboardEntry[]; participantCount: number; isLastSlide: boolean }
) => publishPresentationEvent(presentationId, 'leaderboard:shown', payload);

export const publishPresentationEnded = (
  presentationId: string,
  payload: { leaderboard: LeaderboardEntry[]; participantCount: number }
) => publishPresentationEvent(presentationId, 'quiz:ended', payload);
