# C4 — error middleware and async handler wrapping

## Symptom

Any unhandled rejection in an async Express 4 route handler (e.g. MySQL connection failure) caused
Node 22 to terminate the process. Docker `restart: on-failure` hid the crash; all WebSocket
connections on that instance died and clients saw realtime stop working.

## Reproduction

1. Start the stack: `docker compose up`.
2. Trigger a driver error in any async handler (e.g. temporarily break MySQL connectivity).
3. Before fix: process exits, `docker compose logs api` shows restart, WebSockets drop.
4. After fix: request gets HTTP 500 with `{ error: 'internal server error' }`, process stays up.

## Root cause

`src/index.ts` had no terminal `(err, req, res, next)` middleware. Route handlers in
`src/routes/*.js` and `session.ts` were plain `async (req, res) =>` functions — Express 4 does not
catch rejected promises, so driver errors became unhandled rejections (`docs/architecture-audit.md`
C4).

## Fix

- Added `src/middleware/errorHandler.ts` with `asyncHandler` (forwards rejections to `next`) and
  `errorHandler` (classifies + responds):
  - `400` for malformed JSON (`entity.parse.failed`)
  - `503` for infrastructure connectivity errors (MySQL/Mongo/Redis network codes)
  - `500` for unexpected application errors
- Registered `errorHandler` after all routers in `src/index.ts`.
- Wrapped every async route handler with `asyncHandler` in `messages.js`, `conversations.js`,
  `search.js`, and `session.ts`.
- Added `redis.on('error', ...)` on main and subscriber clients in `src/db/redis.ts`.
- Session auth middleware already used `.catch(next)` — left unchanged.

## Verification

```bash
npm test -- src/middleware/errorHandler.test.ts src/db/redis.test.ts
```

Seven middleware tests + one Redis listener test pass: 500/503/400 response shapes, no leak of
driver text, `headersSent` delegation, `asyncHandler` forwarding, Redis error listeners registered.

## Alternatives considered

See `spec/error-handling.md`.

## Dead ends

None.

## Contributions

**User proposed**
- General error middleware + try/catch with logging for C4.

**Agent proposed**
- `asyncHandler` wrapper instead of inline try/catch in each route — **adopted**.
- Generic `'internal server error'` client message — **adopted**.
- 503 for infra errors, 400 for malformed JSON, Redis `error` listeners — **adopted**.

**Agreed in Phase 2**
- As in spec.

**Changed during implementation**
- Malformed JSON logged with `console.warn` (client fault) instead of `console.error`.
