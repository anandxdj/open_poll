export type PollAnalyticsPayload = {
  pollId: string;
  totalResponses: number;
  questionSummaries: Array<{
    questionId: string;
    counts: number[];
  }>;
  emittedAt: string;
};

export function emptyPollAnalytics(pollId: string): PollAnalyticsPayload {
  return {
    pollId,
    totalResponses: 0,
    questionSummaries: [],
    emittedAt: new Date().toISOString(),
  };
}
