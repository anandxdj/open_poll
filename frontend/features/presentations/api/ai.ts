import { apiClient } from "@/lib/api-client";
import type { GeneratedPresentationDraft, GeneratePresentationInput } from "../types/deck";

type ApiOk<T> = { success: boolean; message: string; data: T };

export const generatePresentationDraft = async (input: GeneratePresentationInput) =>
  (await apiClient.post<ApiOk<GeneratedPresentationDraft>>("/ai/generate-quiz", input)).data.data;
