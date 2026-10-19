import { apiClient } from "@/lib/api-client";
import type {
  QnaHostListResponse,
  QnaHostQuestion,
  QnaParticipantListResponse,
  QnaParticipantQuestion,
  QnaStatus,
  QnaUpvoteResponse,
} from "./types";

type ApiOk<T> = { success: boolean; message: string; data: T };

/** Credentials `POST /presentations/:id/join` returned. Sent as headers, never in the URL. */
export interface QnaCredentials {
  participantId: string;
  token: string;
}

const participantHeaders = ({ participantId, token }: QnaCredentials) => ({
  "X-Participant-Id": participantId,
  "X-Participant-Token": token,
});

// ---------- Participant ----------

export const listQuestions = async (presentationId: string, who: QnaCredentials) =>
  (
    await apiClient.get<ApiOk<QnaParticipantListResponse>>(`/presentations/${presentationId}/qna`, {
      headers: participantHeaders(who),
    })
  ).data.data;

export const askQuestion = async (
  presentationId: string,
  who: QnaCredentials,
  input: { text: string; anonymous: boolean }
) =>
  (
    await apiClient.post<ApiOk<QnaParticipantQuestion>>(`/presentations/${presentationId}/qna`, input, {
      headers: participantHeaders(who),
    })
  ).data.data;

export const setUpvote = async (presentationId: string, who: QnaCredentials, questionId: string, upvote: boolean) => {
  const url = `/presentations/${presentationId}/qna/${questionId}/upvote`;
  const config = { headers: participantHeaders(who) };
  const res = upvote
    ? await apiClient.post<ApiOk<QnaUpvoteResponse>>(url, undefined, config)
    : await apiClient.delete<ApiOk<QnaUpvoteResponse>>(url, config);
  return res.data.data;
};

// ---------- Host ----------

export const listHostQuestions = async (presentationId: string, status: QnaStatus | "all" = "all") =>
  (
    await apiClient.get<ApiOk<QnaHostListResponse>>(`/presentations/${presentationId}/host/qna`, {
      params: status === "all" ? undefined : { status },
    })
  ).data.data;

export const updateHostQuestion = async (
  presentationId: string,
  questionId: string,
  patch: { status?: Exclude<QnaStatus, "pending">; pinned?: boolean }
) =>
  (await apiClient.patch<ApiOk<QnaHostQuestion>>(`/presentations/${presentationId}/host/qna/${questionId}`, patch))
    .data.data;

export const highlightHostQuestion = async (presentationId: string, questionId: string, highlighted: boolean) =>
  (
    await apiClient.post<ApiOk<QnaHostQuestion>>(
      `/presentations/${presentationId}/host/qna/${questionId}/highlight`,
      { highlighted }
    )
  ).data.data;
