import type { NextFunction, Response } from 'express';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { sessionCookieOptions } from '../auth/auth.controller';
import type { AuthRequest } from '../auth/auth.middleware';
import type { ReauthInput } from './privacy.schema';
import { PrivacyService } from './privacy.service';

type Handler = (req: AuthRequest, res: Response) => Promise<unknown>;

const handle = (fn: Handler) => async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await fn(req, res);
  } catch (error) {
    next(error);
  }
};

export const PrivacyController = {
  status: handle(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    ApiResponse.ok(res, 'Privacy settings fetched', await PrivacyService.status(req));
  }),

  /** The archive itself, never JSON: the browser saves it as a file. */
  export: handle(async (req, res) => {
    const { job, archive } = await PrivacyService.export(req);
    const day = job.createdAt.toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="openpoll-data-${day}.zip"`);
    res.setHeader('Content-Length', String(archive.bytes.byteLength));
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).end(Buffer.from(archive.bytes));
  }),

  reauth: handle(async (req, res) => {
    const { password } = req.body as ReauthInput;
    ApiResponse.ok(res, 'Confirmed', await PrivacyService.reauth(req, password));
  }),

  remove: handle(async (req, res) => {
    const result = await PrivacyService.requestDeletion(req);
    res.clearCookie('refreshToken', sessionCookieOptions);
    ApiResponse.ok(res, 'Your account will be deleted', result);
  }),
};
