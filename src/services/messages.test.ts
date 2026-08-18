import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import { computeMessageSignature } from './messages.ts';

// Regression guard only: async pbkdf2 must produce the same hex as the old pbkdf2Sync
// (same salt, iterations, keylen, digest). Catches accidental param drift in
// computeMessageSignature — not a Node.js guarantee we need to re-prove.
//
// This does NOT test the actual C1 fix (event loop stays responsive under burst POST).
// That requires manual repro: parallel GET while 50 concurrent POSTs (see docs/006-async-pbkdf2.md).
test('computeMessageSignature matches legacy pbkdf2Sync output', async () => {
  const body = 'relay test message';
  const expected = crypto
    .pbkdf2Sync(body, 'relay-signing', 200000, 32, 'sha256')
    .toString('hex');
  const actual = await computeMessageSignature(body);
  assert.equal(actual, expected);
});
