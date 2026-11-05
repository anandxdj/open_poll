"use client";

import { useLive } from "../../live/store";
import { audienceSliceOf } from "../participant/audience/audienceSlice";

/**
 * Whether the host surfaces show the audience dashboard (W2-F): the live
 * session's pace while one runs (it was snapshotted at open), else the deck's
 * pace for the next run.
 */
export function useAudiencePaced(): boolean {
  return useLive((s) =>
    s.status === "lobby" || s.status === "active" ? audienceSliceOf(s).pace === "audience" : s.deck?.pace === "audience"
  );
}
