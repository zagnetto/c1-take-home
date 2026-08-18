import express from 'express';
import { pool } from '../db/mysql.ts';
import { requireSession } from '../middleware/session.ts';
import { asyncHandler } from '../middleware/errorHandler.ts';
import { MAX_CONVERSATION_TITLE_LENGTH } from '../constants/conversations.ts';
import { isDuplicateTitleError } from '../helpers/mysqlErrors.ts';
import { parsePositiveInt, sanitizeConversationTitle } from '../helpers/validation/messageInput.ts';

export const conversationsRouter = express.Router();

async function findConversationIdByTitle(title: string): Promise<number | null> {
  const [rows] = await pool.query<Array<{ id: number }>>(
    'SELECT id FROM conversations WHERE title = ? LIMIT 1',
    [title],
  );
  return rows[0]?.id ?? null;
}

/** Scoped to the requesting user's conversations — see spec/conversation-list-scaling.md */
export const LIST_CONVERSATIONS_SQL = `
  SELECT c.id,
         c.title,
         COALESCE(stats.message_count, 0) AS messageCount,
         m.id AS lastMessageId,
         m.sender_id AS lastSenderId,
         m.created_at AS lastCreatedAt
  FROM conversations c
  JOIN conversation_participants p ON p.conversation_id = c.id
  LEFT JOIN (
    SELECT m.conversation_id,
           COUNT(*) AS message_count,
           MAX(m.id) AS last_id
    FROM messages m
    INNER JOIN conversation_participants cp
      ON cp.conversation_id = m.conversation_id AND cp.user_id = ?
    GROUP BY m.conversation_id
  ) stats ON stats.conversation_id = c.id
  LEFT JOIN messages m ON m.id = stats.last_id
  WHERE p.user_id = ?
  ORDER BY c.id ASC`;

conversationsRouter.get('/', requireSession, asyncHandler(async (req, res) => {
  const userId = req.sessionUser.userId;

  const [rows] = await pool.query(LIST_CONVERSATIONS_SQL, [userId, userId]);

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
  const { participantIds } = req.body || {};
  const rawTitle = req.body?.title;
  const title = sanitizeConversationTitle(rawTitle);

  if (title == null) {
    if (typeof rawTitle === 'string' && rawTitle.trim().length > MAX_CONVERSATION_TITLE_LENGTH) {
      return res.status(400).json({
        error: `title must be at most ${MAX_CONVERSATION_TITLE_LENGTH} characters`,
      });
    }
    return res.status(400).json({ error: 'title is required and must be non-empty text' });
  }

  if (!Array.isArray(participantIds) || participantIds.length === 0) {
    return res.status(400).json({ error: 'a non-empty participantIds[] is required' });
  }

  const selfId = req.sessionUser.userId;
  const parsedIds = participantIds.map(parsePositiveInt);
  if (parsedIds.some((id) => id == null)) {
    return res.status(400).json({ error: 'participantIds must contain positive integers only' });
  }

  const ids = [...new Set([selfId, ...parsedIds])];

  if (await findConversationIdByTitle(title)) {
    return res.status(409).json({ error: 'a conversation with this title already exists' });
  }

  try {
    const [created] = await pool.execute('INSERT INTO conversations (title) VALUES (?)', [title]);
    const id = created.insertId;
    for (const uid of ids) {
      await pool.execute(
        'INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)',
        [id, uid],
      );
    }

    res.status(201).json({ id, title, participantIds: ids });
  } catch (err) {
    if (isDuplicateTitleError(err)) {
      return res.status(409).json({ error: 'a conversation with this title already exists' });
    }
    throw err;
  }
}));
