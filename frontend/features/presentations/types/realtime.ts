import type {
  AnswerRequest,
  AnswerResult,
  LeaderboardEntry,
  LiveSlide,
  ParticipantLiveState,
  RevealDistribution,
  RevealPayload,
  SessionPace,
} from "./live";

/**
 * Socket wire names of the versioned live protocol (backend
 * `presentations.socket.ts`): `live:join` (with an ack) puts the socket in the
 * deck's `live:{id}` rooms, and every event arrives as a `live:event`
 * envelope. `answer:submit` sends an answer over the socket (acked with the
 * REST envelope); `live:resync` returns the full state. The legacy `quiz:*`
 * protocol no longer exists on the server.
 */
export const LIVE_SOCKET_EVENTS = {
  join: "live:join",
  leave: "live:leave",
  event: "live:event",
  answerSubmit: "answer:submit",
  resync: "live:resync",
  /** To a screen whose link was turned off or whose deck stopped allowing embedding (W4-D); it has left the deck's rooms. */
  screenRevoked: "screen:revoked",
  /** Phone remote (W2-A): `{token, deviceKey}` → `RemoteJoinAck`. */
  remoteJoin: "remote:join",
  /** Phone remote: `{command}` → `RemoteCommandAck`. */
  remoteCommand: "remote:command",
  /** Server → remote: the pairing was revoked or replaced. */
  remoteRevoked: "remote:revoked",
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
  | "quiz:ended"
  | "slide:timing"
  | "participant:kicked";

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
  /**
   * The current response slide's timer was paused, resumed, extended or skipped (W2-A).
   * `endsAt` is null while paused; `pausedRemainingMs` is then the frozen time left.
   */
  "slide:timing": {
    slideId: string;
    slideIndex: number;
    action: "pause" | "resume" | "extend" | "skip";
    startedAt: string;
    endsAt: string | null;
    pausedRemainingMs: number | null;
    durationMs: number | null;
    addedSeconds: number;
    serverNow: string;
  };
  /** The host removed a participant (W2-A): to the host room and to that participant's own room. */
  "participant:kicked": { participantId: string; name: string; participantCount: number };
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
  | { role: "participant"; participantId: string; participantToken: string }
  /** A read-only stage (W4-D): a screen token of the deck. */
  | { role: "screen"; screenToken: string };

/** Why a screen was sent away (`screen:revoked {presentationId, reason}`, W4-D). */
export type ScreenRevokeReason = "revoked" | "embed_disabled";

/** `live:join` ack. */
export type LiveJoinAck =
  | { ok: true; role: "host" | "participant" | "screen" }
  | { ok: false; error: string };

/**
 * Socket `answer:submit` payload: the REST answer body plus the deck. The
 * socket must have joined the deck as this participant first (`live:join`
 * ack `{ok: true}`), else the ack is 403 `NOT_JOINED`.
 */
export type AnswerSubmitPayload = AnswerRequest & { presentationId: string };

/**
 * Ack of `answer:submit` (backend `AnswerSubmitAck`): the REST envelope plus
 * the HTTP `status` the same call would have returned, so both channels are
 * handled alike — 2xx done; 400/401/409 and 403 `PARTICIPANT_KICKED` final;
 * 403 `NOT_JOINED` join and retry; 429, 5xx and no ack retry with the same
 * `clientAnswerId`.
 */
export type AnswerSubmitAck =
  | { success: true; status: 200; message: string; data: AnswerResult }
  | { success: false; status: number; message: string; code?: string; data: null };

/** Socket `live:resync` payload; credentials as in `live:join`. */
export type LiveResyncPayload =
  | { presentationId: string; role: "host"; accessToken?: string }
  | { presentationId: string; role: "participant"; participantId: string; participantToken: string }
  /** A read-only screen (W4-D); `features/embeds` resyncs over REST (`GET /api/embeds/stage`). */
  | { presentationId: string; role: "screen"; screenToken: string };

/**
 * Ack of `live:resync` (participant side): the `live-state` document and the
 * deck's envelope `seq` read before it. (The host variant carries
 * `HostStateResponse`; this client resyncs the host over REST.)
 */
export type LiveResyncAck =
  | { ok: true; role: "participant"; seq: number; state: ParticipantLiveState }
  | { ok: true; role: "host"; seq: number; state: unknown }
  | { ok: true; role: "screen"; seq: number; state: unknown }
  | { ok: false; error: "INVALID_PAYLOAD" | "RATE_LIMITED" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "UNAVAILABLE" };
