import type { NextFunction, Request, Response } from 'express';
import { audit } from '../../common/audit/audit';
import type { AuthRequest } from '../auth/auth.middleware';
import type { WorkspaceRequest } from '../../common/tenancy/workspaceContext.middleware';
import { ApiError } from '../../common/utils/ApiError';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { importIdSchema, questionsFieldsSchema } from './import.schema';
import { ImportsService, type ImportContext } from './import.service';
import { IMPORT_LIMITS } from './limits';
import { readMultipart } from './multipart';
import { questionsTemplateCsv, questionsTemplateXlsx } from './questions';

const importContext = (req: WorkspaceRequest): ImportContext => {
  if (!req.user) throw ApiError.unauthorized('Not authenticated');
  if (!req.workspace) throw ApiError.internal('Imports need workspaceContext() mounted before them');
  return { user: req.user, workspace: req.workspace, membership: req.membership };
};

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export class ImportsController {
  static async create(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      const job = await ImportsService.create(importContext(req), req.body);
      void audit(req, 'import.create', { type: 'import', id: job.id }, { kind: job.kind });
      return res.status(202).json({ success: true, message: 'Import queued', data: job });
    } catch (error) {
      next(error);
    }
  }

  static async get(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const id = importIdSchema.safeParse(req.params.id);
      if (!id.success) throw ApiError.notFound('Import not found');
      const job = await ImportsService.get(req.user!.id, id.data);
      return ApiResponse.ok(res, 'Import fetched successfully', job);
    } catch (error) {
      next(error);
    }
  }

  static async questions(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      const ctx = importContext(req);
      const form = await readMultipart(req, { maxFileBytes: IMPORT_LIMITS.questions.maxBytes });
      if (!form.file) throw ApiError.badRequest('Attach a CSV or XLSX file in the "file" field');
      const fields = questionsFieldsSchema.safeParse(
        Object.fromEntries(Object.entries(form.fields).filter(([, value]) => value.trim() !== '')),
      );
      if (!fields.success) {
        throw ApiError.badRequest(fields.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      }
      const result = await ImportsService.importQuestions(ctx, { ...fields.data, file: form.file });
      if (result.mode === 'import') {
        void audit(req, 'import.questions', { type: 'presentation', id: result.presentationId }, { imported: result.imported, skipped: result.skipped, created: result.created });
        return ApiResponse.created(res, 'Questions imported', result);
      }
      return ApiResponse.ok(res, 'Questions checked', result);
    } catch (error) {
      next(error);
    }
  }

  static async template(req: Request, res: Response, next: NextFunction) {
    try {
      const format = req.params.format;
      if (format !== 'csv' && format !== 'xlsx') throw ApiError.notFound('Template not found');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      if (format === 'xlsx') {
        const bytes = await questionsTemplateXlsx();
        res.setHeader('Content-Type', XLSX_TYPE);
        res.setHeader('Content-Disposition', 'attachment; filename="openpoll-questions-template.xlsx"');
        return res.send(Buffer.from(bytes));
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="openpoll-questions-template.csv"');
      return res.send(questionsTemplateCsv());
    } catch (error) {
      next(error);
    }
  }
}
