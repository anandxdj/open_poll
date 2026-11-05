/**
 * Attempt states of audience-paced participants (W2-F), as kept in the
 * session's `psess:{sid}:attempts` hash: `"<n>"` while attempt n runs,
 * `"<n>:done"` once it was submitted. A participant without an entry is on
 * attempt 1, running. The answer script compares the raw value, so these
 * helpers are the only place the format is spelled out.
 */

export interface AttemptState {
  number: number;
  submitted: boolean;
}

export const FIRST_ATTEMPT: AttemptState = { number: 1, submitted: false };

/** The stored value (or null for no entry) as an attempt state; anything malformed counts as attempt 1. */
export const parseAttemptState = (raw: string | null | undefined): AttemptState => {
  if (!raw) return FIRST_ATTEMPT;
  const [head, tail] = raw.split(':');
  const number = Number(head);
  if (!Number.isInteger(number) || number < 1) return FIRST_ATTEMPT;
  return { number, submitted: tail === 'done' };
};

/** The value the answer script expects while attempt `n` runs. */
export const runningAttempt = (number: number) => String(number);

/** The value of a submitted attempt `n`. */
export const submittedAttempt = (number: number) => `${number}:done`;
