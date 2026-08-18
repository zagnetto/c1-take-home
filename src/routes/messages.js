import express from 'express';
import { createMessage } from '../services/messages.ts';
import { pool } from '../db/mysql.ts';
import { mongo } from '../db/mongo.ts';
import { broadcast } from '../ws/hub.ts';
import { requireSession } from '../middleware/session.ts';
import { asyncHandler } from '../middleware/errorHandler.ts';

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
  if (!conversationId) return res.status(400).json({ error: 'conversationId is required' });

  const [rows] = await pool.query(
    `SELECT id, conversation_id AS conversationId, sender_id AS senderId, created_at AS createdAt
     FROM messages WHERE conversation_id = ? ORDER BY id ASC`,
    [conversationId],
  );

  const ids = rows.map((r) => r.id);
  const bodies = ids.length
    ? await mongo().collection('message_bodies').find({ _id: { $in: ids } }).toArray()
    : [];
  const bodyById = new Map(bodies.map((b) => [b._id, b.body]));

  res.json(rows.map((r) => ({ ...r, body: bodyById.get(r.id) ?? '' })));
}));
