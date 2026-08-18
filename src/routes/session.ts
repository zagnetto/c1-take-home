import express from 'express';
import { setSessionCookie, parseCookies } from '../middleware/session.ts';
import { config } from '../config.ts';
import { createSession, lookupSession } from '../services/session.ts';

export const sessionRouter = express.Router();

sessionRouter.post('/', async (req, res) => {
  const token = parseCookies(req.headers.cookie)[config.sessionCookieName];

  if (token) {
    const existing = await lookupSession(token);
    if (existing) {
      return res.json(existing);
    }
  }

  const created = await createSession();
  if (created === 'pool_exhausted') {
    return res.status(503).json({ error: 'no users available' });
  }

  setSessionCookie(res, created.token);
  res.status(201).json(created.user);
});
