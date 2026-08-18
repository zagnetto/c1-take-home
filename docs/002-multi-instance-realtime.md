# Realtime fan-out across API instances (R4 + R6)

## Symptom

With `docker compose up -d --scale api=3`, the author often does not see their own message in the UI.
Other participants may also miss live updates. Messages are saved in MySQL/Mongo but the screen stays
empty for the sender.

## Reproduction

```bash
docker compose up -d --scale api=3
# Open two tabs on the same conversation; send several messages from one tab.
# Author's bubble often missing; peer may miss updates too.
```

## Root cause

`src/ws/hub.ts` kept all WebSocket state in a process-local `Set`. Envoy round-robins with **no
session affinity**, so `POST /api/messages` and the author's WebSocket routinely hit different
instances. `broadcast()` only iterated local sockets — the instance that handled POST had no
connection to the author.

The frontend renders the sender's message **only** from the WebSocket echo (`web/app.js` ignores the
POST response), so a missed fan-out looks like a lost message.

Secondary issue (R4): delivery scanned every connection (`O(all sockets)`) instead of room members.

## Fix

1. **`Map<conversationId, Set<WebSocket>>`** — rooms updated on subscribe, cleaned on close/error.
2. **`ioredis`** client in `src/db/redis.ts` (shared publisher + dedicated subscriber connection).
3. **`broadcast()`** — publish-only to `relay:events`; no direct local send.
4. **`initRedisFanout()`** — subscribe at startup; each instance delivers to its local room members.
5. **`src/index.ts`** — `waitForRedis()` + `initRedisFanout()` before listen.

## Contributions

**User proposed**
- Fix R6 + R4; use `ioredis`; clarify dependency approval before adding packages.

**Agent proposed**
- Publish-only path, single channel, fail-open on publish errors — all adopted.
- `spec/multi-instance-realtime.md` and unit tests in `src/ws/hub.test.ts`.

**Agreed**
- Sticky sessions deferred; Redis pub/sub is the cross-instance mechanism.

## Alternatives considered

- **Envoy sticky sessions alone** — insufficient when HTTP and WS diverge; kept for future optional
  optimisation.
- **Dual local + Redis send** — rejected (double delivery / origin filtering complexity).

## Verification

Tests (red → green):

```bash
docker compose run --rm -e REDIS_URL=redis://redis:6379 api npm test
# 3 passed
```

Manual: `--scale api=3`, two tabs, repeated sends — author and peer both receive frames.

## Dead ends

None.

## Trade-offs and follow-ups

- Redis pub/sub is fire-and-forget; missed frames need HTTP recovery (R3 reconnect).
- Sticky sessions in Envoy can reduce cross-instance traffic later but are not required for correctness.
- R1 heartbeat, R2 backpressure, R5 subscribe auth remain open.
