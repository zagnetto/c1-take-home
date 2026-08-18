import assert from 'node:assert/strict';
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

async function postConversation(
  cookie: string,
  title: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${BASE}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ title, participantIds: [2] }),
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
