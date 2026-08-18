# C2 — dual-write rollback on Mongo failure

## Symptom

A message appeared in the conversation list but rendered as an empty bubble. MySQL had a row in
`messages` with no matching document in `message_bodies`.

## Reproduction

Any failure between the two writes — Mongo timeout, network blip, or (in tests) a simulated
`insertOne` error after MySQL INSERT:

```bash
npm test -- src/services/messages-dual-write-rollback.test.ts
```

Compare counts on a running stack:

```bash
docker compose exec mysql mysql -uroot -proot relay -N -e "SELECT COUNT(*) FROM messages"
docker compose exec mongo mongosh relay --quiet --eval 'db.message_bodies.countDocuments()'
```

## Root cause

`createMessage` (`src/services/messages.ts`) inserted into MySQL first, then Mongo, with no
compensation. A failure after the first write left a permanent orphan row; `GET /api/messages` masked
it with `body ?? ''`.

## Fix

- Inner `try/catch` around Mongo `insertOne`.
- On failure, `rollbackMessageRow(id)` runs `DELETE FROM messages WHERE id = ?` inside its own
  `try/catch`; delete failure is logged, original Mongo error is rethrown.
- In-code comment notes the preferred production approach: **MySQL triggers + message broker**
  (transactional outbox), proposed by the project author.

Idempotent replay (`ensureMessageBody`) is unchanged — it still heals orphans created before this
fix or by process crash between writes.

## Contributions

**User proposed**
- Code rollback via `try/catch` + `DELETE`, with delete also wrapped in `try/catch`.
- Document and comment that MySQL triggers + message broker is the better long-term solution.

**Agent proposed**
- `rollbackMessageRow` helper with structured log on delete failure — **adopted**
- Test patching `db.collection` to simulate Mongo failure — **adopted**

**Agreed in Phase 2**
- Happy path only; replay path untouched.
- Rethrow Mongo error even when rollback delete fails.

## Alternatives considered

| Option | Why rejected |
|---|---|
| MySQL trigger + message broker | Best for production; deferred due to infra scope |
| Outbox table + worker | Same class as broker; heavier than compensating delete for this repo |
| Body in MySQL | Architectural change beyond C2 |
| Write Mongo first | Cannot assign `_id` before MySQL autoincrement |

## Verification

**Before:** `messages-dual-write-rollback.test.ts` failed — `8 !== 7` (orphan row after simulated Mongo error).

**After:**

```bash
npm test -- src/services/messages-dual-write-rollback.test.ts
# ok 1 - createMessage rolls back MySQL row when Mongo insert fails
```

## Dead ends

None — compensating delete was the first approach implemented.

## Trade-offs and follow-ups

- Does **not** cover crash between INSERT and Mongo (no durable outbox).
- If rollback DELETE fails, orphan remains until C3 replay or manual cleanup.
- Next step if scaling further: transactional outbox with MySQL trigger + broker, as proposed by
  the author.

See `spec/c2-dual-write-rollback.md`.
