"use client";

import type { LiveParticipant, PresentationSlide, RevealPayload } from "../../types";
import { getSlideRuntime, type StageLiveData, type StageMode } from "../../slides/runtime";

const NO_LIVE_DATA: StageLiveData = { distribution: null, answeredCount: 0, leaderboard: [] };
const NO_PARTICIPANTS: LiveParticipant[] = [];

interface StageViewProps {
  slide: PresentationSlide;
  mode: StageMode;
  live?: StageLiveData;
  reveal?: RevealPayload | null;
  participants?: LiveParticipant[];
}

/**
 * The slide type's StageView, looked up in the runtime registry. Data props
 * default to "nothing yet", so `<StageView slide={slide} mode="thumbnail" />`
 * is all a preview needs. Unknown types render nothing.
 */
export function StageView({
  slide,
  mode,
  live = NO_LIVE_DATA,
  reveal = null,
  participants = NO_PARTICIPANTS,
}: StageViewProps) {
  const runtime = getSlideRuntime(slide.type);
  if (!runtime) return null;
  return (
    <runtime.StageView slide={slide} mode={mode} live={live} reveal={reveal} participants={participants} />
  );
}
