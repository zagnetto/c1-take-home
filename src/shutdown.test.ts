import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import WebSocket from 'ws';
import { createGracefulShutdown } from './shutdown.ts';
import { attachWs, closeWsServer } from './ws/hub.ts';

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('expected TCP address'));
        return;
      }
      resolve(addr.port);
    });
  });
}

function waitForRequest(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.once('request', () => resolve());
  });
}

test('gracefulShutdown waits for in-flight HTTP before closing dependencies', async () => {
  let requestFinished = false;
  const server = http.createServer((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
      requestFinished = true;
    }, 40);
  });

  const port = await listen(server);
  attachWs(server);

  const closed: string[] = [];
  const shutdown = createGracefulShutdown({
    server,
    closeWebSockets: async () => {
      closed.push('ws');
    },
    closeMysql: async () => {
      closed.push('mysql');
    },
    closeMongo: async () => {
      closed.push('mongo');
    },
    closeRedis: async () => {
      closed.push('redis');
    },
    timeoutMs: 5_000,
    exit: () => {},
  });

  const requestSeen = waitForRequest(server);
  const responsePromise = fetch(`http://127.0.0.1:${port}/`).then((r) => r.text());
  await requestSeen;
  await shutdown.run();

  assert.equal(await responsePromise, 'ok');
  assert.equal(requestFinished, true);
  assert.deepEqual(closed, ['ws', 'mysql', 'mongo', 'redis']);
});

test('gracefulShutdown closes WebSocket clients with code 1001', async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });

  const port = await listen(server);
  attachWs(server);

  const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
    ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
  });

  const shutdown = createGracefulShutdown({
    server,
    closeWebSockets: closeWsServer,
    closeMysql: async () => {},
    closeMongo: async () => {},
    closeRedis: async () => {},
    timeoutMs: 5_000,
    exit: () => {},
  });

  await shutdown.run();
  const closed = await closePromise;

  assert.equal(closed.code, 1001);
  assert.equal(closed.reason, 'server shutting down');
});

test('gracefulShutdown rejects when shutdown exceeds timeout', async () => {
  const server = http.createServer((_req, res) => {
    setTimeout(() => {
      res.writeHead(200);
      res.end('slow');
    }, 500);
  });

  const port = await listen(server);

  const shutdown = createGracefulShutdown({
    server,
    closeWebSockets: async () => {},
    closeMysql: async () => {},
    closeMongo: async () => {},
    closeRedis: async () => {},
    timeoutMs: 50,
    exit: () => {},
  });

  const requestSeen = waitForRequest(server);
  const inFlight = fetch(`http://127.0.0.1:${port}/`).catch(() => undefined);
  await requestSeen;
  await assert.rejects(shutdown.run(), /shutdown timed out/i);
  await inFlight;
});

test('gracefulShutdown skips server.close when server is not listening yet', async () => {
  const server = http.createServer();
  let closeCalled = false;
  const originalClose = server.close.bind(server);
  server.close = ((cb?: (err?: Error) => void) => {
    closeCalled = true;
    return originalClose(cb);
  }) as typeof server.close;

  const closed: string[] = [];
  const shutdown = createGracefulShutdown({
    server,
    closeWebSockets: async () => {
      closed.push('ws');
    },
    closeMysql: async () => {
      closed.push('mysql');
    },
    closeMongo: async () => {},
    closeRedis: async () => {},
    timeoutMs: 1_000,
    exit: () => {},
  });

  await shutdown.run();

  assert.equal(server.listening, false);
  assert.equal(closeCalled, false);
  assert.deepEqual(closed, ['ws', 'mysql']);
});

test('gracefulShutdown calls closeAllConnections when drain exceeds timeout', async () => {
  const server = http.createServer((_req, res) => {
    setTimeout(() => {
      res.writeHead(200);
      res.end('slow');
    }, 500);
  });

  await listen(server);
  let closeAllCalled = false;
  const originalCloseAll = server.closeAllConnections.bind(server);
  server.closeAllConnections = () => {
    closeAllCalled = true;
    originalCloseAll();
  };

  const shutdown = createGracefulShutdown({
    server,
    closeWebSockets: async () => {},
    closeMysql: async () => {},
    closeMongo: async () => {},
    closeRedis: async () => {},
    timeoutMs: 50,
    exit: () => {},
  });

  const requestSeen = waitForRequest(server);
  const inFlight = fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/`).catch(
    () => undefined,
  );
  await requestSeen;
  await assert.rejects(shutdown.run(), /shutdown timed out/i);
  assert.equal(closeAllCalled, true);
  await inFlight;
});

test('installGracefulShutdown registers SIGTERM and SIGINT once', async () => {
  const { installGracefulShutdown } = await import('./shutdown.ts');

  const listenersBefore = process.listenerCount('SIGTERM');
  installGracefulShutdown({
    server: http.createServer(),
    closeWebSockets: async () => {},
    closeMysql: async () => {},
    closeMongo: async () => {},
    closeRedis: async () => {},
    timeoutMs: 1_000,
    exit: () => {},
  });

  assert.equal(process.listenerCount('SIGTERM'), listenersBefore + 1);
  assert.equal(process.listenerCount('SIGINT'), listenersBefore + 1);
});
