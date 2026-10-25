import type { QuizRealtimeEventType } from '../../../common/realtime/events';
import { publishLiveEvent } from '../../../common/realtime/publish';
import type { PresentationEventPayloads } from './contract';

/**
 * Every live event the presentations module emits goes through one function per
 * event below, and all of them through `publishPresentationEvent`, so the
 * envelope fields (sessionId, audience) are set in one place. Payload shapes are
 * the contract types (`contract.ts`).
 */

export type PresentationEventType = QuizRealtimeEventType;

export const publishPresentationEvent = async (
  presentationId: string,
  type: PresentationEventType,
  payload: Record<string, unknown>,
  sessionId: string | null = null
) => {
  await publishLiveEvent({ presentationId, type, payload, sessionId });
};

type Payload<T extends keyof PresentationEventPayloads> = PresentationEventPayloads[T];

const publisher =
  <T extends keyof PresentationEventPayloads & PresentationEventType>(type: T) =>
  (presentationId: string, sessionId: string, payload: Payload<T>) =>
    publishPresentationEvent(presentationId, type, payload as Record<string, unknown>, sessionId);

/** A new session opened its lobby: the new event, then its legacy copy. */
export const publishSessionLobby = async (presentationId: string, sessionId: string, payload: Payload<'session:lobby'>) => {
  await publisher('session:lobby')(presentationId, sessionId, payload);
  await publisher('lobby:opened')(presentationId, sessionId, { joinCode: payload.joinCode });
};

export const publishParticipantJoined = publisher('participant:joined');

export const publishQuestionStarted = publisher('question:started');

/** A slide with no answer window (content/board lifecycle) is on screen. */
export const publishSlideShown = publisher('slide:shown');

export const publishSlideClosed = publisher('slide:closed');

/**
 * Host-only (the socket layer never sends it to participants): the light
 * per-answer count, or the worker's coalesced count + distribution.
 */
export const publishAnswerReceived = publisher('answer:received');

export const publishQuestionRevealed = publisher('question:revealed');

export const publishLeaderboardShown = publisher('leaderboard:shown');

/** The session ended: the new event, then its legacy copy. */
export const publishSessionEnded = async (presentationId: string, sessionId: string, payload: Payload<'session:ended'>) => {
  await publisher('session:ended')(presentationId, sessionId, payload);
  await publisher('quiz:ended')(presentationId, sessionId, {
    leaderboard: payload.leaderboard,
    participantCount: payload.participantCount,
  });
};
