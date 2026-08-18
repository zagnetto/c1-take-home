import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import Redis from 'ioredis';
import { config } from '../config.ts';

const BASE = process.env.RELAY_TEST_URL ?? 'http://localhost:3000';
const SESSION_COOKIE = 'relay_session';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stackAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/conversations?userId=1`, {
      signal: AbortSignal.timeout(2000),
    });
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

async function createSession(): Promise<{ userId: number; cookie: string; token: string }> {
  const res = await fetch(`${BASE}/api/session`, { method: 'POST' });
  assert.equal(res.status, 201, `expected 201 from POST /api/session, got ${res.status}`);
  const body = (await res.json()) as { userId: number };
  const token = parseSessionCookie(res.headers.get('set-cookie'));
  assert.ok(token, 'POST /api/session must set relay_session cookie');
  assert.ok(Number.isInteger(body.userId) && body.userId > 0, 'response must include positive userId');
  trackSession(token, body.userId);
  return { userId: body.userId, cookie: `${SESSION_COOKIE}=${token}`, token };
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

test('POST /api/session assigns a free seeded user and sets HttpOnly cookie', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('API stack not reachable — run docker compose up');
    return;
  }
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable — run docker compose up -d redis');
    return;
  }

  const res = await fetch(`${BASE}/api/session`, { method: 'POST' });
  assert.equal(res.status, 201);

  const body = (await res.json()) as { userId: number; name?: string };
  assert.ok([1, 2, 3].includes(body.userId), 'userId must be one of the seeded users 1–3');

  const setCookie = res.headers.get('set-cookie') ?? '';
  const token = parseSessionCookie(setCookie);
  assert.ok(token, 'must set relay_session cookie');
  assert.match(setCookie, /HttpOnly/i, 'session cookie must be HttpOnly');
  trackSession(token, body.userId);
});

test('POST /api/session with valid cookie resumes the same user', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('API stack not reachable — run docker compose up');
    return;
  }
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable');
    return;
  }

  const first = await createSession();

  const res = await fetch(`${BASE}/api/session`, {
    method: 'POST',
    headers: { Cookie: first.cookie },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { userId: number };
  assert.equal(body.userId, first.userId, 'existing cookie must map to the same userId');
});

test('POST /api/session returns 503 when all seeded users are occupied', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('API stack not reachable — run docker compose up');
    return;
  }
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable');
    return;
  }

  for (let i = 0; i < 3; i++) {
    await createSession();
  }

  const res = await fetch(`${BASE}/api/session`, { method: 'POST' });
  assert.equal(res.status, 503);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /no users available/i);
});

test('GET /api/conversations derives userId from session cookie', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('API stack not reachable — run docker compose up');
    return;
  }
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable');
    return;
  }

  const session = await createSession();

  const res = await fetch(`${BASE}/api/conversations`, {
    headers: { Cookie: session.cookie },
  });
  assert.equal(res.status, 200);
  const conversations = (await res.json()) as { id: number }[];
  assert.ok(Array.isArray(conversations));

  const legacy = await fetch(`${BASE}/api/conversations?userId=${session.userId}`);
  const legacyConversations = (await legacy.json()) as { id: number }[];
  assert.deepEqual(
    conversations.map((c) => c.id),
    legacyConversations.map((c) => c.id),
    'session-scoped list must match the assigned user conversations',
  );
});

test('POST /api/messages derives senderId from session and ignores client senderId', async (t) => {
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
  const res = await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: session.cookie },
    body: JSON.stringify({
      conversationId: 1,
      senderId: 999,
      body: `session-auth probe ${clientId}`,
      clientId,
    }),
  });
  assert.equal(res.status, 201);
  const msg = (await res.json()) as { senderId: number };
  assert.equal(
    msg.senderId,
    session.userId,
    'senderId must come from session, not the request body',
  );

  await wait(300);
});
