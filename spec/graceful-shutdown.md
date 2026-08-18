# Graceful shutdown (S2)

## Goal

При `SIGTERM`/`SIGINT` (наприклад `docker compose restart api`) процес має:

1. Перестати приймати нові HTTP/WS з'єднання.
2. Дочекатися завершення активних HTTP-запитів (з таймаутом).
3. Закрити WebSocket-клієнтів із кодом **1001** і reason `server shutting down`.
4. Закрити пули MySQL, Mongo і Redis (client + subscriber).
5. Вийти з кодом **0** при успіху або **1** при таймауті.

## Design

### `src/shutdown.ts`

Тестований оркестратор `createGracefulShutdown(deps)` + `installGracefulShutdown(deps)`:

```
SIGTERM/SIGINT
  → ignore duplicate signals while shutting down
  → closeWebSockets()       // hub: close clients 1001; stop heartbeat
  → if server.listening:
      server.close()        // stop accepting; drain in-flight HTTP/WS TCP
      on timeout: server.closeAllConnections() then reject
      releaseWebSockets()   // drop WSS ref after server drained
  → closeMysql()            // pool.end()
  → closeMongo()            // client.close()
  → closeRedis()            // quit client + subscriber
  → exit(0)
  — on timeout: reject / exit(1)
```

Handlers register **immediately after** `createServer` + `attachWs`, before DB/redis startup — so
SIGTERM during `waitForMysql()` is caught. If the server is not listening yet, `server.close()` is
skipped and only deps are closed.

WebSocket clients must close **before** `server.close()` because WSS shares the HTTP server; otherwise
`server.close()` waits forever on open WS connections.

- **`SHUTDOWN_TIMEOUT_MS`** env var, default **10 000** ms.
- `installGracefulShutdown` реєструє `SIGTERM` і `SIGINT` один раз (guard against double install).

### `src/ws/hub.ts`

- Зберігати посилання на `WebSocketServer`.
- Експортувати `closeWsServer()`: для кожного клієнта `close(1001, 'server shutting down')`; не
  викликати `wss.close()` до HTTP drain (shared server).

### `src/db/*.ts`

- `mysql.ts`: `closeMysql()` → `pool.end()`.
- `mongo.ts`: `closeMongo()` → `client.close()`.
- `redis.ts`: `closeRedis()` → `unsubscribe`, `quit()` на client і subscriber.

### `src/index.ts`

Після `server.listen` викликати `installGracefulShutdown` з реальними deps.

### `docker-compose.yml`

```yaml
api:
  stop_grace_period: 15s   # SHUTDOWN_TIMEOUT_MS (10s) + запас
```

## Contracts (tests in `src/shutdown.test.ts`)

| Test | Asserts |
|---|---|
| waits for in-flight HTTP | `fetch` завершується до закриття deps; порядок `ws → mysql → mongo → redis` |
| closes WS with 1001 | клієнт отримує `close` code 1001, reason `server shutting down` |
| timeout | запит довший за timeout → reject з `/shutdown timed out/` |
| timeout force | `server.closeAllConnections()` викликається при timeout |
| pre-listen shutdown | `server.close()` пропускається коли `!server.listening`; deps все одно закриваються |
| signal registration | `installGracefulShutdown` додає по одному listener на SIGTERM/SIGINT |

## Alternatives considered

| Option | Why rejected |
|---|---|
| `process.exit(0)` одразу на сигнал | обриває in-flight запити і dual-write (C2 window) |
| Лише `server.close()` без закриття пулів | залишає відкриті MySQL/Mongo/Redis з'єднання |
| `server.closeAllConnections()` без drain | не дає активним запитам завершитися |
| Окремий health endpoint замість shutdown | не вирішує проблему при restart |

## Contributions

**User proposed**
- Пофіксити S2 (немає graceful shutdown) з architecture audit.

**Agent proposed**
- Окремий модуль `shutdown.ts` з injectable deps для юніт-тестів — **adopted**
- `SHUTDOWN_TIMEOUT_MS` env з дефолтом 10 с — **adopted** (user choice)
- `stop_grace_period: 15s` у docker-compose для `api` — **adopted** (user choice)
- WS close code 1001 (Going Away) — **adopted**

**Agreed in Phase 2**
- Таймаут через `SHUTDOWN_TIMEOUT_MS`, default 10 000 ms.
- Docker `stop_grace_period: 15s` на сервісі `api`.
