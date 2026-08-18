# WebSocket resilience (R1 + R2 + R3)

## Goal

Make Relay realtime survivable for long-lived tabs and flaky networks:

- **R1** — server heartbeat: one missed ping/pong cycle → `terminate()`
- **R2** — outbound backpressure, inbound `maxPayload`, subscription cap
- **R3** — client auto-reconnect with backoff, resubscribe, HTTP recovery, connection indicator

## Server (`src/ws/hub.ts`)

### R1 — Heartbeat

- Interval from `WS_HEARTBEAT_MS` (default **30_000**).
- Per connection: `isAlive` flag; `ping()` each interval; `pong` sets `isAlive = true`.
- If `isAlive === false` at interval tick → `removeClient()` + `terminate()`.
- **One missed cycle closes the socket** (agreed).

### R2 — Backpressure and limits

| Env | Default | Behaviour |
|---|---|---|
| `WS_MAX_BUFFERED_BYTES` | 1_048_576 (1 MiB) | Before `send()`, if `bufferedAmount > limit` → terminate |
| `WS_MAX_PAYLOAD_BYTES` | 16_384 (16 KiB) | `WebSocketServer({ maxPayload })` |
| `WS_MAX_SUBSCRIPTIONS` | 500 | `subscribe.conversationIds` truncated to first N finite ids |

Freshness over completeness: slow consumers are dropped; clients recover via HTTP.

### Contracts (unchanged frames)

- Inbound: `{ type: 'subscribe', conversationIds: number[] }`
- Outbound: `{ type: 'message', ... }` (unchanged)

## Client (`web/app.js`)

### R3 — Reconnect

- On unexpected `close` / `error`: schedule reconnect with exponential backoff + jitter (cap 30s).
- After reconnect: refresh `/api/conversations`, resubscribe, refetch active conversation via HTTP.
- `loadConversations()` intentional close does not trigger reconnect loop.
- UI: `#wsStatus` badge (`connected` / `reconnecting` / `disconnected`).

## Alternatives considered

| Option | Why rejected |
|---|---|
| 2 missed pong cycles before terminate | User chose 1-cycle (initial variant) |
| Drop frames silently (no terminate) on backpressure | Zombie buffers still grow in `ws` internals |
| Client-side ping | Server must reap half-open sockets; browser WS API has no ping |

## Contributions

**User proposed**
- Fix R3 + R1 + R2 together as one heartbeat/reconnect/backpressure bundle
- Heartbeat: initial variant — **one missed ping/pong cycle → close**

**Agent proposed**
- Env-tunable limits for tests (`WS_HEARTBEAT_MS=80`, etc.) — **adopted**
- HTTP resync of active conversation after reconnect — **adopted**
- `#wsStatus` indicator in sidebar header — **adopted**

**Agreed in Phase 2**
- 1 missed heartbeat cycle → terminate
- Backpressure → terminate slow consumer
- Client reconnect with backoff + resubscribe + HTTP recovery
