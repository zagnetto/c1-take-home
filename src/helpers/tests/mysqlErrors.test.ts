import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDuplicateTitleError } from '../mysqlErrors.ts';

test('isDuplicateTitleError returns true for ER_DUP_ENTRY', () => {
  assert.equal(isDuplicateTitleError({ code: 'ER_DUP_ENTRY' }), true);
});

test('isDuplicateTitleError returns false for other errors', () => {
  assert.equal(isDuplicateTitleError({ code: 'ER_NO_SUCH_TABLE' }), false);
  assert.equal(isDuplicateTitleError(new Error('fail')), false);
  assert.equal(isDuplicateTitleError(null), false);
});
