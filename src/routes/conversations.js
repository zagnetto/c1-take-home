import express from 'express';
import { pool } from '../db/mysql.ts';
import { requireSession, sessionOrQueryUserId } from '../middleware/session.ts';
import { asyncHandler } from '../middleware/errorHandler.ts';

export const conversationsRouter = express.Router();

conversationsRouter.get('/', sessionOrQueryUserId, asyncHandler(async (req, res) => {
  const userId = req.sessionUser.userId;

  const [rows] = await pool.query(
    `SELECT c.id,
            c.title,
            COALESCE(stats.message_count, 0) AS messageCount,
            m.id AS lastMessageId,
            m.sender_id AS lastSenderId,
            m.created_at AS lastCreatedAt
     FROM conversations c
     JOIN conversation_participants p ON p.conversation_id = c.id
     LEFT JOIN (
       SELECT conversation_id, COUNT(*) AS message_count, MAX(id) AS last_id
       FROM messages
       GROUP BY conversation_id
     ) stats ON stats.conversation_id = c.id
     LEFT JOIN messages m ON m.id = stats.last_id
     WHERE p.user_id = ?
     ORDER BY c.id ASC`,
    [userId],
  );

  const result = rows.map((r) => ({
    id: r.id,
    title: r.title,
    messageCount: Number(r.messageCount),
    lastMessage: r.lastMessageId
      ? {
          id: r.lastMessageId,
          senderId: r.lastSenderId,
          createdAt: r.lastCreatedAt,
        }
      : null,
  }));

  res.json(result);
}));

conversationsRouter.post('/', requireSession, asyncHandler(async (req, res) => {
  const { title, participantIds } = req.body || {};
  if (!title || !Array.isArray(participantIds) || participantIds.length === 0) {
    return res.status(400).json({ error: 'title and a non-empty participantIds[] are required' });
  }

  const selfId = req.sessionUser.userId;
  const ids = [...new Set([selfId, ...participantIds.map(Number)])];

  const [created] = await pool.execute('INSERT INTO conversations (title) VALUES (?)', [title]);
  const id = created.insertId;
  for (const uid of ids) {
    await pool.execute(
      'INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)',
      [id, uid],
    );
  }

  res.status(201).json({ id, title, participantIds: ids });
}));
