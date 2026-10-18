import { assertCan, type PolicyContext } from '../../common/tenancy/policy';
import type { IWorkspace } from '../workspaces/workspace.model';
import { PollModel } from '../polls/polls.model';
import { AnalyticsModel } from '../responses/analytics.model';
import { PresentationModel } from '../presentations/presentations.model';
import type { LibraryQuery } from './library.schema';
import {
  afterCursorFilter,
  allOf,
  decodeCursor,
  folderFilter,
  LIVE_PRESENTATION_STATUSES,
  mergePages,
  POLL_CARD_PROJECTION,
  pollStatusFilter,
  PRESENTATION_CARD_PROJECTION,
  presentationStatusFilter,
  scopeFilter,
  titleFilter,
  toPollCard,
  toPresentationCard,
  type PollCardSource,
  type PresentationCardSource,
} from './library.query';
import type { LibraryCard, LibraryCounts, LibraryPage } from './library.types';

/** The caller after authenticate() + workspaceContext(). */
export type LibraryContext = PolicyContext & { user: { id: string }; workspace: IWorkspace };

type Filter = Record<string, unknown>;

const SORT = { updatedAt: -1, _id: -1 } as const;

interface CountRow {
  total: number;
  live: number;
  draft: number;
}

const ZERO: CountRow = { total: 0, live: 0, draft: 0 };

async function countPolls(base: Filter, now: Date): Promise<CountRow> {
  const [row] = await PollModel.aggregate<CountRow>([
    { $match: base },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        live: {
          $sum: {
            $cond: [
              { $and: [{ $eq: ['$isPublished', true] }, { $ne: ['$isClosed', true] }, { $gt: ['$expiresAt', now] }] },
              1,
              0,
            ],
          },
        },
        draft: { $sum: { $cond: [{ $ne: ['$isPublished', true] }, 1, 0] } },
      },
    },
  ]);
  return row ?? ZERO;
}

async function countPresentations(base: Filter): Promise<CountRow> {
  const [row] = await PresentationModel.aggregate<CountRow>([
    { $match: base },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        live: { $sum: { $cond: [{ $in: ['$status', [...LIVE_PRESENTATION_STATUSES]] }, 1, 0] } },
        draft: { $sum: { $cond: [{ $eq: ['$status', 'draft'] }, 1, 0] } },
      },
    },
  ]);
  return row ?? ZERO;
}

async function pollCards(filter: Filter, limit: number, now: Date): Promise<LibraryCard[]> {
  const polls = await PollModel.find(filter, POLL_CARD_PROJECTION).sort(SORT).limit(limit).lean<PollCardSource[]>();
  if (polls.length === 0) return [];
  const analytics = await AnalyticsModel.find({ pollId: { $in: polls.map((poll) => poll._id) } }, { pollId: 1, totalResponses: 1 }).lean();
  const responses = new Map(analytics.map((row) => [String(row.pollId), row.totalResponses ?? 0]));
  return polls.map((poll) => toPollCard(poll, responses.get(String(poll._id)) ?? 0, now));
}

async function presentationCards(filter: Filter, limit: number): Promise<LibraryCard[]> {
  const decks = await PresentationModel.find(filter, PRESENTATION_CARD_PROJECTION)
    .sort(SORT)
    .limit(limit)
    .lean<PresentationCardSource[]>();
  return decks.map(toPresentationCard);
}

export class LibraryService {
  /**
   * One page of the caller's library: polls and decks of the current workspace
   * (plus their own pre-workspace items in their personal workspace), newest
   * update first. Each collection is read with `limit + 1` after the cursor and
   * the two sorted runs are merged, so a page never skips or repeats an item
   * that did not change meanwhile.
   */
  static async list(ctx: LibraryContext, query: LibraryQuery): Promise<LibraryPage> {
    assertCan(ctx, 'deck:read');

    const now = new Date();
    const scope = scopeFilter({ userId: ctx.user.id, workspace: ctx.workspace });
    // Soft-deleted decks (trash) never show; polls have no trash, the clause is a no-op there.
    const shared = allOf(
      scope,
      { deletedAt: null },
      query.folderId ? folderFilter(query.folderId) : null,
      query.q ? titleFilter(query.q) : null,
    );
    const cursor = query.cursor ? afterCursorFilter(decodeCursor(query.cursor)) : null;
    const wantPolls = query.type !== 'presentation';
    const wantDecks = query.type !== 'poll';
    const fetch = query.limit + 1;

    const [polls, decks, counts] = await Promise.all([
      wantPolls
        ? pollCards(allOf(shared, query.status ? pollStatusFilter(query.status, now) : null, cursor), fetch, now)
        : [],
      wantDecks
        ? presentationCards(allOf(shared, query.status ? presentationStatusFilter(query.status) : null, cursor), fetch)
        : [],
      query.cursor ? undefined : LibraryService.counts(shared, now),
    ]);

    const page: LibraryPage = mergePages([polls, decks], query.limit);
    if (counts) page.counts = counts;
    return page;
  }

  private static async counts(shared: Filter, now: Date): Promise<LibraryCounts> {
    const [polls, decks] = await Promise.all([countPolls(shared, now), countPresentations(shared)]);
    return {
      all: polls.total + decks.total,
      poll: polls.total,
      presentation: decks.total,
      live: polls.live + decks.live,
      draft: polls.draft + decks.draft,
    };
  }
}
