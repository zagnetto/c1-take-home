import assert from 'node:assert/strict';
import { test } from 'node:test';
import { positiveIntFromEnv } from '../envInt.ts';

test('positiveIntFromEnv returns fallback for missing, empty, or invalid values', () => {
  assert.equal(positiveIntFromEnv(undefined, 5), 5);
  assert.equal(positiveIntFromEnv('', 5), 5);
  assert.equal(positiveIntFromEnv('   ', 5), 5);
  assert.equal(positiveIntFromEnv('abc', 5), 5);
  assert.equal(positiveIntFromEnv('0', 5), 5);
  assert.equal(positiveIntFromEnv('-3', 5), 5);
  assert.equal(positiveIntFromEnv('3.5', 5), 5);
});

test('positiveIntFromEnv parses positive integers', () => {
  assert.equal(positiveIntFromEnv('10', 5), 10);
  assert.equal(positiveIntFromEnv('  7  ', 5), 7);
});
