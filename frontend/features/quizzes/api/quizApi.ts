import { apiClient } from "@/lib/api-client";
import type {
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

export const startNextQuestion = async (id: string) =>
  (await apiClient.post<ApiOk<Quiz>>(`/quizzes/${id}/host/next-question`)).data.data;

export const revealAnswers = async (id: string) =>
  (await apiClient.post<ApiOk<Quiz>>(`/quizzes/${id}/host/reveal`)).data.data;

export const showLeaderboard = async (id: string) =>
  (await apiClient.post<ApiOk<Quiz>>(`/quizzes/${id}/host/leaderboard`)).data.data;

export const endQuiz = async (id: string) =>
  (await apiClient.post<ApiOk<Quiz>>(`/quizzes/${id}/host/end`)).data.data;

// ---------- Participant (public) ----------

export const getQuizByCode = async (code: string) =>
  (await apiClient.get<ApiOk<PublicQuizInfo>>(`/quizzes/code/${code}`)).data.data;

export const joinQuiz = async (quizId: string, name: string, deviceId: string) =>
  (
    await apiClient.post<ApiOk<QuizParticipantSelf>>(`/quizzes/${quizId}/join`, {
      name,
      deviceId,
    })
  ).data.data;

export const submitAnswer = async (
  quizId: string,
  input: { participantId: string; slideIndex: number; optionIndex?: number; text?: string }
) => (await apiClient.post<ApiOk<{ accepted: boolean }>>(`/quizzes/${quizId}/answer`, input)).data.data;

export const getParticipantState = async (quizId: string, participantId: string) =>
  (
    await apiClient.get<ApiOk<ParticipantState>>(
      `/quizzes/${quizId}/participants/${participantId}`
    )
  ).data.data;
