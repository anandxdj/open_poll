import type { Request } from 'express';
import { ApiError } from '../../../common/utils/ApiError';
import type { AuthRequest } from '../../auth/auth.middleware';

export const requireUser = (req: AuthRequest) => {
  if (!req.user) throw ApiError.unauthorized('Not authenticated');
  return req.user;
};

export const requireParam = (req: Request, name: string) => {
  const value = req.params[name];
  if (!value) throw ApiError.badRequest(`${name} is required`);
  return String(value);
};
