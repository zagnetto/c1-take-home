import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { asyncHandler, errorHandler } from '../errorHandler.ts';

function mockResponse(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    headersSent: false,
  };
  return res as Response & { statusCode: number; body: unknown };
}

test('errorHandler returns 500 with generic message and logs the error', () => {
  const req = { method: 'GET', originalUrl: '/api/messages?conversationId=1' } as Request;
  const res = mockResponse();
  const logs: unknown[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    logs.push(args);
  };

  try {
    errorHandler(new Error('ER_NO_SUCH_TABLE'), req, res, (() => {}) as NextFunction);
  } finally {
    console.error = originalError;
  }

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: 'internal server error' });
  assert.ok(logs.some((entry) => Array.isArray(entry) && String(entry[0]).includes('GET')));
});

test('errorHandler returns 503 for infrastructure errors', () => {
  const req = { method: 'GET', originalUrl: '/api/conversations?userId=1' } as Request;
  const res = mockResponse();

  errorHandler(
    Object.assign(new Error('connect refused'), { code: 'ECONNREFUSED' }),
    req,
    res,
    (() => {}) as NextFunction,
  );

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: 'service temporarily unavailable' });
});

test('errorHandler returns 503 for Mongo network errors', () => {
  const req = { method: 'GET', originalUrl: '/api/messages?conversationId=1' } as Request;
  const res = mockResponse();
  const err = Object.assign(new Error('topology closed'), { name: 'MongoNetworkError' });

  errorHandler(err, req, res, (() => {}) as NextFunction);

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: 'service temporarily unavailable' });
});

test('errorHandler returns 400 for malformed JSON bodies', () => {
  const req = { method: 'POST', originalUrl: '/api/messages' } as Request;
  const res = mockResponse();
  const err = Object.assign(new SyntaxError('Unexpected token'), {
    status: 400,
    type: 'entity.parse.failed',
    body: '{not json',
  });

  errorHandler(err, req, res, (() => {}) as NextFunction);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'invalid JSON body' });
});

test('errorHandler delegates when response headers were already sent', () => {
  const req = { method: 'POST', originalUrl: '/api/messages' } as Request;
  const res = mockResponse();
  res.headersSent = true;
  const err = new Error('late failure');
  let delegated: unknown;

  errorHandler(err, req, res, (nextErr: unknown) => {
    delegated = nextErr;
  });

  assert.equal(delegated, err);
  assert.equal(res.statusCode, 200);
});

test('asyncHandler forwards rejected promises to next', async () => {
  const handler = asyncHandler(async () => {
    throw new Error('driver timeout');
  });
  let forwarded: unknown;

  handler({} as Request, mockResponse(), (err: unknown) => {
    forwarded = err;
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(forwarded instanceof Error);
  assert.match((forwarded as Error).message, /driver timeout/);
});

test('asyncHandler passes through successful handlers', async () => {
  let called = false;
  const handler = asyncHandler(async (_req, res) => {
    called = true;
    res.status(200).json({ ok: true });
  });
  const res = mockResponse();

  handler({} as Request, res, (() => {}) as NextFunction);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(called, true);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
});
