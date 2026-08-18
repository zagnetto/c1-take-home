---
name: relay-redis-conventions
description: How to introduce and use Redis in Relay — client module, key namespace, TTL rules, pub/sub connections, atomic rate limiting with Lua, and failure behaviour when Redis is unavailable. Use when implementing rate limiting, cross-instance fan-out, typing indicators, presence, caching, or any shared state that must outlive a single process.
---

# Relay Redis Conventions

Redis 7 already runs in `docker-compose.yml` and its URL is exposed as `config.redisUrl`
(`redis://redis:6379`), but **no client library is installed and nothing uses it**. It is the intended
home for every piece of state that must be shared between API instances.

## Client module

Add `ioredis` (`npm i ioredis`, then `docker compose up --build` — see
[relay-dev-workflow](../relay-dev-workflow/SKILL.md)) and create `src/db/redis.ts` mirroring the shape
of `src/db/mysql.ts` and `src/db/mongo.ts`:

- an exported shared client for commands,
- a lazily created **separate** connection for subscriptions (a subscriber connection cannot run other
  commands),
- a `waitForRedis()` retry helper called from `src/index.ts` alongside `waitForMysql()` and
  `connectMongo()`,
- `lazyConnect: false` and an explicit `maxRetriesPerRequest` so a dead Redis fails fast instead of
  queueing requests forever.

Do not create a connection per request or per WebSocket.

## Key namespace

Always prefix with `relay:` and go from general to specific, colon-separated:

```
relay:ratelimit:messages:<conversationId>:<userId>   # send quota counter
relay:typing:<conversationId>:<userId>               # ephemeral typing flag
relay:events                                          # pub/sub channel for realtime fan-out
```

Rules:

- Build keys in one small helper per domain, never with ad-hoc string concatenation at call sites.
- **Every ephemeral key gets a TTL in the same round trip that creates it.** A counter or flag without
  an expiry is a leak.
- Never use `KEYS` or `FLUSHALL` in application code; `SCAN` if you truly must enumerate. `KEYS` is
  fine at a `redis-cli` prompt while debugging.
- Keep values small and JSON-encoded when structured; Redis is not the system of record. MySQL and
  Mongo remain authoritative — see [relay-architecture](../relay-architecture/SKILL.md).

## Pub/sub

Used for realtime fan-out. Subscribe once at startup from the dedicated subscriber connection; publish
from the shared client. Payloads are JSON with the same `type` discriminator as WebSocket frames, so a
received message can be forwarded to local sockets without reshaping. Delivery is fire-and-forget: a
subscriber that is down misses messages, which is acceptable for notifications and unacceptable for
anything a client cannot re-fetch.

## Rate limiting

Requirements from `tasks/rate-limiting.md`: roughly 5 messages per 10 seconds, per user, per
conversation; over-limit sends get `429` plus `Retry-After`; must hold across instances.

Make the check **atomic** — `INCR` followed by a separate `EXPIRE` is a race that lets a key live
forever if the process dies in between, and a read-then-write check lets concurrent requests both pass.
Use a single Lua script (or `SET key 1 NX PX <window>` then `INCR`) that increments, sets the TTL on
first increment, and returns both the new count and the remaining TTL:

```lua
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return { count, redis.call('PTTL', KEYS[1]) }
```

- `Retry-After` is in **whole seconds**, rounded up from the returned TTL, minimum 1.
- A fixed window is acceptable for this scope; it allows a double burst across the window boundary.
  State that trade-off in your notes and mention the sliding-window or token-bucket alternative rather
  than pretending the limit is exact.
- Enforce **before** any expensive work or any write, and count only accepted sends.
- Limits belong in `src/config.ts` (env-overridable), not hardcoded at the call site.
- Scope strictly per user per conversation, so one noisy sender cannot throttle anyone else.
- Verify with the concurrent `xargs -P` burst from
  [relay-dev-workflow](../relay-dev-workflow/SKILL.md), and again with `--scale api=3`, where an
  in-process counter would let roughly three times the quota through.

## When Redis is unavailable

Decide per feature and document it; never let a Redis error crash a request or take down the process:

- Typing, presence, and other cosmetics: **fail open**, log once, carry on.
- Realtime fan-out: fail open for the write path (the message is already persisted and clients can
  re-fetch), and log loudly — silent loss of live updates is the worst outcome.
- Rate limiting: **fail open** with a warning log by default, because a dead cache should not stop
  people talking. If you prefer fail-closed, that is defensible — but say which you chose and why.

Wrap Redis calls so a failure surfaces as a logged degradation rather than a 500.
