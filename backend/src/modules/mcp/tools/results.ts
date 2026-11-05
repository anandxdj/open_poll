import { z } from 'zod';
import { ApiError } from '../../../common/utils/ApiError';
import { getReport, listSessions } from '../../sessions/sessions.service';
import type { SessionReport } from '../../sessions/contract';
import { listForHost } from '../../qna/qna.service';
import { QNA_STATUSES } from '../../qna/qna.contract';
import { InsightsService } from '../../insights/insights.service';
import { insightsQuerySchema } from '../../insights/insights.schema';
import {
  AUDIENCE_TEXT_NOTE,
  asWorkspaceRequest,
  frontendUrl,
  parseObjectId,
  workspaceScope,
} from '../mcp.context';
import { agentKindOf } from './decks';
import { agentDistribution, agentLeaderboard } from './resultViews';
import { defineTool } from './types';

/**
 * Results an agent reads back: aggregates per slide (the registry's own
 * distributions), counts, and the leaderboard top 10. Never the participant
 * list, participant ids or device ids; names appear only in the leaderboard,
 * which the host already shows on stage.
 */
function reportView(report: SessionReport) {
  const { session } = report;
  return {
    session: {
      sessionId: session.sessionId,
      deckId: session.presentationId,
      title: session.title,
      runNumber: session.runNumber,
      status: session.status,
      isLive: session.isLive,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      durationMinutes: session.durationMs === null ? null : Math.round(session.durationMs / 6000) / 10,
      participantCount: session.participantCount,
      answerCount: session.answerCount,
      participationRate: session.participationRate,
    },
    slides: report.slides.map((slide) => ({
      position: slide.slideIndex,
      slideId: slide.slideId,
      kind: agentKindOf(slide.slide as { type: string; points?: number }),
      label: slide.label,
      scored: slide.scored,
      visited: slide.visited,
      ...(slide.distribution
        ? { answeredCount: slide.answeredCount, results: agentDistribution(slide.distribution) }
        : {}),
    })),
    leaderboard: agentLeaderboard(report.leaderboard),
    reportUrl: `${frontendUrl()}/presentations/${session.presentationId}/sessions/${session.sessionId}`,
    note: AUDIENCE_TEXT_NOTE,
  };
}

const deckId = z.string().min(1).describe('Deck id');

const qnaStatus = z
  .enum([...QNA_STATUSES, 'all'])
  .optional()
  .describe('Only questions with this status (default all): pending awaits moderation, visible is on the board');

const resultsInputShape = {
  sessionId: z.string().min(1).optional().describe('Session id (from list_sessions or end_session)'),
  deckId: deckId.optional().describe('Deck id: reads its most recent session; use instead of sessionId'),
};

export const RESULT_TOOLS = [
  defineTool({
    name: 'list_sessions',
    scope: 'results:read',
    description: 'The sessions a deck has been run in, newest first, with when, how many people joined and answered.',
    inputShape: {
      deckId,
      limit: z.number().int().min(1).max(50).optional().describe('At most this many (default 10)'),
      cursor: z.string().max(200).optional().describe('nextCursor from a previous call, for older sessions'),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async handler(args, ctx) {
      const parsed = z
        .object({ deckId, limit: z.number().int().min(1).max(50).optional(), cursor: z.string().max(200).optional() })
        .parse(args);
      const presentationId = parseObjectId(parsed.deckId, 'deck id');
      const scope = await workspaceScope(ctx);
      const page = await listSessions(asWorkspaceRequest(scope), {
        presentationId,
        limit: parsed.limit ?? 10,
        cursor: parsed.cursor,
      });
      return {
        deck: { id: page.presentation.presentationId, title: page.presentation.title },
        sessions: page.items.map((item) => ({
          sessionId: item.sessionId,
          runNumber: item.runNumber,
          status: item.status,
          isLive: item.isLive,
          startedAt: item.startedAt,
          endedAt: item.endedAt,
          participantCount: item.participantCount,
          answerCount: item.answerCount,
        })),
        nextCursor: page.nextCursor,
      };
    },
  }),

  defineTool({
    name: 'get_session_results',
    scope: 'results:read',
    description:
      'Results of a session: per slide what the room answered (vote counts with the correct options, word cloud words, open answers, ratings, rankings, 2x2 averages, guesses, pin heatmaps), participation, and the leaderboard top 10. Pass sessionId, or deckId for its latest session. Works while live too (results so far).',
    inputShape: resultsInputShape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async handler(args, ctx) {
      const parsed = z
        .object({ sessionId: z.string().min(1).optional(), deckId: z.string().min(1).optional() })
        .refine((data) => Boolean(data.sessionId) !== Boolean(data.deckId), 'Pass either sessionId or deckId')
        .parse(args);
      const scope = await workspaceScope(ctx);
      let sessionId = parsed.sessionId ? parseObjectId(parsed.sessionId, 'session id') : null;
      if (!sessionId) {
        const presentationId = parseObjectId(parsed.deckId, 'deck id');
        const latest = await listSessions(asWorkspaceRequest(scope), { presentationId, limit: 1 });
        sessionId = latest.items[0]?.sessionId ?? null;
        if (!sessionId) throw ApiError.notFound('This deck has not been run yet: open_lobby starts its first session');
      }
      return reportView(await getReport(sessionId, asWorkspaceRequest(scope)));
    },
  }),

  defineTool({
    name: 'get_qna',
    scope: 'results:read',
    description:
      'Audience questions of a deck\'s live (else latest) session, most upvoted first: text, upvotes, status (pending, visible, answered, archived, rejected). Author names are not included.',
    inputShape: {
      deckId,
      status: qnaStatus,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async handler(args, ctx) {
      const parsed = z
        .object({ deckId, status: qnaStatus })
        .parse(args);
      const presentationId = parseObjectId(parsed.deckId, 'deck id');
      const scope = await workspaceScope(ctx);
      const list = await listForHost(presentationId, scope, parsed.status ?? 'all');
      return {
        sessionId: list.sessionId,
        open: list.qna.open,
        questions: list.questions.map((question) => ({
          id: question.id,
          text: question.text,
          upvotes: question.upvoteCount,
          status: question.status,
          pinned: question.pinned,
          highlighted: question.highlighted,
          askedAt: question.createdAt,
          answeredAt: question.answeredAt,
        })),
        note: AUDIENCE_TEXT_NOTE,
      };
    },
  }),

  defineTool({
    name: 'get_insights',
    scope: 'results:read',
    description:
      'Workspace activity over a date range (default the last 30 days): sessions run, people reached, responses, engagement, a day-by-day series, the most used decks and polls, and recent sessions, with the previous period for comparison.',
    inputShape: {
      from: z.string().optional().describe('ISO date-time with offset, e.g. 2026-09-01T00:00:00Z (default: 30 days before to)'),
      to: z.string().optional().describe('ISO date-time with offset (default: now)'),
      tz: z.string().max(64).optional().describe('IANA time zone days are counted in, e.g. Europe/Berlin (default UTC)'),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async handler(args, ctx) {
      const query = insightsQuerySchema.parse(args ?? {});
      const scope = await workspaceScope(ctx);
      return InsightsService.get(scope, query);
    },
  }),
];
