import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { Db } from 'mongodb';
import { pool } from './mysql.ts';

const MYSQL_INDEXES = [
  {
    table: 'messages',
    name: 'idx_messages_conversation_id',
    sql: 'CREATE INDEX idx_messages_conversation_id ON messages (conversation_id, id)',
  },
  {
    table: 'conversation_participants',
    name: 'idx_participants_user_id',
    sql: 'CREATE INDEX idx_participants_user_id ON conversation_participants (user_id, conversation_id)',
  },
  {
    table: 'users',
    name: 'idx_users_email',
    sql: 'CREATE UNIQUE INDEX idx_users_email ON users (email)',
  },
  {
    table: 'conversations',
    name: 'idx_conversations_title',
    sql: 'CREATE UNIQUE INDEX idx_conversations_title ON conversations (title)',
  },
] as const;

const SENDER_CLIENT_ID_INDEX = {
  table: 'messages',
  name: 'idx_messages_sender_client_id',
  legacyName: 'idx_messages_client_id',
  sql: 'CREATE UNIQUE INDEX idx_messages_sender_client_id ON messages (sender_id, client_id)',
} as const;

async function mysqlIndexExists(mysqlPool: Pool, table: string, name: string): Promise<boolean> {
  interface CountRow extends RowDataPacket {
    cnt: number;
  }
  const [rows] = await mysqlPool.query<CountRow[]>(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND index_name = ?`,
    [table, name],
  );
  return Number(rows[0]?.cnt ?? 0) > 0;
}

async function migrateSenderClientIdIndex(mysqlPool: Pool): Promise<void> {
  const { table, name, legacyName, sql } = SENDER_CLIENT_ID_INDEX;

  if (await mysqlIndexExists(mysqlPool, table, name)) {
    if (await mysqlIndexExists(mysqlPool, table, legacyName)) {
      await mysqlPool.query(`DROP INDEX ${legacyName} ON ${table}`);
    }
    return;
  }

  if (await mysqlIndexExists(mysqlPool, table, legacyName)) {
    await mysqlPool.query(`DROP INDEX ${legacyName} ON ${table}`);
  }

  await mysqlPool.query(sql);
}

async function ensureMysqlIndexes(mysqlPool: Pool): Promise<void> {
  await migrateSenderClientIdIndex(mysqlPool);
  for (const index of MYSQL_INDEXES) {
    if (await mysqlIndexExists(mysqlPool, index.table, index.name)) continue;
    await mysqlPool.query(index.sql);
  }
}

async function ensureMongoIndexes(db: Db): Promise<void> {
  const bodies = db.collection('message_bodies');
  await bodies.createIndex({ conversationId: 1 }, { name: 'idx_message_bodies_conversation_id' });
  await bodies.createIndex({ body: 'text' }, { name: 'idx_message_bodies_body_text' });
}

export async function ensureIndexes(db: Db): Promise<void> {
  await ensureMysqlIndexes(pool);
  await ensureMongoIndexes(db);
}

export { MYSQL_INDEXES, SENDER_CLIENT_ID_INDEX };
