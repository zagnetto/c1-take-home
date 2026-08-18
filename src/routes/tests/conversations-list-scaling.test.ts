import '../../testHelpers/hostEnv.ts';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { after, afterEach, before, test } from 'node:test';
import {
  cleanupHttpTestSessions,
  closeHttpTestCleanup,
  createSessionAs,
  initHttpTestCleanup,
  redisAvailable,
  stackAvailable,
  TEST_BASE_URL,
} from '../../testHelpers/httpSession.ts';

process.env.MYSQL_URL ??=
  'mysql://root:root@127.0.0.1:3306/relay?charset=utf8mb4';

const FOREIGN_MESSAGE_COUNT = 3000;
const ALICE_USER_ID = 1;

const { pool, waitForMysql } = await import('../../db/mysql.ts');
const { LIST_CONVERSATIONS_SQL } = await import('../../services/conversations.ts');

type ExplainRow = RowDataPacket & {
  table: string | null;
  rows: number;
};

interface CountRow extends RowDataPacket {
  n: number;
}

before(async () => {
  await initHttpTestCleanup();
  await waitForMysql().catch(() => undefined);
});

afterEach(async () => {
  await cleanupHttpTestSessions();
});

after(async () => {
  await pool.end();
  await closeHttpTestCleanup();
});

async function mysqlAvailable(): Promise<boolean> {
  try {
    await waitForMysql();
    return true;
  } catch {
    return false;
  }
}

async function bulkInsertMessages(conversationId: number, senderId: number, count: number): Promise<void> {
  const batchSize = 500;
  for (let offset = 0; offset < count; offset += batchSize) {
    const n = Math.min(batchSize, count - offset);
    const placeholders = Array.from({ length: n }, () => '(?, ?, NULL)').join(', ');
    const params: number[] = [];
    for (let i = 0; i < n; i++) {
      params.push(conversationId, senderId);
    }
    await pool.query(
      `INSERT INTO messages (conversation_id, sender_id, client_id) VALUES ${placeholders}`,
      params,
    );
  }
}

test('GET /api/conversations aggregates only the current user conversations', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('API stack not reachable — run docker compose up');
    return;
  }
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable');
    return;
  }
  if (!(await mysqlAvailable())) {
    t.skip('MySQL not reachable');
    return;
  }

  const alice = await createSessionAs(ALICE_USER_ID);
  if (!alice) {
    t.skip('could not claim seeded user 1');
    return;
  }

  const title = `__list_scaling_${crypto.randomUUID()}`;
  let foreignConversationId: number | undefined;

  try {
    const [created] = await pool.execute<ResultSetHeader>(
      'INSERT INTO conversations (title) VALUES (?)',
      [title],
    );
    foreignConversationId = created.insertId;
    await pool.execute(
      'INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)',
      [foreignConversationId, 3],
    );
    await bulkInsertMessages(foreignConversationId, 3, FOREIGN_MESSAGE_COUNT);

    const [totalRows] = await pool.query<CountRow[]>('SELECT COUNT(*) AS n FROM messages');
    const totalMessages = Number(totalRows[0]?.n ?? 0);
    assert.ok(totalMessages >= FOREIGN_MESSAGE_COUNT + 3, 'fixture must include many foreign messages');

    const [userScopedRows] = await pool.query<CountRow[]>(
      `SELECT COUNT(*) AS n
       FROM messages m
       INNER JOIN conversation_participants cp
         ON cp.conversation_id = m.conversation_id AND cp.user_id = ?`,
      [ALICE_USER_ID],
    );
    const userMessages = Number(userScopedRows[0]?.n ?? 0);
    assert.ok(
      userMessages < totalMessages / 2,
      'Alice must have far fewer messages than the whole system',
    );

    const [plan] = await pool.query<ExplainRow[]>(
      `EXPLAIN ${LIST_CONVERSATIONS_SQL}`,
      [ALICE_USER_ID, ALICE_USER_ID],
    );
    const messagesPlanRows = plan
      .filter((row) => row.table === 'messages')
      .reduce((sum, row) => sum + Number(row.rows), 0);
    assert.ok(
      messagesPlanRows < totalMessages / 2,
      `EXPLAIN must not scale with all messages (estimated ${messagesPlanRows}, total ${totalMessages})`,
    );

    const res = await fetch(`${TEST_BASE_URL}/api/conversations`, {
      headers: { Cookie: alice.cookie },
    });
    assert.equal(res.status, 200);
    const conversations = (await res.json()) as Array<{
      id: number;
      title: string;
      messageCount: number;
      lastMessage: { id: number } | null;
    }>;

    assert.ok(!conversations.some((c) => c.id === foreignConversationId));
    const support = conversations.find((c) => c.id === 1);
    assert.ok(support);
    assert.ok(support!.messageCount >= 2);
    assert.ok(support!.lastMessage);
  } finally {
    if (foreignConversationId != null) {
      await pool.query('DELETE FROM messages WHERE conversation_id = ?', [foreignConversationId]);
      await pool.query('DELETE FROM conversation_participants WHERE conversation_id = ?', [
        foreignConversationId,
      ]);
      await pool.query('DELETE FROM conversations WHERE id = ?', [foreignConversationId]);
    }
  }
});
