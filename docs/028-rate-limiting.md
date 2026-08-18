# Rate limiting on message send

## What shipped

`POST /api/messages` now enforces a Redis-backed send quota: **5 messages / 10 seconds / user /
conversation** by default. Over-limit requests return **`429`** with **`Retry-After`** (seconds,
rounded up). Limits are scoped per session user and conversation, so one noisy sender does not
throttle others.

Files:

- `src/config.ts` — `messageRateLimitMax`, `messageRateLimitWindowMs` (env-overridable; see `.env.example`)
- `src/constants/redis.ts` — `messageRateLimitKey()`
- `src/services/rateLimit.ts` — Lua reserve/release + `retryAfterSecondsFromPttl`
- `src/services/messages.ts` — `messageExistsForClientId()` for idempotent bypass
- `src/controllers/messagesController.ts` — enforce before dual-write

## Verification

```bash
npm test
```

With the stack running (`docker compose up`):

```bash
COOKIE=$(curl -si -X POST localhost:3000/api/session | tr -d '\r' | awk '/^set-cookie:/ {print $2}')

for i in $(seq 1 5); do
  curl -s -o /dev/null -w "send $i: %{http_code}\n" -X POST localhost:3000/api/messages \
    -H "content-type: application/json" -H "Cookie: $COOKIE" \
    -d "{\"conversationId\":1,\"body\":\"burst $i\",\"clientId\":\"$(uuidgen)\"}"
done

curl -si -X POST localhost:3000/api/messages \
  -H "content-type: application/json" -H "Cookie: $COOKIE" \
  -d '{"conversationId":1,"body":"blocked","clientId":"'"$(uuidgen)"'"}' \
  | tr -d '\r' | awk 'BEGIN{status=0} /^HTTP/{status=$2} /^Retry-After:/{print "Retry-After:", $2} END{print "status:", status}'
```

Expected: five `201`, then `429` with `Retry-After: <seconds>`.

Concurrent burst (optional):

```bash
seq 1 20 | xargs -P 20 -I{} curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST localhost:3000/api/messages -H "content-type: application/json" -H "Cookie: $COOKIE" \
  -d "{\"conversationId\":1,\"body\":\"concurrent {}\",\"clientId\":\"$(uuidgen)\"}"
```

With `--scale api=3`, the same cap holds (in-process counters would allow ~3× quota).

## Why Lua (`redis.eval`) instead of plain TypeScript commands

The limit must stay exact when several API instances handle a burst at once (`docker compose --scale
api=3`, `xargs -P 20`). Separate Redis commands from Node are **not atomic across clients**:

| Approach | Problem |
|---|---|
| `GET` → compare → `SET` | Two instances both read `4`, both pass → 6+ sends |
| `INCR` then `PEXPIRE` in TS | Crash between commands leaves a key with no TTL; two round trips |
| `INCR` → check → `DECR` on 429 in TS | Gap between commands lets another instance slip in; cap drifts |

`redis.eval` runs the reserve script as **one atomic step** on the Redis server:

1. `INCR` the counter
2. `PEXPIRE` on first increment (TTL always paired with creation)
3. `DECR` when over limit so a rejected 429 does **not** consume quota
4. return `PTTL` for `Retry-After`

That matches `tasks/rate-limiting.md` (multi-instance) and the repo skill
(`.cursor/skills/relay-redis-conventions/SKILL.md`).

**Simpler options we rejected**

- **INCR-only, count 429s too** — less code, but spamming at the limit burns quota faster and
  conflicts with idempotent retries.
- **`ioredis.defineCommand`** — same Lua, only hides it; eval is fine for two small scripts.
- **In-process `Map`** — breaks immediately with `--scale api=3`.

Inline rationale also lives in `src/services/rateLimit.ts` above `RESERVE_MESSAGE_SEND_SLOT`.

## Behaviour notes

- **Idempotent retries** (`clientId` already stored) skip the limit entirely.
- **Reserved but not created** slots are released on error or duplicate-key replay (`isNew: false`).
- **Redis down** → fail open with a warning log; sends proceed.
- **Fixed window** — small burst possible across window boundaries; documented in spec.

## Contributions

**User proposed**
- Implement rate limiting from `tasks/rate-limiting.md` in a single PR.

**Agent proposed**
- Lua reserve with decrement-on-reject — **adopted**.
- Idempotent `clientId` bypass — **adopted**.
- Fail open on Redis outage — **adopted**.

**Agreed in Phase 2**
- See `spec/rate-limiting.md`.

**Changed during implementation**
- Env-overridable limits via `MESSAGE_RATE_LIMIT_*` and `positiveIntFromEnv` (`src/helpers/envInt.ts`).
- Documented why `redis.eval`/Lua is used instead of separate INCR/EXPIRE commands (user review).

## Dead ends

- Increment-only Lua (no decrement on reject) — rejected because probe requests at the limit would
  consume quota and block legitimate sends sooner than intended.

## Alternatives considered

See `spec/rate-limiting.md`.
