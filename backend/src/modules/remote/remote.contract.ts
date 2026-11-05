import type { SessionStatus, SlidePhase, ThemeTokens } from '../presentations/live/contract';
import type { SlideLifecycle } from '../presentations/slides/types';

/**
 * Wire contract of the phone remote (W2-A). Prose:
 * `backend/docs/wiki/modules/presentations-live.md` ("Phone remote").
 */

export const REMOTE_COMMANDS = ['next', 'prev', 'reveal', 'close', 'extend30', 'pause', 'resume'] as const;
export type RemoteCommand = (typeof REMOTE_COMMANDS)[number];

export const REMOTE_ERROR_CODES = {
  /** 404: unknown, revoked, replaced or expired pairing. */
  invalid: 'REMOTE_INVALID',
  /** 403: the pairing is bound to another device. */
  bound: 'REMOTE_BOUND',
  /** 400: missing or malformed device key. */
  badDevice: 'REMOTE_DEVICE_REQUIRED',
} as const;

/** `POST /api/presentations/:id/host/remote-token` (201). The token is shown once; only its hash is stored. */
export interface RemoteTokenCreated {
  token: string;
  /** App path of the remote page: `/remote/<token>`. */
  path: string;
  expiresAt: string;
}

/** `GET|DELETE /api/presentations/:id/host/remote-token`. */
export interface RemoteStatus {
  /** An active (not revoked, not expired) pairing exists. */
  paired: boolean;
  /** A device redeemed it. */
  bound: boolean;
  boundAt: string | null;
  expiresAt: string | null;
  /** A remote socket is connected right now. */
  connected: boolean;
}

/** The slide a remote shows: enough to drive it, including the speaker notes (the remote is the presenter's device). */
export interface RemoteSlideView {
  slideId: string;
  slideIndex: number;
  type: string;
  lifecycle: SlideLifecycle;
  title: string;
  phase: SlidePhase;
  isLastSlide: boolean;
  /** The current window has a timer (running or paused). */
  timed: boolean;
  startedAt: string | null;
  endsAt: string | null;
  pausedRemainingMs: number | null;
  durationMs: number | null;
  answeredCount: number;
  notes: string;
}

/** `GET /api/remote/:token/state`, the `remote:join` ack and every `remote:command` ack. */
export interface RemoteState {
  presentationId: string;
  title: string;
  /** `draft` = never presented. */
  status: SessionStatus | 'draft';
  sessionId: string | null;
  joinCode: string;
  participantCount: number;
  totalSlides: number;
  currentSlideIndex: number;
  slide: RemoteSlideView | null;
  /** The slide after the current one (title and type only). */
  next: { slideIndex: number; type: string; title: string } | null;
  /** The live session's theme snapshot, else the deck's theme as it is now: the remote looks like the stage. */
  theme: ThemeTokens | null;
  serverNow: string;
}

export type RemoteJoinAck =
  | { ok: true; state: RemoteState }
  | { ok: false; error: 'INVALID_PAYLOAD' | 'RATE_LIMITED' | 'REMOTE_INVALID' | 'REMOTE_BOUND' | 'UNAVAILABLE' };

export type RemoteCommandAck =
  | { ok: true; command: RemoteCommand; state: RemoteState }
  | {
      ok: false;
      error: 'INVALID_PAYLOAD' | 'NOT_JOINED' | 'RATE_LIMITED' | 'REMOTE_INVALID' | 'FORBIDDEN' | 'COMMAND_FAILED' | 'UNAVAILABLE';
      /** The live error code behind a refused command (`NO_TIMER`, `NO_LIVE_SESSION`, …). */
      code?: string;
      message?: string;
    };
