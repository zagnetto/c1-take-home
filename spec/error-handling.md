# Error handling (C4)

## Goal

Stop unhandled promise rejections in HTTP handlers from crashing the Node process. A single MySQL,
Mongo, or Redis driver error must return `{ error: string }` with status 500 and log server-side,
without killing WebSocket connections on that instance.

## Design

1. **`asyncHandler`** (`src/middleware/errorHandler.ts`) — wraps each async route handler so
   rejected promises call `next(err)` instead of becoming unhandled rejections.
2. **`errorHandler`** — terminal Express middleware registered after all routers in `src/index.ts`.
   Classifies errors before responding:
   - malformed JSON (`entity.parse.failed`) → `400` `{ error: 'invalid JSON body' }`
   - infrastructure / driver connectivity errors → `503` `{ error: 'service temporarily unavailable' }`
   - everything else → `500` `{ error: 'internal server error' }`
   Logs method + URL plus the error; never sends stack traces or driver messages to the client.
3. **Redis clients** (`src/db/redis.ts`) — `error` event listeners on main and subscriber
   connections so ioredis network blips do not become unhandled `error` events.
4. **Session middleware** already used `.catch(next)` on its internal async IIFE — no change needed.
5. **WebSocket hub** — message parsing and Redis publish already have local try/catch; out of scope
   for this HTTP-focused fix.

## Contracts

- Malformed JSON body → HTTP 400, body `{ error: 'invalid JSON body' }`.
- MySQL / Mongo / Redis connectivity failures → HTTP 503, body `{ error: 'service temporarily unavailable' }`.
- Unexpected application errors → HTTP 500, body `{ error: 'internal server error' }`.
- Expected failures (400 validation, 401, 503 session pool) continue to be returned directly from handlers unchanged.
- Process must not exit on a single driver error during a request or on an ioredis `error` event.
- Server logs must include method, URL, and the full error object.

## Alternatives considered

| Option | Why it lost |
|---|---|
| `express-async-errors` package | New dependency; five-line `asyncHandler` is enough |
| Inline `try/catch` in every handler | Duplicated boilerplate; easy to miss a handler |
| Global `unhandledRejection` handler only | Does not send a response — client hangs until Envoy timeout |
| Express 5 upgrade | Out of scope; async rejection handling is built-in but migration is large |

## Contributions

**User proposed**
- Add general error middleware and wrap handlers in try/catch with error logging (C4 from architecture audit).

**Agent proposed**
- Central `asyncHandler` wrapper instead of per-handler try/catch — **adopted** (same effect, DRY).
- Generic client message `'internal server error'` — **adopted** (matches relay-api-conventions).
- Classify infra errors as 503, malformed JSON as 400, attach `redis.on('error')` — **adopted** (follow-up).

**Agreed in Phase 2**
- Terminal error middleware after routers in `index.ts`.
- All async route handlers wrapped with `asyncHandler`.
- Unit tests for middleware behaviour.
- 503 vs 500 split, 400 for bad JSON, Redis error listeners.
