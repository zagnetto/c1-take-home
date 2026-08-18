# PR 2 — idempotency scoped per sender

**Goal:** `clientId` must deduplicate retries only for the same sender. A collision between two
users (or a replay with different `conversationId` / body) must not return another user's message
or silently drop the send.

**Source:** `docs/017-critical-high-review.md` — PR 2.

## Problem

Today `client_id` is globally unique in MySQL and duplicate lookup ignores the sender:

| Layer | Today | Failure |
|---|---|---|
| Schema | `UNIQUE (client_id)` in `docker/db/mysql.sql:31` | User B cannot insert when User A already used the same UUID |
| Lookup | `findMessageByClientId(clientId)` in `src/services/messages.ts:53-63` | On `ER_DUP_ENTRY`, User B receives User A's row id, conversation, and Mongo body |
| Replay | `returnExistingMessage` always returns the found row | User B's message is never stored; client shows foreign content |

`clientId` is client-controlled (`web/app.js` generates `crypto.randomUUID()` per submit). UUID
collisions across users are unlikely but valid as an attack / bug class once idempotency treats
`client_id` as a global key.

## Design

### 1. Composite unique index — `(sender_id, client_id)`

Replace the global unique index with a per-sender scope.

```sql
-- bootstrap: docker/db/mysql.sql
UNIQUE INDEX idx_messages_sender_client_id (sender_id, client_id)

-- existing volumes: src/db/ensureIndexes.ts migration step
DROP INDEX idx_messages_client_id ON messages;          -- if present (old shape)
CREATE UNIQUE INDEX idx_messages_sender_client_id ON messages (sender_id, client_id);
```

**Why not `(sender_id, conversation_id, client_id)`?** Retries always reuse the same sender,
conversation, body, and `clientId`. A second send in another conversation should not silently reuse
the key — it is a conflict. `(sender_id, client_id)` is enough to isolate users and detect misuse.

MySQL allows multiple `NULL` `client_id` rows under a unique index (NULL ≠ NULL); sends without
`clientId` stay insert-only, unchanged from C3.

### 2. Scoped duplicate lookup

```ts
findMessageBySenderClientId(senderId: number, clientId: string)
  WHERE sender_id = ? AND client_id = ?
```

Pass `senderId` through `returnExistingMessage` and the `ER_DUP_ENTRY` path in `createMessage`.

### 3. Semantic match on replay — reject mismatch with `409`

When a row exists for `(senderId, clientId)`:

| Request vs stored | HTTP | Broadcast |
|---|---|---|
| Same `conversationId` and same body (after sanitize) | `200`, existing row | no |
| Different `conversationId` or different body | `409` `{ error: 'clientId already used for a different message' }` | no |
| MySQL row exists, Mongo body missing, body matches | `200`, heal Mongo (C3) | no |

Implementation sketch in `returnExistingMessage`:

1. Load row by `(senderId, clientId)`.
2. Load Mongo body (or heal if missing and body matches — keep C3 behaviour).
3. If `row.conversationId !== input.conversationId` or stored body ≠ input body → throw
   `IdempotencyConflictError`.
4. Otherwise return `{ message, isNew: false }`.

**Why `409` and not `200` with wrong data?** C3 explicitly chose return-existing over `409` for
true retries. Semantic mismatch is not a retry; returning foreign or stale content was the bug.
`409` matches existing duplicate-title handling in `src/routes/conversations.ts`.

**PR 1 coordination:** Scoped index means User B with User A's `clientId` inserts normally — no
cross-user row returned, no existence oracle. `409` applies only when the same sender reuses a
key with different payload.

### 4. Startup migration (not bootstrap-only)

`ensureIndexes()` today only **adds** missing indexes. Extend it with an idempotent upgrade:

1. If `idx_messages_sender_client_id` exists → done.
2. Else if legacy `idx_messages_client_id` on `(client_id)` exists → `DROP`, then create composite.
3. Else → create composite (fresh partial state).

Log the upgrade once; safe under `--scale api=3` (DDL is idempotent; concurrent drops may race —
acceptable for dev bootstrap; document if we see duplicate DDL errors).

Update `spec/message-read-optimization.md` index table and `MYSQL_INDEXES` constant.

## Contracts

| Case | HTTP | Rows |
|---|---|---|
| User A first send with `clientId` | `201` | 1 MySQL + 1 Mongo |
| User A retry (same payload) | `200`, same `id` | unchanged |
| User B send with User A's `clientId` | `201`, **different** `id` | separate rows |
| User A same `clientId`, different body | `409` | unchanged |
| User A same `clientId`, different `conversationId` | `409` | unchanged |
| Send without `clientId` | `201` (no dedup) | unchanged |

Existing C3 integration tests in `src/routes/messages-idempotent.test.ts` must stay green.

## Tests (Phase 1 — to add before implementation)

Integration (`messages-idempotent.test.ts` or sibling):

1. Two sessions, same `clientId`, same conversation → both `201`, different `id`, each body
   preserved.
2. Same session, same `clientId`, different body → second request `409`.
3. (Optional) same session, same `clientId`, different `conversationId` → `409`.

## Files to touch (Phase 3)

| File | Change |
|---|---|
| `docker/db/mysql.sql` | composite unique index |
| `src/db/ensureIndexes.ts` | migration + new index definition |
| `src/services/messages.ts` | scoped lookup, conflict check, error type |
| `src/routes/messages.ts` | map `IdempotencyConflictError` → `409` |
| `src/routes/messages-idempotent.test.ts` | cross-user + conflict cases |
| `spec/message-read-optimization.md` | index column docs |
| `spec/idempotent-sends.md` | note scope extension (link here) |
| `docs/019-idempotency-user-scope.md` | fix note after green |

## Alternatives considered

| Option | Why rejected |
|---|---|
| Keep global unique, namespace `clientId` server-side | Breaks client-generated retry key; does not fix lookup leak on `ER_DUP_ENTRY` |
| `(sender_id, conversation_id, client_id)` unique | Allows reusing one UUID across conversations for the same user — wrong semantics |
| `409` on any duplicate including true retry | Breaks C3 contract; client would need conflict handling on normal retry |
| Pre-SELECT before INSERT | Extra hot-path round-trip; duplicate catch stays sufficient with scoped index |
| Redis per-user idempotency namespace | New dependency; MySQL already stores `client_id` |

## Contributions

**User proposed**
- Fix PR 2 from `docs/017-critical-high-review.md` — isolate idempotency between users.

**Agent proposed**
- Composite unique index `(sender_id, client_id)` — **adopted**
- Scoped lookup + semantic validation; `409` on payload mismatch — **adopted**
- Idempotent index migration in `ensureIndexes()` — **adopted**
- Cross-user integration test as Phase 1 red test — **adopted**

**Agreed in Phase 2**
- Unique index on `(sender_id, client_id)` only (not `conversation_id`).
- Same sender reusing `clientId` with different body or conversation → `409`.
- Cross-user same `clientId` → independent `201` responses.
- True retry (same sender, conversation, body) → `200` unchanged from C3.
