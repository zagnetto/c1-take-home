import '../../testHelpers/hostEnv.ts';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, afterEach, before, test } from 'node:test';
import { MAX_MESSAGE_BODY_LENGTH } from '../../constants/messages.ts';
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
  payload: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${TEST_BASE_URL}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  if (text) body = JSON.parse(text) as Record<string, unknown>;
  return { status: res.status, body };
}

test('POST /api/messages rejects non-integer conversationId before SQL', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('API stack not reachable — run docker compose up');
    return;
  }
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable');
    return;
  }

  const session = await createSession();
  const res = await postMessage(session.cookie, {
    conversationId: '12abc',
    body: 'probe',
    clientId: crypto.randomUUID(),
  });
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /conversationId must be a positive integer/);
});

test('POST /api/messages rejects oversized body', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('API stack not reachable — run docker compose up');
    return;
  }
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable');
    return;
  }

  const session = await createSession();
  const res = await postMessage(session.cookie, {
    conversationId: 1,
    body: 'x'.repeat(MAX_MESSAGE_BODY_LENGTH + 1),
    clientId: crypto.randomUUID(),
  });
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /at most/);
});

test('POST /api/messages stores XSS-safe body and matches GET createdAt', async (t) => {
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
  const unsafeBody = `<script>alert(1)</script> safe ${clientId.slice(0, 8)}`;

  const created = await postMessage(session.cookie, {
    conversationId: 1,
    body: unsafeBody,
    clientId,
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.body, `safe ${clientId.slice(0, 8)}`);

  const listed = await fetch(`${TEST_BASE_URL}/api/messages?conversationId=1&limit=50`, {
    headers: { Cookie: session.cookie },
  });
  assert.equal(listed.status, 200);
  const page = (await listed.json()) as {
    messages: Array<{ id: number; body: string; createdAt: string }>;
  };
  const row = page.messages.find((m) => m.id === created.body.id);
  assert.ok(row, 'created message must appear in GET /api/messages');
  assert.equal(row.body, created.body.body);
  const listedMs = Date.parse(String(row.createdAt));
  const createdMs = Date.parse(String(created.body.createdAt));
  assert.ok(
    Math.abs(listedMs - createdMs) < 1000,
    'GET and POST createdAt must match within one second (MySQL DATETIME precision)',
  );
});
