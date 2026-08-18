# Scalable conversation list query

**Status:** implemented — see `docs/021-conversation-list-scaling.md`.  
**Source:** `docs/017-critical-high-review.md` — PR 4.

## Goal

Fix `GET /api/conversations` so query cost scales with the **current user's conversations and their
messages**, not with total messages across the entire system.

## Problem

`src/routes/conversations.ts:42-46` builds a derived table that aggregates **all rows in
`messages`** before the user's membership filter is applied:

```sql
LEFT JOIN (
  SELECT conversation_id, COUNT(*) AS message_count, MAX(id) AS last_id
  FROM messages
  GROUP BY conversation_id
) stats ON stats.conversation_id = c.id
```

MySQL materializes this subquery over the full `messages` table on every list request. A user with
two conversations still pays for `GROUP BY` over every message in the database.

PR 1 (D6) already collapsed N+1 into one round-trip and added `(conversation_id, id)` on
`messages`; PR 4 closes the remaining global-aggregation gap.

## Design (recommended)

Scope the derived table to conversations the requesting user participates in, using the existing
`(user_id, conversation_id)` index on `conversation_participants`:

```sql
SELECT c.id,
       c.title,
       COALESCE(stats.message_count, 0) AS messageCount,
       m.id AS lastMessageId,
       m.sender_id AS lastSenderId,
       m.created_at AS lastCreatedAt
FROM conversations c
JOIN conversation_participants p ON p.conversation_id = c.id
LEFT JOIN (
  SELECT m.conversation_id,
         COUNT(*) AS message_count,
         MAX(m.id) AS last_id
  FROM messages m
  INNER JOIN conversation_participants cp
    ON cp.conversation_id = m.conversation_id AND cp.user_id = ?
  GROUP BY m.conversation_id
) stats ON stats.conversation_id = c.id
LEFT JOIN messages m ON m.id = stats.last_id
WHERE p.user_id = ?
ORDER BY c.id ASC
```

Parameters: `[userId, userId]` — same value bound twice (inner scope + outer filter).

### Why this shape

- **One SQL round-trip** — unchanged from current handler.
- **Response contract unchanged** — `[{ id, title, messageCount, lastMessage }]`.
- **Minimal diff** — only the derived table body changes; mapping code stays the same.
- **Index-friendly** — optimizer can drive from `idx_participants_user_id`, then use
  `idx_messages_conversation_id` per conversation instead of scanning the whole table.

Conversations with zero messages still appear (`LEFT JOIN stats`, `COALESCE(..., 0)`).

## Contracts

- `GET /api/conversations` (session required) — same JSON shape and sort order (`id ASC`).
- Functional behaviour identical for seeded data and existing integration tests.
- Query plan must not aggregate all system messages when the user belongs to a small subset of
  conversations (verified via regression test + `EXPLAIN`).

## Verification plan

### Phase 1 test (red)

Integration test (`src/routes/conversations-list-scaling.test.ts` or extend
`message-read.test.ts`):

1. Create a conversation **without** the test user as participant (or use a dedicated user with one
   conversation).
2. Bulk-insert a large number of messages into that foreign conversation (e.g. 5k–10k rows via
   direct `pool` insert).
3. Call `GET /api/conversations` as a user with few conversations.
4. Assert response shape/counts are still correct **and** that `EXPLAIN` on the list query shows
   examined rows dominated by the user's conversations (not total `messages` row count).

Cleanup: delete inserted messages and the foreign conversation in `after`/`finally`.

### Phase 3 verification

```bash
npm test -- src/routes/conversations-list-scaling.test.ts

docker compose exec mysql mysql -uroot -proot relay -e "
EXPLAIN ANALYZE
SELECT ... -- full scoped query with userId = 1
"
```

Record before/after examined rows in `docs/021-conversation-list-scaling.md`.

## Alternatives considered

| Option | Why rejected |
|---|---|
| **Keep global `GROUP BY`, add covering index only** | Index helps join but still aggregates every message on each request; does not meet PR 4 criterion. |
| **`LATERAL` correlated subquery per conversation** | Valid if `EXPLAIN ANALYZE` proves faster for typical inbox sizes; more verbose SQL and per-row subquery overhead when a user has many conversations. Fallback if scoped derived table plans poorly. |
| **Two round-trips** (fetch conv ids, then aggregate) | Violates "one SQL round-trip" boundary in `docs/017-critical-high-review.md`. |
| **Cached/materialized stats table or Redis** | Out of scope; adds write-path complexity and invalidation rules for a P1 read-path fix. |
| **Application-level loop with indexed queries** | Reintroduces N+1 pattern PR 1/D6 removed. |

## Contributions

**User proposed**
- Fix PR 4 from `docs/017-critical-high-review.md` — scalable conversation list.

**Agent proposed**
- Scope derived-table aggregation via `INNER JOIN conversation_participants` on `user_id` inside
  the subquery — **adopted**.
- Regression test that bulk-loads foreign messages and asserts via `EXPLAIN` that cost stays
  user-scoped — **adopted**.
- Export `LIST_CONVERSATIONS_SQL` for test reuse — **adopted**.

**Agreed in Phase 2**
- One SQL round-trip; unchanged JSON response shape.
- Scoped derived table as first choice; `LATERAL` only if plan fails `EXPLAIN ANALYZE`.
