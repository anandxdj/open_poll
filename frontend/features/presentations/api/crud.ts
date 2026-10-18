import { apiClient } from "@/lib/api-client";
import type { Presentation, PresentationSlide } from "../types/deck";

type ApiOk<T> = { success: boolean; message: string; data: T };

export interface PresentationDraftInput {
  title: string;
  slides: Omit<PresentationSlide, "_id">[];
}

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
