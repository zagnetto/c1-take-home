import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import Redis from 'ioredis';
import { config } from '../config.ts';

const BASE = process.env.RELAY_TEST_URL ?? 'http://localhost:3000';
const SESSION_COOKIE = 'relay_session';

type MessagesPage = {
  messages: Array<{ id: number; body?: string }>;
  hasMore: boolean;
  nextBefore: number | null;
};

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

let cleanupRedis: Redis | undefined;

after(async () => {
  await cleanupRedis?.quit();
});

test('GET /api/conversations returns messageCount and lastMessage in one response', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('API stack not reachable — run docker compose up');
    return;
  }

  const res = await fetch(`${BASE}/api/conversations?userId=1`);
  assert.equal(res.status, 200);
  const conversations = (await res.json()) as Array<{
    id: number;
    title: string;
    messageCount: number;
    lastMessage: { id: number; senderId: number } | null;
  }>;
  assert.ok(conversations.length > 0);
  const support = conversations.find((c) => c.id === 1);
  assert.ok(support);
  assert.equal(typeof support!.messageCount, 'number');
  assert.ok(support!.messageCount >= 2);
  assert.ok(support!.lastMessage);
  assert.equal(typeof support!.lastMessage!.id, 'number');
});

test('GET /api/messages returns paginated page object in ascending order', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('API stack not reachable — run docker compose up');
    return;
  }

  const allRes = await fetch(`${BASE}/api/messages?conversationId=1&limit=200`);
  assert.equal(allRes.status, 200);
  const all = (await allRes.json()) as MessagesPage;
  assert.ok(Array.isArray(all.messages));
  assert.equal(typeof all.hasMore, 'boolean');
  assert.ok(all.messages.length >= 2);

  const pageRes = await fetch(`${BASE}/api/messages?conversationId=1&limit=1`);
  assert.equal(pageRes.status, 200);
  const page = (await pageRes.json()) as MessagesPage;
  assert.equal(page.messages.length, 1);
  assert.equal(
    page.messages[0]!.id,
    all.messages[all.messages.length - 1]!.id,
    'first page must return the newest message',
  );
  assert.equal(page.hasMore, all.messages.length > 1);
  assert.equal(page.nextBefore, page.messages[0]!.id);

  const olderRes = await fetch(
    `${BASE}/api/messages?conversationId=1&before=${page.messages[0]!.id}&limit=10`,
  );
  assert.equal(olderRes.status, 200);
  const older = (await olderRes.json()) as MessagesPage;
  assert.ok(older.messages.every((m) => m.id < page.messages[0]!.id));
  for (let i = 1; i < older.messages.length; i++) {
    assert.ok(
      older.messages[i - 1]!.id < older.messages[i]!.id,
      'older page must stay ascending by id',
    );
  }
});

test('GET /api/messages rejects invalid pagination params', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('API stack not reachable — run docker compose up');
    return;
  }

  const badLimit = await fetch(`${BASE}/api/messages?conversationId=1&limit=0`);
  assert.equal(badLimit.status, 400);

  const badBefore = await fetch(`${BASE}/api/messages?conversationId=1&before=abc`);
  assert.equal(badBefore.status, 400);
});

test('GET /api/messages page messages stay ascending by id', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('API stack not reachable — run docker compose up');
    return;
  }

  const res = await fetch(`${BASE}/api/messages?conversationId=1&limit=5`);
  assert.equal(res.status, 200);
  const page = (await res.json()) as MessagesPage;
  for (let i = 1; i < page.messages.length; i++) {
    assert.ok(page.messages[i - 1]!.id < page.messages[i]!.id);
  }
});
