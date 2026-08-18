import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_MESSAGE_BODY_LENGTH,
  parseClientId,
  parsePositiveInt,
  sanitizeConversationTitle,
  sanitizeMessageBody,
  sanitizeStoredText,
} from './messageInput.ts';

test('parsePositiveInt accepts positive integers only', () => {
  assert.equal(parsePositiveInt(1), 1);
  assert.equal(parsePositiveInt('42'), 42);
  assert.equal(parsePositiveInt(0), null);
  assert.equal(parsePositiveInt(-1), null);
  assert.equal(parsePositiveInt(1.5), null);
  assert.equal(parsePositiveInt('12abc'), null);
  assert.equal(parsePositiveInt(''), null);
  assert.equal(parsePositiveInt(null), null);
});

test('sanitizeStoredText is shared by body and title helpers', () => {
  assert.equal(sanitizeStoredText('  hello  ', 50), 'hello');
  assert.equal(sanitizeMessageBody('  hello  '), 'hello');
});

test('sanitizeMessageBody trims, caps length, and strips HTML tags', () => {
  assert.equal(sanitizeMessageBody('  hello  '), 'hello');
  assert.equal(sanitizeMessageBody('<b>bold</b> ok'), 'bold ok');
  assert.equal(sanitizeMessageBody('<script>alert(1)</script>hi'), 'hi');
  assert.equal(sanitizeMessageBody('a'.repeat(MAX_MESSAGE_BODY_LENGTH + 1)), null);
  assert.equal(sanitizeMessageBody('   '), null);
  assert.equal(sanitizeMessageBody('<img onerror=x>'), null);
  assert.equal(sanitizeMessageBody(123), null);
});

test('sanitizeConversationTitle caps at 200 chars and strips markup', () => {
  assert.equal(
    sanitizeConversationTitle('Support <img src=x onerror=alert(1)> ticket'),
    'Support ticket',
  );
  assert.equal(sanitizeConversationTitle('<script>x</script>'), null);
  assert.equal(sanitizeConversationTitle('a'.repeat(201)), null);
});

test('sanitizeConversationTitle does not strip unclosed tags (frontend must encode)', () => {
  assert.equal(
    sanitizeConversationTitle('Support <img src=x onerror=alert(1) ticket'),
    'Support <img src=x onerror=alert(1) ticket',
  );
});

test('parseClientId accepts optional uuid-like strings up to 64 chars', () => {
  assert.equal(parseClientId(undefined), null);
  assert.equal(parseClientId(null), null);
  assert.equal(parseClientId('abc'), 'abc');
  assert.equal(parseClientId('a'.repeat(64)), 'a'.repeat(64));
  assert.equal(parseClientId('a'.repeat(65)), 'invalid');
  assert.equal(parseClientId(''), 'invalid');
  assert.equal(parseClientId(1), 'invalid');
});
