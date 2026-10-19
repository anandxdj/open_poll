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
import { BigNumberParticipant } from "./types/big_number/participant";
import { BigNumberStage } from "./types/big_number/stage";
import { BulletsParticipant } from "./types/bullets/participant";
import { BulletsStage } from "./types/bullets/stage";
import { Grid2x2Participant } from "./types/grid_2x2/participant";
import { Grid2x2Stage } from "./types/grid_2x2/stage";
import { GuessNumberParticipant } from "./types/guess_number/participant";
import { GuessNumberStage } from "./types/guess_number/stage";
import { HeadingParticipant } from "./types/heading/participant";
import { HeadingStage } from "./types/heading/stage";
import { HundredPointsParticipant } from "./types/hundred_points/participant";
import { HundredPointsStage } from "./types/hundred_points/stage";
import { ImageParticipant } from "./types/image/participant";
import { ImageStage } from "./types/image/stage";
import { InstructionsParticipant } from "./types/instructions/participant";
import { InstructionsStage } from "./types/instructions/stage";
import { LeaderboardParticipant } from "./types/leaderboard/participant";
import { LeaderboardStage } from "./types/leaderboard/stage";
import { OpenEndedParticipant } from "./types/open_ended/participant";
import { OpenEndedStage } from "./types/open_ended/stage";
import { ParagraphParticipant } from "./types/paragraph/participant";
import { ParagraphStage } from "./types/paragraph/stage";
import { PinOnImageParticipant } from "./types/pin_on_image/participant";
import { PinOnImageStage } from "./types/pin_on_image/stage";
import { QuoteParticipant } from "./types/quote/participant";
import { QuoteStage } from "./types/quote/stage";
import { RankingParticipant } from "./types/ranking/participant";
import { RankingStage } from "./types/ranking/stage";
import { ScalesParticipant } from "./types/scales/participant";
import { ScalesStage } from "./types/scales/stage";
import { SelectAnswerParticipant } from "./types/select_answer/participant";
import { SelectAnswerStage } from "./types/select_answer/stage";
import { TypeAnswerParticipant } from "./types/type_answer/participant";
import { TypeAnswerStage } from "./types/type_answer/stage";
import { VideoParticipant } from "./types/video/participant";
import { VideoStage } from "./types/video/stage";
import { WordcloudParticipant } from "./types/wordcloud/participant";
import { WordcloudStage } from "./types/wordcloud/stage";

/**
 * Runtime registry: how each slide type looks live, on the participant's
 * phone and on the stage. Editor code lives in `slides/editor.ts`, so
 * participants never download it.
 */

/**
 * `live`: interactive, presenter-paced (the stage shows the slide; content
 * slides only point there). `audience`: interactive, audience-paced (the
 * phone is the only screen, so content slides render in full). `preview`:
 * inert render of the slide (builder, presenter preview).
 */
export type ParticipantMode = "live" | "audience" | "preview";

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
 * whole participant view (leaderboard). `content`: shown, never answered —
 * the type renders its whole view ("Look at the screen" in `live` mode, the
 * slide itself in `audience`/`preview`). `board` arrives with W2-B.
 */
export type SlideLifecycle = "response" | "system" | "content" | "board";

export interface SlideRuntime {
  lifecycle: SlideLifecycle;
  ParticipantView: ComponentType<ParticipantViewProps>;
  StageView: ComponentType<StageViewProps>;
}

/** Append-only, one entry per type, alphabetical. */
const RUNTIMES: Partial<Record<PresentationSlideType | (string & {}), SlideRuntime>> = {
  big_number: { lifecycle: "content", ParticipantView: BigNumberParticipant, StageView: BigNumberStage },
  bullets: { lifecycle: "content", ParticipantView: BulletsParticipant, StageView: BulletsStage },
  grid_2x2: { lifecycle: "response", ParticipantView: Grid2x2Participant, StageView: Grid2x2Stage },
  guess_number: { lifecycle: "response", ParticipantView: GuessNumberParticipant, StageView: GuessNumberStage },
  heading: { lifecycle: "content", ParticipantView: HeadingParticipant, StageView: HeadingStage },
  hundred_points: { lifecycle: "response", ParticipantView: HundredPointsParticipant, StageView: HundredPointsStage },
  image: { lifecycle: "content", ParticipantView: ImageParticipant, StageView: ImageStage },
  instructions: { lifecycle: "content", ParticipantView: InstructionsParticipant, StageView: InstructionsStage },
  leaderboard: { lifecycle: "system", ParticipantView: LeaderboardParticipant, StageView: LeaderboardStage },
  open_ended: { lifecycle: "response", ParticipantView: OpenEndedParticipant, StageView: OpenEndedStage },
  paragraph: { lifecycle: "content", ParticipantView: ParagraphParticipant, StageView: ParagraphStage },
  pin_on_image: { lifecycle: "response", ParticipantView: PinOnImageParticipant, StageView: PinOnImageStage },
  quote: { lifecycle: "content", ParticipantView: QuoteParticipant, StageView: QuoteStage },
  ranking: { lifecycle: "response", ParticipantView: RankingParticipant, StageView: RankingStage },
  scales: { lifecycle: "response", ParticipantView: ScalesParticipant, StageView: ScalesStage },
  select_answer: { lifecycle: "response", ParticipantView: SelectAnswerParticipant, StageView: SelectAnswerStage },
  type_answer: { lifecycle: "response", ParticipantView: TypeAnswerParticipant, StageView: TypeAnswerStage },
  video: { lifecycle: "content", ParticipantView: VideoParticipant, StageView: VideoStage },
  wordcloud: { lifecycle: "response", ParticipantView: WordcloudParticipant, StageView: WordcloudStage },
};

export function getSlideRuntime(type: string): SlideRuntime | undefined {
  return RUNTIMES[type];
}

export const runtimeSlideTypes = (): string[] => Object.keys(RUNTIMES);

