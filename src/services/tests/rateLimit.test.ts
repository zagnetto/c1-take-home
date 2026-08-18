import assert from 'node:assert/strict';
import { test } from 'node:test';
import { retryAfterSecondsFromPttl } from '../rateLimit.ts';

test('retryAfterSecondsFromPttl rounds up partial seconds with minimum 1', () => {
  assert.equal(retryAfterSecondsFromPttl(1), 1);
  assert.equal(retryAfterSecondsFromPttl(1000), 1);
  assert.equal(retryAfterSecondsFromPttl(1001), 2);
  assert.equal(retryAfterSecondsFromPttl(9500), 10);
});

test('retryAfterSecondsFromPttl treats missing or expired TTL as 1 second', () => {
  assert.equal(retryAfterSecondsFromPttl(0), 1);
  assert.equal(retryAfterSecondsFromPttl(-1), 1);
  assert.equal(retryAfterSecondsFromPttl(Number.NaN), 1);
});
