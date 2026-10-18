import type { LeaderboardEntry, LiveSlide, RevealDistribution, RevealPayload } from "./live";

/**
 * Socket wire names. The `quiz:*` names are the protocol left over from the
 * quiz era; the server rooms are `quiz_{presentationId}` (+ `_host`).
 */
export const LIVE_SOCKET_EVENTS = {
  join: "quiz:join",
  leave: "quiz:leave",
  event: "quiz:event",
} as const;

export type PresentationRealtimeEventType =
  | "lobby:opened"
  | "participant:joined"
  | "question:started"
  | "answer:received"
  | "question:revealed"
  | "leaderboard:shown"
  | "quiz:ended";

/** Payload of each core event type (contract: backend/docs/wiki/realtime/socket-events.md). */
export interface RealtimePayloads {
  "lobby:opened": { joinCode: string };
  "participant:joined": { participantId: string; name: string; participantCount: number };
  "question:started": { slide: LiveSlide; startedAt: string; endsAt: string; serverNow: string };
  /** Host room only — never reaches participant sockets. */
  "answer:received": { answeredCount: number; distribution?: RevealDistribution };
  "question:revealed": RevealPayload & { auto?: boolean };
  "leaderboard:shown": {
    slideIndex: number;
    leaderboard: LeaderboardEntry[];
    participantCount: number;
    isLastSlide: boolean;
  };
  "quiz:ended": { leaderboard: LeaderboardEntry[]; participantCount: number };
}

/**
 * The realtime envelope. Feature modules add prefixed types (`qna:*`,
 * `reaction:*`, …) handled by their own live sub-reducer, so `type` stays open.
 * `seq`/`sessionId`/`v` arrive with the versioned envelope and are optional
 * until every sender emits it.
 */
export interface PresentationRealtimeEvent {
  quizId: string;
  presentationId?: string;
  type: PresentationRealtimeEventType | (string & {});
  /** Envelope v1: `all`, `host` or `participant:<id>`. */
  audience?: string;
  payload: Record<string, unknown>;
  emittedAt: string;
  v?: number;
  seq?: number;
  sessionId?: string;
}

/** Narrows an event to a core type with its typed payload. */
export function isRealtimeEvent<T extends PresentationRealtimeEventType>(
  event: PresentationRealtimeEvent,
  type: T
): event is PresentationRealtimeEvent & { type: T; payload: RealtimePayloads[T] & Record<string, unknown> } {
  return event.type === type;
}

/** Credentials the socket presents to join a deck's room. */
export type LiveSocketAuth =
  | { role: "host" }
  | { role: "participant"; participantId: string; participantToken: string };
