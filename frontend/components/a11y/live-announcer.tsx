"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export type Politeness = "polite" | "assertive";
type Announce = (message: string, politeness?: Politeness) => void;

const AnnounceContext = createContext<Announce>(() => {});

/** Messages that arrive this close together are read as one. */
const BATCH_MS = 120;

/**
 * Screen-reader announcements (W4-A). Renders two visually hidden live regions
 * that exist before anything is said into them (a region mounted together with
 * its text is often not read), one polite and one assertive, and gives the
 * subtree `useAnnounce()`. Messages that arrive within one batch are joined; a
 * message repeated later is read again (the region is cleared first).
 */
export function LiveAnnouncer({ children }: { children: ReactNode }) {
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");
  const queues = useRef<Record<Politeness, string[]>>({ polite: [], assertive: [] });
  const timers = useRef<Partial<Record<Politeness, ReturnType<typeof setTimeout>>>>({});

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of Object.values(pending)) clearTimeout(timer);
    };
  }, []);

  const announce = useCallback<Announce>((message, politeness = "polite") => {
    const text = message.trim();
    if (!text) return;
    const set = politeness === "assertive" ? setAssertive : setPolite;
    const queue = queues.current[politeness];
    if (!queue.includes(text)) queue.push(text);
    if (timers.current[politeness]) return;
    set("");
    timers.current[politeness] = setTimeout(() => {
      timers.current[politeness] = undefined;
      set(queue.splice(0).join(". "));
    }, BATCH_MS);
  }, []);

  return (
    <AnnounceContext.Provider value={announce}>
      {children}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="announcer-polite">
        {polite}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true" data-testid="announcer-assertive">
        {assertive}
      </div>
    </AnnounceContext.Provider>
  );
}

/** Says `message` through the nearest `LiveAnnouncer` (a no-op outside one). */
export const useAnnounce = () => useContext(AnnounceContext);

/**
 * Announces `message` whenever `key` changes after the first render (the
 * screen that is already there when a page opens is not read out). A null
 * message stays silent.
 */
export function useAnnounceOnChange(key: string | null, message: string | null, politeness: Politeness = "polite") {
  const announce = useAnnounce();
  const previous = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const first = previous.current === undefined;
    const changed = previous.current !== key;
    previous.current = key;
    if (first || !changed || key === null || !message) return;
    announce(message, politeness);
    // The message belongs to the key: re-announce only when the key changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/**
 * Moves focus to the first heading inside `ref` whenever `key` changes after
 * the first render (or on the first render too with `initial`), so a keyboard
 * or screen-reader user lands on the new screen's title. The heading becomes
 * focusable with `tabindex="-1"` (no tab stop) and shows no focus ring.
 */
export function useFocusHeadingOnChange(
  ref: React.RefObject<HTMLElement | null>,
  key: string | null,
  { initial = false }: { initial?: boolean } = {}
) {
  const previous = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const first = previous.current === undefined;
    const changed = previous.current !== key;
    previous.current = key;
    if (key === null || !changed || (first && !initial)) return;
    // Wait a frame: the new screen's heading renders with this commit, entrance animations may follow.
    const frame = requestAnimationFrame(() => {
      const heading = ref.current?.querySelector<HTMLElement>("h1, h2, h3");
      if (!heading) return;
      if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
      // Leave focus alone while the participant types somewhere else (e.g. a Q&A question).
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body && active.matches("input, textarea, select, [contenteditable]") && !ref.current?.contains(active)) return;
      heading.focus({ preventScroll: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [key, ref, initial]);
}
