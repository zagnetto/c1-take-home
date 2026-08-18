import '../../testHelpers/hostEnv.ts';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, afterEach, before, test } from 'node:test';
import {
  cleanupHttpTestSessions,
  closeHttpTestCleanup,
  createSession,
  initHttpTestCleanup,
  redisAvailable,
  stackAvailable,
  TEST_BASE_URL,
} from '../../testHelpers/httpSession.ts';

before(async () => {
  await initHttpTestCleanup();
});

afterEach(async () => {
  await cleanupHttpTestSessions();
});

after(async () => {
  await closeHttpTestCleanup();
});

async function postMessage(
  cookie: string,
  payload: { conversationId: number; body: string; clientId: string },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${TEST_BASE_URL}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

test('POST /api/messages returns existing message on duplicate clientId', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('API stack not reachable — run docker compose up');
    return;
  }
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable');
    return;
  }

  const session = await createSession();
  const clientId = crypto.randomUUID();
  const payload = {
    conversationId: 1,
    body: `idempotent probe ${clientId}`,
    clientId,
  };

  const first = await postMessage(session.cookie, payload);
  assert.equal(first.status, 201);
  assert.equal(typeof first.body.id, 'number');

  const second = await postMessage(session.cookie, payload);
  assert.equal(second.status, 200, 'duplicate clientId must return 200, not 409');
  assert.equal(second.body.id, first.body.id, 'duplicate clientId must return the same message id');
  assert.equal(second.body.body, payload.body);
});

test('POST /api/messages concurrent duplicate clientId resolves to one id', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('API stack not reachable — run docker compose up');
    return;
  }
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable');
    return;
  }

  const session = await createSession();
  const clientId = crypto.randomUUID();
  const payload = {
    conversationId: 1,
    body: `concurrent idempotent ${clientId}`,
    clientId,
  };

  const results = await Promise.all([
    postMessage(session.cookie, payload),
    postMessage(session.cookie, payload),
  ]);

  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 201], 'one create and one replay');
  assert.equal(results[0].body.id, results[1].body.id, 'both responses must share the same id');
});

test('POST /api/messages allows the same clientId for different senders', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('API stack not reachable — run docker compose up');
    return;
  }
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable');
    return;
  }

  const sessionA = await createSession();
  const sessionB = await createSession();
  const clientId = crypto.randomUUID();

  const first = await postMessage(sessionA.cookie, {
    conversationId: 1,
    body: `sender-a ${clientId}`,
    clientId,
  });
  const second = await postMessage(sessionB.cookie, {
    conversationId: 1,
    body: `sender-b ${clientId}`,
    clientId,
  });

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.notEqual(first.body.id, second.body.id, 'each sender must get its own message id');
  assert.equal(first.body.body, `sender-a ${clientId}`);
  assert.equal(second.body.body, `sender-b ${clientId}`);
});

test('POST /api/messages rejects clientId reuse with a different body', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('API stack not reachable — run docker compose up');
    return;
  }
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable');
    return;
  }

  const session = await createSession();
  const clientId = crypto.randomUUID();

  const first = await postMessage(session.cookie, {
    conversationId: 1,
    body: `original ${clientId}`,
    clientId,
  });
  assert.equal(first.status, 201);

  const second = await postMessage(session.cookie, {
    conversationId: 1,
    body: `changed ${clientId}`,
    clientId,
  });
  assert.equal(second.status, 409);
  assert.equal(second.body.error, 'clientId already used for a different message');
});

test('POST /api/messages rejects clientId reuse in a different conversation', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('API stack not reachable — run docker compose up');
    return;
  }
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable');
    return;
  }

  const session = await createSession();
  const clientId = crypto.randomUUID();

  const first = await postMessage(session.cookie, {
    conversationId: 1,
    body: `conv-1 ${clientId}`,
    clientId,
  });
  assert.equal(first.status, 201);

  const second = await postMessage(session.cookie, {
    conversationId: 2,
    body: `conv-1 ${clientId}`,
    clientId,
  });
  assert.equal(second.status, 409);
  assert.equal(second.body.error, 'clientId already used for a different message');
});
