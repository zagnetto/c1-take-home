import '../../testHelpers/hostEnv.ts';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import Redis from 'ioredis';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { config } from '../../config.ts';
import { messageRateLimitKey } from '../../constants/redis.ts';
import {
  cleanupHttpTestSessions,
  closeHttpTestCleanup,
  createSession,
  createSessionAs,
  initHttpTestCleanup,
  redisAvailable,
  stackAvailable,
  TEST_BASE_URL,
} from '../../testHelpers/httpSession.ts';

before(async () => {
  await initHttpTestCleanup();
});

beforeEach(async () => {
  await cleanupAllRateLimitKeys();
});

afterEach(async () => {
  await cleanupHttpTestSessions();
  await cleanupRateLimitKeys();
});

after(async () => {
  await cleanupRateLimitKeys();
  await closeHttpTestCleanup();
});

const trackedRateLimitKeys = new Set<string>();
let cleanupRedis: Redis | undefined;

function trackRateLimitKey(conversationId: number, userId: number): void {
  trackedRateLimitKeys.add(messageRateLimitKey(conversationId, userId));
}

async function cleanupAllRateLimitKeys(): Promise<void> {
  if (!(await redisAvailable())) return;
  if (!cleanupRedis) {
    cleanupRedis = new Redis(config.redisUrl, { maxRetriesPerRequest: 1 });
  }
  const keys = await cleanupRedis.keys('relay:ratelimit:messages:*');
  if (keys.length > 0) await cleanupRedis.del(...keys);
  trackedRateLimitKeys.clear();
}

async function cleanupRateLimitKeys(): Promise<void> {
  if (!cleanupRedis) {
    if (!(await redisAvailable())) return;
    cleanupRedis = new Redis(config.redisUrl, { maxRetriesPerRequest: 1 });
  }
  if (trackedRateLimitKeys.size === 0) return;
  await cleanupRedis.del(...trackedRateLimitKeys);
  trackedRateLimitKeys.clear();
}

async function postMessage(
  cookie: string,
  payload: { conversationId: number; body: string; clientId?: string },
): Promise<{ status: number; headers: Headers; body: Record<string, unknown> }> {
  const res = await fetch(`${TEST_BASE_URL}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      clientId: crypto.randomUUID(),
      ...payload,
    }),
  });
  return {
    status: res.status,
    headers: res.headers,
    body: (await res.json()) as Record<string, unknown>,
  };
}

test('POST /api/messages returns 429 with Retry-After after the per-user conversation quota', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('API stack not reachable — run docker compose up');
    return;
  }
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable');
    return;
  }

  const session = await createSession();
  trackRateLimitKey(1, session.userId);

  for (let i = 0; i < config.messageRateLimitMax; i++) {
    const res = await postMessage(session.cookie, {
      conversationId: 1,
      body: `rate-limit ok ${i} ${crypto.randomUUID()}`,
    });
    assert.equal(res.status, 201, `send ${i + 1} should succeed`);
  }

  const blocked = await postMessage(session.cookie, {
    conversationId: 1,
    body: `rate-limit blocked ${crypto.randomUUID()}`,
  });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error, 'message rate limit exceeded');
  const retryAfter = blocked.headers.get('Retry-After');
  assert.ok(retryAfter, '429 must include Retry-After');
  assert.match(retryAfter!, /^\d+$/);
  assert.ok(Number(retryAfter) >= 1);
});

test('POST /api/messages rate limit is scoped per conversation for the same user', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('API stack not reachable — run docker compose up');
    return;
  }
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable');
    return;
  }

  const session = await createSession();
  trackRateLimitKey(1, session.userId);
  trackRateLimitKey(2, session.userId);

  for (let i = 0; i < config.messageRateLimitMax; i++) {
    const res = await postMessage(session.cookie, {
      conversationId: 1,
      body: `conv1 ${i} ${crypto.randomUUID()}`,
    });
    assert.equal(res.status, 201);
  }

  const otherConversation = await postMessage(session.cookie, {
    conversationId: 2,
    body: `conv2 still allowed ${crypto.randomUUID()}`,
  });
  assert.equal(otherConversation.status, 201);
});

test('POST /api/messages rate limit is scoped per user in the same conversation', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('API stack not reachable — run docker compose up');
    return;
  }
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable');
    return;
  }

  const alice = await createSessionAs(1);
  const bob = await createSessionAs(2);
  assert.ok(alice, 'expected seeded session for user 1');
  assert.ok(bob, 'expected seeded session for user 2');
  trackRateLimitKey(1, alice!.userId);
  trackRateLimitKey(1, bob!.userId);

  for (let i = 0; i < config.messageRateLimitMax; i++) {
    const res = await postMessage(alice!.cookie, {
      conversationId: 1,
      body: `alice flood ${i} ${crypto.randomUUID()}`,
    });
    assert.equal(res.status, 201);
  }

  const blockedAlice = await postMessage(alice!.cookie, {
    conversationId: 1,
    body: `alice blocked ${crypto.randomUUID()}`,
  });
  assert.equal(blockedAlice.status, 429);

  const bobSend = await postMessage(bob!.cookie, {
    conversationId: 1,
    body: `bob unaffected ${crypto.randomUUID()}`,
  });
  assert.equal(bobSend.status, 201);
});

test('POST /api/messages idempotent retry does not consume rate limit quota', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('API stack not reachable — run docker compose up');
    return;
  }
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable');
    return;
  }

  const session = await createSession();
  trackRateLimitKey(1, session.userId);
  const clientId = crypto.randomUUID();
  const payload = { conversationId: 1, body: 'counts once', clientId };

  const first = await fetch(`${TEST_BASE_URL}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: session.cookie },
    body: JSON.stringify(payload),
  });
  assert.equal(first.status, 201);

  for (let i = 0; i < config.messageRateLimitMax - 2; i++) {
    const res = await postMessage(session.cookie, {
      conversationId: 1,
      body: `fill ${i} ${crypto.randomUUID()}`,
    });
    assert.equal(res.status, 201);
  }

  for (let i = 0; i < 2; i++) {
    const replay = await fetch(`${TEST_BASE_URL}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: session.cookie },
      body: JSON.stringify(payload),
    });
    assert.equal(replay.status, 200, `duplicate clientId retry ${i + 1} must not consume quota`);
  }

  const lastAllowed = await postMessage(session.cookie, {
    conversationId: 1,
    body: `last allowed ${crypto.randomUUID()}`,
  });
  assert.equal(lastAllowed.status, 201, 'one slot should remain after replays that bypass the limit');

  const blocked = await postMessage(session.cookie, {
    conversationId: 1,
    body: `blocked ${crypto.randomUUID()}`,
  });
  assert.equal(blocked.status, 429);
});

test('POST /api/messages duplicate clientId retries bypass rate limit when quota is full', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('API stack not reachable — run docker compose up');
    return;
  }
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable');
    return;
  }

  const session = await createSession();
  trackRateLimitKey(1, session.userId);
  const clientId = crypto.randomUUID();
  const payload = { conversationId: 1, body: 'retry without quota hit', clientId };

  const initial = await fetch(`${TEST_BASE_URL}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: session.cookie },
    body: JSON.stringify(payload),
  });
  assert.equal(initial.status, 201);
  const initialBody = (await initial.json()) as { id: number };

  for (let i = 0; i < config.messageRateLimitMax - 1; i++) {
    const res = await postMessage(session.cookie, {
      conversationId: 1,
      body: `fill ${i} ${crypto.randomUUID()}`,
    });
    assert.equal(res.status, 201);
  }

  const blocked = await postMessage(session.cookie, {
    conversationId: 1,
    body: `blocked ${crypto.randomUUID()}`,
  });
  assert.equal(blocked.status, 429);

  const replay = await fetch(`${TEST_BASE_URL}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: session.cookie },
    body: JSON.stringify(payload),
  });
  assert.equal(replay.status, 200, 'existing clientId must bypass the rate limit');
  const replayBody = (await replay.json()) as { id: number };
  assert.equal(replayBody.id, initialBody.id);
});
