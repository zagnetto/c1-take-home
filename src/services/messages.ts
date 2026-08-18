import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { pool } from '../db/mysql.ts';
import { mongo } from '../db/mongo.ts';

const pbkdf2Async = promisify(crypto.pbkdf2);

export interface NewMessage {
  conversationId: number;
  senderId: number;
  body: string;
  clientId: string | null;
}

export async function computeMessageSignature(body: string): Promise<string> {
  const digest = await pbkdf2Async(body, 'relay-signing', 200000, 32, 'sha256');
  return digest.toString('hex');
}

export async function createMessage(input: NewMessage) {
  const { conversationId, senderId, body, clientId } = input;

  const signature = await computeMessageSignature(body);

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
