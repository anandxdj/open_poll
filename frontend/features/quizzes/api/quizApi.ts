import { apiClient } from "@/lib/api-client";
import type {
  GeneratedQuizDraft,
  GenerateQuizInput,
  HostState,
  ParticipantState,
  PublicQuizInfo,
  Quiz,
  QuizParticipantSelf,
  QuizSlide,
} from "../types";

type ApiOk<T> = { success: boolean; message: string; data: T };

export interface QuizDraftInput {
  title: string;
  slides: Omit<QuizSlide, "_id">[];
}

// ---------- Creator ----------

export const createQuiz = async (input: QuizDraftInput) =>
  (await apiClient.post<ApiOk<Quiz>>("/quizzes", input)).data.data;

export const listQuizzes = async () =>
  (await apiClient.get<ApiOk<Quiz[]>>("/quizzes")).data.data;

export const getQuiz = async (id: string) =>
  (await apiClient.get<ApiOk<Quiz>>(`/quizzes/${id}`)).data.data;

export const updateQuiz = async (id: string, input: Partial<QuizDraftInput>) =>
  (await apiClient.patch<ApiOk<Quiz>>(`/quizzes/${id}`, input)).data.data;

export const deleteQuiz = async (id: string) =>
  (await apiClient.delete<ApiOk<null>>(`/quizzes/${id}`)).data;

// ---------- Host controls ----------

export const getHostState = async (id: string) =>
  (await apiClient.get<ApiOk<HostState>>(`/quizzes/${id}/host/state`)).data.data;

export const openLobby = async (id: string) =>
  (await apiClient.post<ApiOk<Quiz>>(`/quizzes/${id}/host/open-lobby`)).data.data;

export const advanceSlide = async (id: string, slideIndex?: number) =>
  (await apiClient.post<ApiOk<Quiz>>(`/quizzes/${id}/host/advance`, { slideIndex })).data.data;
// Backward-compatible alias
export const startNextQuestion = advanceSlide;

// Broadcasts the correct answer + distribution for the current slide without
// changing status. Host fires this when the timer hits 0 (auto-reveal).
export const revealCurrentSlide = async (id: string) =>
  (await apiClient.post<ApiOk<Quiz>>(`/quizzes/${id}/host/reveal`)).data.data;

export const endQuiz = async (id: string) =>
  (await apiClient.post<ApiOk<Quiz>>(`/quizzes/${id}/host/end`)).data.data;

// ---------- Participant (public) ----------

export const getQuizByCode = async (code: string) =>
  (await apiClient.get<ApiOk<PublicQuizInfo>>(`/quizzes/code/${code}`)).data.data;

export const joinQuiz = async (quizId: string, name: string, deviceToken?: string) =>
  (
    await apiClient.post<ApiOk<QuizParticipantSelf>>(`/quizzes/${quizId}/join`, {
      name,
      deviceToken,
    })
  ).data.data;

export const submitAnswer = async (
  quizId: string,
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
) => (await apiClient.post<ApiOk<{ accepted: boolean }>>(`/quizzes/${quizId}/answer`, input)).data.data;

// ---------- AI ----------

export const generateQuizDraft = async (input: GenerateQuizInput) =>
  (await apiClient.post<ApiOk<GeneratedQuizDraft>>("/ai/generate-quiz", input)).data.data;

export const getParticipantState = async (quizId: string, participantId: string, token: string) =>
  (
    await apiClient.get<ApiOk<ParticipantState>>(`/quizzes/${quizId}/me`, {
      params: { participantId, token },
    })
  ).data.data;
