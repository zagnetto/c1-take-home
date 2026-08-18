import type { NextFunction, Request, Response } from 'express';
import { INFRA_ERROR_CODES, INFRA_ERROR_NAMES } from '../constants/errors.ts';

type AsyncRouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void | Promise<void>;

/** Express 4 does not catch rejected promises in async handlers — forward them to error middleware. */
export function asyncHandler(fn: AsyncRouteHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function isMalformedJsonBody(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: number; type?: string };
  return e.status === 400 && e.type === 'entity.parse.failed';
}

export function isInfrastructureError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; name?: string };
  if (e.code && INFRA_ERROR_CODES.has(e.code)) return true;
  if (e.name && INFRA_ERROR_NAMES.has(e.name)) return true;
  return false;
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  const prefix = `[${req.method} ${req.originalUrl}]`;

  if (isMalformedJsonBody(err)) {
    console.warn(prefix, err);
    res.status(400).json({ error: 'invalid JSON body' });
    return;
  }

  if (isInfrastructureError(err)) {
    console.error(prefix, err);
    res.status(503).json({ error: 'service temporarily unavailable' });
    return;
  }

  console.error(prefix, err);
  res.status(500).json({ error: 'internal server error' });
}
