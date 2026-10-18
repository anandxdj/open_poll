import type { z } from 'zod';
import type { IPresentationSlide } from '../models/presentation.model';

/**
 * Contract every slide type implements. One file per type under `slides/types/`,
 * registered from `slides/index.ts`. The live engine, request schema, Mongoose
 * model, distribution worker and (later) exports look types up here instead of
 * switching on `slide.type`.
 */

/** What the slide is, for builders and dashboards. Stored on the slide as `kind`. */
export type SlideKind = 'content' | 'interactive' | 'system';

/**
 * How the live engine runs the slide when the host moves to it:
 * - `content`  — shown only: publishes `slide:shown`, no timer, answers rejected.
 * - `response` — opens a timed answer window: `question:started` → answers → reveal.
 * - `board`    — shown like content; participation goes through its own module API.
 * - `system`   — engine-rendered standings (`leaderboard:shown`), no timer, no answers.
 */
export type SlideLifecycle = 'content' | 'response' | 'board' | 'system';

/** The seven types that predate the registry; their flat fields stay on the slide. */
export const BUILT_IN_SLIDE_TYPES = [
  'select_answer',
  'type_answer',
  'wordcloud',
  'open_ended',
  'scales',
  'ranking',
  'leaderboard',
] as const;

export type BuiltInSlideType = (typeof BUILT_IN_SLIDE_TYPES)[number];

/**
 * Per-slide Redis structures an answer may write. `live/keys.ts` maps them to
 * real keys, so type code never builds key strings.
 * - `dist` HASH: counters (option index / normalized text / sums)
 * - `disp` HASH: normalized text → first-seen display text
 * - `feed` LIST: capped list of recent raw entries (needs `feedLength`)
 */
export type SlideRedisTarget = 'dist' | 'disp' | 'feed';

export type RedisOp =
  | { op: 'hincrby'; key: SlideRedisTarget; field: string; by: number }
  | { op: 'hsetnx'; key: SlideRedisTarget; field: string; value: string }
  | { op: 'lpush_trim'; key: SlideRedisTarget; value: string; max: number };

/** Columns written to the durable answer document (legacy columns default to null). */
export interface AnswerPersist {
  optionIndex: number | null;
  text: string | null;
  payload: unknown;
}

export interface AcceptContext {
  /** Server-clock ms since the answer window opened. */
  elapsedMs: number;
}

export interface AcceptResult {
  isCorrect: boolean;
  ops: RedisOp[];
  persist: AnswerPersist;
}

export interface ScoreContext {
  isCorrect: boolean;
  elapsedMs: number;
}

/** Raw Redis reads handed to `distribution`. `feed` is newest first. */
export interface DistributionRaw {
  dist: Record<string, string>;
  disp: Record<string, string>;
  feed: string[];
}

export type ExportCell = string | number | null;

/** The stored answer fields an export cell is rendered from. */
export interface ExportAnswer {
  optionIndex?: number | null;
  text?: string | null;
  payload?: unknown;
  isCorrect: boolean;
  score: number;
}

export interface SlideMedia {
  key: string | null;
  url: string;
  alt: string;
  layout: string | null;
}

/** Output of a type's request `schema` (what `PATCH`/`POST` store on the slide). */
export interface ParsedSlide {
  type: string;
  question: string;
  notes: string;
  media: SlideMedia | null;
  layout: string | null;
  timeLimit: number;
  content?: unknown;
  config?: unknown;
  options?: { text: string; isCorrect: boolean }[];
  acceptedAnswers?: string[];
  statements?: string[];
  minLabel?: string;
  maxLabel?: string;
  scaleMax?: number;
  items?: string[];
  maxEntries?: number;
  points?: number;
  scoreDependsOnTime?: boolean;
}

/** A slide as the engine sees it: a hydrated subdocument or an equivalent plain object. */
export type Slide = IPresentationSlide;

export interface SlideTypeDef<Cfg = unknown, Payload = unknown> {
  /** Registry key, stored as `slide.type`. */
  type: string;
  /** Human name of the type ("Select answer"), used in messages and export headers. */
  name: string;
  kind: SlideKind;
  lifecycle: SlideLifecycle;
  /** Scored types feed the leaderboard and must keep a timer of at least 5s. */
  scored: boolean;
  /** Validates and defaults one slide of this type in create/update requests. */
  schema: z.ZodType<ParsedSlide>;
  /**
   * Participant-facing fields, as an explicit allow-list: anything not copied
   * here (notes, answer keys, future fields) never reaches participants. The
   * registry adds `slideIndex`, `totalSlides`, `type`, `kind`, `scored`,
   * `media` and `layout`.
   */
  sanitize(slide: Slide): Record<string, unknown>;
  /** JSON-safe snapshot cached in Redis when the answer window opens. */
  acceptConfig?(slide: Slide): Cfg;
  /** Structural check of the answer payload; `accept` does the config-dependent checks. */
  answerSchema?: z.ZodType<Payload>;
  /** Grades one answer. Throw `ApiError.badRequest` to reject it (nothing is written). */
  accept?(cfg: Cfg, payload: Payload, ctx: AcceptContext): AcceptResult;
  /** Points for a graded answer; only called when `scored`. */
  score?(cfg: Cfg, ctx: ScoreContext): number;
  /** Capacity of the per-slide `feed` list; when set, `distribution` receives it. */
  feedLength?: number;
  /** Results payload for reveal, host state and the live worker. */
  distribution?(slide: Slide, raw: DistributionRaw): Record<string, unknown>;
  exportColumns?(slide: Slide): string[];
  exportCells?(slide: Slide, answer: ExportAnswer | null): ExportCell[];
  /** Short human label for one slide (lists, exports). */
  label(slide: Slide): string;
}

// Registry storage is heterogeneous; each def is type-checked by `defineSlideType`.
export type AnySlideTypeDef = SlideTypeDef<any, any>;
