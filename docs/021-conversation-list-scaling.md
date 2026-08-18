# PR 4 — scalable conversation list query

## Symptom

`GET /api/conversations` slowed as total messages in the system grew, even for users with only a
few conversations. Cost was tied to **all messages in the database**, not the requesting user's inbox.

## Reproduction

```bash
docker compose up -d

# Insert many messages into a conversation the test user does not belong to, then:
curl -s -b "relay_session=…" localhost:3000/api/conversations | jq length

# Before fix — derived table aggregates every row in messages:
docker compose exec mysql mysql -uroot -proot relay -e "
EXPLAIN SELECT c.id FROM conversations c
JOIN conversation_participants p ON p.conversation_id = c.id
LEFT JOIN (
  SELECT conversation_id, COUNT(*) AS message_count, MAX(id) AS last_id
  FROM messages GROUP BY conversation_id
) stats ON stats.conversation_id = c.id
WHERE p.user_id = 1\G"
```

With 3000+ foreign messages, the unscoped derived table `EXPLAIN` estimates examined rows on
`messages` at roughly the full table size; the scoped query stays near the user's conversation
message count.

## Root cause

`src/routes/conversations.ts` (pre-fix) built a derived table with `GROUP BY conversation_id` over
the entire `messages` table before filtering by `conversation_participants.user_id`:

```sql
LEFT JOIN (
  SELECT conversation_id, COUNT(*) AS message_count, MAX(id) AS last_id
  FROM messages
  GROUP BY conversation_id
) stats ON stats.conversation_id = c.id
```

MySQL materialized this subquery on every list request. PR 1/D6 removed N+1 and added
`(conversation_id, id)`, but the global aggregation remained.

## Fix

Scope the derived table to conversations the requesting user participates in:

```sql
LEFT JOIN (
  SELECT m.conversation_id, COUNT(*) AS message_count, MAX(m.id) AS last_id
  FROM messages m
  INNER JOIN conversation_participants cp
    ON cp.conversation_id = m.conversation_id AND cp.user_id = ?
  GROUP BY m.conversation_id
) stats ON stats.conversation_id = c.id
```

Handler binds `[userId, userId]`. SQL exported as `LIST_CONVERSATIONS_SQL` for regression testing.
Response contract unchanged.

## Verification

```bash
npm test -- src/routes/conversations-list-scaling.test.ts
npm test -- src/routes/message-read.test.ts
```

**Regression test:** bulk-inserts 3000 messages into a conversation Alice (user 1) is not in;
asserts `EXPLAIN` `messages` row estimates stay below half of total table rows and API response
still returns correct counts for Alice's conversations.

**After fix:** `conversations-list-scaling.test.ts` and `message-read.test.ts` pass against running
stack.

| Plan | `messages` access (seed + 3000 foreign rows) |
|---|---|
| Unscoped `GROUP BY` | ~full table (derived scan over all conversations) |
| Scoped join on `cp.user_id` | ~user's messages only |

## Contributions

**User proposed**
- Fix PR 4 from `docs/017-critical-high-review.md` — scalable conversation list.
- Proceed with the recommended scoped derived-table fix after reviewing risks.

**Agent proposed**
- Scope derived-table aggregation via `INNER JOIN conversation_participants` on `user_id` inside the
  subquery — **adopted**.
- Export `LIST_CONVERSATIONS_SQL` for `EXPLAIN` regression test — **adopted**.
- Regression test with 3000 foreign messages + `EXPLAIN` row estimate bound — **adopted**.

**Agreed in Phase 2**
- One SQL round-trip; unchanged JSON response shape.
- Scoped derived table as first choice; `LATERAL` only if plan fails `EXPLAIN ANALYZE`.

## Alternatives considered

See `spec/conversation-list-scaling.md`.

## Dead ends

None. Scoped derived table produced an acceptable plan on MySQL 8 without switching to `LATERAL`.
