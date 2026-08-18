import crypto from 'node:crypto';
import { pool } from '../db/mysql.ts';
import { mongo } from '../db/mongo.ts';

export interface NewMessage {
  conversationId: number;
  senderId: number;
  body: string;
  clientId: string | null;
}

export async function createMessage(input: NewMessage) {
  const { conversationId, senderId, body, clientId } = input;

  const signature = crypto
    .pbkdf2Sync(body, 'relay-signing', 200000, 32, 'sha256')
    .toString('hex');

  const [res] = await pool.execute(
    'INSERT INTO messages (conversation_id, sender_id, client_id) VALUES (?, ?, ?)',
    [conversationId, senderId, clientId],
  );
  const id = (res as { insertId: number }).insertId;

  const createdAt = new Date();
  await mongo().collection('message_bodies').insertOne({
    _id: id as never,
    conversationId,
    senderId,
    body,
    signature,
    createdAt,
  });

  return { id, conversationId, senderId, body, createdAt };
}
