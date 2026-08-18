import express from 'express';
import { createMessage, IdempotencyConflictError } from '../services/messages.ts';
import { pool } from '../db/mysql.ts';
import { mongo } from '../db/mongo.ts';
import { broadcast } from '../ws/hub.ts';
import { requireConversationAccess } from '../middleware/conversationAccess.ts';
import { requireSession } from '../middleware/session.ts';
import { asyncHandler } from '../middleware/errorHandler.ts';
import { MAX_MESSAGE_BODY_LENGTH } from '../constants/messages.ts';
import { buildMessagesPage, parseLimit } from '../helpers/pagination.ts';
import {
  parseClientId,
  parsePositiveInt,
  sanitizeMessageBody,
} from '../validation/messageInput.ts';

export const messagesRouter = express.Router();

messagesRouter.post(
  '/',
  requireSession,
  requireConversationAccess({ source: 'body' }),
  asyncHandler(async (req, res) => {
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
      senderId: req.sessionUser.userId,
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
  }),
);

messagesRouter.get(
  '/',
  requireSession,
  requireConversationAccess({ source: 'query' }),
  asyncHandler(async (req, res) => {
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

  const params =
    before != null ? [conversationId, before, limit + 1] : [conversationId, limit + 1];
  const sql =
    before != null
      ? `SELECT id, conversation_id AS conversationId, sender_id AS senderId, created_at AS createdAt
         FROM messages
         WHERE conversation_id = ? AND id < ?
         ORDER BY id DESC
         LIMIT ?`
      : `SELECT id, conversation_id AS conversationId, sender_id AS senderId, created_at AS createdAt
         FROM messages
         WHERE conversation_id = ?
         ORDER BY id DESC
         LIMIT ?`;

  const [rows] = await pool.query(sql, params);
  const { messages: pageRows, hasMore, nextBefore } = buildMessagesPage(rows, limit);

  const ids = pageRows.map((r) => r.id);
  const bodies = ids.length
    ? await mongo().collection('message_bodies').find({ _id: { $in: ids } }).toArray()
    : [];
  const bodyById = new Map(bodies.map((b) => [b._id, b.body]));

  res.json({
    messages: pageRows.map((r) => ({ ...r, body: bodyById.get(r.id) ?? '' })),
    hasMore,
    nextBefore,
  });
  }),
);
