import type { LiveAudience, QuizRealtimeEventType } from '../../../common/realtime/events';
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
  sessionId: string | null = null,
  audience?: LiveAudience
) => {
  await publishLiveEvent({ presentationId, type, payload, sessionId, ...(audience ? { audience } : {}) });
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

/** The current slide's timer changed (pause, resume, extend, skip). */
export const publishSlideTiming = publisher('slide:timing');

/** Audience pace (W2-F): every response slide is open (or the closing time changed). */
export const publishAudienceOpened = publisher('audience:opened');

/** Audience pace: answers stopped. */
export const publishAudienceClosed = publisher('audience:closed');

/** Audience pace, host only: a participant submitted an attempt or started a new one. */
export const publishAudienceProgress = publisher('audience:progress');

/** A participant was removed: told to the host, then to the participant itself. */
export const publishParticipantKicked = async (
  presentationId: string,
  sessionId: string,
  payload: Payload<'participant:kicked'>
) => {
  const body = payload as Record<string, unknown>;
  await publishPresentationEvent(presentationId, 'participant:kicked', body, sessionId, 'host');
  await publishPresentationEvent(presentationId, 'participant:kicked', body, sessionId, `participant:${payload.participantId}`);
};
