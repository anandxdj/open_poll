import type { NextFunction, Response } from 'express';
import { ApiError } from '../utils/ApiError';
import type { WorkspaceRequest } from '../tenancy/workspaceContext.middleware';
import { assertFeature } from './entitlements';
import type { Feature } from './plans';

/**
 * Route guard: 403 FEATURE_NOT_IN_PLAN unless the current workspace's plan
 * includes `feature`. Mount after authenticate() and workspaceContext().
 */
export const requireFeature = (feature: Feature) => (req: WorkspaceRequest, _res: Response, next: NextFunction) => {
  try {
    if (!req.workspace) throw ApiError.internal('requireFeature() needs workspaceContext() mounted before it');
    assertFeature(req.workspace, feature);
    next();
  } catch (error) {
    next(error);
  }
};
