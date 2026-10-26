import mongoose, { Schema, Document } from 'mongoose';
import { hasSlideType, slideKindOf, type BuiltInSlideType, type SlideKind, type SlideMedia } from '../slides';
import { DEFAULT_THEME_PRESET } from '../../themes/presets';
import type { DeckSettings, SessionPace } from '../live/contract';

export const SESSION_PACES = ['presenter', 'audience'] as const satisfies readonly SessionPace[];
export const NICKNAME_MODES = ['required', 'optional', 'off'] as const;
export const RESULTS_VISIBILITY = ['never', 'after_submit', 'after_close'] as const;

// ---------- Slide ----------

/** The built-in slide types. Stored slides may carry any registered type (`slides/`). */
export type PresentationSlideType = BuiltInSlideType;

export interface IPresentationSlideOption {
  text: string;
  isCorrect: boolean;
}

export interface IPresentationSlide {
  _id?: mongoose.Types.ObjectId;
  /** Registry key (`slides/registry.ts`). */
  type: string;
  /** Derived from the registry on validate; not client-settable. */
  kind: SlideKind;
  question: string;
  /** Speaker notes — host only, stripped from every participant payload. */
  notes: string;
  media: SlideMedia | null;
  layout: string | null;
  /** Type-specific payload for registry types without flat fields (validated by the type schema). */
  content: unknown;
  /** Type-specific settings for registry types (validated by the type schema). */
  config: unknown;
  // select_answer only
  options: IPresentationSlideOption[];
  // type_answer only — any of these (case/whitespace-insensitive) counts as correct
  acceptedAnswers: string[];
  // scales only — statements rated on 1..scaleMax
  statements: string[];
  minLabel: string;
  maxLabel: string;
  scaleMax: number;
  // ranking only — items participants order
  items: string[];
  // wordcloud only — entries allowed per participant (1-3)
  maxEntries: number;
  timeLimit: number; // seconds; 0 = untimed (the registry requires ≥5 where an answer window runs)
  points: number; // max points for a correct answer (scored types only)
  scoreDependsOnTime: boolean;
}

// ---------- Presentation (definition + mirror of the live session) ----------

export type PresentationStatus =
  | 'draft' // never presented
  | 'lobby' // the live session is joinable, waiting for the host to start
  | 'active' // the live session shows a slide
  | 'ended'; // no live session; at least one ended session

export interface IPresentationTheme {
  presetId: string;
  brandKitId: mongoose.Types.ObjectId | null;
  overrides: Record<string, unknown> | null;
}

export interface IPresentationLegacy {
  source: 'poll' | 'quiz';
  sourceId: mongoose.Types.ObjectId;
}

export interface IPresentation extends Document {
  creatorId: string;
  /** Owning workspace; absent on decks created before workspaces (policy falls back to `creatorId`). */
  workspaceId?: mongoose.Types.ObjectId | null;
  folderId: mongoose.Types.ObjectId | null;
  title: string;
  joinCode: string;
  pace: SessionPace;
  settings: DeckSettings;
  theme: IPresentationTheme;
  // Mirror of the live session, written only by live/session.service.ts.
  status: PresentationStatus;
  currentSlideIndex: number; // -1 until the first slide is shown
  questionStartedAt?: Date | null;
  /** End of the current answer window: the deadline, or the close time once closed early; null while untimed. */
  questionEndsAt?: Date | null;
  activeSessionId: mongoose.Types.ObjectId | null;
  lastSessionAt: Date | null;
  sessionCount: number;
  isTemplate: boolean;
  templateSourceId: mongoose.Types.ObjectId | null;
  /** Set when the deck was converted from a poll or copied from the legacy quizzes collection. */
  legacy: IPresentationLegacy | null;
  /** Trash: hidden from lists and lookups. */
  deletedAt: Date | null;
  slides: IPresentationSlide[];
  createdAt: Date;
  updatedAt: Date;
}

const SlideMediaSchema = new Schema<SlideMedia>(
  {
    key: { type: String, default: null },
    url: { type: String, required: true },
    alt: { type: String, default: '' },
    layout: { type: String, default: null },
  },
  { _id: false }
);

const PresentationSlideSchema = new Schema<IPresentationSlide>({
  type: {
    type: String,
    required: true,
    validate: {
      validator: (value: string) => hasSlideType(value),
      message: (props: { value: unknown }) => `Unknown slide type "${String(props.value)}"`,
    },
  },
  kind: {
    type: String,
    enum: ['content', 'interactive', 'system'],
    // Function defaults run after the provided values are set, and on load for
    // documents saved before this field existed.
    default: function (this: IPresentationSlide) {
      return slideKindOf(this.type) ?? 'interactive';
    },
  },
  question: { type: String, default: '' },
  notes: { type: String, default: '', maxlength: 5000 },
  media: { type: SlideMediaSchema, default: null },
  layout: { type: String, default: null },
  content: { type: Schema.Types.Mixed, default: null },
  config: { type: Schema.Types.Mixed, default: null },
  options: {
    type: [
      {
        text: { type: String, required: true },
        isCorrect: { type: Boolean, default: false },
      },
    ],
    default: [],
  },
  acceptedAnswers: { type: [String], default: [] },
  statements: { type: [String], default: [] },
  minLabel: { type: String, default: '' },
  maxLabel: { type: String, default: '' },
  scaleMax: { type: Number, default: 5, min: 2, max: 10 },
  items: { type: [String], default: [] },
  maxEntries: { type: Number, default: 3, min: 1, max: 3 },
  timeLimit: { type: Number, default: 30, min: 0, max: 300 },
  points: { type: Number, default: 1000, min: 0, max: 10000 },
  scoreDependsOnTime: { type: Boolean, default: true },
});

// `kind` always follows `type`, even when a slide's type is edited in place.
PresentationSlideSchema.pre('validate', function () {
  const kind = slideKindOf(this.type);
  if (kind) this.kind = kind;
});

// ---------- Deck settings (every field defaulted, so decks stored before them hydrate) ----------

export const MAX_REACTION_EMOJIS = 6;
export const DEFAULT_REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '👏'];

const sub = <T>(definition: Record<string, unknown>) => new Schema<T>(definition, { _id: false });

const DeckSettingsSchema = sub<DeckSettings>({
  audienceLocale: { type: String, default: 'en', maxlength: 10 },
  nickname: { type: String, enum: NICKNAME_MODES, default: 'required' },
  showResultsOnDevices: { type: Boolean, default: true },
  qna: {
    type: sub({
      enabled: { type: Boolean, default: false },
      moderation: { type: Boolean, default: false },
      anonymousAllowed: { type: Boolean, default: true },
      upvotes: { type: Boolean, default: true },
    }),
    default: () => ({}),
  },
  reactions: {
    type: sub({
      enabled: { type: Boolean, default: false },
      emojis: {
        type: [String],
        default: () => [...DEFAULT_REACTION_EMOJIS],
        validate: {
          validator: (v: string[]) => v.length <= MAX_REACTION_EMOJIS,
          message: `At most ${MAX_REACTION_EMOJIS} reaction emojis`,
        },
      },
    }),
    default: () => ({}),
  },
  quiz: {
    type: sub({
      leaderboard: { type: Boolean, default: true },
      showCorrectOnDevices: { type: Boolean, default: true },
    }),
    default: () => ({}),
  },
  audiencePaced: {
    type: sub({
      resultsVisibility: { type: String, enum: RESULTS_VISIBILITY, default: 'after_close' },
      assessment: {
        type: sub({
          enabled: { type: Boolean, default: false },
          passingScorePercentage: { type: Number, default: 70, min: 0, max: 100 },
          // null = unlimited attempts (converted TRIAL polls let respondents retry until they pass).
          maxAttempts: { type: Number, default: 1, min: 1, max: 10 },
        }),
        default: () => ({}),
      },
    }),
    default: () => ({}),
  },
  embed: {
    type: sub({ allowed: { type: Boolean, default: false } }),
    default: () => ({}),
  },
});

const ThemeSchema = sub<IPresentationTheme>({
  presetId: { type: String, default: DEFAULT_THEME_PRESET, maxlength: 40 },
  brandKitId: { type: Schema.Types.ObjectId, ref: 'BrandKit', default: null },
  overrides: { type: Schema.Types.Mixed, default: null },
});

const LegacySchema = sub<IPresentationLegacy>({
  source: { type: String, enum: ['poll', 'quiz'], required: true },
  sourceId: { type: Schema.Types.ObjectId, required: true },
});

const PresentationSchema = new Schema<IPresentation>(
  {
    creatorId: { type: String, required: true, index: true },
    // No default: decks created before workspaces must stay without the field
    // until migration 020 backfills it.
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace' },
    folderId: { type: Schema.Types.ObjectId, ref: 'Folder', default: null },
    title: { type: String, required: true },
    joinCode: { type: String, required: true, unique: true },
    pace: { type: String, enum: SESSION_PACES, default: 'presenter' },
    settings: { type: DeckSettingsSchema, default: () => ({}) },
    theme: { type: ThemeSchema, default: () => ({}) },
    status: {
      type: String,
      enum: ['draft', 'lobby', 'active', 'ended'],
      default: 'draft',
    },
    currentSlideIndex: { type: Number, default: -1 },
    questionStartedAt: { type: Date, default: null },
    questionEndsAt: { type: Date, default: null },
    activeSessionId: { type: Schema.Types.ObjectId, ref: 'PresentationSession', default: null },
    lastSessionAt: { type: Date, default: null },
    sessionCount: { type: Number, default: 0 },
    isTemplate: { type: Boolean, default: false },
    templateSourceId: { type: Schema.Types.ObjectId, ref: 'Presentation', default: null },
    legacy: { type: LegacySchema, default: null },
    deletedAt: { type: Date, default: null },
    slides: {
      type: [PresentationSlideSchema],
      required: true,
      validate: {
        validator: (v: IPresentationSlide[]) => v.length > 0,
        message: 'A presentation deck must contain at least one slide.',
      },
    },
  },
  { timestamps: true, optimisticConcurrency: true }
);

// Created by migration 030 in production (see PRESENTATION_INDEXES there).
PresentationSchema.index({ workspaceId: 1, updatedAt: -1 });
PresentationSchema.index({ workspaceId: 1, folderId: 1, updatedAt: -1 });
PresentationSchema.index({ 'legacy.source': 1, 'legacy.sourceId': 1 }, { sparse: true });

export const PresentationModel = mongoose.model<IPresentation>('Presentation', PresentationSchema);
