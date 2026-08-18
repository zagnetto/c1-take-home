import '../../testHelpers/hostEnv.ts';
import assert from 'node:assert/strict';
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

async function postConversation(
  cookie: string,
  title: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${TEST_BASE_URL}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ title, participantIds: [2] }),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  if (text) body = JSON.parse(text) as Record<string, unknown>;
  return { status: res.status, body };
}

test('POST /api/conversations rejects duplicate title with 409', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('API stack not reachable — run docker compose up');
    return;
  }
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable');
    return;
  }

  const session = await createSession();
  const title = `unique title ${Date.now()}`;

  const first = await postConversation(session.cookie, title);
  assert.equal(first.status, 201);

  const second = await postConversation(session.cookie, title);
  assert.equal(second.status, 409);
  assert.match(String(second.body.error), /title already exists/i);
});
