# Multi-instance realtime (R4 + R6)

## Goal

Make live message delivery work when Relay runs as several API instances (`docker compose up -d
--scale api=3`). Fixes audit items **R4** (room-based delivery) and **R6** (cross-instance fan-out).

Related task: [`tasks/multi-instance.md`](../tasks/multi-instance.md).

## Non-goals

- Sticky sessions in Envoy (future optimisation; Redis fan-out must work without them).
- WebSocket auth (R5 / SEC2).
- Client reconnect (R3), heartbeat (R1), backpressure (R2).
- Typing indicators or unread persistence.

## Contributions

**User proposed**
- Fix R6 + R4 as foundation for possible sticky sessions later.
- Use **`ioredis`** — no Redis client existed in the repo.

**Agent proposed**
- Publish-only fan-out (no direct local send + filter) — **adopted** per `relay-realtime` skill.
- Single channel `relay:events` with `conversationId` in payload — **adopted**.
- Fail open when Redis publish fails (message already persisted) — **adopted**.

**Agreed in Phase 2**
- `Map<conversationId, Set<WebSocket>>` for O(subscribers) delivery (R4).
- `broadcast()` publishes to Redis; `initRedisFanout()` subscribes once at startup and delivers locally.
- Separate Redis subscriber connection (`maxRetriesPerRequest: null`).

## Design

```
POST /api/messages → persist → redis.publish('relay:events', JSON)
                                      ↓
              each api instance: redis subscriber → deliverToRoom(conversationId)
```

- Subscribe frame still replaces the client's conversation set; rooms are updated on subscribe and
  cleaned up on `close` / `error`.
- Malformed Redis payloads are ignored (same as malformed WS frames today).

## Alternatives considered

| Option | Why rejected |
|---|---|
| Sticky sessions only | POST and WebSocket can still land on different instances; does not fix author echo. |
| Local send + publish with origin filter | Two code paths; easy to double-send or miss the author. |
| Per-conversation Redis channels | Dynamic SUBSCRIBE/UNSUBSCRIBE per client churn; harder to reason about. |

## Contracts

### Redis

- Channel: `relay:events` (constant in `src/services/realtimeKeys.ts`).
- Payload: same JSON as the WebSocket frame, must include numeric `conversationId`.

### WebSocket (unchanged)

- Inbound: `{ type: 'subscribe', conversationIds: number[] }`.
- Outbound: `{ type: 'message', id, conversationId, senderId, body, createdAt }`.

### Hub exports

- `attachWs(server)` — unchanged entry point.
- `initRedisFanout(): Promise<void>` — idempotent; call once at startup.
- `broadcast(conversationId, payload): Promise<void>` — publish only.

## Failure modes

- **Redis down at startup:** `waitForRedis()` blocks boot (same as MySQL/Mongo).
- **Redis publish fails after message saved:** log error; clients can re-fetch via HTTP; no 500.
- **Subscriber misses a message while down:** fire-and-forget; client recovery via HTTP (R3 later).

## How to verify

```bash
docker compose up --build -d --scale api=3
docker compose run --rm -e REDIS_URL=redis://redis:6379 api npm test
# Two browser tabs, same conversation — sender must see own message after several sends.
```
