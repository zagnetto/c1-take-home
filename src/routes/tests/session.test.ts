import '../../testHelpers/hostEnv.ts';
import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import {
  cleanupHttpTestSessions,
  closeHttpTestCleanup,
  createSession,
  initHttpTestCleanup,
  parseSessionCookie,
  redisAvailable,
  stackAvailable,
  TEST_BASE_URL,
  trackSession,
  wait,
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

test('POST /api/session assigns a free seeded user and sets HttpOnly cookie', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('API stack not reachable — run docker compose up');
    return;
  }
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable — run docker compose up -d redis');
    return;
  }

  const res = await fetch(`${TEST_BASE_URL}/api/session`, { method: 'POST' });
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

  const res = await fetch(`${TEST_BASE_URL}/api/session`, {
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

  const res = await fetch(`${TEST_BASE_URL}/api/session`, { method: 'POST' });
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

  const res = await fetch(`${TEST_BASE_URL}/api/conversations`, {
    headers: { Cookie: session.cookie },
  });
  assert.equal(res.status, 200);
  const conversations = (await res.json()) as { id: number }[];
  assert.ok(Array.isArray(conversations));

  const legacy = await fetch(`${TEST_BASE_URL}/api/conversations?userId=${session.userId}`);
  assert.equal(legacy.status, 401, 'legacy ?userId= must not authenticate without session cookie');
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
  const res = await fetch(`${TEST_BASE_URL}/api/messages`, {
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
