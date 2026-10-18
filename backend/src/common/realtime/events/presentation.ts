import { defineLiveEvents } from './envelope';

// ---------- Presentation (live deck) events ----------
// The type names are the wire protocol the clients already speak. New types
// take a module prefix (`slide:`, `session:`, `qna:`, `reaction:`, ...).

export const PRESENTATION_EVENTS = defineLiveEvents({
  // A new session opened its lobby (`lobby:opened` is the legacy copy).
  'session:lobby': { audience: 'all' },
  'lobby:opened': { audience: 'all' },
  'participant:joined': { audience: 'all' },
  'question:started': { audience: 'all' },
  // Content slides (registry lifecycle `content`): shown on every screen, no answer window.
  'slide:shown': { audience: 'all' },
  // The current response slide stopped accepting answers (results not revealed).
  'slide:closed': { audience: 'all' },
  // Carries the live vote/word distribution — leaking it to participants before
  // reveal defeats the point of a scored quiz.
  'answer:received': { audience: 'host', hostOnly: true },
  'question:revealed': { audience: 'all' },
  'leaderboard:shown': { audience: 'all' },
  // The session ended (`quiz:ended` is the legacy copy).
  'session:ended': { audience: 'all' },
  'quiz:ended': { audience: 'all' },
});

export type PresentationEventType = keyof typeof PRESENTATION_EVENTS;

/** Name the presentations service publishes with. */
export type QuizRealtimeEventType = PresentationEventType;

export type LiveRole = 'host' | 'participant';

export const PRESENTATION_SOCKET_EVENTS = {
  // Legacy protocol: `quiz:join` joins both the `quiz_*` and the `live:*` rooms.
  quizJoin: 'quiz:join',
  quizLeave: 'quiz:leave',
  quizEvent: 'quiz:event',
  liveJoin: 'live:join',
  liveLeave: 'live:leave',
} as const;
