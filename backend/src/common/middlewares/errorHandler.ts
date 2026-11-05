import type { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/ApiError';
import { notifyError } from '../observability/alerts';

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction): void => {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(err.details ? { details: err.details } : {}),
    });
    return;
  }

  // body-parser: payload over the route's JSON/raw limit, or unparseable JSON
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ success: false, message: 'Request body too large' });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ success: false, message: 'Malformed JSON body' });
    return;
  }

  // Mongoose invalid ObjectId etc. — client error, not a server fault
  if (err?.name === 'CastError') {
    res.status(400).json({ success: false, message: 'Invalid id format' });
    return;
  }

  console.error(`[Unhandled Error]`, err);
  // The route pattern, never the raw URL: paths carry tokens (reset links, share links) and ids.
  const route = req.route?.path ? `${req.baseUrl ?? ''}${req.route.path}` : 'unmatched';
  void notifyError('http', err, { method: req.method, route, status: 500 });
  res.status(500).json({
    success: false, 
    message: 'Internal Server Error' 
  });
};