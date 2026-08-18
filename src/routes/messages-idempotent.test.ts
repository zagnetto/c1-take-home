import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, afterEach, before, test } from 'node:test';
import Redis from 'ioredis';
import { config } from '../config.ts';

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

async function createSession(): Promise<{ cookie: string }> {
  const res = await fetch(`${BASE}/api/session`, { method: 'POST' });
  assert.equal(res.status, 201);
  const body = (await res.json()) as { userId: number };
  const token = parseSessionCookie(res.headers.get('set-cookie'));
  assert.ok(token);
  trackSession(token, body.userId);
  return { cookie: `${SESSION_COOKIE}=${token}` };
}

async function postMessage(
  cookie: string,
  payload: { conversationId: number; body: string; clientId: string },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
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
