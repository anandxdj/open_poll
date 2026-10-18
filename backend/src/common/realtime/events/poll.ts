// ---------- Poll analytics events ----------
// Polls keep their own channel and socket event; they do not use the live
// envelope.

export const POLL_SOCKET_EVENTS = {
  pollJoin: 'poll:join',
  pollLeave: 'poll:leave',
  analyticsUpdate: 'analytics:update',
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
