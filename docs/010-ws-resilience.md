# WebSocket resilience (R1 + R2 + R3)

## Symptom

- Half-open WebSocket connections accumulated forever (sleeping laptop, NAT timeout) — server never
  reaped them (R1).
- Slow consumers caused unbounded in-process send buffers — no `bufferedAmount` check (R2).
- Any disconnect (deploy, process restart, network blip) permanently killed realtime in the tab — no
  reconnect, no UI indicator (R3).

## Root cause

- `src/ws/hub.ts`: cleanup only on explicit `close`; `deliverToRoom` called `send()` without
  backpressure limits; no `maxPayload` or subscription cap.
- `web/app.js`: `connectWs()` only on page load / new conversation; no `onclose` handler.

## Fix

### R1 — Heartbeat (`src/ws/hub.ts`)

- Server ping every `WS_HEARTBEAT_MS` (default 30s).
- One missed pong cycle → `removeClient()` + `terminate()`.

### R2 — Limits (`src/ws/hub.ts`)

- `WS_MAX_BUFFERED_BYTES` (default 1 MiB): terminate before send when exceeded.
- `WS_MAX_PAYLOAD_BYTES` (default 16 KiB): `WebSocketServer({ maxPayload })`.
- `WS_MAX_SUBSCRIPTIONS` (default 500): truncate subscribe list.

### R3 — Client reconnect (`web/app.js`, `web/index.html`)

- Exponential backoff + jitter (cap 30s) on unexpected close.
- Resubscribe + refresh conversations; HTTP refetch of active conversation after reconnect.
- `#wsStatus` badge: Live / Reconnecting / Offline.

## Verification

```bash
node --import tsx --test --test-force-exit src/ws/hub.resilience.test.ts
```

Before: R1 and maxPayload tests **fail**. After: all 4 pass (2 need Redis for subscription-cap
integration test — skip locally without docker).

Manual:

1. Open app, confirm **Live** badge.
2. `docker compose restart api` — tab should show Reconnecting → Live and messages resume after
   opening a conversation.
3. `wscat` with `autoPong: false` — server terminates within ~2 heartbeat intervals.

## Contributions

**User proposed**
- Fix R3 + R1 + R2 together
- Heartbeat: one missed cycle → close (initial variant)

**Agent proposed**
- Env-tunable WS limits for tests — **adopted**
- `sendFrameForTest` export for backpressure unit assertion — **adopted**
- `#wsStatus` UI badge — **adopted**

**Agreed in Phase 2**
- See `spec/ws-resilience.md`

**Changed during implementation**
- Backpressure test uses `sendFrameForTest` mock instead of client-side `bufferedAmount` patch (client
  object ≠ server socket).

## Alternatives considered

- 2-strike heartbeat — rejected (user chose 1-cycle).
- Silent frame drop on backpressure — rejected (internal buffers still grow).

## Dead ends

- Patching `bufferedAmount` on the test client's `WebSocket` does not affect the server's socket
  object — integration test could not observe backpressure that way.
