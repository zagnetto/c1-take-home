# Message read path — indexes, N+1 collapse, pagination

## Goal

Fix audit items **D2**, **D6**, and **D7** as one related read-path group:

- add MySQL index `(conversation_id, id)` on `messages`
- collapse conversation-list N+1 queries into a single aggregate query
- add keyset pagination to `GET /api/messages`
- add supporting indexes on both MySQL and Mongo for current and near-term queries

## Design

### MySQL indexes

| Index | Table | Columns | Why |
|---|---|---|---|
| `idx_messages_conversation_id` | `messages` | `(conversation_id, id)` | history reads, counts, last message, keyset pagination |
| `idx_participants_user_id` | `conversation_participants` | `(user_id, conversation_id)` | list conversations for a user |
| `idx_messages_client_id` | `messages` | `(client_id)` UNIQUE | future idempotent sends (C3) |
| `idx_users_email` | `users` | `(email)` UNIQUE | data integrity |

Fresh installs get indexes from `docker/db/mysql.sql`. Existing volumes get the same indexes from
`ensureIndexes()` on API startup (idempotent via `information_schema` check).

### Mongo indexes

| Index | Collection | Definition | Why |
|---|---|---|---|
| `idx_message_bodies_conversation_id` | `message_bodies` | `{ conversationId: 1 }` | conversation-scoped reads / search prep |
| `idx_message_bodies_body_text` | `message_bodies` | text on `body` | upcoming search task |

Current body fetch uses `_id $in`, which already hits the primary key; Mongo indexes are created at
startup for forward-looking queries.

### Conversation list (D6)

Replace the per-conversation loop (`1 + 2N` queries) with one query:

- aggregate `COUNT(*)` and `MAX(id)` grouped by `conversation_id`
- join back to `messages` on `MAX(id)` for last-message fields

Response shape is unchanged: `[{ id, title, messageCount, lastMessage }]`.

### Message history (D7)

```
GET /api/messages?conversationId=1&before=<messageId>&limit=50
```

- default `limit=50`, max `200`
- without `before`: return the newest page, ascending by `id`
- with `before`: return messages with `id < before`, ascending by `id`
- Mongo `$in` fetches bodies only for the current page

Frontend loads the newest page (`limit=200`) and prepends older pages when the user scrolls to the
top of `#messages`.

## Contracts

- `GET /api/conversations` — same JSON shape; one SQL round-trip instead of `1 + 2N`
- `GET /api/messages?conversationId=&limit=&before=` — still returns `[{ id, conversationId, senderId, createdAt, body }]`, ascending by `id`
- invalid `conversationId`, `limit`, or `before` → `400 { error: string }`

## Alternatives considered

| Option | Why rejected |
|---|---|
| Offset pagination (`OFFSET n`) | degrades on large tables; keyset on monotonic `id` is stable |
| Keep N+1 and only add index | index helps each query but still burns pool connections sequentially |
| Lazy-load Mongo bodies in a second loop | still N+1 on Mongo; page-scoped `$in` is bounded |
| Migration SQL file run manually | easy to forget; startup `ensureIndexes()` covers existing volumes automatically |

## Contributions

**User proposed**
- Fix D2 + D6 + D7 together as one read-path group
- Add all necessary indexes for both databases

**Agent proposed**
- `ensureIndexes()` on API startup for existing MySQL volumes — **adopted**
- Extract `parseLimit()` to a typed helper with unit tests — **adopted**
- Frontend scroll-up pagination with `before` — **adopted**
- Unique index on `client_id` and `users.email` as part of “all necessary indexes” — **adopted**

**Agreed in Phase 2**
- Single aggregate query for conversations
- Keyset pagination on `messages.id`
- Index definitions in both `mysql.sql` and startup ensure path
- Mongo indexes for `conversationId` and text search on `body`
