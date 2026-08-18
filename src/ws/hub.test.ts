import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import Redis from 'ioredis';
import WebSocket from 'ws';
import { config } from '../config.ts';
import { REALTIME_EVENTS_CHANNEL } from '../services/realtimeKeys.ts';
import { attachWs, broadcast } from './hub.ts';

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

function collectMessages(ws: WebSocket): Promise<unknown[]> {
  const frames: unknown[] = [];
  ws.on('message', (raw) => frames.push(JSON.parse(raw.toString())));
  return Promise.resolve(frames);
}

test('broadcast publishes to relay:events (R6 publish-only path)', async (t) => {
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable — run docker compose up -d redis');
    return;
  }

  const sub = redisClient();
  const received: string[] = [];

  try {
    await sub.subscribe(REALTIME_EVENTS_CHANNEL);
    sub.on('message', (_channel, message) => received.push(message));

    const payload = {
      type: 'message',
      id: 99,
      conversationId: 1,
      senderId: 1,
      body: 'fan-out probe',
      createdAt: new Date().toISOString(),
    };

    await broadcast(1, payload);
    await wait(200);

    assert.equal(received.length, 1, 'broadcast must publish exactly one Redis event');
    assert.deepEqual(JSON.parse(received[0]!), payload);
  } finally {
    await sub.quit();
  }
});

test('relay:events delivery reaches subscribed local sockets (R6 + R4 rooms)', async (t) => {
  const hub = await import('./hub.ts');
  if (!('initRedisFanout' in hub) || typeof hub.initRedisFanout !== 'function') {
    t.skip('initRedisFanout not implemented yet');
    return;
  }
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable — run docker compose up -d redis');
    return;
  }
  const { initRedisFanout } = hub;
  const server = http.createServer();
  attachWs(server);
  await initRedisFanout();

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;

  const wsInRoom = new WebSocket(`ws://127.0.0.1:${port}`);
  const wsOtherRoom = new WebSocket(`ws://127.0.0.1:${port}`);

  await Promise.all([
    new Promise<void>((resolve, reject) => {
      wsInRoom.once('open', () => resolve());
      wsInRoom.once('error', reject);
    }),
    new Promise<void>((resolve, reject) => {
      wsOtherRoom.once('open', () => resolve());
      wsOtherRoom.once('error', reject);
    }),
  ]);

  const inRoomFrames = await collectMessages(wsInRoom);
  const otherRoomFrames = await collectMessages(wsOtherRoom);

  wsInRoom.send(JSON.stringify({ type: 'subscribe', conversationIds: [1] }));
  wsOtherRoom.send(JSON.stringify({ type: 'subscribe', conversationIds: [2] }));
  await wait(50);

  const payload = {
    type: 'message',
    id: 42,
    conversationId: 1,
    senderId: 2,
    body: 'cross-instance',
    createdAt: new Date().toISOString(),
  };

  const pub = redisClient();
  await pub.publish(REALTIME_EVENTS_CHANNEL, JSON.stringify(payload));
  await wait(200);

  assert.equal(inRoomFrames.length, 1, 'subscriber in conversation 1 must receive the frame');
  assert.deepEqual(inRoomFrames[0], payload);
  assert.equal(otherRoomFrames.length, 0, 'subscriber in conversation 2 must not receive the frame');

  wsInRoom.close();
  wsOtherRoom.close();
  await pub.quit();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('broadcast via Redis fan-out delivers to local room members including sender path', async (t) => {
  const hub = await import('./hub.ts');
  if (!('initRedisFanout' in hub) || typeof hub.initRedisFanout !== 'function') {
    t.skip('initRedisFanout not implemented yet');
    return;
  }
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable — run docker compose up -d redis');
    return;
  }
  const { initRedisFanout } = hub;
  const server = http.createServer();
  attachWs(server);
  await initRedisFanout();

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;

  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  const frames = await collectMessages(ws);
  ws.send(JSON.stringify({ type: 'subscribe', conversationIds: [1] }));
  await wait(50);

  const payload = {
    type: 'message',
    id: 7,
    conversationId: 1,
    senderId: 1,
    body: 'author echo',
    createdAt: new Date().toISOString(),
  };

  await broadcast(1, payload);
  await wait(200);

  assert.equal(frames.length, 1, 'author must see own message via Redis fan-out');
  assert.deepEqual(frames[0], payload);

  ws.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
