import { apiClient } from "@/lib/api-client";
import type {
  AnswerPayload,
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

/** Joins the deck's live session. 403 `SESSION_FULL` / `PARTICIPANT_KICKED`. */
export const joinPresentation = async (presentationId: string, name: string, deviceToken?: string) =>
  (
    await apiClient.post<ApiOk<PresentationParticipantSelf>>(`/presentations/${presentationId}/join`, {
      name,
      deviceToken,
    })
  ).data.data;

export const submitAnswer = async (
  presentationId: string,
  input: AnswerPayload & {
    participantId: string;
    participantToken: string;
    slideIndex: number;
    sessionId?: string;
    slideId?: string;
    /** Idempotency key (≤ 64 chars): repeating an accepted answer with it returns the original, `replay: true`. */
    clientAnswerId?: string;
    /** From `question:started` / `live-state`: lets a late answer through the grace period. */
    slideTicket?: string;
    /** Held offline before sending (stored as `via: "offline"`). */
    offline?: boolean;
  }
) => (await apiClient.post<ApiOk<AnswerResult>>(`/presentations/${presentationId}/answer`, input)).data.data;

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
