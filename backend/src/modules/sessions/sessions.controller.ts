import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import { audit } from '../../common/audit/audit';
import { ApiError } from '../../common/utils/ApiError';
import { ApiResponse } from '../../common/utils/ApiResponse';
import type { WorkspaceRequest } from '../../common/tenancy/workspaceContext.middleware';
import { streamSessionExport, type ExportFormat } from './export';
import { authorizeSession } from './sessions.access';
import { listSessionsQuerySchema, takeHomeQuerySchema } from './sessions.schema';
import { deleteSession, eraseParticipant, getReport, getTakeHome, listSessions } from './sessions.service';
import { disableShare, enableShare, getPublicResults } from './share.service';

const parseQuery = <T>(schema: ZodType<T>, query: unknown): T => {
  try {
    return schema.parse(query);
  } catch (error) {
    if (error instanceof ZodError) {
      throw ApiError.badRequest(error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '));
    }
    throw error;
  }
};

const sessionIdOf = (req: Request) => String(req.params.sessionId ?? '');

type Handler = (req: WorkspaceRequest, res: Response) => Promise<unknown>;

const handle = (fn: Handler) => async (req: WorkspaceRequest, res: Response, next: NextFunction) => {
  try {
    await fn(req, res);
  } catch (error) {
    next(error);
  }
};

const exportHandler = (format: ExportFormat) =>
  handle(async (req, res) => {
    const found = await authorizeSession(sessionIdOf(req), req, 'session:export');
    void audit(req, 'session.export', { type: 'session', id: found.session._id }, {
      format,
      presentationId: String(found.session.presentationId),
    });
    await streamSessionExport(res, format, found);
  });

export const SessionsController = {
  list: handle(async (req, res) => {
    const query = parseQuery(listSessionsQuerySchema, req.query);
    ApiResponse.ok(res, 'Sessions fetched', await listSessions(req, query));
  }),

  report: handle(async (req, res) => {
    ApiResponse.ok(res, 'Session report fetched', await getReport(sessionIdOf(req), req));
  }),

  exportCsv: exportHandler('csv'),
  exportXlsx: exportHandler('xlsx'),
  exportPdf: exportHandler('pdf'),

  share: handle(async (req, res) => {
    ApiResponse.ok(res, 'Results link enabled', await enableShare(sessionIdOf(req), req, req.body ?? {}));
  }),

  unshare: handle(async (req, res) => {
    ApiResponse.ok(res, 'Results link disabled', await disableShare(sessionIdOf(req), req));
  }),

  remove: handle(async (req, res) => {
    ApiResponse.ok(res, 'Session deleted', await deleteSession(sessionIdOf(req), req));
  }),

  takeHome: handle(async (req, res) => {
    const { participantId, token } = parseQuery(takeHomeQuerySchema, req.query);
    res.setHeader('Cache-Control', 'no-store');
    ApiResponse.ok(res, 'Your results', await getTakeHome(sessionIdOf(req), participantId, token));
  }),

  /** Body validated by eraseParticipantSchema on the route. */
  eraseParticipant: handle(async (req, res) => {
    const { participantId, token } = req.body as { participantId: string; token: string };
    res.setHeader('Cache-Control', 'no-store');
    ApiResponse.ok(res, 'Your answers were removed', await eraseParticipant(sessionIdOf(req), participantId, token));
  }),

  publicResults: handle(async (req, res) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    ApiResponse.ok(res, 'Results fetched', await getPublicResults(String(req.params.token ?? '')));
  }),
};
