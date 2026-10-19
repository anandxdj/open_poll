/**
 * Q&A Redis keys. Session-scoped and hash-tagged like the live engine's
 * `psess:{<sid>}:*` keys, so one session's keys share a Cluster slot and the
 * coalescer scripts may touch them together.
 */

/** Q&A keys expire 6 h after their last write, like the live session keys. */
export const QNA_KEY_TTL_SEC = 6 * 3600;

const session = (sid: string) => `qna:{${sid}}`;

export const qnaKeys = {
  /** SET of question ids whose upvote count changed since the last `qna:votes`. */
  votesDirty: (sid: string) => `${session(sid)}:votes:dirty`,
  /** STRING lock (`SET NX PX 500`): held while a `qna:votes` flush is scheduled. */
  votesLock: (sid: string) => `${session(sid)}:votes:lock`,
};
