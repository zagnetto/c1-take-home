import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import Redis from 'ioredis';
import WebSocket from 'ws';
import { config } from '../config.ts';
import { REALTIME_EVENTS_CHANNEL } from '../services/realtimeKeys.ts';

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

async function startHub(): Promise<{
  server: http.Server;
  port: number;
  close: () => Promise<void>;
}> {
  process.env.WS_HEARTBEAT_MS = '80';
  process.env.WS_MAX_BUFFERED_BYTES = '1024';
  process.env.WS_MAX_SUBSCRIPTIONS = '50';
  process.env.WS_MAX_PAYLOAD_BYTES = '4096';

  const { attachWs } = await import('./hub.ts');
  const server = http.createServer();
  attachWs(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    server,
    port: address.port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('terminates clients that miss heartbeat pong (R1)', async () => {
  const { port, close } = await startHub();

  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { autoPong: false });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  await wait(350);

  assert.equal(
    ws.readyState,
    WebSocket.CLOSED,
    'server must terminate sockets that never respond to ping',
  );

  await close();
});

test('closes connections that exceed outbound backpressure (R2)', async (t) => {
  const { sendFrameForTest } = await import('./hub.ts');

  let terminated = false;
  const mock = {
    readyState: WebSocket.OPEN,
    bufferedAmount: 2048,
    subs: new Set<number>(),
    terminate() {
      terminated = true;
    },
    send() {
      throw new Error('send must not run when backpressure exceeded');
    },
  };

  sendFrameForTest(mock as never, '{"type":"message"}', 1024);
  assert.equal(terminated, true, 'server must drop slow consumers once bufferedAmount exceeds the limit');
});

test('rejects oversized inbound frames via maxPayload (R2)', async () => {
  const { port, close } = await startHub();

  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const closed = new Promise<void>((resolve) => ws.once('close', () => resolve()));
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  const huge = JSON.stringify({
    type: 'subscribe',
    conversationIds: Array.from({ length: 500 }, (_, i) => i + 1),
    padding: 'x'.repeat(5000),
  });
  assert.ok(huge.length > 4096, 'test frame must exceed maxPayload');
  ws.send(huge);

  const closedInTime = await Promise.race([
    closed.then(() => true),
    wait(300).then(() => false),
  ]);

  assert.equal(closedInTime, true, 'oversized subscribe frame must close the socket');

  await close();
});

test('caps subscribe list length (R2)', async (t) => {
  if (!(await redisAvailable())) {
    t.skip('Redis not reachable — run docker compose up -d redis');
    return;
  }

  const { port, close } = await startHub();
  const { initRedisFanout } = await import('./hub.ts');
  await initRedisFanout();

  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  const ids = Array.from({ length: 100 }, (_, i) => i + 1);
  ws.send(JSON.stringify({ type: 'subscribe', conversationIds: ids }));
  await wait(30);

  const received: unknown[] = [];
  ws.on('message', (raw) => received.push(JSON.parse(raw.toString())));

  const pub = new Redis(config.redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 2000 });
  await pub.publish(
    REALTIME_EVENTS_CHANNEL,
    JSON.stringify({
      type: 'message',
      id: 75,
      conversationId: 75,
      senderId: 1,
      body: 'within cap',
      createdAt: new Date().toISOString(),
    }),
  );
  await pub.publish(
    REALTIME_EVENTS_CHANNEL,
    JSON.stringify({
      type: 'message',
      id: 99,
      conversationId: 99,
      senderId: 1,
      body: 'beyond cap',
      createdAt: new Date().toISOString(),
    }),
  );
  await wait(150);

  assert.equal(received.length, 1, 'only the first WS_MAX_SUBSCRIPTIONS ids may be subscribed');
  assert.deepEqual((received[0] as { conversationId: number }).conversationId, 75);

  ws.close();
  await pub.quit();
  await close();
});
