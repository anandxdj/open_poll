import { Types, type PipelineStage } from 'mongoose';
import { assertCan, type PolicyContext } from '../../common/tenancy/policy';
import { pollStatusFilter, scopeFilter } from '../library/library.query';
import { PollModel } from '../polls/polls.model';
import { PresentationModel, PresentationSessionModel } from '../presentations/presentations.model';
import { ResponseModel } from '../responses/responses.model';
import type {
  InsightsDay,
  InsightsPayload,
  InsightsRecentSession,
  InsightsTopItem,
  InsightsTotals,
} from './insights.contract';
import type { InsightsQuery } from './insights.schema';

/** Rows in the top list and the recent sessions list. */
export const TOP_LIMIT = 6;
export const RECENT_LIMIT = 6;

export interface InsightsContext extends PolicyContext {
  user: { id: string };
  workspace: { _id: Types.ObjectId | string; type: string; ownerId: Types.ObjectId | string };
}

type Range = { from: Date; to: Date };

/**
 * Sessions of the workspace, plus the caller's own sessions of decks from
 * before workspaces (their personal workspace only), like the library's scope.
 */
function sessionScope(ctx: InsightsContext) {
  const clauses: Record<string, unknown>[] = [{ workspaceId: new Types.ObjectId(String(ctx.workspace._id)) }];
  if (ctx.workspace.type === 'personal' && String(ctx.workspace.ownerId) === ctx.user.id) {
    clauses.push({ workspaceId: null, hostUserId: ctx.user.id });
  }
  return { $or: clauses };
}

/** The calendar day (`YYYY-MM-DD`) of a date field in `tz`. */
const dayOf = (field: string, tz: string) => ({ $dateToString: { format: '%Y-%m-%d', date: field, timezone: tz } });

/** Every day from `from` to `to` (inclusive) as `YYYY-MM-DD` in `tz`. */
export function daysBetween(from: Date, to: Date, tz: string): string[] {
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const days = new Set<string>();
  // Six-hour steps never skip a calendar day, also across daylight saving changes.
  for (let t = from.getTime(); t < to.getTime(); t += 6 * 60 * 60 * 1000) days.add(format.format(new Date(t)));
  days.add(format.format(new Date(to.getTime() - 1)));
  return [...days];
}

interface SessionFacets {
  totals: { sessions: number; participants: number; answers: number; endedAnswers: number; possible: number; decks: number }[];
  daily?: { _id: string; sessions: number; participants: number; answers: number }[];
  byDeck?: { _id: Types.ObjectId; runs: number; participants: number; lastAt: Date }[];
  recent?: {
    _id: Types.ObjectId;
    presentationId: Types.ObjectId;
    runNumber: number;
    status: InsightsRecentSession['status'];
    isLive: boolean;
    startedAt: Date;
    participantCount: number;
    answerCount: number;
    responseSlides: number;
  }[];
}

async function sessionStats(ctx: InsightsContext, range: Range, tz: string, details: boolean): Promise<SessionFacets> {
  const ended = { $eq: ['$status', 'ended'] };
  const facets: Record<string, PipelineStage.FacetPipelineStage[]> = {
    totals: [
      {
        $group: {
          _id: null,
          sessions: { $sum: 1 },
          participants: { $sum: '$participantCount' },
          answers: { $sum: '$answerCount' },
          // Engagement counts ended sessions only: their slide stats are final.
          endedAnswers: { $sum: { $cond: [ended, '$answerCount', 0] } },
          possible: {
            $sum: {
              $cond: [ended, { $multiply: ['$participantCount', { $size: { $ifNull: ['$slideStats', []] } }] }, 0],
            },
          },
          decks: { $addToSet: '$presentationId' },
        },
      },
      { $project: { _id: 0, sessions: 1, participants: 1, answers: 1, endedAnswers: 1, possible: 1, decks: { $size: '$decks' } } },
    ],
  };
  if (details) {
    facets.daily = [
      {
        $group: {
          _id: dayOf('$startedAt', tz),
          sessions: { $sum: 1 },
          participants: { $sum: '$participantCount' },
          answers: { $sum: '$answerCount' },
        },
      },
    ];
    facets.byDeck = [
      {
        $group: {
          _id: '$presentationId',
          runs: { $sum: 1 },
          participants: { $sum: '$participantCount' },
          lastAt: { $max: '$startedAt' },
        },
      },
      { $sort: { participants: -1, lastAt: -1 } },
      // A few spare rows in case some of these decks were deleted since.
      { $limit: TOP_LIMIT * 2 },
    ];
    facets.recent = [
      { $sort: { startedAt: -1 } },
      { $limit: RECENT_LIMIT },
      {
        $project: {
          presentationId: 1,
          runNumber: 1,
          status: 1,
          isLive: 1,
          startedAt: 1,
          participantCount: 1,
          answerCount: 1,
          responseSlides: { $size: { $ifNull: ['$slideStats', []] } },
        },
      },
    ];
  }
  const [result] = await PresentationSessionModel.aggregate<SessionFacets>([
    { $match: { ...sessionScope(ctx), startedAt: { $gte: range.from, $lt: range.to } } },
    { $facet: facets },
  ]);
  return result ?? { totals: [] };
}

interface PollFacets {
  total: { count: number }[];
  daily?: { _id: string; count: number }[];
  byPoll?: { _id: Types.ObjectId; count: number; lastAt: Date }[];
}

async function pollStats(pollIds: Types.ObjectId[], range: Range, tz: string, details: boolean): Promise<PollFacets> {
  if (pollIds.length === 0) return { total: [] };
  const facets: Record<string, PipelineStage.FacetPipelineStage[]> = { total: [{ $count: 'count' }] };
  if (details) {
    facets.daily = [{ $group: { _id: dayOf('$createdAt', tz), count: { $sum: 1 } } }];
    facets.byPoll = [
      { $group: { _id: '$pollId', count: { $sum: 1 }, lastAt: { $max: '$createdAt' } } },
      { $sort: { count: -1, lastAt: -1 } },
      { $limit: TOP_LIMIT },
    ];
  }
  const [result] = await ResponseModel.aggregate<PollFacets>([
    { $match: { pollId: { $in: pollIds }, createdAt: { $gte: range.from, $lt: range.to } } },
    { $facet: facets },
  ]);
  return result ?? { total: [] };
}

function totalsOf(sessions: SessionFacets, polls: PollFacets): InsightsTotals {
  const s = sessions.totals[0];
  const sessionAnswers = s?.answers ?? 0;
  const pollResponses = polls.total[0]?.count ?? 0;
  return {
    sessions: s?.sessions ?? 0,
    participants: s?.participants ?? 0,
    sessionAnswers,
    pollResponses,
    responses: sessionAnswers + pollResponses,
    engagement: s && s.possible > 0 ? Math.min(1, s.endedAnswers / s.possible) : null,
    decksRun: s?.decks ?? 0,
  };
}

const iso = (date: Date) => date.toISOString();

export class InsightsService {
  /**
   * Workspace activity in `[from, to)`: live sessions (by start) and poll
   * responses (by submission), with the previous period of equal length for
   * comparison, a daily series in `tz`, the most attended decks and most
   * answered polls, the latest sessions, and what is live right now.
   */
  static async get(ctx: InsightsContext, query: InsightsQuery): Promise<InsightsPayload> {
    assertCan(ctx, 'session:read');
    const { from, to, tz } = query;
    const span = to.getTime() - from.getTime();
    const previous: Range = { from: new Date(from.getTime() - span), to: from };
    const now = new Date();

    const scope = scopeFilter({ userId: ctx.user.id, workspace: ctx.workspace });
    const polls = await PollModel.find(scope, { _id: 1, title: 1 }).lean();
    const pollIds = polls.map((poll) => poll._id as Types.ObjectId);
    const pollTitles = new Map(polls.map((poll) => [String(poll._id), poll.title]));

    const [sessions, pollActivity, sessionsBefore, pollsBefore, liveSessions, livePolls] = await Promise.all([
      sessionStats(ctx, { from, to }, tz, true),
      pollStats(pollIds, { from, to }, tz, true),
      sessionStats(ctx, previous, tz, false),
      pollStats(pollIds, previous, tz, false),
      PresentationSessionModel.countDocuments({ ...sessionScope(ctx), isLive: true }),
      PollModel.countDocuments({ $and: [scope, pollStatusFilter('live', now)] }),
    ]);

    // Daily series, every day present.
    const byDay = new Map<string, InsightsDay>(
      daysBetween(from, to, tz).map((date) => [date, { date, sessions: 0, participants: 0, responses: 0 }])
    );
    for (const day of sessions.daily ?? []) {
      const entry = byDay.get(day._id);
      if (!entry) continue;
      entry.sessions += day.sessions;
      entry.participants += day.participants;
      entry.responses += day.answers;
    }
    for (const day of pollActivity.daily ?? []) {
      const entry = byDay.get(day._id);
      if (entry) entry.responses += day.count;
    }

    // Titles of the decks in the top and recent lists (deleted decks drop out of the top list).
    const deckIds = [
      ...new Set([...(sessions.byDeck ?? []).map((d) => String(d._id)), ...(sessions.recent ?? []).map((r) => String(r.presentationId))]),
    ];
    const decks = deckIds.length
      ? await PresentationModel.find({ _id: { $in: deckIds } }, { title: 1, deletedAt: 1 }).lean()
      : [];
    const deckById = new Map(decks.map((deck) => [String(deck._id), deck]));

    const top: InsightsTopItem[] = [
      ...(sessions.byDeck ?? []).flatMap((d): InsightsTopItem[] => {
        const deck = deckById.get(String(d._id));
        // Deleted decks, and runs nobody joined, are not "top" anything.
        if (!deck || deck.deletedAt || d.participants === 0) return [];
        return [
          { type: 'presentation', id: String(d._id), title: deck.title, people: d.participants, runs: d.runs, lastActivityAt: iso(d.lastAt) },
        ];
      }),
      ...(pollActivity.byPoll ?? []).map(
        (p): InsightsTopItem => ({
          type: 'poll',
          id: String(p._id),
          title: pollTitles.get(String(p._id)) ?? 'Untitled poll',
          people: p.count,
          runs: null,
          lastActivityAt: iso(p.lastAt),
        })
      ),
    ]
      .sort((a, b) => b.people - a.people || b.lastActivityAt.localeCompare(a.lastActivityAt))
      .slice(0, TOP_LIMIT);

    const recentSessions: InsightsRecentSession[] = (sessions.recent ?? []).map((r) => {
      const possible = r.participantCount * r.responseSlides;
      return {
        sessionId: String(r._id),
        presentationId: String(r.presentationId),
        title: deckById.get(String(r.presentationId))?.title ?? 'Deleted deck',
        runNumber: r.runNumber,
        status: r.status,
        isLive: r.isLive,
        startedAt: iso(r.startedAt),
        participantCount: r.participantCount,
        answerCount: r.answerCount,
        participationRate: r.status === 'ended' && possible > 0 ? Math.min(1, r.answerCount / possible) : null,
      };
    });

    return {
      range: { from: iso(from), to: iso(to), days: Math.round(span / 86_400_000), tz },
      totals: totalsOf(sessions, pollActivity),
      previous: totalsOf(sessionsBefore, pollsBefore),
      daily: [...byDay.values()],
      top,
      recentSessions,
      liveNow: { sessions: liveSessions, polls: livePolls },
    };
  }
}
