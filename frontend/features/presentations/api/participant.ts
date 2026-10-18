import { apiClient } from "@/lib/api-client";
import type {
  AnswerPayload,
  ParticipantState,
  PresentationParticipantSelf,
  PublicPresentationInfo,
} from "../types";

type ApiOk<T> = { success: boolean; message: string; data: T };

// Public participant flow — no account; the participant token from `join`
// authorizes answers and the socket room join.

export const getPresentationByCode = async (code: string) =>
  (await apiClient.get<ApiOk<PublicPresentationInfo>>(`/presentations/code/${code}`)).data.data;

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
  }
) => (await apiClient.post<ApiOk<{ accepted: boolean }>>(`/presentations/${presentationId}/answer`, input)).data.data;

export const getParticipantState = async (presentationId: string, participantId: string, token: string) =>
  (
    await apiClient.get<ApiOk<ParticipantState>>(`/presentations/${presentationId}/me`, {
      params: { participantId, token },
    })
  ).data.data;
