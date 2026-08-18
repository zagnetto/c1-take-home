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

test('POST /api/conversations stores sanitized title without HTML markup', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('API stack not reachable — run docker compose up');
    return;
  }
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable');
    return;
  }

  const session = await createSession();
  const suffix = Date.now();
  const unsafeTitle = `SEC1-${suffix} <img src=x onerror=alert(1)> probe`;

  const created = await fetch(`${TEST_BASE_URL}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: session.cookie },
    body: JSON.stringify({ title: unsafeTitle, participantIds: [2] }),
  });
  assert.equal(created.status, 201);
  const row = (await created.json()) as { id: number; title: string };
  assert.equal(row.title, `SEC1-${suffix} probe`);
  assert.doesNotMatch(row.title, /[<>]/);

  const listed = await fetch(`${TEST_BASE_URL}/api/conversations`, {
    headers: { Cookie: session.cookie },
  });
  assert.equal(listed.status, 200);
  const conversations = (await listed.json()) as Array<{ id: number; title: string }>;
  const found = conversations.find((c) => c.id === row.id);
  assert.ok(found);
  assert.equal(found.title, `SEC1-${suffix} probe`);
});
