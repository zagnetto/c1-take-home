# S2 — graceful shutdown

## Symptom

`docker compose restart api` (or `SIGTERM`/`SIGINT`) killed the Node process immediately. In-flight
HTTP requests were cut off — including mid dual-write — MySQL/Mongo/Redis pools stayed open, and
WebSocket clients saw abrupt disconnects with no close frame.

## Reproduction

Before this fix, `src/index.ts` had no signal handlers. Any restart was a hard kill.

Verify the fix:

```bash
npm test -- src/shutdown.test.ts
# 6 pass
```

On a running stack, restart and confirm a log line:

```bash
docker compose restart api
docker compose logs api --tail 5
# "received SIGTERM, shutting down gracefully"
```

## Root cause

`src/index.ts` called `server.listen` but never registered `SIGTERM`/`SIGINT`. Docker sends
`SIGTERM` on stop/restart; without handlers the default is immediate exit.

## Fix

- **`src/shutdown.ts`** — testable orchestrator: close WS clients → `server.close()` (drain) → close
  MySQL pool, Mongo client, Redis client + subscriber. Timeout via `SHUTDOWN_TIMEOUT_MS` (default
  10 000 ms); `exit(1)` on timeout.
- **`src/ws/hub.ts`** — `closeWsServer()` sends `1001 server shutting down` to each client; does
  **not** call `wss.close()` on the shared HTTP server (that would abort in-flight REST).
- **`src/db/{mysql,mongo,redis}.ts`** — `closeMysql`, `closeMongo`, `closeRedis`.
- **`src/index.ts`** — `installGracefulShutdown` after listen.
- **`docker-compose.yml`** — `stop_grace_period: 15s` on `api` (timeout + headroom).

## Verification

| Check | Before | After |
|---|---|---|
| `src/shutdown.test.ts` | module missing (red) | **6 pass** |
| Full suite | — | **33 pass**, 16 skip |
| WS close on shutdown | abrupt TCP drop | code **1001**, reason `server shutting down` |
| In-flight HTTP | aborted | completes before deps close |

## Contributions

**User proposed**
- Fix S2 from architecture audit.
- `SHUTDOWN_TIMEOUT_MS` env with 10 s default.
- `stop_grace_period: 15s` on `api` in docker-compose.

**Agent proposed**
- Injectable `createGracefulShutdown(deps)` for unit tests — **adopted**
- Close WS clients before `server.close()` (shared HTTP server) — **adopted**
- Do not call `wss.close()` before HTTP drain — **adopted** (dead end below)

**Agreed in Phase 2**
- See `spec/graceful-shutdown.md`.

**Changed during implementation**
- Added `releaseWebSockets()` to clear the WSS ref after `server.close()` drains connections.
- Moved `installGracefulShutdown` before DB startup; skip `server.close()` when `!server.listening`.
- On drain timeout, call `server.closeAllConnections()` before `exit(1)`.

## Alternatives considered

See `spec/graceful-shutdown.md`.

## Dead ends

- **`wss.close()` before `server.close()`** — on a shared HTTP server this aborted in-flight REST
  requests (`fetch failed` in the drain test). Fix: only send WS close frames; let `server.close()`
  drain all TCP connections.
