import mongoose, { Schema, Document } from 'mongoose';
import { hasSlideType, slideKindOf, type BuiltInSlideType, type SlideKind, type SlideMedia } from '../slides';

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
