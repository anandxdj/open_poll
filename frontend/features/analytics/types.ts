export type PollAnalyticsPayload = {
  pollId: string;
  totalResponses: number;
  questionSummaries: Array<{
    questionId: string;
    counts: number[];
  }>;
  emittedAt: string;
};

export type PollVoterType = "registered" | "guest" | "anonymous";

/** One row of `GET /responses/poll/:pollId/list` (creator-only voter activity log). */
export type PollVoterRecord = {
  _id: string;
  voter: {
    type: PollVoterType;
    name: string;
    email: string;
  };
  answers: Array<{
    questionId: string;
    questionText: string;
    selectedOptionIndex?: number;
    selectedOptionText?: string;
  }>;
  createdAt: string;
};

export function emptyPollAnalytics(pollId: string): PollAnalyticsPayload {
  return {
    pollId,
    totalResponses: 0,
    questionSummaries: [],
    emittedAt: new Date().toISOString(),
  };
}
