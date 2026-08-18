import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import { redis, redisSubscriber } from '../db/redis.ts';
import { REALTIME_EVENTS_CHANNEL } from '../services/realtimeKeys.ts';

type Client = WebSocket & { subs?: Set<number>; isAlive?: boolean };

const rooms = new Map<number, Set<Client>>();

let fanoutReady: Promise<void> | undefined;

function wsLimits() {
  return {
    heartbeatMs: Number(process.env.WS_HEARTBEAT_MS) || 30_000,
    maxBufferedBytes: Number(process.env.WS_MAX_BUFFERED_BYTES) || 1_048_576,
    maxSubscriptions: Number(process.env.WS_MAX_SUBSCRIPTIONS) || 500,
    maxPayloadBytes: Number(process.env.WS_MAX_PAYLOAD_BYTES) || 16_384,
  };
}

function addToRoom(conversationId: number, ws: Client): void {
  let room = rooms.get(conversationId);
  if (!room) {
    room = new Set();
    rooms.set(conversationId, room);
  }
  room.add(ws);
}

function removeFromRoom(conversationId: number, ws: Client): void {
  const room = rooms.get(conversationId);
  if (!room) return;
  room.delete(ws);
  if (room.size === 0) rooms.delete(conversationId);
}

function removeClient(ws: Client): void {
  if (!ws.subs) return;
  for (const conversationId of ws.subs) {
    removeFromRoom(conversationId, ws);
  }
  ws.subs.clear();
}

function setSubscriptions(ws: Client, conversationIds: number[], maxSubscriptions: number): void {
  removeClient(ws);
  const capped = conversationIds.filter(Number.isFinite).slice(0, maxSubscriptions);
  ws.subs = new Set(capped);
  for (const conversationId of ws.subs) {
    addToRoom(conversationId, ws);
  }
}

function sendFrame(ws: Client, data: string, maxBufferedBytes: number): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  if (ws.bufferedAmount > maxBufferedBytes) {
    removeClient(ws);
    ws.terminate();
    return;
  }
  ws.send(data);
}

function deliverToRoom(conversationId: number, payload: unknown, maxBufferedBytes: number): void {
  const room = rooms.get(conversationId);
  if (!room) return;

  const data = JSON.stringify(payload);
  for (const ws of room) {
    sendFrame(ws, data, maxBufferedBytes);
  }
}

export function attachWs(server: Server): void {
  const limits = wsLimits();
  const wss = new WebSocketServer({ server, maxPayload: limits.maxPayloadBytes });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const client = ws as Client;
      if (client.isAlive === false) {
        removeClient(client);
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, limits.heartbeatMs);

  server.on('close', () => clearInterval(heartbeat));

  wss.on('connection', (ws: Client) => {
    ws.subs = new Set();
    ws.isAlive = true;

    const detach = (): void => removeClient(ws);

    ws.on('pong', () => {
      ws.isAlive = true;
    });
    ws.on('message', (raw) => {
      try {
        const m = JSON.parse(raw.toString());
        if (m.type === 'subscribe' && Array.isArray(m.conversationIds)) {
          setSubscriptions(ws, m.conversationIds.map(Number), limits.maxSubscriptions);
        }
      } catch {
        /* ignore malformed frames */
      }
    });
    ws.on('close', detach);
    ws.on('error', detach);
  });
}

export async function initRedisFanout(): Promise<void> {
  const { maxBufferedBytes } = wsLimits();
  if (!fanoutReady) {
    fanoutReady = (async () => {
      const sub = redisSubscriber();
      await sub.subscribe(REALTIME_EVENTS_CHANNEL);
      sub.on('message', (_channel, message) => {
        try {
          const payload = JSON.parse(message) as { conversationId?: unknown };
          const conversationId = Number(payload.conversationId);
          if (!Number.isFinite(conversationId)) return;
          deliverToRoom(conversationId, payload, maxBufferedBytes);
        } catch {
          /* ignore malformed frames */
        }
      });
    })();
  }
  return fanoutReady;
}

export async function broadcast(conversationId: number, payload: unknown): Promise<void> {
  try {
    await redis.publish(REALTIME_EVENTS_CHANNEL, JSON.stringify(payload));
  } catch (err) {
    console.error('redis publish failed; realtime fan-out degraded', err);
  }
}

/** @internal Exposed for unit tests (R2 backpressure). */
export function sendFrameForTest(ws: Client, data: string, maxBufferedBytes: number): void {
  sendFrame(ws, data, maxBufferedBytes);
}
