import '../../testHelpers/hostEnv.ts';
import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import Redis from 'ioredis';
import WebSocket from 'ws';
import { config } from '../../config.ts';
import { REALTIME_EVENTS_CHANNEL } from '../../constants/redis.ts';
import {
  clearRedisSessionKeys,
  seedRedisSession,
  wsConnectHeaders,
} from '../../testHelpers/wsSession.ts';
import { attachWs, initRedisFanout } from '../hub.ts';

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

async function openAuthenticatedWs(
  port: number,
  userId: number,
  redis: Redis,
): Promise<{ ws: WebSocket; keys: string[] }> {
  const session = await seedRedisSession(userId, redis);
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
    headers: wsConnectHeaders(session.cookie, port),
  });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return { ws, keys: session.keys };
}

async function startHubServer(): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer();
  attachWs(server);
  await initRedisFanout();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return { server, port: address.port };
}

test('typing frame publishes to Redis with session userId', async (t) => {
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable — run docker compose up -d redis');
    return;
  }

  const sub = redisClient();
  const received: string[] = [];
  const { server, port } = await startHubServer();
  const redis = redisClient();

  try {
    await sub.subscribe(REALTIME_EVENTS_CHANNEL);
    sub.on('message', (_channel, message) => received.push(message));

    const { ws, keys } = await openAuthenticatedWs(port, 2, redis);
    ws.send(JSON.stringify({ type: 'subscribe', conversationIds: [1] }));
    await wait(150);
    ws.send(JSON.stringify({ type: 'typing', conversationId: 1, isTyping: true }));
    await wait(200);

    assert.equal(received.length, 1);
    assert.deepEqual(JSON.parse(received[0]!), {
      type: 'typing',
      conversationId: 1,
      userId: 2,
      isTyping: true,
    });

    ws.close();
    await clearRedisSessionKeys(redis, keys);
  } finally {
    await sub.quit();
    await redis.quit();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('typing frame ignored for conversation not in ws.subs', async (t) => {
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable — run docker compose up -d redis');
    return;
  }

  const sub = redisClient();
  const received: string[] = [];
  const { server, port } = await startHubServer();
  const redis = redisClient();

  try {
    await sub.subscribe(REALTIME_EVENTS_CHANNEL);
    sub.on('message', (_channel, message) => received.push(message));

    const { ws, keys } = await openAuthenticatedWs(port, 1, redis);
    ws.send(JSON.stringify({ type: 'subscribe', conversationIds: [1] }));
    await wait(150);
    ws.send(JSON.stringify({ type: 'typing', conversationId: 99, isTyping: true }));
    await wait(200);

    assert.equal(received.length, 0);

    ws.close();
    await clearRedisSessionKeys(redis, keys);
  } finally {
    await sub.quit();
    await redis.quit();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('typer does not receive own typing frame; peer does', async (t) => {
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable — run docker compose up -d redis');
    return;
  }

  const { server, port } = await startHubServer();
  const redis = redisClient();
  const typer = await openAuthenticatedWs(port, 1, redis);
  const peer = await openAuthenticatedWs(port, 2, redis);

  try {
    typer.ws.send(JSON.stringify({ type: 'subscribe', conversationIds: [1] }));
    peer.ws.send(JSON.stringify({ type: 'subscribe', conversationIds: [1] }));
    await wait(150);

    const typerFrames = collectMessages(typer.ws);
    const peerFrames = collectMessages(peer.ws);

    typer.ws.send(JSON.stringify({ type: 'typing', conversationId: 1, isTyping: true }));
    await wait(250);

    assert.equal(typerFrames.length, 0, 'typer must not receive own typing frame');
    assert.equal(peerFrames.length, 1, 'peer must receive typing frame');
    assert.deepEqual(peerFrames[0], {
      type: 'typing',
      conversationId: 1,
      userId: 1,
      isTyping: true,
    });
  } finally {
    typer.ws.close();
    peer.ws.close();
    await clearRedisSessionKeys(redis, [...typer.keys, ...peer.keys]);
    await redis.quit();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('typing works when sent immediately after subscribe (subscribe race)', async (t) => {
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable — run docker compose up -d redis');
    return;
  }

  const { server, port } = await startHubServer();
  const redis = redisClient();
  const typer = await openAuthenticatedWs(port, 1, redis);
  const peer = await openAuthenticatedWs(port, 2, redis);

  try {
    peer.ws.send(JSON.stringify({ type: 'subscribe', conversationIds: [1] }));
    await wait(150);
    const peerFrames = collectMessages(peer.ws);
    typer.ws.send(JSON.stringify({ type: 'subscribe', conversationIds: [1] }));
    typer.ws.send(JSON.stringify({ type: 'typing', conversationId: 1, isTyping: true }));
    await wait(300);

    assert.equal(peerFrames.length, 1);
    assert.deepEqual(peerFrames[0], {
      type: 'typing',
      conversationId: 1,
      userId: 1,
      isTyping: true,
    });
  } finally {
    typer.ws.close();
    peer.ws.close();
    await clearRedisSessionKeys(redis, [...typer.keys, ...peer.keys]);
    await redis.quit();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('disconnect publishes isTyping false for active typing conversations', async (t) => {
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable — run docker compose up -d redis');
    return;
  }

  const { server, port } = await startHubServer();
  const redis = redisClient();
  const typer = await openAuthenticatedWs(port, 1, redis);
  const peer = await openAuthenticatedWs(port, 2, redis);

  try {
    typer.ws.send(JSON.stringify({ type: 'subscribe', conversationIds: [1] }));
    peer.ws.send(JSON.stringify({ type: 'subscribe', conversationIds: [1] }));
    await wait(150);

    const peerFrames = collectMessages(peer.ws);

    typer.ws.send(JSON.stringify({ type: 'typing', conversationId: 1, isTyping: true }));
    await wait(200);
    typer.ws.close();
    await wait(250);

    assert.equal(peerFrames.length, 2);
    assert.deepEqual(peerFrames[0], {
      type: 'typing',
      conversationId: 1,
      userId: 1,
      isTyping: true,
    });
    assert.deepEqual(peerFrames[1], {
      type: 'typing',
      conversationId: 1,
      userId: 1,
      isTyping: false,
    });
  } finally {
    peer.ws.close();
    await clearRedisSessionKeys(redis, [...typer.keys, ...peer.keys]);
    await redis.quit();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
