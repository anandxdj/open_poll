import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { env } from '../../common/config/env';

export const IMPORT_KINDS = ['pptx', 'pdf', 'csv', 'xlsx', 'gslides'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

/** Kinds the queue processes (`csv`/`xlsx` question imports are synchronous and recorded as completed). */
export const QUEUED_KINDS = ['pptx', 'pdf', 'gslides'] as const;
export type QueuedImportKind = (typeof QUEUED_KINDS)[number];

export const IMPORT_STATUSES = ['queued', 'running', 'completed', 'failed'] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

export interface IImportWarning {
  code: string;
  message: string;
  /** 1-based slide or page in the source the warning is about. */
  slide: number | null;
}

export interface IImportError {
  code: string;
  /** Written for the person who started the import. */
  message: string;
}

export interface IImportJob extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  userId: Types.ObjectId;
  kind: ImportKind;
  status: ImportStatus;
  /** Storage key of the uploaded file (pptx/pdf). */
  sourceKey: string | null;
  /** Google Slides document id (public link or Drive), never the full URL. */
  sourceRef: string | null;
  /** Reads the file through the Drive API with a one-off token held in Redis. */
  viaDrive: boolean;
  /** Name for the new deck when the request gave one. */
  title: string | null;
  /** Reserved up front so a retry after a crash reuses the same deck instead of creating a second one. */
  resultPresentationId: Types.ObjectId | null;
  warnings: IImportWarning[];
  error: IImportError | null;
  /** Human-readable stage while running. */
  stage: string | null;
  /** Times a worker claimed this job. */
  attempts: number;
  /** The worker holding the lease (`<host>:<pid>:<n>`). */
  leaseOwner: string | null;
  /** Last sign of life from the worker; used by the reaper next to the Redis lease. */
  heartbeatAt: Date | null;
  queuedAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const warningSchema = new Schema<IImportWarning>(
  {
    code: { type: String, required: true, maxlength: 60 },
    message: { type: String, required: true, maxlength: 500 },
    slide: { type: Number, default: null },
  },
  { _id: false },
);

const errorSchema = new Schema<IImportError>(
  {
    code: { type: String, required: true, maxlength: 60 },
    message: { type: String, required: true, maxlength: 500 },
  },
  { _id: false },
);

const importJobSchema = new Schema<IImportJob>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: IMPORT_KINDS, required: true },
    status: { type: String, enum: IMPORT_STATUSES, default: 'queued' },
    sourceKey: { type: String, default: null, maxlength: 512 },
    sourceRef: { type: String, default: null, maxlength: 128 },
    viaDrive: { type: Boolean, default: false },
    title: { type: String, default: null, maxlength: 120 },
    resultPresentationId: { type: Schema.Types.ObjectId, ref: 'Presentation', default: null },
    warnings: { type: [warningSchema], default: [] },
    error: { type: errorSchema, default: null },
    stage: { type: String, default: null, maxlength: 60 },
    attempts: { type: Number, default: 0 },
    leaseOwner: { type: String, default: null },
    heartbeatAt: { type: Date, default: null },
    queuedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true, autoIndex: !env.isProduction },
);

importJobSchema.index({ workspaceId: 1, createdAt: -1 });
importJobSchema.index({ userId: 1, createdAt: -1 });
// The reaper looks for unfinished jobs that went quiet.
importJobSchema.index({ status: 1, heartbeatAt: 1, queuedAt: 1 });

export const ImportJobModel = mongoose.model<IImportJob>('ImportJob', importJobSchema);
