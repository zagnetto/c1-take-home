import '../../testHelpers/hostEnv.ts';
import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import {
  cleanupHttpTestSessions,
  closeHttpTestCleanup,
  createSessionAs,
  initHttpTestCleanup,
  redisAvailable,
  stackAvailable,
  wait,
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

test('GET /api/messages without session returns 401', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('API stack not reachable — run docker compose up');
    return;
  }

  const res = await fetch(`${TEST_BASE_URL}/api/messages?conversationId=1&limit=10`);
  assert.equal(res.status, 401);
});

test('GET /api/conversations rejects legacy ?userId= without session', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('API stack not reachable — run docker compose up');
    return;
  }

  const res = await fetch(`${TEST_BASE_URL}/api/conversations?userId=1`);
  assert.equal(res.status, 401);
});

test('GET /api/messages returns 404 for conversation the user is not a member of', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('API stack not reachable — run docker compose up');
    return;
  }
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable');
    return;
  }

  const bob = await createSessionAs(2);
  if (!bob) {
    t.skip('could not claim seeded user 2');
    return;
  }

  const forbidden = await fetch(`${TEST_BASE_URL}/api/messages?conversationId=2&limit=10`, {
    headers: { Cookie: bob.cookie },
  });
  assert.equal(forbidden.status, 404);

  const allowed = await fetch(`${TEST_BASE_URL}/api/messages?conversationId=1&limit=10`, {
    headers: { Cookie: bob.cookie },
  });
  assert.equal(allowed.status, 200);
});

test('GET /api/messages returns the same 404 for missing and forbidden conversations', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('API stack not reachable — run docker compose up');
    return;
  }
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable');
    return;
  }

  const bob = await createSessionAs(2);
  if (!bob) {
    t.skip('could not claim seeded user 2');
    return;
  }

  const forbidden = await fetch(`${TEST_BASE_URL}/api/messages?conversationId=2&limit=10`, {
    headers: { Cookie: bob.cookie },
  });
  const missing = await fetch(`${TEST_BASE_URL}/api/messages?conversationId=99999&limit=10`, {
    headers: { Cookie: bob.cookie },
  });

  assert.equal(forbidden.status, 404);
  assert.equal(missing.status, 404);
  const forbiddenBody = (await forbidden.json()) as { error: string };
  const missingBody = (await missing.json()) as { error: string };
  assert.equal(forbiddenBody.error, missingBody.error);
});

test('POST /api/messages returns 404 when sender is not a conversation participant', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('API stack not reachable — run docker compose up');
    return;
  }
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable');
    return;
  }

  const bob = await createSessionAs(2);
  if (!bob) {
    t.skip('could not claim seeded user 2');
    return;
  }

  const res = await fetch(`${TEST_BASE_URL}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: bob.cookie },
    body: JSON.stringify({
      conversationId: 2,
      body: 'should not land',
      clientId: crypto.randomUUID(),
    }),
  });
  assert.equal(res.status, 404);

  await wait(100);
});

test('POST /api/messages still succeeds for a participant', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('API stack not reachable — run docker compose up');
    return;
  }
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable');
    return;
  }

  const bob = await createSessionAs(2);
  if (!bob) {
    t.skip('could not claim seeded user 2');
    return;
  }

  const res = await fetch(`${TEST_BASE_URL}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: bob.cookie },
    body: JSON.stringify({
      conversationId: 1,
      body: `member send probe ${crypto.randomUUID()}`,
      clientId: crypto.randomUUID(),
    }),
  });
  assert.equal(res.status, 201);

  await wait(100);
});
