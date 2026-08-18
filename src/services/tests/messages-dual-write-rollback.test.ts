import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { Collection } from 'mongodb';
import { after, test } from 'node:test';

// Host-side tests reach published compose ports, not the in-network hostnames.
process.env.MYSQL_URL ??=
  'mysql://root:root@127.0.0.1:3306/relay?charset=utf8mb4';
process.env.MONGO_URL ??= 'mongodb://127.0.0.1:27017/relay';

const { connectMongo, mongo } = await import('../../db/mongo.ts');
const { pool, waitForMysql } = await import('../../db/mysql.ts');
const { createMessage } = await import('../messages.ts');

type MessageBodyDoc = {
  _id: number;
  conversationId: number;
  senderId: number;
  body: string;
  signature: string;
  createdAt: Date;
};

async function stackAvailable(): Promise<boolean> {
  try {
    await waitForMysql();
    await connectMongo();
    return true;
  } catch {
    return false;
  }
}

async function messageCount(): Promise<number> {
  const [rows] = await pool.query('SELECT COUNT(*) AS n FROM messages');
  return Number((rows as { n: number }[])[0]?.n ?? 0);
}

after(async () => {
  await pool.end();
});

test('createMessage rolls back MySQL row when Mongo insert fails', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('MySQL/Mongo not reachable — run docker compose up');
    return;
  }

  const before = await messageCount();
  const clientId = crypto.randomUUID();
  const db = mongo();
  const realCollection = db.collection.bind(db);

  db.collection = function patchedCollection(name: string) {
    const coll = realCollection(name);
    if (name !== 'message_bodies') return coll;

    return {
      ...coll,
      insertOne: async () => {
        throw new Error('simulated mongo insert failure');
      },
      findOne: coll.findOne.bind(coll),
    } as unknown as Collection<MessageBodyDoc>;
  } as typeof db.collection;

  try {
    await assert.rejects(
      () =>
        createMessage({
          conversationId: 1,
          senderId: 1,
          body: `dual-write rollback probe ${clientId}`,
          clientId,
        }),
      /simulated mongo insert failure/,
    );

    const after = await messageCount();
    assert.equal(after, before, 'MySQL row must be deleted when Mongo write fails');

    const [rows] = await pool.query('SELECT id FROM messages WHERE client_id = ?', [clientId]);
    assert.equal((rows as unknown[]).length, 0, 'no orphan row for this clientId');
  } finally {
    db.collection = realCollection;
  }
});
