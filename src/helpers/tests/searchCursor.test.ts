import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decodeSearchCursor,
  encodeSearchCursor,
  parseSearchLimit,
} from '../searchCursor.ts';

test('encodeSearchCursor round-trips payload', () => {
  const payload = { score: 1.25, id: 42, q: 'order update' };
  const encoded = encodeSearchCursor(payload);
  assert.deepEqual(decodeSearchCursor(encoded), payload);
});

test('decodeSearchCursor rejects malformed tokens', () => {
  assert.equal(decodeSearchCursor('not-base64'), null);
  assert.equal(decodeSearchCursor(encodeSearchCursor({ score: NaN, id: 1, q: 'x' })), null);
  assert.equal(decodeSearchCursor(encodeSearchCursor({ score: 1, id: 0, q: 'x' })), null);
  assert.equal(decodeSearchCursor(encodeSearchCursor({ score: 1, id: 1, q: '' })), null);
});

test('parseSearchLimit defaults and caps', () => {
  assert.equal(parseSearchLimit(undefined), 50);
  assert.equal(parseSearchLimit('25'), 25);
  assert.equal(parseSearchLimit('999'), 50);
  assert.equal(parseSearchLimit('0'), null);
  assert.equal(parseSearchLimit('abc'), null);
});
