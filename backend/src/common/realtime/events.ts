export const REALTIME_CHANNELS = {
  analyticsUpdate: 'analytics:update',
} as const;

export const SOCKET_EVENTS = {
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
