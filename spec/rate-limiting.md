# Rate limiting

## Goal

Protect `POST /api/messages` from send spam: cap each authenticated user to roughly **5 messages per
10 seconds per conversation**, return **HTTP 429** with **`Retry-After`** when over quota, and keep
counts consistent across `--scale api=3` via Redis.

## Design

### Config (`src/config.ts`)

| Setting | Env | Default |
|---|---|---|
| `messageRateLimitMax` | `MESSAGE_RATE_LIMIT_MAX` | `5` |
| `messageRateLimitWindowMs` | `MESSAGE_RATE_LIMIT_WINDOW_MS` | `10000` |

### Redis key

`relay:ratelimit:messages:<conversationId>:<userId>` — helper in `src/constants/redis.ts`.

### Atomic reserve (`src/services/rateLimit.ts`)

Lua script on send:

1. `INCR` the counter.
2. On first increment, `PEXPIRE` with the configured window.
3. If count exceeds max, `DECR` (rejected attempts do not consume quota) and return `{ allowed: 0, pttl }`.
4. Otherwise return `{ allowed: 1, pttl }`.

`Retry-After` = `ceil(pttl / 1000)`, minimum 1.

After a reserved slot, if `createMessage` fails or returns `isNew: false` (duplicate `clientId` race),
`releaseMessageSendSlot` decrements and deletes the key at zero.

### Controller flow (`src/controllers/messagesController.ts`)

After validation and session/conversation access middleware:

1. If `clientId` already exists for this sender (`messageExistsForClientId`), skip rate limit entirely
   (idempotent retries must not consume quota).
2. `reserveMessageSendSlot` — on reject, `429 { error: 'message rate limit exceeded' }` + `Retry-After`.
3. `createMessage` — release slot on failure or `isNew: false`.
4. Broadcast only for `isNew: true` (unchanged).

Enforcement happens **before** MySQL/Mongo writes.

### Redis unavailable

**Fail open** — log a warning and allow the send. A dead cache must not stop people talking.

### Window model

Fixed window (not sliding). Allows a small double burst across the window boundary; acceptable for
this scope.

## Contracts (tests)

| Case | Expected |
|---|---|
| 5 sends in window | `201` |
| 6th send same user + conversation | `429` + `Retry-After >= 1` |
| Same user, different conversation | not blocked |
| Different user, same conversation | not blocked |
| Duplicate `clientId` retry at full quota | `200`, bypasses limit |
| New sends after one idempotent create | only the first new send counts |

Unit tests cover `retryAfterSecondsFromPttl` in `src/services/tests/rateLimit.test.ts`.

Integration tests in `src/routes/tests/messages-rate-limit.test.ts` (requires `docker compose up`).

- Separate `INCR` + `PEXPIRE` + `DECR` in TypeScript — rejected after review; not atomic across
  `--scale api=3`, allows concurrent over-send and TTL leaks. See `docs/028-rate-limiting.md`
  § "Why Lua".

## Alternatives considered

| Option | Why not |
|---|---|
| In-process counter | Breaks with `--scale api=3` behind Envoy. |
| `INCR` + separate `EXPIRE` in TypeScript | Not atomic: TTL leak on crash; concurrent over-send under burst. |
| `INCR` → check → `DECR` on 429 in TypeScript | DECR races with other instances; cap drifts. **Lua eval avoids this.** |
| Count rejected 429s against quota | Punishes retries; conflicts with idempotent send design. |
| Fail closed when Redis is down | Blocks all sends during cache outage. |
| Sliding window / token bucket | More exact but heavier; fixed window is enough here. |
| `ioredis.defineCommand` wrapper | Same Lua underneath; eval is explicit enough for two scripts. |

## Contributions

**User proposed**
- Rate limit message sends (~5 / 10s / user / conversation); `429` + `Retry-After`; per-user scope;
  must work with multiple API instances; implement in one PR.
- Document why `redis.eval`/Lua is used instead of simpler separate Redis commands.

**Agent proposed**
- Redis Lua reserve with decrement-on-reject so over-limit probes do not consume quota — **adopted**.
- Skip rate limit when `clientId` already exists (idempotent replay) — **adopted**.
- Release reserved slot when `createMessage` fails or deduplicates — **adopted**.
- Fail open on Redis errors — **adopted** (per `relay-redis-conventions` skill).
- Env-overridable limits in `config.ts` — **adopted**.
- Frontend `429` handling deferred to a follow-up PR — **adopted**.

**Agreed in Phase 2**
- Backend-only in this change; fixed window; atomic Redis counter; tests + spec/docs in the same PR.
