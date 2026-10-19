import type { IPresentationSession } from '../presentations/models/session.model';
import type { LeaderboardEntry, SlideDistribution } from '../presentations/live/contract';
import { computeSlideDistributionHelper, FINAL_LEADERBOARD_SIZE, getLeaderboard } from '../presentations/live/distribution';
import { lifecycleOf, slideIdOf } from '../presentations/live/state';
import { visitedSlides } from '../presentations/live/views';

export interface SlideResults {
  answeredCount: number;
  distribution: SlideDistribution;
}

/**
 * Results of every response slide a session ran, by slideId: the stored
 * `slideStats` once it has ended (the reconciled snapshot), the live Redis
 * aggregates while it runs.
 */
export const sessionResults = async (session: IPresentationSession): Promise<Map<string, SlideResults>> => {
  const results = new Map<string, SlideResults>();
  if (!session.isLive) {
    for (const stat of session.slideStats ?? []) {
      results.set(String(stat.slideId), {
        answeredCount: stat.answeredCount ?? 0,
        distribution: (stat.distribution ?? {}) as SlideDistribution,
      });
    }
    return results;
  }
  const sid = String(session._id);
  const responseSlides = visitedSlides(session).filter(({ slide }) => lifecycleOf(slide.type) === 'response');
  const live = await Promise.all(
    responseSlides.map(({ slide }) => computeSlideDistributionHelper(sid, slideIdOf(slide), slide))
  );
  responseSlides.forEach(({ slide }, i) =>
    results.set(slideIdOf(slide), { answeredCount: live[i]!.answeredCount, distribution: live[i]!.distribution })
  );
  return results;
};


/**
 * The standings as participants saw them: the stored final leaderboard of an
 * ended session, the live one while it runs. Ties are broken the same way
 * everywhere (the leaderboard's own order), so the report, the exports and a
 * participant's take-home agree on every rank.
 */
export const standingsOf = (session: IPresentationSession): Promise<LeaderboardEntry[]> =>
  session.isLive
    ? getLeaderboard(String(session._id), FINAL_LEADERBOARD_SIZE)
    : Promise.resolve(
        (session.finalLeaderboard ?? []).map((entry) => ({
          participantId: entry.participantId,
          name: entry.name,
          score: entry.score,
          correctCount: entry.correctCount,
          rank: entry.rank,
        }))
      );
