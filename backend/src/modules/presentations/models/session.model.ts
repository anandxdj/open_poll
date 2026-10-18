import mongoose, { Schema, Document, type SchemaDefinitionProperty } from 'mongoose';
import { env } from '../../../common/config/env';
import type { IPresentationSlide } from './presentation.model';
import type { DeckSettings, LeaderboardEntry, SessionPace, SessionStatus } from '../live/contract';
import type { ThemeTokens } from '../../themes/resolve';

/** Timing of one visited slide. Response slides are open while neither `closedAt` nor `revealedAt` is set. */
export interface ISlideState {
  /** First shown, or (response slides) last opened. */
  openedAt: Date | null;
  /** Answer deadline; null when untimed or for slides without an answer window. */
  endsAt: Date | null;
  /** Remaining time while a timer is paused (presenter tools). */
  pausedRemainingMs: number | null;
  closedAt: Date | null;
  revealedAt: Date | null;
}

export interface ISessionSlideStat {
  slideId: mongoose.Types.ObjectId;
  slideIndex: number;
  type: string;
  answeredCount: number;
  distribution: Record<string, unknown>;
}

export interface ISessionEntitlements {
  plan: string;
  /** Participants allowed to join; null = unlimited. */
  audienceCap: number | null;
  /** Days ended-session data is kept; null = no limit. */
  retentionDays: number | null;
}

export interface ISessionShare {
  token: string;
  enabled: boolean;
  includeNames: boolean;
  createdAt: Date;
  expiresAt: Date | null;
}

export interface IPresentationSession extends Document {
  _id: mongoose.Types.ObjectId;
  presentationId: mongoose.Types.ObjectId;
  /** The deck's workspace when the session opened; null for decks without one. */
  workspaceId: mongoose.Types.ObjectId | null;
  hostUserId: string | null;
  runNumber: number;
  pace: SessionPace;
  status: SessionStatus;
  /** True while `lobby`/`active`; unique per deck (partial index). */
  isLive: boolean;
  joinCode: string;
  startedAt: Date;
  endedAt: Date | null;
  currentSlideId: mongoose.Types.ObjectId | null;
  currentSlideIndex: number;
  /** slideId → state, for every visited slide. */
  slideStates: Map<string, ISlideState>;
  /** The deck's slides, frozen at open; the engine runs from these. */
  deckSnapshot: IPresentationSlide[];
  themeSnapshot: ThemeTokens | null;
  settingsSnapshot: DeckSettings | null;
  entitlementsSnapshot: ISessionEntitlements | null;
  participantCount: number;
  answerCount: number;
  finalLeaderboard: LeaderboardEntry[];
  slideStats: ISessionSlideStat[];
  share: ISessionShare | null;
  retainUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const SESSION_STATUSES = ['lobby', 'active', 'ended'] as const satisfies readonly SessionStatus[];

const SlideStateSchema = new Schema<ISlideState>(
  {
    openedAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    pausedRemainingMs: { type: Number, default: null },
    closedAt: { type: Date, default: null },
    revealedAt: { type: Date, default: null },
  },
  { _id: false }
);

const SlideStatSchema = new Schema<ISessionSlideStat>(
  {
    slideId: { type: Schema.Types.ObjectId, required: true },
    slideIndex: { type: Number, required: true },
    type: { type: String, required: true },
    answeredCount: { type: Number, default: 0 },
    distribution: { type: Schema.Types.Mixed, default: () => ({}) },
  },
  { _id: false }
);

const LeaderboardEntrySchema = new Schema<LeaderboardEntry>(
  {
    participantId: { type: String, required: true },
    name: { type: String, required: true },
    score: { type: Number, default: 0 },
    correctCount: { type: Number, default: 0 },
    rank: { type: Number, required: true },
  },
  { _id: false }
);

const EntitlementsSchema = new Schema<ISessionEntitlements>(
  {
    plan: { type: String, required: true },
    audienceCap: { type: Number, default: null },
    retentionDays: { type: Number, default: null },
  },
  { _id: false }
);

const ShareSchema = new Schema<ISessionShare>(
  {
    token: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    includeNames: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null },
  },
  { _id: false }
);

const PresentationSessionSchema = new Schema<IPresentationSession>(
  {
    presentationId: { type: Schema.Types.ObjectId, ref: 'Presentation', required: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', default: null },
    hostUserId: { type: String, default: null },
    runNumber: { type: Number, required: true, min: 1 },
    pace: { type: String, enum: ['presenter', 'audience'], default: 'presenter' },
    status: { type: String, enum: SESSION_STATUSES, default: 'lobby' },
    isLive: { type: Boolean, default: true },
    joinCode: { type: String, required: true },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    currentSlideId: { type: Schema.Types.ObjectId, default: null },
    currentSlideIndex: { type: Number, default: -1 },
    slideStates: { type: Map, of: SlideStateSchema, default: () => new Map() },
    // Mixed: a snapshot must load even if a slide type is later unregistered.
    deckSnapshot: { type: [Schema.Types.Mixed], default: [] } as SchemaDefinitionProperty<IPresentationSlide[]>,
    themeSnapshot: { type: Schema.Types.Mixed, default: null },
    settingsSnapshot: { type: Schema.Types.Mixed, default: null },
    entitlementsSnapshot: { type: EntitlementsSchema, default: null },
    participantCount: { type: Number, default: 0 },
    answerCount: { type: Number, default: 0 },
    finalLeaderboard: { type: [LeaderboardEntrySchema], default: [] },
    slideStats: { type: [SlideStatSchema], default: [] },
    // Absent until shared, so the sparse token index skips unshared sessions.
    share: { type: ShareSchema, default: undefined },
    retainUntil: { type: Date, default: null },
  },
  // Production indexes come from migration 030 (syncIndexes), not boot.
  { timestamps: true, optimisticConcurrency: true, autoIndex: !env.isProduction }
);

PresentationSessionSchema.index({ presentationId: 1, startedAt: -1 });
PresentationSessionSchema.index({ workspaceId: 1, startedAt: -1 });
// At most one live session per deck.
PresentationSessionSchema.index(
  { presentationId: 1 },
  { unique: true, partialFilterExpression: { isLive: true }, name: 'one_live_session_per_presentation' }
);
PresentationSessionSchema.index({ 'share.token': 1 }, { unique: true, sparse: true });
PresentationSessionSchema.index({ retainUntil: 1 });

export const PresentationSessionModel = mongoose.model<IPresentationSession>(
  'PresentationSession',
  PresentationSessionSchema
);
