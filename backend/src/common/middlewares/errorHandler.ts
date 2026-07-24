import type { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/ApiError';

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction): void => {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({ success: false, message: err.message });
    return;
  }

  // Mongoose invalid ObjectId etc. — client error, not a server fault
  if (err?.name === 'CastError') {
    res.status(400).json({ success: false, message: 'Invalid id format' });
    return;
  }

  console.error(`[Unhandled Error]`, err);
  res.status(500).json({ 
    success: false, 
    message: 'Internal Server Error' 
  });
};