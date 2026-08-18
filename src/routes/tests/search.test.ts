import '../../testHelpers/hostEnv.ts';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, afterEach, before, test } from 'node:test';
import {
  cleanupHttpTestSessions,
  closeHttpTestCleanup,
  createSessionAs,
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

type SearchResultItem = {
  messageId: number;
  conversationId: number;
  conversationTitle: string;
  body: string;
};

type SearchPage = {
  results: SearchResultItem[];
  hasMore: boolean;
  nextCursor: string | null;
};

const EMPTY_PAGE: SearchPage = { results: [], hasMore: false, nextCursor: null };

async function searchApi(
  cookie: string | undefined,
  q: string,
  opts: { limit?: number; cursor?: string } = {},
): Promise<{ status: number; body: SearchPage | Record<string, unknown> }> {
  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = cookie;

  const params = new URLSearchParams({ q });
  if (opts.limit != null) params.set('limit', String(opts.limit));
  if (opts.cursor) params.set('cursor', opts.cursor);

  const res = await fetch(`${TEST_BASE_URL}/api/search?${params}`, { headers });
  const text = await res.text();
  let body: SearchPage | Record<string, unknown> = EMPTY_PAGE;
  if (text) body = JSON.parse(text) as SearchPage | Record<string, unknown>;
  return { status: res.status, body };
}

async function postMessage(
  cookie: string,
  payload: Record<string, unknown>,
): Promise<{ status: number }> {
  const res = await fetch(`${TEST_BASE_URL}/api/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(payload),
  });
  return { status: res.status };
}

test('GET /api/search without session returns 401', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('API stack not reachable — run docker compose up');
    return;
  }

  const res = await searchApi(undefined, 'order');
  assert.equal(res.status, 401);
});

test('GET /api/search with empty q returns empty page', async (t) => {
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

  const res = await searchApi(alice.cookie, '   ');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, EMPTY_PAGE);
});

test('GET /api/search returns matching messages in member conversations', async (t) => {
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

  const res = await searchApi(alice.cookie, 'order');
  assert.equal(res.status, 200);
  const page = res.body as SearchPage;
  assert.ok(page.results.length >= 1);
  const hit = page.results.find((r) => r.conversationId === 1);
  assert.ok(hit);
  assert.ok(hit.messageId >= 1);
  assert.equal(hit.conversationTitle, 'Support — order #1042');
  assert.match(hit.body, /order #1042/i);
});

test('GET /api/search excludes conversations the user is not a member of', async (t) => {
  if (!(await stackAvailable())) {
    t.skip('API stack not reachable — run docker compose up');
    return;
  }
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable');
    return;
  }

  const bob = await createSessionAs(2);
  if (!bob) {
    t.skip('could not claim seeded user 2');
    return;
  }

  const res = await searchApi(bob.cookie, 'design');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, EMPTY_PAGE);
});

test('GET /api/search returns empty page for unsanitized-only query', async (t) => {
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

  const res = await searchApi(alice.cookie, '""');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, EMPTY_PAGE);
});

test('GET /api/search paginates with cursor', async (t) => {
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

  const token = `paginationprobe-${crypto.randomUUID()}`;
  for (let i = 0; i < 3; i++) {
    const posted = await postMessage(alice.cookie, {
      conversationId: 1,
      body: `${token} message ${i}`,
      clientId: crypto.randomUUID(),
    });
    assert.equal(posted.status, 201);
  }

  const page1 = await searchApi(alice.cookie, token, { limit: 2 });
  assert.equal(page1.status, 200);
  const first = page1.body as SearchPage;
  assert.equal(first.results.length, 2);
  assert.equal(first.hasMore, true);
  assert.ok(first.nextCursor);

  const page2 = await searchApi(alice.cookie, token, {
    limit: 2,
    cursor: first.nextCursor!,
  });
  assert.equal(page2.status, 200);
  const second = page2.body as SearchPage;
  assert.equal(second.results.length, 1);
  assert.equal(second.hasMore, false);
  assert.equal(second.nextCursor, null);

  const ids = [...first.results, ...second.results].map((r) => r.messageId);
  assert.equal(new Set(ids).size, 3);
});

test('GET /api/search rejects cursor for a different query', async (t) => {
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

  const page = await searchApi(alice.cookie, 'order', { limit: 1 });
  assert.equal(page.status, 200);
  const body = page.body as SearchPage;
  if (!body.nextCursor) {
    t.skip('not enough order hits to produce a cursor');
    return;
  }

  const mismatched = await searchApi(alice.cookie, 'design', { cursor: body.nextCursor });
  assert.equal(mismatched.status, 400);
  assert.match(String((mismatched.body as { error?: string }).error), /cursor does not match query/);
});

test('GET /api/search rejects invalid cursor', async (t) => {
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

  const res = await searchApi(alice.cookie, 'order', { cursor: 'not-a-valid-cursor' });
  assert.equal(res.status, 400);
  assert.match(String((res.body as { error?: string }).error), /cursor is invalid/);
});
