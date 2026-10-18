import axios from "axios";

import { apiClient } from "@/lib/api-client";
import type {
  GeneratedPresentationDraft,
  GeneratePresentationInput,
  HostState,
  ParticipantState,
  PublicPresentationInfo,
  Presentation,
  PresentationParticipantSelf,
  PresentationSlide,
} from "../types";

type ApiOk<T> = { success: boolean; message: string; data: T };

/** The backend's error message for a failed call, when it sent one. */
export function apiErrorMessage(err: unknown): string | undefined {
  if (!axios.isAxiosError(err)) return undefined;
  const data = err.response?.data as { message?: unknown } | undefined;
  return typeof data?.message === "string" ? data.message : undefined;
}

export function apiErrorStatus(err: unknown): number | undefined {
  return axios.isAxiosError(err) ? err.response?.status : undefined;
}

export interface PresentationDraftInput {
  title: string;
  slides: Omit<PresentationSlide, "_id">[];
}

// ---------- Creator ----------

export const createPresentation = async (input: PresentationDraftInput) =>
  (await apiClient.post<ApiOk<Presentation>>("/presentations", input)).data.data;

export const listPresentations = async () =>
  (await apiClient.get<ApiOk<Presentation[]>>("/presentations")).data.data;

export const getPresentation = async (id: string) =>
  (await apiClient.get<ApiOk<Presentation>>(`/presentations/${id}`)).data.data;

export const updatePresentation = async (id: string, input: Partial<PresentationDraftInput>) =>
  (await apiClient.patch<ApiOk<Presentation>>(`/presentations/${id}`, input)).data.data;

export const deletePresentation = async (id: string) =>
  (await apiClient.delete<ApiOk<null>>(`/presentations/${id}`)).data;

// ---------- Host controls ----------

export const getHostState = async (id: string) =>
  (await apiClient.get<ApiOk<HostState>>(`/presentations/${id}/host/state`)).data.data;

export const openLobby = async (id: string) =>
  (await apiClient.post<ApiOk<Presentation>>(`/presentations/${id}/host/open-lobby`)).data.data;

export const advanceSlide = async (id: string, slideIndex?: number) =>
  (await apiClient.post<ApiOk<Presentation>>(`/presentations/${id}/host/advance`, { slideIndex })).data.data;

// Broadcasts the correct answer + distribution for the current slide without
// changing status. Host fires this when the timer hits 0 (auto-reveal).
export const revealCurrentSlide = async (id: string) =>
  (await apiClient.post<ApiOk<Presentation>>(`/presentations/${id}/host/reveal`)).data.data;

export const endPresentation = async (id: string) =>
  (await apiClient.post<ApiOk<Presentation>>(`/presentations/${id}/host/end`)).data.data;

// ---------- Participant (public) ----------

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
  input: {
    participantId: string;
    participantToken: string;
    slideIndex: number;
    optionIndex?: number;
    text?: string;
    entries?: string[];
    ratings?: number[];
    ranking?: number[];
  }
) => (await apiClient.post<ApiOk<{ accepted: boolean }>>(`/presentations/${presentationId}/answer`, input)).data.data;

// ---------- AI ----------

export const generatePresentationDraft = async (input: GeneratePresentationInput) =>
  (await apiClient.post<ApiOk<GeneratedPresentationDraft>>("/ai/generate-quiz", input)).data.data;

export const getParticipantState = async (presentationId: string, participantId: string, token: string) =>
  (
    await apiClient.get<ApiOk<ParticipantState>>(`/presentations/${presentationId}/me`, {
      params: { participantId, token },
    })
  ).data.data;
