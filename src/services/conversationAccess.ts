import { pool } from '../db/mysql.ts';

export class ConversationNotFoundError extends Error {
  constructor() {
    super('conversation not found');
    this.name = 'ConversationNotFoundError';
  }
}

export async function isConversationMember(
  userId: number,
  conversationId: number,
): Promise<boolean> {
  const [rows] = await pool.query(
    `SELECT 1
     FROM conversations c
     JOIN conversation_participants p ON p.conversation_id = c.id AND p.user_id = ?
     WHERE c.id = ?
     LIMIT 1`,
    [userId, conversationId],
  );
  return (rows as unknown[]).length > 0;
}

export async function assertConversationAccess(
  userId: number,
  conversationId: number,
): Promise<void> {
  if (!(await isConversationMember(userId, conversationId))) {
    throw new ConversationNotFoundError();
  }
}

export async function listUserConversationIds(userId: number): Promise<number[]> {
  const [rows] = await pool.query(
    `SELECT p.conversation_id AS conversationId
     FROM conversation_participants p
     JOIN conversations c ON c.id = p.conversation_id
     WHERE p.user_id = ?
     ORDER BY p.conversation_id ASC`,
    [userId],
  );
  return (rows as { conversationId: number }[]).map((r) => r.conversationId);
}

export async function filterMemberConversationIds(
  userId: number,
  conversationIds: number[],
): Promise<number[]> {
  const unique = [...new Set(conversationIds.filter(Number.isFinite))];
  if (unique.length === 0) return [];

  const placeholders = unique.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `SELECT p.conversation_id AS conversationId
     FROM conversation_participants p
     JOIN conversations c ON c.id = p.conversation_id
     WHERE p.user_id = ? AND p.conversation_id IN (${placeholders})`,
    [userId, ...unique],
  );

  const allowed = new Set((rows as { conversationId: number }[]).map((r) => r.conversationId));
  return unique.filter((id) => allowed.has(id));
}
