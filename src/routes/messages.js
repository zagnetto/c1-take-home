import express from 'express';
import { createMessage } from '../services/messages.ts';
import { pool } from '../db/mysql.ts';
import { mongo } from '../db/mongo.ts';
import { broadcast } from '../ws/hub.ts';
import { requireSession } from '../middleware/session.ts';
import { asyncHandler } from '../middleware/errorHandler.ts';
import { parseLimit, buildMessagesPage } from './messagesPagination.ts';

export const messagesRouter = express.Router();

messagesRouter.post('/', requireSession, asyncHandler(async (req, res) => {
  const { conversationId, body, clientId } = req.body || {};
  const senderId = req.sessionUser.userId;
  if (!conversationId || !body) {
    return res.status(400).json({ error: 'conversationId and body are required' });
  }

  const msg = await createMessage({
    conversationId: Number(conversationId),
    senderId,
    body: String(body),
    clientId: clientId ?? null,
  });

  void broadcast(msg.conversationId, { type: 'message', ...msg });
  res.status(201).json(msg);
}));

messagesRouter.get('/', asyncHandler(async (req, res) => {
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
}));
