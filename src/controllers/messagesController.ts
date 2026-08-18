import type { Request, Response } from 'express';
import { createMessage, IdempotencyConflictError, listMessages } from '../services/messages.ts';
import { broadcast } from '../ws/hub.ts';
import { MAX_MESSAGE_BODY_LENGTH } from '../constants/messages.ts';
import { parseLimit } from '../helpers/pagination.ts';
import {
  parseClientId,
  parsePositiveInt,
  sanitizeMessageBody,
} from '../helpers/validation/messageInput.ts';

export async function create(req: Request, res: Response) {
  const conversationId = parsePositiveInt(req.body?.conversationId);
  if (conversationId == null) {
    return res.status(400).json({ error: 'conversationId must be a positive integer' });
  }

  const rawBody = req.body?.body;
  const body = sanitizeMessageBody(rawBody);
  if (body == null) {
    if (typeof rawBody === 'string' && rawBody.trim().length > MAX_MESSAGE_BODY_LENGTH) {
      return res.status(400).json({
        error: `body must be at most ${MAX_MESSAGE_BODY_LENGTH} characters`,
      });
    }
    return res.status(400).json({ error: 'body is required and must be non-empty text' });
  }

  const clientIdParsed = parseClientId(req.body?.clientId);
  if (clientIdParsed === 'invalid') {
    return res.status(400).json({ error: 'clientId must be a string up to 64 characters' });
  }

  try {
    const { message: msg, isNew } = await createMessage({
      conversationId,
      senderId: req.sessionUser!.userId,
      body,
      clientId: clientIdParsed,
    });

    if (isNew) void broadcast(msg.conversationId, { type: 'message', ...msg });
    res.status(isNew ? 201 : 200).json(msg);
  } catch (err) {
    if (err instanceof IdempotencyConflictError) {
      return res.status(409).json({ error: err.message });
    }
    throw err;
  }
}

export async function list(req: Request, res: Response) {
  const conversationId = Number(req.query.conversationId);
  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    return res.status(400).json({ error: 'conversationId must be a positive integer' });
  }

  const limit = parseLimit(req.query.limit);
  if (limit == null) {
    return res.status(400).json({ error: 'limit must be a positive integer' });
  }

  const beforeRaw = req.query.before;
  const before =
    beforeRaw == null || beforeRaw === '' ? null : Number(beforeRaw);
  if (before != null && (!Number.isInteger(before) || before <= 0)) {
    return res.status(400).json({ error: 'before must be a positive integer' });
  }

  res.json(await listMessages({ conversationId, limit, before }));
}
