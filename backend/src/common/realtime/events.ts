export const REALTIME_CHANNELS = {
  analyticsUpdate: 'analytics:update',
  quizEvent: 'quiz:event',
} as const;

export const SOCKET_EVENTS = {
  pollJoin: 'poll:join',
  pollLeave: 'poll:leave',
  analyticsUpdate: 'analytics:update',
  quizJoin: 'quiz:join',
  quizLeave: 'quiz:leave',
  quizEvent: 'quiz:event',
} as const;

// ---------- Quiz realtime payloads ----------

export type QuizRealtimeEventType =
  | 'lobby:opened'
  | 'participant:joined'
  | 'question:started'
  | 'answer:received'
  | 'question:revealed'
  | 'leaderboard:shown'
  | 'quiz:ended';

export interface QuizRealtimeEvent {
  quizId: string;
  type: QuizRealtimeEventType;
  payload: Record<string, unknown>;
  emittedAt: string;
}

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
