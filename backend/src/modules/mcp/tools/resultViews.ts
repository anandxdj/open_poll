import type { LeaderboardEntry } from '../../presentations/live/contract';
import { serialize } from '../mcp.context';

/** Standings rows an agent may see: what the host shows on stage, no participant ids. */
export const LEADERBOARD_TOP = 10;

export const agentLeaderboard = (entries: readonly LeaderboardEntry[] | null | undefined) =>
  (entries ?? []).slice(0, LEADERBOARD_TOP).map((entry) => ({
    rank: entry.rank,
    name: entry.name,
    score: entry.score,
    correctCount: entry.correctCount,
  }));

/**
 * A slide's results as the registry computes them (option counts, words,
 * responses, averages, points), minus the raw per-person feeds the stage
 * animates from: the heatmap and the averages already summarise those, and
 * hundreds of coordinates only cost an agent context.
 */
export function agentDistribution(distribution: unknown) {
  if (!distribution || typeof distribution !== 'object') return distribution ?? null;
  const copy = { ...(distribution as Record<string, unknown>) };
  if (copy.kind === 'pin_on_image') delete copy.pins;
  if (copy.kind === 'grid_2x2') delete copy.placements;
  return serialize(copy);
}

/** Text an agent can name a slide by: its question, else its title, else its type. */
export function slideLabel(slide: { type?: unknown; question?: unknown; content?: unknown } | undefined): string {
  if (!slide) return '';
  if (typeof slide.question === 'string' && slide.question.trim()) return slide.question.trim();
  const content = slide.content as Record<string, unknown> | null | undefined;
  for (const key of ['title', 'text', 'label'] as const) {
    const value = content?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return typeof slide.type === 'string' ? slide.type : '';
}
