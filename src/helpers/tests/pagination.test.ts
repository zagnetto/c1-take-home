import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMessagesPage, parseLimit } from '../pagination.ts';

test('parseLimit defaults to 50 when omitted', () => {
  assert.equal(parseLimit(undefined), 50);
  assert.equal(parseLimit(null), 50);
  assert.equal(parseLimit(''), 50);
});

test('parseLimit caps at 200 and rejects invalid values', () => {
  assert.equal(parseLimit('50'), 50);
  assert.equal(parseLimit('200'), 200);
  assert.equal(parseLimit('500'), 200);
  assert.equal(parseLimit('0'), null);
  assert.equal(parseLimit('-1'), null);
  assert.equal(parseLimit('abc'), null);
});

test('buildMessagesPage returns ascending slice with hasMore and nextBefore', () => {
  const rows = [{ id: 5 }, { id: 4 }, { id: 3 }];
  const page = buildMessagesPage(rows, 2);
  assert.deepEqual(
    page.messages.map((m) => m.id),
    [4, 5],
  );
  assert.equal(page.hasMore, true);
  assert.equal(page.nextBefore, 4);
});

test('buildMessagesPage hasMore false when page is complete', () => {
  const rows = [{ id: 2 }, { id: 1 }];
  const page = buildMessagesPage(rows, 2);
  assert.deepEqual(
    page.messages.map((m) => m.id),
    [1, 2],
  );
  assert.equal(page.hasMore, false);
  assert.equal(page.nextBefore, 1);
});

test('buildMessagesPage handles empty input', () => {
  const page = buildMessagesPage([], 50);
  assert.deepEqual(page.messages, []);
  assert.equal(page.hasMore, false);
  assert.equal(page.nextBefore, null);
});
