import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redis, redisSubscriber } from '../redis.ts';

test('redis clients register error listeners', () => {
  assert.ok(redis.listenerCount('error') >= 1, 'main client must handle error events');
  assert.ok(
    redisSubscriber().listenerCount('error') >= 1,
    'subscriber client must handle error events',
  );
});
