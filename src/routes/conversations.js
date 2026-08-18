import express from 'express';
import { pool } from '../db/mysql.ts';
import { requireSession, sessionOrQueryUserId } from '../middleware/session.ts';
import { asyncHandler } from '../middleware/errorHandler.ts';

export const conversationsRouter = express.Router();

conversationsRouter.get('/', sessionOrQueryUserId, asyncHandler(async (req, res) => {
  const userId = req.sessionUser.userId;

  const [conversations] = await pool.query(
    `SELECT c.id, c.title
     FROM conversations c
     JOIN conversation_participants p ON p.conversation_id = c.id
     WHERE p.user_id = ?
     ORDER BY c.id ASC`,
    [userId],
  );

  const result = [];
  for (const c of conversations) {
    const [[last]] = await pool.query(
      `SELECT id, sender_id AS senderId, created_at AS createdAt
       FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1`,
      [c.id],
    );
    const [[counted]] = await pool.query(
      'SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ?',
      [c.id],
    );
    result.push({ ...c, lastMessage: last || null, messageCount: counted.count });
  }

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
