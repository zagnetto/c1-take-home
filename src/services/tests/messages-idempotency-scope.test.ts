import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, test } from 'node:test';

process.env.MYSQL_URL ??=
  'mysql://root:root@127.0.0.1:3306/relay?charset=utf8mb4';
process.env.MONGO_URL ??= 'mongodb://127.0.0.1:27017/relay';

const { connectMongo, mongo } = await import('../../db/mongo.ts');
const { pool, waitForMysql } = await import('../../db/mysql.ts');
const { ensureIndexes } = await import('../../db/ensureIndexes.ts');
const { createMessage, IdempotencyConflictError } = await import('../messages.ts');

async function stackAvailable(): Promise<boolean> {
  try {
    await waitForMysql();
    await connectMongo();
    await ensureIndexes(mongo());
    return true;
  } catch {
    return false;
  }
}

after(async () => {
  await pool.end();
});

test('createMessage isolates clientId per sender', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('MySQL/Mongo not reachable — run docker compose up');
    return;
  }

  const clientId = crypto.randomUUID();
  const first = await createMessage({
    conversationId: 1,
    senderId: 1,
    body: `sender-1 ${clientId}`,
    clientId,
  });
  const second = await createMessage({
    conversationId: 1,
    senderId: 2,
    body: `sender-2 ${clientId}`,
    clientId,
  });

  assert.equal(first.isNew, true);
  assert.equal(second.isNew, true);
  assert.notEqual(first.message.id, second.message.id);
  assert.equal(first.message.body, `sender-1 ${clientId}`);
  assert.equal(second.message.body, `sender-2 ${clientId}`);
});

test('createMessage replays the same sender clientId with matching payload', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('MySQL/Mongo not reachable — run docker compose up');
    return;
  }

  const clientId = crypto.randomUUID();
  const input = {
    conversationId: 1,
    senderId: 1,
    body: `replay ${clientId}`,
    clientId,
  };

  const first = await createMessage(input);
  const second = await createMessage(input);

  assert.equal(first.isNew, true);
  assert.equal(second.isNew, false);
  assert.equal(second.message.id, first.message.id);
  assert.equal(second.message.body, input.body);
});

test('createMessage rejects clientId reuse with a different body', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('MySQL/Mongo not reachable — run docker compose up');
    return;
  }

  const clientId = crypto.randomUUID();
  await createMessage({
    conversationId: 1,
    senderId: 1,
    body: `original ${clientId}`,
    clientId,
  });

  await assert.rejects(
    () =>
      createMessage({
        conversationId: 1,
        senderId: 1,
        body: `changed ${clientId}`,
        clientId,
      }),
    IdempotencyConflictError,
  );
});

test('createMessage rejects clientId reuse in a different conversation', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('MySQL/Mongo not reachable — run docker compose up');
    return;
  }

  const clientId = crypto.randomUUID();
  await createMessage({
    conversationId: 1,
    senderId: 1,
    body: `conv-1 ${clientId}`,
    clientId,
  });

  await assert.rejects(
    () =>
      createMessage({
        conversationId: 2,
        senderId: 1,
        body: `conv-1 ${clientId}`,
        clientId,
      }),
    IdempotencyConflictError,
  );
});
