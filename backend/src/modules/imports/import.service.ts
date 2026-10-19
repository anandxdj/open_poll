import { Types } from 'mongoose';
import { env } from '../../common/config/env';
import { consumeUsage } from '../../common/plans/usage';
import { storage, storageDisabledError } from '../../common/storage/storage';
import { assertCan, type PolicyContext } from '../../common/tenancy/policy';
import { ApiError } from '../../common/utils/ApiError';
import { authorizeDeck } from '../presentations/access';
import { createPresentation } from '../presentations/crud.service';
import type { CreatePresentationInput } from '../presentations/presentations.schema';
import { MediaAssetModel } from '../uploads/media.model';
import type { IWorkspace } from '../workspaces/workspace.model';
import { WorkspaceMemberModel } from '../workspaces/workspaceMember.model';
import { ImportError, type ImportWarning } from './errors';
import { isDriveFileId, parseSlidesLink, PPTX_MIME } from './gslides';
import { ImportJobModel, type IImportJob, type ImportKind } from './import.model';
import type { CreateImportInput } from './import.schema';
import { IMPORT_LIMITS } from './limits';
import { parseQuestionFile, type QuestionRowError } from './questions';
import { enqueueImport, storeDriveToken } from './queue';
import { clip, oneLine } from './text';

/** The caller after authenticate() + workspaceContext(). */
export type ImportContext = PolicyContext & { user: { id: string }; workspace: IWorkspace };

export interface ImportJobView {
  id: string;
  kind: ImportKind;
  status: IImportJob['status'];
  stage: string | null;
  title: string | null;
  warnings: ImportWarning[];
  error: { code: string; message: string } | null;
  resultPresentationId: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export const toJobView = (job: IImportJob): ImportJobView => ({
  id: String(job._id),
  kind: job.kind,
  status: job.status,
  stage: job.status === 'running' ? job.stage : null,
  title: job.title,
  warnings: (job.warnings ?? []).map((w) => ({ code: w.code, message: w.message, slide: w.slide ?? null })),
  error: job.error ? { code: job.error.code, message: job.error.message } : null,
  resultPresentationId: job.resultPresentationId ? String(job.resultPresentationId) : null,
  createdAt: job.createdAt,
  startedAt: job.startedAt,
  finishedAt: job.finishedAt,
});

/** An ImportError raised while validating a request is the caller's mistake: 400 with the same code. */
const asBadRequest = (error: unknown): never => {
  if (error instanceof ImportError) throw new ApiError(400, error.message, error.code);
  throw error;
};

const SOURCE_MIME = { pptx: PPTX_MIME, pdf: 'application/pdf' } as const;

export class ImportsService {
  /**
   * Validates the source, takes one import from the plan's monthly quota and
   * queues the job. Repeating the request for a source that is still queued
   * or running returns that job instead of starting (and counting) another.
   */
  static async create(ctx: ImportContext, input: CreateImportInput): Promise<ImportJobView> {
    assertCan(ctx, 'deck:create');
    const workspaceId = String(ctx.workspace._id);
    const userId = ctx.user.id;
    const base = { workspaceId, userId, kind: input.kind, title: input.title ?? null };

    let sourceKey: string | null = null;
    let sourceRef: string | null = null;
    let viaDrive = false;
    let driveToken: string | null = null;

    if (input.kind === 'pptx' || input.kind === 'pdf') {
      if (!storage.enabled) throw storageDisabledError();
      const asset = await MediaAssetModel.findOne({ key: input.key, workspaceId, purpose: 'import_source' }).lean();
      if (!asset) throw new ApiError(404, 'Upload not found. Upload the file again.', 'UPLOAD_NOT_FOUND');
      if (asset.mime !== SOURCE_MIME[input.kind]) {
        throw new ApiError(
          400,
          input.kind === 'pdf' ? 'This upload is not a PDF.' : 'This upload is not a PowerPoint (.pptx) file.',
          'IMPORT_KIND_MISMATCH',
        );
      }
      sourceKey = input.key;
    } else if (input.driveFileId !== undefined) {
      if (!env.googleDriveImport) {
        throw new ApiError(503, 'Importing from Google Drive is not configured on this server', 'GOOGLE_DRIVE_DISABLED');
      }
      if (!isDriveFileId(input.driveFileId)) throw new ApiError(400, 'This is not a valid Google Drive file id', 'INVALID_LINK');
      sourceRef = input.driveFileId;
      viaDrive = true;
      driveToken = input.driveAccessToken!;
    } else {
      try {
        sourceRef = parseSlidesLink(input.url!);
      } catch (error) {
        asBadRequest(error);
      }
    }

    const running = await ImportJobModel.findOne({
      userId,
      workspaceId,
      status: { $in: ['queued', 'running'] },
      ...(sourceKey ? { sourceKey } : { sourceRef }),
    });
    if (running) return toJobView(running);

    await consumeUsage(ctx.workspace, 'import');

    const job = await ImportJobModel.create({
      ...base,
      sourceKey,
      sourceRef,
      viaDrive,
      status: 'queued',
      queuedAt: new Date(),
    });
    try {
      if (driveToken) await storeDriveToken(String(job._id), driveToken);
      await enqueueImport(String(job._id));
    } catch (error) {
      console.error('[Imports] Could not queue the job:', (error as Error)?.message);
      await ImportJobModel.updateOne(
        { _id: job._id },
        { $set: { status: 'failed', finishedAt: new Date(), error: { code: 'QUEUE_UNAVAILABLE', message: 'The import queue is unavailable right now. Try again in a moment.' } } },
      );
      throw new ApiError(503, 'The import queue is unavailable right now. Try again in a moment.', 'QUEUE_UNAVAILABLE');
    }
    return toJobView(job);
  }

  /** A job as its creator sees it; anyone else (or someone who left the workspace) gets 404. */
  static async get(userId: string, jobId: string): Promise<ImportJobView> {
    const job = Types.ObjectId.isValid(jobId) ? await ImportJobModel.findById(jobId) : null;
    if (!job || String(job.userId) !== userId) throw ApiError.notFound('Import not found');
    const member = await WorkspaceMemberModel.exists({ workspaceId: job.workspaceId, userId, status: 'active' });
    if (!member) throw ApiError.notFound('Import not found');
    return toJobView(job);
  }

  /**
   * CSV/XLSX questions → slides, synchronously. `preview` only parses; `import`
   * appends the valid rows to `presentationId` or creates a new deck, and
   * records a completed ImportJob.
   */
  static async importQuestions(
    ctx: ImportContext,
    params: { mode: 'preview' | 'import'; file: { name: string; bytes: Uint8Array }; presentationId?: string; title?: string },
  ) {
    const workspaceId = String(ctx.workspace._id);
    const userId = ctx.user.id;

    let deck = null;
    let capacity: number = IMPORT_LIMITS.maxSlides;
    if (params.presentationId) {
      deck = await authorizeDeck(params.presentationId, ctx, 'deck:edit');
      if (deck.status !== 'draft' && deck.status !== 'ended') {
        throw ApiError.badRequest('Cannot edit a presentation deck while a live session is running');
      }
      capacity = Math.max(0, IMPORT_LIMITS.maxSlides - deck.slides.length);
    } else {
      assertCan(ctx, 'deck:create');
    }

    let parsed;
    try {
      parsed = await parseQuestionFile(params.file.bytes, { capacity });
    } catch (error) {
      return asBadRequest(error);
    }
    const warnings = parsed.warnings.map((w) => ({ code: w.code, message: w.message, slide: null }));
    const summary = {
      fileKind: parsed.kind,
      totalRows: parsed.totalRows,
      imported: parsed.questions.length,
      skipped: parsed.errors.length,
      errors: parsed.errors as QuestionRowError[],
      warnings,
      capacity,
      questions: parsed.questions.map(({ row, type, question, detail }) => ({ row, type, question, detail })),
    };
    // The builder adds previewed slides to the deck it has open, so a preview carries them.
    if (params.mode === 'preview') return { mode: 'preview' as const, ...summary, slides: parsed.questions.map((q) => q.slide) };

    if (parsed.questions.length === 0) {
      throw new ApiError(400, 'No valid questions were found in this file', 'NO_VALID_QUESTIONS', { errors: parsed.errors });
    }
    await consumeUsage(ctx.workspace, 'import');

    const slides = parsed.questions.map((q) => q.slide);
    let presentationId: string;
    let slideCount: number;
    if (deck) {
      deck.slides.push(...(slides as never[]));
      await deck.save();
      presentationId = String(deck._id);
      slideCount = deck.slides.length;
    } else {
      const fromFile = clip(oneLine(params.file.name.replace(/\.[A-Za-z0-9]{1,5}$/, '')), 120);
      const title = params.title ?? (fromFile || 'Imported questions');
      const created = await createPresentation({ title, slides } as unknown as CreatePresentationInput, ctx);
      presentationId = String(created._id);
      slideCount = created.slides.length;
    }

    const job = await ImportJobModel.create({
      workspaceId,
      userId,
      kind: parsed.kind,
      status: 'completed',
      title: params.title ?? null,
      resultPresentationId: presentationId,
      warnings: warnings.map((w) => ({ ...w, slide: null })),
      queuedAt: new Date(),
      startedAt: new Date(),
      finishedAt: new Date(),
    });
    return {
      mode: 'import' as const,
      ...summary,
      importId: String(job._id),
      presentationId,
      created: !deck,
      slideCount,
    };
  }
}
