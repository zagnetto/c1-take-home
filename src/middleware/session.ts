import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.ts';
import { lookupSession, type SessionUser } from '../services/session.ts';

declare global {
  namespace Express {
    interface Request {
      sessionUser?: SessionUser;
    }
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function sessionTokenFromRequest(req: Request): string | undefined {
  return parseCookies(req.headers.cookie)[config.sessionCookieName];
}

export function requireSession(req: Request, res: Response, next: NextFunction): void {
  void (async () => {
    const token = sessionTokenFromRequest(req);
    if (!token) {
      res.status(401).json({ error: 'session required' });
      return;
    }

    const user = await lookupSession(token);
    if (!user) {
      res.status(401).json({ error: 'invalid or expired session' });
      return;
    }

    req.sessionUser = user;
    next();
  })().catch(next);
}

export function setSessionCookie(res: Response, token: string): void {
  const maxAge = config.sessionTtlSeconds;
  res.setHeader(
    'Set-Cookie',
    `${config.sessionCookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`,
  );
}
