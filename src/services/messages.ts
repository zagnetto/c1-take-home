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

export interface CreatedMessage {
  id: number;
  conversationId: number;
  senderId: number;
  body: string;
  createdAt: Date;
}

export interface CreateMessageResult {
  message: CreatedMessage;
  isNew: boolean;
}

type MessageRow = {
  id: number;
  conversationId: number;
  senderId: number;
  createdAt: Date;
};

export async function computeMessageSignature(body: string): Promise<string> {
  const digest = await pbkdf2Async(body, 'relay-signing', 200000, 32, 'sha256');
  return digest.toString('hex');
}

function isDuplicateClientIdError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'ER_DUP_ENTRY'
  );
}

function isMongoDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: number }).code === 11000;
}

async function findMessageByClientId(clientId: string): Promise<MessageRow | null> {
  const [rows] = await pool.query(
    `SELECT id, conversation_id AS conversationId, sender_id AS senderId, created_at AS createdAt
     FROM messages
     WHERE client_id = ?
     LIMIT 1`,
    [clientId],
  );
  const row = (rows as MessageRow[])[0];
  return row ?? null;
}

async function loadMessageBody(id: number): Promise<string | null> {
  const doc = await mongo().collection('message_bodies').findOne({ _id: id as never });
  return doc?.body ?? null;
}

async function ensureMessageBody(
  row: MessageRow,
  body: string,
  signature: string,
): Promise<string> {
  const existing = await loadMessageBody(row.id);
  if (existing != null) return existing;

  const createdAt = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
  try {
    await mongo().collection('message_bodies').insertOne({
      _id: row.id as never,
      conversationId: row.conversationId,
      senderId: row.senderId,
      body,
      signature,
      createdAt,
    });
  } catch (err) {
    if (!isMongoDuplicateKeyError(err)) throw err;
  }

  return (await loadMessageBody(row.id)) ?? body;
}

async function returnExistingMessage(
  clientId: string,
  body: string,
  signature: string,
): Promise<CreateMessageResult> {
  const row = await findMessageByClientId(clientId);
  if (!row) {
    throw new Error(`duplicate client_id ${clientId} but row not found`);
  }

  const storedBody = await ensureMessageBody(row, body, signature);
  const createdAt = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);

  return {
    message: {
      id: row.id,
      conversationId: row.conversationId,
      senderId: row.senderId,
      body: storedBody,
      createdAt,
    },
    isNew: false,
  };
}

async function rollbackMessageRow(id: number): Promise<void> {
  try {
    await pool.execute('DELETE FROM messages WHERE id = ?', [id]);
  } catch (rollbackErr) {
    console.error('[createMessage] failed to roll back MySQL row after Mongo write error', {
      id,
      err: rollbackErr,
    });
  }
}

export async function createMessage(input: NewMessage): Promise<CreateMessageResult> {
  const { conversationId, senderId, body, clientId } = input;

  const signature = await computeMessageSignature(body);

  // Compensating delete when Mongo fails after MySQL INSERT. A production-grade fix is a
  // transactional outbox: MySQL trigger (or same transaction) writes an outbox row, then a
  // message broker delivers the body to Mongo — proposed by the project author; see
  // spec/c2-dual-write-rollback.md and docs/015-dual-write-rollback.md.
  try {
    const createdAt = new Date();
    const [res] = await pool.execute(
      'INSERT INTO messages (conversation_id, sender_id, client_id, created_at) VALUES (?, ?, ?, ?)',
      [conversationId, senderId, clientId, createdAt],
    );
    const id = (res as { insertId: number }).insertId;

    try {
      await mongo().collection('message_bodies').insertOne({
        _id: id as never,
        conversationId,
        senderId,
        body,
        signature,
        createdAt,
      });
    } catch (mongoErr) {
      await rollbackMessageRow(id);
      throw mongoErr;
    }

    return {
      message: { id, conversationId, senderId, body, createdAt },
      isNew: true,
    };
  } catch (err) {
    if (clientId && isDuplicateClientIdError(err)) {
      return returnExistingMessage(clientId, body, signature);
    }
    throw err;
  }
}
