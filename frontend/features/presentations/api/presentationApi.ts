import { apiClient } from "@/lib/api-client";
import type {
  HostState,
  ParticipantState,
  PublicPresentationInfo,
  Presentation,
  PresentationParticipantSelf,
} from "../types";

// Creator CRUD and AI calls live in ./crud and ./ai; re-exported here so
// existing imports of this module keep working.
export * from "./crud";
export * from "./ai";

type ApiOk<T> = { success: boolean; message: string; data: T };

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

export const getParticipantState = async (presentationId: string, participantId: string, token: string) =>
  (
    await apiClient.get<ApiOk<ParticipantState>>(`/presentations/${presentationId}/me`, {
      params: { participantId, token },
    })
  ).data.data;
