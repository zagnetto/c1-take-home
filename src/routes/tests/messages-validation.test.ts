import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, afterEach, before, test } from 'node:test';
import Redis from 'ioredis';
import { config } from '../../config.ts';
import { MAX_MESSAGE_BODY_LENGTH } from '../../validation/messageInput.ts';

const BASE = process.env.RELAY_TEST_URL ?? 'http://localhost:3000';
const SESSION_COOKIE = 'relay_session';

async function stackAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function redisAvailable(): Promise<boolean> {
  const probe = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 1000,
    lazyConnect: true,
  });
  try {
    await probe.connect();
    await probe.ping();
    await probe.quit();
    return true;
  } catch {
    await probe.quit().catch(() => undefined);
    return false;
  }
}

function parseSessionCookie(setCookie: string | null): string | undefined {
  if (!setCookie) return undefined;
  const match = setCookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return match?.[1];
}

const createdSessionKeys: string[] = [];
let cleanupRedis: Redis | undefined;

function trackSession(token: string, userId: number): void {
  createdSessionKeys.push(`relay:session:${token}`, `relay:session:user:${userId}`);
}

async function createSession(): Promise<{ cookie: string; userId: number }> {
  const res = await fetch(`${BASE}/api/session`, { method: 'POST' });
  assert.equal(res.status, 201);
  const body = (await res.json()) as { userId: number };
  const token = parseSessionCookie(res.headers.get('set-cookie'));
  assert.ok(token);
  trackSession(token, body.userId);
  return { cookie: `${SESSION_COOKIE}=${token}`, userId: body.userId };
}

async function postMessage(
  cookie: string,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  if (text) body = JSON.parse(text) as Record<string, unknown>;
  return { status: res.status, body };
}

before(async () => {
  if (await redisAvailable()) {
    cleanupRedis = new Redis(config.redisUrl, { maxRetriesPerRequest: 1 });
  }
});

afterEach(async () => {
  if (cleanupRedis && createdSessionKeys.length) {
    await cleanupRedis.del(...createdSessionKeys);
    createdSessionKeys.length = 0;
  }
});

after(async () => {
  await cleanupRedis?.quit();
});

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

  const listed = await fetch(`${BASE}/api/messages?conversationId=1&limit=50`, {
    headers: { Cookie: session.cookie },
  });
  assert.equal(listed.status, 200);
  const page = (await listed.json()) as {
    messages: Array<{ id: number; body: string; createdAt: string }>;
  };
  const row = page.messages.find((m) => m.id === created.body.id);
  assert.ok(row, 'created message must appear in GET /api/messages');
  assert.equal(row.body, created.body.body);
  assert.equal(String(row.createdAt), String(created.body.createdAt));
});
