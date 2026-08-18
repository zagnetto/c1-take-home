---
name: relay-architecture
description: Explains the Relay chat app layout, runtime, split MySQL/Mongo data model, and the invariants any change must preserve. Use when orienting in this repo, adding a module, touching messages, conversations, or the message body storage, or when deciding where new code belongs.
---

# Relay Architecture

Relay is a chat/inbox app: Express HTTP API plus a WebSocket hub, served behind Envoy, with a
no-build vanilla JS frontend in `web/`.

## Runtime

- Node 22, ESM (`"type": "module"`), TypeScript executed directly by `tsx` — there is no build step
  and `tsconfig.json` sets `noEmit`. Type checking is advisory only; nothing enforces it at runtime.
- Relative imports carry explicit extensions (`from './config.ts'`). Keep that style; dropping the
  extension breaks the loader.

## Layers

HTTP requests flow **routes → controllers → services → db**. WebSocket fan-out is invoked from
controllers when a write should reach live clients (e.g. new message).

| Path | Responsibility |
|---|---|
| `src/index.ts` | Bootstrap: express, static `web/`, mount routers, create http server, attach WS, wait for MySQL/Mongo/Redis, listen |
| `src/config.ts` | Env parsing with docker-hostname fallbacks (`port`, `mysqlUrl`, `mongoUrl`, `redisUrl`) |
| `src/routes/*` | Express Router only: paths, middleware, `asyncHandler(controllerFn)` binding |
| `src/controllers/*` | Parse/validate input, call services, map errors → HTTP status/json; may call `broadcast()` for realtime orchestration |
| `src/services/*` | Domain logic and **all** MySQL / Mongo / Redis queries |
| `src/constants/*` | Limits, Redis key/channel names, infra error code sets (no I/O) |
| `src/helpers/*` | Pure utilities (`pagination`, `mysqlErrors`, …) |
| `src/helpers/validation/*` | Input parsers and sanitizers (`parsePositiveInt`, `sanitizeMessageBody`, …) |
| `src/middleware/*` | Session, conversation access, `asyncHandler`, global error handler |
| `src/db/*` | Connection singletons, `ensureIndexes` — no business queries |
| `src/ws/hub.ts` | WebSocket server, per-connection subscriptions, `broadcast()` |
| `src/testHelpers/*` | Shared fixtures for integration tests (`httpSession`, `wsSession`, …) |
| `web/` | Static frontend, plain JS, no bundler |
| `docker/` | Dockerfile, Envoy config, MySQL init SQL, Mongo seed script |

### Import rules

| Layer | May import | Must not |
|---|---|---|
| `routes/` | controllers, middleware | `pool`, `mongo`, `redis`, SQL, domain logic |
| `controllers/` | services, helpers, constants, `ws/hub` (orchestration) | `pool`, `mongo`, `redis`, raw SQL |
| `services/` | db clients, helpers, constants, other services | Express types, `req`/`res` |
| `helpers/` | other helpers, constants | db clients, Express |
| `db/` | config | business/domain logic |

Tests live in per-module `tests/` subfolders (`src/**/tests/**/*.test.ts`), co-located with the
code they exercise — not a top-level `src/tests/`.

**Where new code goes:** add the route wiring in `routes/`, HTTP mapping in `controllers/`, queries
and business rules in `services/`. See [relay-api-conventions](../relay-api-conventions/SKILL.md)
for endpoint shapes.

## Data model — deliberately split across two stores

MySQL (`docker/db/mysql.sql`) holds identity and metadata:

- `users(id, name, email)`
- `conversations(id, title, created_at)`
- `conversation_participants(conversation_id, user_id)` — composite PK, no FKs anywhere
- `messages(id BIGINT AI, conversation_id, sender_id, client_id NULL, created_at)` — **no body
  column, and no index on `conversation_id`**

MongoDB holds the text in collection `message_bodies`:

```
{ _id: <MySQL messages.id>, conversationId, senderId, body, signature, createdAt }
```

### Invariants to preserve

1. **`message_bodies._id` mirrors the MySQL autoincrement id.** The MySQL insert must happen first
   to obtain the id, then the Mongo document is written with it. Any new write path must keep both
   sides in step.
2. **The two writes are not atomic** and there is no compensation. A failure between them leaves a
   message row with no body; `services/messages.ts` masks that with `?? ''` on read. If you add a write
   path, decide explicitly how you handle a partial write and write it down.
3. **Reads must join by id in bulk**, not per row — the existing pattern is one MySQL query followed
   by a single `find({ _id: { $in: ids } })`.
4. `senderId` and `conversationId` are duplicated into Mongo. Keep them populated; search and any
   Mongo-side filtering rely on them.

## Infrastructure

- **Envoy** (`docker/envoy/envoy.yaml`) is the only published port (3000). It round-robins over the
  `api` cluster with `timeout: 0s` and websocket upgrade enabled. **There is no session affinity**,
  so a client's WebSocket and its HTTP requests can land on different instances.
- **API instances** use `expose`, not `ports` — reach them only through Envoy or `docker compose exec`.
- **Redis** backs session tokens and cross-instance WebSocket fan-out (`constants/redis.ts` key
  builders). See [relay-redis-conventions](../relay-redis-conventions/SKILL.md).
- **Seeding**: MySQL runs `docker/db/mysql.sql` only when its data directory is empty; the one-shot
  `seed` service inserts the matching Mongo bodies and `api` waits for it to complete. Seed data is
  users 1-3 (Alice, Bob, Carol), conversations 1-2, messages 1-3.

## Identity and state gaps to be aware of

- **Session auth** assigns a seeded user via `POST /api/session`; protected routes use
  `requireSession` and derive `senderId` from the session, not from client-supplied body fields.
- **Conversation access** is enforced on message routes via `requireConversationAccess`; other paths
  may still need explicit checks when added.
- The unread dot lives only in browser memory and is lost on reload; nothing server-side tracks a
  read position.

## Related skills

- Running, scaling, and inspecting the stack: [relay-dev-workflow](../relay-dev-workflow/SKILL.md)
- Known load-related defects and how to prove them: [relay-load-bug-triage](../relay-load-bug-triage/SKILL.md)
- Realtime contracts: [relay-realtime](../relay-realtime/SKILL.md)
