import type {
  LeaderboardEntry,
  LiveSlide,
  RevealDistribution,
  RevealPayload,
  SessionPace,
} from "./live";

/**
 * Socket wire names of the versioned live protocol (backend
 * `presentations.socket.ts`): `live:join` (with an ack) puts the socket in the
 * deck's `live:{id}` rooms, and every event arrives as a `live:event`
 * envelope. The legacy `quiz:*` protocol is not used by this client.
 */
export const LIVE_SOCKET_EVENTS = {
  join: "live:join",
  leave: "live:leave",
  event: "live:event",
} as const;

export type PresentationRealtimeEventType =
  | "session:lobby"
  | "lobby:opened"
  | "participant:joined"
  | "question:started"
  | "slide:shown"
  | "slide:closed"
  | "answer:received"
  | "question:revealed"
  | "leaderboard:shown"
  | "session:ended"
  | "quiz:ended";

/**
 * Payload of each core event type. Mirror of `PresentationEventPayloads` in
 * `backend/src/modules/presentations/live/contract.ts`
 * (prose: `backend/docs/wiki/modules/presentations-live.md`).
 */
export interface RealtimePayloads {
  /** A new session opened its lobby. */
  "session:lobby": { runNumber: number; joinCode: string; pace: SessionPace };
  /** Legacy copy of `session:lobby`, sent right after it — ignored by the reducer. */
  "lobby:opened": { joinCode: string };
  "participant:joined": { participantId: string; name: string; participantCount: number };
  /** A response slide opened (first visit, or `reopened` by the host). */
  "question:started": {
    slideId: string;
    slideIndex: number;
    slide: LiveSlide;
    startedAt: string;
    /** null = untimed: open until the host closes or reveals. */
    endsAt: string | null;
    serverNow: string;
    isLastSlide: boolean;
    reopened: boolean;
    /**
     * HMAC proof that the client saw this window open: send it with the answer
     * (`slideTicket`) so a slow connection still gets the grace period. The
     * same value for every viewer of this run of the slide; a reopen gets a new one.
     */
    slideTicket: string;
  };
  /** A content or board slide is on screen; no answer window. */
  "slide:shown": {
    slideId: string;
    slideIndex: number;
    slide: LiveSlide;
    isLastSlide: boolean;
    serverNow: string;
  };
  /** The current response slide stopped accepting answers (closed, or revisited while closed). */
  "slide:closed": {
    slideId: string;
    slideIndex: number;
    slide: LiveSlide;
    closedAt: string;
    answeredCount: number;
    participantCount: number;
    isLastSlide: boolean;
    revisit: boolean;
    serverNow: string;
  };
  /**
   * Host room only — never reaches participant sockets. Coalesced by the server: at most one
   * per dirty slide per 250 ms, carrying the slide's current counts and distribution.
   */
  "answer:received": {
    slideId: string;
    slideIndex: number;
    answeredCount: number;
    participantCount?: number;
    distribution?: RevealDistribution;
  };
  /** Results of the current response slide (reveal, or revisited after a reveal). */
  "question:revealed": RevealPayload & {
    slideId: string;
    slide: LiveSlide;
    auto: boolean;
    revealedAt: string;
    revisit: boolean;
  };
  "leaderboard:shown": {
    slideId: string;
    slideIndex: number;
    slide?: LiveSlide;
    leaderboard: LeaderboardEntry[];
    participantCount: number;
    isLastSlide: boolean;
  };
  "session:ended": {
    runNumber: number;
    endedAt: string;
    leaderboard: LeaderboardEntry[];
    participantCount: number;
    answerCount: number;
  };
  /** Legacy copy of `session:ended`, sent right after it — ignored by the reducer. */
  "quiz:ended": { leaderboard: LeaderboardEntry[]; participantCount: number };
}

/**
 * The live event envelope (v1, `backend/docs/wiki/realtime/envelope.md`).
 * Feature modules add prefixed types (`qna:*`, `reaction:*`, …) handled by
 * their own live sub-reducer, so `type` stays open.
 */
export interface PresentationRealtimeEvent {
  v?: number;
  presentationId?: string;
  /** Legacy alias of `presentationId`. */
  quizId?: string;
  /** The session the event belongs to; null/absent for events outside a session. */
  sessionId?: string | null;
  /** Per-deck counter across every audience and session (`INCR live:{pid}:seq`). */
  seq?: number;
  type: PresentationRealtimeEventType | (string & {});
  /** `all`, `host` or `participant:<id>`. */
  audience?: string;
  payload: Record<string, unknown>;
  emittedAt: string;
}

/** Narrows an event to a core type with its typed payload. */
export function isRealtimeEvent<T extends PresentationRealtimeEventType>(
  event: PresentationRealtimeEvent,
  type: T
): event is PresentationRealtimeEvent & { type: T; payload: RealtimePayloads[T] & Record<string, unknown> } {
  return event.type === type;
}

/** Credentials the socket presents to join a deck's rooms. */
export type LiveSocketAuth =
  | { role: "host" }
  | { role: "participant"; participantId: string; participantToken: string };

/** `live:join` ack. */
export type LiveJoinAck =
  | { ok: true; role: "host" | "participant" }
  | { ok: false; error: string };
