import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';

type Client = WebSocket & { subs?: Set<number> };

const clients = new Set<Client>();

export function attachWs(server: Server): void {
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws: Client) => {
    ws.subs = new Set();
    clients.add(ws);
    ws.on('message', (raw) => {
      try {
        const m = JSON.parse(raw.toString());
        if (m.type === 'subscribe' && Array.isArray(m.conversationIds)) {
          ws.subs = new Set(m.conversationIds.map(Number));
        }
      } catch {
        /* ignore malformed frames */
      }
    });
    ws.on('close', () => clients.delete(ws));
  });
}

export function broadcast(conversationId: number, payload: unknown): void {
  const data = JSON.stringify(payload);
  for (const ws of clients) {
    if (ws.subs?.has(conversationId) && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}
