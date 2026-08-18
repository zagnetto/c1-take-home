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
- `allowJs: true`, `checkJs: false`, so the `.js` files under `src/routes/` are completely unchecked
  even though they use TS-only import specifiers. Treat them as legacy: see
  [relay-api-conventions](../relay-api-conventions/SKILL.md).

## Layers

| Path | Responsibility |
|---|---|
| `src/index.ts` | Bootstrap: express, static `web/`, mount routers, create http server, attach WS, wait for MySQL and Mongo, listen |
| `src/config.ts` | Env parsing with docker-hostname fallbacks (`port`, `mysqlUrl`, `mongoUrl`, `redisUrl`) |
| `src/routes/*` | HTTP boundary, mounted at `/api/conversations`, `/api/messages`, `/api/search` |
| `src/services/*` | Domain logic (`createMessage` is the only one so far) |
| `src/db/*` | Connection singletons plus retry helpers (`pool`/`waitForMysql`, `connectMongo`/`mongo`) |
| `src/ws/hub.ts` | WebSocket server, per-connection subscriptions, `broadcast()` |
| `web/` | Static frontend, plain JS, no bundler |
| `docker/` | Dockerfile, Envoy config, MySQL init SQL, Mongo seed script |

Route handlers must not own domain logic. New behaviour belongs in `src/services/`, so it can be
reused by both the HTTP and realtime paths.

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
   message row with no body; `src/routes/messages.js` masks that with `?? ''`. If you add a write
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
- **Redis** is running and its URL is in `config.redisUrl`, but nothing uses it and no client library
  is installed. It is the intended home for cross-instance state: see
  [relay-redis-conventions](../relay-redis-conventions/SKILL.md).
- **Seeding**: MySQL runs `docker/db/mysql.sql` only when its data directory is empty; the one-shot
  `seed` service inserts the matching Mongo bodies and `api` waits for it to complete. Seed data is
  users 1-3 (Alice, Bob, Carol), conversations 1-2, messages 1-3.

## Identity and state gaps to be aware of

- There is **no authentication**. `web/app.js` hardcodes `userId = 1` and every endpoint trusts the
  `userId`/`senderId` it receives. Do not build a feature that assumes a trustworthy caller without
  saying so in your notes.
- Conversation membership is never checked on read or write, so any user id can post into any
  conversation.
- The unread dot lives only in browser memory and is lost on reload; nothing server-side tracks a
  read position.

## Related skills

- Running, scaling, and inspecting the stack: [relay-dev-workflow](../relay-dev-workflow/SKILL.md)
- Known load-related defects and how to prove them: [relay-load-bug-triage](../relay-load-bug-triage/SKILL.md)
- Realtime contracts: [relay-realtime](../relay-realtime/SKILL.md)
