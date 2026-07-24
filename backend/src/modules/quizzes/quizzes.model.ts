import mongoose, { Schema, Document } from 'mongoose';

// ---------- Slide ----------

// Scored (quiz competition): select_answer, type_answer.
// Interactive (non-scored, Mentimeter-style): wordcloud, open_ended, scales, ranking.
export type QuizSlideType =
  | 'select_answer'
  | 'type_answer'
  | 'wordcloud'
  | 'open_ended'
  | 'scales'
  | 'ranking';

export const SCORED_SLIDE_TYPES: QuizSlideType[] = ['select_answer', 'type_answer'];

export const isScoredSlideType = (type: QuizSlideType) => SCORED_SLIDE_TYPES.includes(type);

export interface IQuizSlideOption {
  text: string;
  isCorrect: boolean;
}

export interface IQuizSlide {
  _id?: mongoose.Types.ObjectId;
  type: QuizSlideType;
  question: string;
  // select_answer only
  options: IQuizSlideOption[];
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

// ---------- Quiz (definition + live session state) ----------

export type QuizStatus =
  | 'draft' // being edited, not joinable
  | 'lobby' // joinable, waiting for host to start
  | 'question' // a question is live and accepting answers
  | 'reveal' // current question closed, results shown
  | 'leaderboard' // standings shown between questions
  | 'ended'; // final results

export interface IQuiz extends Document {
  creatorId: string;
  title: string;
  joinCode: string;
  status: QuizStatus;
  currentSlideIndex: number; // -1 until first question starts
  questionStartedAt?: Date | null;
  questionEndsAt?: Date | null;
  slides: IQuizSlide[];
  createdAt: Date;
  updatedAt: Date;
}

const QuizSlideSchema = new Schema<IQuizSlide>({
  type: {
    type: String,
    enum: ['select_answer', 'type_answer', 'wordcloud', 'open_ended', 'scales', 'ranking'],
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

const QuizSchema = new Schema<IQuiz>(
  {
    creatorId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    joinCode: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ['draft', 'lobby', 'question', 'reveal', 'leaderboard', 'ended'],
      default: 'draft',
    },
    currentSlideIndex: { type: Number, default: -1 },
    questionStartedAt: { type: Date, default: null },
    questionEndsAt: { type: Date, default: null },
    slides: {
      type: [QuizSlideSchema],
      required: true,
      validate: {
        validator: (v: IQuizSlide[]) => v.length > 0,
        message: 'A quiz must contain at least one slide.',
      },
    },
  },
  { timestamps: true }
);

export const QuizModel = mongoose.model<IQuiz>('Quiz', QuizSchema);

// ---------- Participant ----------

export interface IQuizParticipant extends Document {
  quizId: mongoose.Types.ObjectId;
  name: string;
  deviceId: string;
  /** Secret returned only to the joiner; required to submit answers as this participant */
  token: string;
  score: number;
  correctCount: number;
  joinedAt: Date;
}

const QuizParticipantSchema = new Schema<IQuizParticipant>({
  quizId: { type: Schema.Types.ObjectId, ref: 'Quiz', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 30 },
  deviceId: { type: String, required: true },
  token: { type: String, required: true },
  score: { type: Number, default: 0 },
  correctCount: { type: Number, default: 0 },
  joinedAt: { type: Date, default: Date.now },
});

// One participant per device per quiz (rejoin returns the same participant)
QuizParticipantSchema.index({ quizId: 1, deviceId: 1 }, { unique: true });

export const QuizParticipantModel = mongoose.model<IQuizParticipant>(
  'QuizParticipant',
  QuizParticipantSchema
);

// ---------- Answer ----------

export interface IQuizAnswer extends Document {
  quizId: mongoose.Types.ObjectId;
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

const QuizAnswerSchema = new Schema<IQuizAnswer>(
  {
    quizId: { type: Schema.Types.ObjectId, ref: 'Quiz', required: true, index: true },
    participantId: { type: Schema.Types.ObjectId, ref: 'QuizParticipant', required: true },
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
QuizAnswerSchema.index({ quizId: 1, slideIndex: 1, participantId: 1 }, { unique: true });

export const QuizAnswerModel = mongoose.model<IQuizAnswer>('QuizAnswer', QuizAnswerSchema);
