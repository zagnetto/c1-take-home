import type { NextFunction, Request, Response } from 'express';
import {
  assertConversationAccess,
  ConversationNotFoundError,
} from '../services/conversationAccess.ts';

type ConversationIdSource = 'query' | 'body';

function parseConversationId(raw: unknown): number | null {
  const conversationId = Number(raw);
  if (!Number.isInteger(conversationId) || conversationId <= 0) return null;
  return conversationId;
}

export function requireConversationAccess(options: {
  source: ConversationIdSource;
  field?: string;
}) {
  const field = options.field ?? 'conversationId';

  return (req: Request, res: Response, next: NextFunction): void => {
    void (async () => {
      const raw =
        options.source === 'query'
          ? req.query[field]
          : (req.body as Record<string, unknown> | undefined)?.[field];

      const conversationId = parseConversationId(raw);
      if (conversationId == null) {
        res.status(400).json({ error: 'conversationId must be a positive integer' });
        return;
      }

      const userId = req.sessionUser?.userId;
      if (!userId) {
        res.status(401).json({ error: 'session required' });
        return;
      }

      try {
        await assertConversationAccess(userId, conversationId);
        next();
      } catch (err) {
        if (err instanceof ConversationNotFoundError) {
          res.status(404).json({ error: 'conversation not found' });
          return;
        }
        next(err);
      }
    })().catch(next);
  };
}
