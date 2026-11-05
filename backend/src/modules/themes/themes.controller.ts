import type { NextFunction, Response } from 'express';
import type { AuthRequest } from '../auth/auth.middleware';
import type { WorkspaceRequest } from '../../common/tenancy/workspaceContext.middleware';
import { ApiResponse } from '../../common/utils/ApiResponse';
import type { CreateBrandKitInput, UpdateBrandKitInput } from './themes.schema';
import { BrandKitService, fontChoices, presetViews } from './themes.service';

type Ctx = Parameters<typeof BrandKitService.list>[0];

const handle =
  <R extends AuthRequest>(fn: (req: R, res: Response) => Promise<unknown>) =>
  async (req: R, res: Response, next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (error) {
      next(error);
    }
  };

const idOf = (req: WorkspaceRequest) => String(req.params.id ?? '');

export const ThemesController = {
  /** Static catalogue: the built-in themes and the fonts a brand kit may use. */
  presets: handle(async (_req, res) => {
    res.setHeader('Cache-Control', 'private, max-age=300');
    ApiResponse.ok(res, 'Themes fetched', { presets: presetViews(), fonts: fontChoices() });
  }),
};

// workspaceContext() ran first on every brand kit route, so user and workspace are present.
export const BrandKitsController = {
  list: handle<WorkspaceRequest>(async (req, res) => {
    ApiResponse.ok(res, 'Brand kits fetched', await BrandKitService.list(req as Ctx));
  }),
  get: handle<WorkspaceRequest>(async (req, res) => {
    ApiResponse.ok(res, 'Brand kit fetched', await BrandKitService.get(req as Ctx, idOf(req)));
  }),
  create: handle<WorkspaceRequest>(async (req, res) => {
    ApiResponse.created(res, 'Brand kit created', await BrandKitService.create(req as Ctx, req.body as CreateBrandKitInput));
  }),
  update: handle<WorkspaceRequest>(async (req, res) => {
    ApiResponse.ok(res, 'Brand kit saved', await BrandKitService.update(req as Ctx, idOf(req), req.body as UpdateBrandKitInput));
  }),
  remove: handle<WorkspaceRequest>(async (req, res) => {
    ApiResponse.ok(res, 'Brand kit deleted', await BrandKitService.remove(req as Ctx, idOf(req)));
  }),
};
