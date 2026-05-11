export const REALTIME_CHANNELS = {
  responseAccepted: 'responses.accepted',
} as const;

export interface PollAnalyticsUpdateEvent {
  pollId: string;
  totalResponses: number;
  questionSummaries: Array<{
    questionId: string;
    counts: number[];
  }>;
  emittedAt: string;
}

export interface ResponseAcceptedEvent {
  pollId: string;
  analytics: PollAnalyticsUpdateEvent;
}
