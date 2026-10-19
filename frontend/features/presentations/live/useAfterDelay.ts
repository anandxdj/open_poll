"use client";

import { useEffect, useState } from "react";

/**
 * True once `active` has been true for `ms` without a break — for notices that
 * should not flash during the first connect or a quick reconnect.
 */
export function useAfterDelay(active: boolean, ms: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setElapsed(true), ms);
    return () => {
      clearTimeout(timer);
      setElapsed(false);
    };
  }, [active, ms]);
  return active && elapsed;
}
