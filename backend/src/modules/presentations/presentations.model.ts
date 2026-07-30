import mongoose, { Schema, Document } from 'mongoose';

// ---------- Slide ----------

// Scored (quiz competition): select_answer, type_answer.
// Interactive (non-scored, Mentimeter-style): wordcloud, open_ended, scales, ranking.
export type PresentationSlideType =
  | 'select_answer'
  | 'type_answer'
  | 'wordcloud'
  | 'open_ended'
  | 'scales'
  | 'ranking'
  | 'leaderboard';

export const SCORED_SLIDE_TYPES: PresentationSlideType[] = ['select_answer', 'type_answer'];

export const isScoredSlideType = (type: PresentationSlideType) => SCORED_SLIDE_TYPES.includes(type);

export interface IPresentationSlideOption {
  text: string;
  isCorrect: boolean;
}

export interface IPresentationSlide {
  _id?: mongoose.Types.ObjectId;
  type: PresentationSlideType;
  question: string;
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
  timeLimit: number; // seconds
  points: number; // max points for a correct answer (scored types only)
  scoreDependsOnTime: boolean;
}

// ---------- Presentation (definition + live session state) ----------

export type PresentationStatus =
  | 'draft' // being edited, not joinable
  | 'lobby' // joinable, waiting for host to start
  | 'active' // a slide is live; answering-vs-revealed is derived from the clock
  | 'ended'; // final results

export interface IPresentation extends Document {
  creatorId: string;
  title: string;
  joinCode: string;
  status: PresentationStatus;
  currentSlideIndex: number; // -1 until first question starts
  questionStartedAt?: Date | null;
  questionEndsAt?: Date | null;
  slides: IPresentationSlide[];
  createdAt: Date;
  updatedAt: Date;
}

const PresentationSlideSchema = new Schema<IPresentationSlide>({
  type: {
    type: String,
    enum: ['select_answer', 'type_answer', 'wordcloud', 'open_ended', 'scales', 'ranking', 'leaderboard'],
    required: true,
  },
  question: { type: String, required: true },
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
  timeLimit: { type: Number, default: 30, min: 5, max: 300 },
  points: { type: Number, default: 1000, min: 0, max: 10000 },
  scoreDependsOnTime: { type: Boolean, default: true },
});

const PresentationSchema = new Schema<IPresentation>(
  {
    creatorId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    joinCode: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ['draft', 'lobby', 'active', 'ended'],
      default: 'draft',
    },
    currentSlideIndex: { type: Number, default: -1 },
    questionStartedAt: { type: Date, default: null },
    questionEndsAt: { type: Date, default: null },
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

export const PresentationModel = mongoose.model<IPresentation>('Presentation', PresentationSchema);

// ---------- Participant ----------

export interface IPresentationParticipant extends Document {
  presentationId: mongoose.Types.ObjectId;
  name: string;
  deviceId: string;
  /** Secret returned only to the joiner; required to submit answers as this participant */
  token: string;
  score: number;
  correctCount: number;
  joinedAt: Date;
}

const PresentationParticipantSchema = new Schema<IPresentationParticipant>({
  presentationId: { type: Schema.Types.ObjectId, ref: 'Presentation', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 30 },
  deviceId: { type: String, required: true },
  token: { type: String, required: true },
  score: { type: Number, default: 0 },
  correctCount: { type: Number, default: 0 },
  joinedAt: { type: Date, default: Date.now },
});

// One participant per device per presentation (rejoin returns the same participant)
PresentationParticipantSchema.index({ presentationId: 1, deviceId: 1 }, { unique: true });

export const PresentationParticipantModel = mongoose.model<IPresentationParticipant>(
  'PresentationParticipant',
  PresentationParticipantSchema
);

// ---------- Answer ----------

export interface IPresentationAnswer extends Document {
  presentationId: mongoose.Types.ObjectId;
  participantId: mongoose.Types.ObjectId;
  slideIndex: number;
  optionIndex?: number | null;
  text?: string | null;
  /** Structured payload for interactive types (entries / ratings / ranking) */
  payload?: unknown;
  isCorrect: boolean;
  score: number;
  timeMs: number; // elapsed time from question start to answer (server clock)
}

const PresentationAnswerSchema = new Schema<IPresentationAnswer>(
  {
    presentationId: { type: Schema.Types.ObjectId, ref: 'Presentation', required: true, index: true },
    participantId: { type: Schema.Types.ObjectId, ref: 'PresentationParticipant', required: true },
    slideIndex: { type: Number, required: true },
    optionIndex: { type: Number, default: null },
    text: { type: String, default: null },
    payload: { type: Schema.Types.Mixed, default: null },
    isCorrect: { type: Boolean, required: true },
    score: { type: Number, required: true },
    timeMs: { type: Number, required: true },
  },
  { timestamps: true }
);

// Hard guarantee against double answers
PresentationAnswerSchema.index({ presentationId: 1, slideIndex: 1, participantId: 1 }, { unique: true });

export const PresentationAnswerModel = mongoose.model<IPresentationAnswer>('PresentationAnswer', PresentationAnswerSchema);
