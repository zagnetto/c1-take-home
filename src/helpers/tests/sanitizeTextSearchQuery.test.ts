import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizeTextSearchQuery } from '../sanitizeTextSearchQuery.ts';

test('sanitizeTextSearchQuery strips quotes and backslashes', () => {
  assert.equal(sanitizeTextSearchQuery('  "order"  '), 'order');
  assert.equal(sanitizeTextSearchQuery('foo\\bar'), 'foo bar');
});

test('sanitizeTextSearchQuery strips leading +/- on tokens', () => {
  assert.equal(sanitizeTextSearchQuery('-order +design'), 'order design');
});

test('sanitizeTextSearchQuery returns empty for punctuation-only input', () => {
  assert.equal(sanitizeTextSearchQuery('""'), '');
  assert.equal(sanitizeTextSearchQuery('   '), '');
});
