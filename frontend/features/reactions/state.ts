import type { LiveSubReducer } from "@/features/presentations/live/reducer";

/**
 * Reaction slice (`state.modules.reaction`): the latest coalesced
 * `reaction:burst`. `burstId` counts bursts, so a view can react to each one
 * even when two bursts carry the same counts.
 */
export const REACTION_PREFIX = "reaction";

export interface ReactionState {
  burstId: number;
  /** Emoji → how many were sent in the last window. */
  counts: Record<string, number>;
}

export const initialReactionState: ReactionState = { burstId: 0, counts: {} };

/** Counts from a `reaction:burst` payload: only positive integer counts of short strings. */
export function readBurstCounts(payload: Record<string, unknown>): Record<string, number> {
  const raw = payload.counts;
  const counts: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return counts;
  for (const [emoji, value] of Object.entries(raw as Record<string, unknown>)) {
    const count = typeof value === "number" ? Math.floor(value) : 0;
    if (emoji.length > 0 && emoji.length <= 16 && count > 0) counts[emoji] = Math.min(count, 10_000);
  }
  return counts;
}

export const reactionReducer: LiveSubReducer<ReactionState> = (state, action) => {
  if (action.type !== "live/event" || action.event.type !== "reaction:burst") return state;
  const counts = readBurstCounts(action.event.payload);
  if (Object.keys(counts).length === 0) return state;
  return { burstId: state.burstId + 1, counts };
};

/** The emoji to float for a burst: every emoji at most `perEmoji` times, `max` in all (largest counts first). */
export function floatersFor(counts: Record<string, number>, perEmoji = 8, max = 24): string[] {
  const out: string[] = [];
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  for (const [emoji, count] of entries) {
    const n = Math.min(count, perEmoji);
    for (let i = 0; i < n && out.length < max; i++) out.push(emoji);
  }
  return out;
}
