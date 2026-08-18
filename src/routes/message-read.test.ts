import '../testHelpers/hostEnv.ts';
import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import {
  cleanupHttpTestSessions,
  closeHttpTestCleanup,
  createSessionAs,
  initHttpTestCleanup,
  redisAvailable,
  stackAvailable,
} from '../testHelpers/httpSession.ts';

const BASE = process.env.RELAY_TEST_URL ?? 'http://localhost:3000';

type MessagesPage = {
  messages: Array<{ id: number; body?: string }>;
  hasMore: boolean;
  nextBefore: number | null;
};

before(async () => {
  await initHttpTestCleanup();
});

afterEach(async () => {
  await cleanupHttpTestSessions();
});

after(async () => {
  await closeHttpTestCleanup();
});

test('GET /api/conversations returns messageCount and lastMessage in one response', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('API stack not reachable — run docker compose up');
    return;
  }
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable');
    return;
  }

  const alice = await createSessionAs(1);
  if (!alice) {
    t.skip('could not claim seeded user 1');
    return;
  }

  const res = await fetch(`${BASE}/api/conversations`, {
    headers: { Cookie: alice.cookie },
  });
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
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable');
    return;
  }

  const alice = await createSessionAs(1);
  if (!alice) {
    t.skip('could not claim seeded user 1');
    return;
  }

  const auth = { headers: { Cookie: alice.cookie } };

  const allRes = await fetch(`${BASE}/api/messages?conversationId=1&limit=200`, auth);
  assert.equal(allRes.status, 200);
  const all = (await allRes.json()) as MessagesPage;
  assert.ok(Array.isArray(all.messages));
  assert.equal(typeof all.hasMore, 'boolean');
  assert.ok(all.messages.length >= 2);

  const pageRes = await fetch(`${BASE}/api/messages?conversationId=1&limit=1`, auth);
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
    auth,
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
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable');
    return;
  }

  const alice = await createSessionAs(1);
  if (!alice) {
    t.skip('could not claim seeded user 1');
    return;
  }

  const auth = { headers: { Cookie: alice.cookie } };

  const badLimit = await fetch(`${BASE}/api/messages?conversationId=1&limit=0`, auth);
  assert.equal(badLimit.status, 400);

  const badBefore = await fetch(`${BASE}/api/messages?conversationId=1&before=abc`, auth);
  assert.equal(badBefore.status, 400);
});

test('GET /api/messages page messages stay ascending by id', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('API stack not reachable — run docker compose up');
    return;
  }
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable');
    return;
  }

  const alice = await createSessionAs(1);
  if (!alice) {
    t.skip('could not claim seeded user 1');
    return;
  }

  const res = await fetch(`${BASE}/api/messages?conversationId=1&limit=5`, {
    headers: { Cookie: alice.cookie },
  });
  assert.equal(res.status, 200);
  const page = (await res.json()) as MessagesPage;
  for (let i = 1; i < page.messages.length; i++) {
    assert.ok(page.messages[i - 1]!.id < page.messages[i]!.id);
  }
});
