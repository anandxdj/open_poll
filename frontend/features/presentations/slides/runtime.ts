import type { ComponentType } from "react";
import type {
  AnswerPayload,
  LeaderboardEntry,
  LiveParticipant,
  LiveSlide,
  PresentationSlide,
  PresentationSlideType,
  RevealDistribution,
  RevealPayload,
} from "../types";
import { LeaderboardParticipant } from "./types/leaderboard/participant";
import { LeaderboardStage } from "./types/leaderboard/stage";
import { OpenEndedParticipant } from "./types/open_ended/participant";
import { OpenEndedStage } from "./types/open_ended/stage";
import { RankingParticipant } from "./types/ranking/participant";
import { RankingStage } from "./types/ranking/stage";
import { ScalesParticipant } from "./types/scales/participant";
import { ScalesStage } from "./types/scales/stage";
import { SelectAnswerParticipant } from "./types/select_answer/participant";
import { SelectAnswerStage } from "./types/select_answer/stage";
import { TypeAnswerParticipant } from "./types/type_answer/participant";
import { TypeAnswerStage } from "./types/type_answer/stage";
import { WordcloudParticipant } from "./types/wordcloud/participant";
import { WordcloudStage } from "./types/wordcloud/stage";

/**
 * Runtime registry: how each slide type looks live, on the participant's
 * phone and on the stage. Editor code lives in `slides/editor.ts`, so
 * participants never download it.
 */

/** `live`: interactive. `preview`: inert render of the same UI (builder, presenter preview). */
export type ParticipantMode = "live" | "preview";

export interface ParticipantViewProps {
  slide: LiveSlide;
  mode: ParticipantMode;
  /** Submit this participant's answer for `slide`. */
  onSubmit: (payload: AnswerPayload) => void;
  submitting: boolean;
}

/**
 * `live`: answers coming in. `reveal`: answer window closed, correct answers
 * shown. `report`: post-session results. `thumbnail`: no data — the slide as
 * it will look, for slide rails and previews.
 */
export type StageMode = "live" | "reveal" | "report" | "thumbnail";

export interface StageLiveData {
  distribution: RevealDistribution | null;
  answeredCount: number;
  leaderboard: LeaderboardEntry[];
}

export interface StageViewProps {
  slide: PresentationSlide;
  live: StageLiveData;
  reveal: RevealPayload | null;
  participants: LiveParticipant[];
  mode: StageMode;
}

/**
 * How the shell treats the slide. `response`: question + timer + one answer
 * per participant (the shell owns the timer, submitted and result states;
 * ParticipantView is only the answer form). `system`: the type renders its
 * whole participant view (leaderboard). `content` / `board` arrive with W1-D
 * and W2-B.
 */
export type SlideLifecycle = "response" | "system" | "content" | "board";

export interface SlideRuntime {
  lifecycle: SlideLifecycle;
  ParticipantView: ComponentType<ParticipantViewProps>;
  StageView: ComponentType<StageViewProps>;
}

/** Append-only, one entry per type, alphabetical. */
const RUNTIMES: Partial<Record<PresentationSlideType | (string & {}), SlideRuntime>> = {
  leaderboard: { lifecycle: "system", ParticipantView: LeaderboardParticipant, StageView: LeaderboardStage },
  open_ended: { lifecycle: "response", ParticipantView: OpenEndedParticipant, StageView: OpenEndedStage },
  ranking: { lifecycle: "response", ParticipantView: RankingParticipant, StageView: RankingStage },
  scales: { lifecycle: "response", ParticipantView: ScalesParticipant, StageView: ScalesStage },
  select_answer: { lifecycle: "response", ParticipantView: SelectAnswerParticipant, StageView: SelectAnswerStage },
  type_answer: { lifecycle: "response", ParticipantView: TypeAnswerParticipant, StageView: TypeAnswerStage },
  wordcloud: { lifecycle: "response", ParticipantView: WordcloudParticipant, StageView: WordcloudStage },
};

export function getSlideRuntime(type: string): SlideRuntime | undefined {
  return RUNTIMES[type];
}

export const runtimeSlideTypes = (): string[] => Object.keys(RUNTIMES);

