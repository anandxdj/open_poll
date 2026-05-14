import { apiClient } from "@/lib/api-client";

export const AI_TONES = ["professional", "casual", "funny", "educational", "professional & casual"] as const;
export type AiTone = (typeof AI_TONES)[number];

export type GenerateDraftBody = {
  topic: string;
  tone: AiTone;
  questionCount: number;
  isAnonymous: boolean;
  expiresAt: string;
};

export type GeneratedPollDraft = {
  title: string;
  questions: { text: string; options: string[]; isMandatory: boolean }[];
  isAnonymous: boolean;
  expiresAt: string;
  isPublished: boolean;
};

export async function generateDraft(body: GenerateDraftBody): Promise<GeneratedPollDraft> {
  const res = await apiClient.post<{ success: boolean; data: GeneratedPollDraft }>("/ai/generate", body);
  return res.data.data;
}

export function defaultAiExpiresAtIso(daysAhead = 7): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(23, 59, 0, 0);
  return d.toISOString();
}
