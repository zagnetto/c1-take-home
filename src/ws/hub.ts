import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import { redis, redisSubscriber } from '../db/redis.ts';
import { REALTIME_EVENTS_CHANNEL } from '../services/realtimeKeys.ts';

type Client = WebSocket & { subs?: Set<number> };

const rooms = new Map<number, Set<Client>>();

let fanoutReady: Promise<void> | undefined;

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

function setSubscriptions(ws: Client, conversationIds: number[]): void {
  removeClient(ws);
  ws.subs = new Set(conversationIds.filter(Number.isFinite));
  for (const conversationId of ws.subs) {
    addToRoom(conversationId, ws);
  }
}

function deliverToRoom(conversationId: number, payload: unknown): void {
  const room = rooms.get(conversationId);
  if (!room) return;

  const data = JSON.stringify(payload);
  for (const ws of room) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

export function attachWs(server: Server): void {
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws: Client) => {
    ws.subs = new Set();

    const detach = (): void => removeClient(ws);

    ws.on('message', (raw) => {
      try {
        const m = JSON.parse(raw.toString());
        if (m.type === 'subscribe' && Array.isArray(m.conversationIds)) {
          setSubscriptions(ws, m.conversationIds.map(Number));
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
  if (!fanoutReady) {
    fanoutReady = (async () => {
      const sub = redisSubscriber();
      await sub.subscribe(REALTIME_EVENTS_CHANNEL);
      sub.on('message', (_channel, message) => {
        try {
          const payload = JSON.parse(message) as { conversationId?: unknown };
          const conversationId = Number(payload.conversationId);
          if (!Number.isFinite(conversationId)) return;
          deliverToRoom(conversationId, payload);
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
