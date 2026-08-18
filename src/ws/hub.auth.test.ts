import '../testHelpers/hostEnv.ts';
import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import Redis from 'ioredis';
import WebSocket from 'ws';
import { config } from '../config.ts';
import { REALTIME_EVENTS_CHANNEL } from '../services/realtimeKeys.ts';
import {
  clearRedisSessionKeys,
  seedRedisSession,
} from '../testHelpers/wsSession.ts';
import { attachWs, initRedisFanout } from './hub.ts';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function redisAvailable(): Promise<boolean> {
  const probe = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 1000,
    lazyConnect: true,
  });
  try {
    await probe.connect();
    await probe.ping();
    await probe.quit();
    return true;
  } catch {
    await probe.quit().catch(() => undefined);
    return false;
  }
}

function redisClient(): Redis {
  return new Redis(config.redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 2000 });
}

function collectMessages(ws: WebSocket): unknown[] {
  const frames: unknown[] = [];
  ws.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
  return frames;
}

test('WebSocket without session is rejected at upgrade', async (t) => {
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable — run docker compose up -d redis');
    return;
  }

  const server = http.createServer();
  attachWs(server);

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;

  const ws = new WebSocket(`ws://127.0.0.1:${port}/`, {
    headers: { Origin: `http://127.0.0.1:${port}` },
  });

  const result = await Promise.race([
    new Promise<'open'>((resolve) => ws.once('open', () => resolve('open'))),
    new Promise<'error'>((resolve) => ws.once('error', () => resolve('error'))),
    wait(500).then(() => 'timeout' as const),
  ]);

  assert.notEqual(result, 'open', 'unauthenticated WebSocket upgrade must be rejected');

  ws.terminate();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('WebSocket with session only receives subscribed conversations the user belongs to', async (t) => {
  const hub = await import('./hub.ts');
  if (!('initRedisFanout' in hub) || typeof hub.initRedisFanout !== 'function') {
    t.skip('initRedisFanout not implemented yet');
    return;
  }
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable');
    return;
  }

  const server = http.createServer();
  attachWs(server);
  await initRedisFanout();

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;

  const redis = redisClient();
  const carolSession = await seedRedisSession(3, redis);

  const ws = new WebSocket(`ws://127.0.0.1:${port}/`, {
    headers: {
      Cookie: carolSession.cookie,
      Origin: `http://127.0.0.1:${port}`,
    },
  });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  const frames = collectMessages(ws);
  ws.send(JSON.stringify({ type: 'subscribe', conversationIds: [1, 2] }));
  await wait(150);

  const pub = redisClient();
  const allowed = {
    type: 'message',
    id: 9002,
    conversationId: 2,
    senderId: 3,
    body: 'allowed fan-out',
    createdAt: new Date().toISOString(),
  };
  const forbidden = {
    type: 'message',
    id: 9003,
    conversationId: 1,
    senderId: 1,
    body: 'forbidden fan-out',
    createdAt: new Date().toISOString(),
  };

  await pub.publish(REALTIME_EVENTS_CHANNEL, JSON.stringify(forbidden));
  await pub.publish(REALTIME_EVENTS_CHANNEL, JSON.stringify(allowed));
  await wait(200);

  assert.equal(frames.length, 1, 'member must receive only conversations they belong to');
  assert.deepEqual(frames[0], allowed);

  ws.close();
  await clearRedisSessionKeys(redis, carolSession.keys);
  await redis.quit();
  await pub.quit();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('WebSocket rejects cross-origin upgrade', async (t) => {
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable — run docker compose up -d redis');
    return;
  }

  const server = http.createServer();
  attachWs(server);

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;

  const redis = redisClient();
  const session = await seedRedisSession(1, redis);

  const ws = new WebSocket(`ws://127.0.0.1:${port}/`, {
    headers: {
      Cookie: session.cookie,
      Origin: 'http://evil.example',
    },
  });

  const result = await Promise.race([
    new Promise<'open'>((resolve) => ws.once('open', () => resolve('open'))),
    new Promise<'error'>((resolve) => ws.once('error', () => resolve('error'))),
    wait(500).then(() => 'timeout' as const),
  ]);

  assert.notEqual(result, 'open', 'cross-origin WebSocket upgrade must be rejected');

  ws.terminate();
  await clearRedisSessionKeys(redis, session.keys);
  await redis.quit();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
