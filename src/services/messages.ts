import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/mysql.ts';
import { mongo } from '../db/mongo.ts';
import { buildMessagesPage, type MessagesPageResponse } from '../helpers/pagination.ts';

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

export class IdempotencyConflictError extends Error {
  constructor() {
    super('clientId already used for a different message');
    this.name = 'IdempotencyConflictError';
  }
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

export async function messageExistsForClientId(
  senderId: number,
  clientId: string,
): Promise<boolean> {
  return (await findMessageBySenderClientId(senderId, clientId)) != null;
}

async function findMessageBySenderClientId(
  senderId: number,
  clientId: string,
): Promise<MessageRow | null> {
  const [rows] = await pool.query(
    `SELECT id, conversation_id AS conversationId, sender_id AS senderId, created_at AS createdAt
     FROM messages
     WHERE sender_id = ? AND client_id = ?
     LIMIT 1`,
    [senderId, clientId],
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
  senderId: number,
  conversationId: number,
  clientId: string,
  body: string,
  signature: string,
): Promise<CreateMessageResult> {
  const row = await findMessageBySenderClientId(senderId, clientId);
  if (!row) {
    throw new Error(`duplicate client_id ${clientId} for sender ${senderId} but row not found`);
  }

  if (row.conversationId !== conversationId) {
    throw new IdempotencyConflictError();
  }

  const existingBody = await loadMessageBody(row.id);
  if (existingBody != null && existingBody !== body) {
    throw new IdempotencyConflictError();
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

type MessageListRow = RowDataPacket & {
  id: number;
  conversationId: number;
  senderId: number;
  createdAt: Date;
};

export async function listMessages(input: {
  conversationId: number;
  limit: number;
  before: number | null;
}): Promise<MessagesPageResponse> {
  const { conversationId, limit, before } = input;

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

  const [rows] = await pool.query<MessageListRow[]>(sql, params);
  const { messages: pageRows, hasMore, nextBefore } = buildMessagesPage(rows, limit);

  const ids = pageRows.map((r) => r.id);
  const bodies = ids.length
    ? await mongo()
        .collection('message_bodies')
        .find({ _id: { $in: ids as never } })
        .toArray()
    : [];
  const bodyById = new Map(bodies.map((b) => [b._id as unknown as number, String(b.body)]));

  return {
    messages: pageRows.map((r) => ({ ...r, body: bodyById.get(r.id) ?? '' })),
    hasMore,
    nextBefore,
  };
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
      return returnExistingMessage(senderId, conversationId, clientId, body, signature);
    }
    throw err;
  }
}
