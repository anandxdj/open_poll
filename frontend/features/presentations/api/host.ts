import { apiClient } from "@/lib/api-client";
import type { HostState, Presentation } from "../types";

type ApiOk<T> = { success: boolean; message: string; data: T };

// Host session controls — all require the deck owner's access token.

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
