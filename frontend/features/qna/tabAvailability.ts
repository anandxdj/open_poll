/**
 * Whether the participant Q&A tab is worth showing for a deck. The tab slot's
 * `when` runs during render without store access, so the answer comes from
 * this small cache, filled once the Q&A list loaded (Q&A is on for the deck,
 * or the deck has a Q&A slide). It is kept in sessionStorage so a refresh
 * does not flash the tab. Unknown counts as available: a missing tab hides
 * the feature, a spare one only shows "Q&A isn't open".
 */
const memory = new Map<string, boolean>();
const key = (presentationId: string) => `openpoll_qna_tab_${presentationId}`;

export function rememberQnaTab(presentationId: string, available: boolean) {
  memory.set(presentationId, available);
  try {
    window.sessionStorage.setItem(key(presentationId), available ? "1" : "0");
  } catch {
    // Private mode: the memory copy still serves this page view.
  }
}

export function qnaTabAvailable(presentationId: string): boolean {
  const known = memory.get(presentationId);
  if (known !== undefined) return known;
  try {
    const stored = window.sessionStorage.getItem(key(presentationId));
    if (stored !== null) return stored === "1";
  } catch {
    // No storage: fall through to the optimistic default.
  }
  return true;
}

/** Test helper. */
export function forgetQnaTabs() {
  memory.clear();
}
