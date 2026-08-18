import { pool } from '../db/mysql.ts';

export type ConversationListItem = {
  id: number;
  title: string;
  messageCount: number;
  lastMessage: {
    id: number;
    senderId: number;
    createdAt: unknown;
  } | null;
};

type ConversationRow = {
  id: number;
  title: string;
  messageCount: number | string;
  lastMessageId: number | null;
  lastSenderId: number | null;
  lastCreatedAt: unknown;
};

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

export async function findConversationIdByTitle(title: string): Promise<number | null> {
  const [rows] = await pool.query<Array<{ id: number }>>(
    'SELECT id FROM conversations WHERE title = ? LIMIT 1',
    [title],
  );
  return rows[0]?.id ?? null;
}

export async function listConversations(userId: number): Promise<ConversationListItem[]> {
  const [rows] = await pool.query<ConversationRow[]>(LIST_CONVERSATIONS_SQL, [userId, userId]);

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    messageCount: Number(r.messageCount),
    lastMessage: r.lastMessageId
      ? {
          id: r.lastMessageId,
          senderId: r.lastSenderId!,
          createdAt: r.lastCreatedAt,
        }
      : null,
  }));
}

export async function createConversation(
  title: string,
  participantIds: number[],
): Promise<{ id: number; title: string; participantIds: number[] }> {
  const [created] = await pool.execute('INSERT INTO conversations (title) VALUES (?)', [title]);
  const id = (created as { insertId: number }).insertId;
  for (const uid of participantIds) {
    await pool.execute(
      'INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)',
      [id, uid],
    );
  }

  return { id, title, participantIds };
}
