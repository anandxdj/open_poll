/** Wire shape of `GET /api/insights` (mirrored in frontend/features/analytics/insights.ts). */

export interface InsightsTotals {
  /** Live sessions started in the range. */
  sessions: number;
  /** People who joined those sessions (summed per session). */
  participants: number;
  /** Answers given in those sessions. */
  sessionAnswers: number;
  /** Responses to polls in the range. */
  pollResponses: number;
  /** `sessionAnswers + pollResponses`. */
  responses: number;
  /** Answers out of everything participants could answer, over ended sessions; null without any. */
  engagement: number | null;
  /** Distinct decks presented. */
  decksRun: number;
}

export interface InsightsDay {
  /** `YYYY-MM-DD` in the requested time zone. */
  date: string;
  sessions: number;
  participants: number;
  /** Session answers and poll responses that day. */
  responses: number;
}

export interface InsightsTopItem {
  type: 'presentation' | 'poll';
  id: string;
  title: string;
  /** Participants (decks, summed over runs) or responses (polls). */
  people: number;
  /** Sessions run (decks); null for polls. */
  runs: number | null;
  lastActivityAt: string;
}

export interface InsightsRecentSession {
  sessionId: string;
  presentationId: string;
  title: string;
  runNumber: number;
  status: 'lobby' | 'active' | 'ended';
  isLive: boolean;
  startedAt: string;
  participantCount: number;
  answerCount: number;
  /** Answers out of participants × response slides shown; null while live or without data. */
  participationRate: number | null;
}

export interface InsightsPayload {
  range: { from: string; to: string; days: number; tz: string };
  totals: InsightsTotals;
  /** The same totals for the period of equal length just before `from`. */
  previous: InsightsTotals;
  /** One entry per day in the range, oldest first, zeros included. */
  daily: InsightsDay[];
  /** Most attended decks and most answered polls in the range, together. */
  top: InsightsTopItem[];
  recentSessions: InsightsRecentSession[];
  /** Right now, whatever the range. */
  liveNow: { sessions: number; polls: number };
}
