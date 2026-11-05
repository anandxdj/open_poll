import { apiClient } from "@/lib/api-client";
import type {
  AnswerRequest,
  AudienceParticipantView,
  AnswerResult,
  ParticipantLiveState,
  ParticipantState,
  PresentationParticipantSelf,
  PublicPresentationInfo,
} from "../types";

type ApiOk<T> = { success: boolean; message: string; data: T };

// Public participant flow — no account; the participant token from `join`
// authorizes answers, reads and the socket room join. Credentials are per
// session (contract: backend/docs/wiki/modules/presentations-live.md).

export const getPresentationByCode = async (code: string) =>
  (await apiClient.get<ApiOk<PublicPresentationInfo>>(`/presentations/code/${code}`)).data.data;

/**
 * Joins the deck's live session. 403 `SESSION_FULL` / `PARTICIPANT_KICKED`. An
 * empty name is fine when the session's nickname rule is `optional` or `off`
 * (the server names the participant "Guest NNNN").
 */
export const joinPresentation = async (presentationId: string, name: string, deviceToken?: string) =>
  (
    await apiClient.post<ApiOk<PresentationParticipantSelf>>(`/presentations/${presentationId}/join`, {
      ...(name ? { name } : {}),
      deviceToken,
    })
  ).data.data;

/** Audience pace (W2-F): submits the participant's attempt → the updated run (score, pass/fail). 409 `ATTEMPT_STALE`. */
export const submitAudienceAttempt = async (
  presentationId: string,
  participantId: string,
  participantToken: string,
  attempt: number
) =>
  (
    await apiClient.post<ApiOk<AudienceParticipantView>>(`/presentations/${presentationId}/audience/submit`, {
      participantId,
      participantToken,
      attempt,
    })
  ).data.data;

/** Audience pace: starts the next attempt of a failed assessment. 409 `RETRY_NOT_ALLOWED`. */
export const retryAudienceAttempt = async (presentationId: string, participantId: string, participantToken: string) =>
  (
    await apiClient.post<ApiOk<AudienceParticipantView>>(`/presentations/${presentationId}/audience/retry`, {
      participantId,
      participantToken,
    })
  ).data.data;

/**
 * How long one answer request may take before it counts as unreachable (then
 * the answer is retried, and finally queued offline). Without it a request on
 * a dead connection could hang for minutes.
 */
export const ANSWER_REQUEST_TIMEOUT_MS = 10_000;

/** `POST /:id/answer` → `AnswerResult`. Errors: see `LIVE_ERROR_CODES` (`NOT_ACCEPTING`, `TIME_UP`, …). */
export const submitAnswer = async (
  presentationId: string,
  input: AnswerRequest,
  options: { timeoutMs?: number } = {}
) =>
  (
    await apiClient.post<ApiOk<AnswerResult>>(`/presentations/${presentationId}/answer`, input, {
      timeout: options.timeoutMs ?? ANSWER_REQUEST_TIMEOUT_MS,
    })
  ).data.data;

export const getParticipantState = async (presentationId: string, participantId: string, token: string) =>
  (
    await apiClient.get<ApiOk<ParticipantState>>(`/presentations/${presentationId}/me`, {
      params: { participantId, token },
    })
  ).data.data;

/** Full resync after a reconnect: session, current slide with phase and timing, results, own standing. */
export const getParticipantLiveState = async (presentationId: string, participantId: string, token: string) =>
  (
    await apiClient.get<ApiOk<ParticipantLiveState>>(`/presentations/${presentationId}/live-state`, {
      params: { participantId, token },
    })
  ).data.data;
