# C2 — dual-write rollback

## Goal

When `createMessage` inserts a MySQL row but the Mongo body write fails, roll back the MySQL row so
the stores stay consistent and the client can retry without leaving a permanent empty bubble.

## Non-goals

- Atomicity across MySQL and Mongo (impossible without an outbox or single store).
- Rollback on process crash between the two writes (requires durable outbox + broker).
- Changing read paths (`?? ''` masking) or migrating bodies into MySQL.

## Contributions

**User proposed**
- Code-level rollback: wrap the dual write in `try/catch` and `DELETE` the MySQL row when Mongo
  fails; wrap the delete in its own `try/catch` too.
- Record in docs that the better long-term fix is **MySQL triggers + message broker**
  (transactional outbox).
- Leave an in-code comment pointing at that preferred approach.

**Agent proposed**
- Extract `rollbackMessageRow(id)` helper with logged delete failure — **adopted**
- Keep `ensureMessageBody` on idempotent replay for pre-existing orphans from before this fix —
  **adopted**
- Unit test simulating Mongo failure via patched `db.collection` — **adopted**

**Agreed in Phase 2**
- Happy-path `createMessage` only; replay path unchanged.
- If rollback `DELETE` fails, log and still rethrow the original Mongo error.
- Comment + `spec/` + `docs/015-dual-write-rollback.md`.

## Design

1. `INSERT` into MySQL (unchanged).
2. `insertOne` into Mongo in an inner `try`.
3. On Mongo error: `DELETE FROM messages WHERE id = ?` inside `rollbackMessageRow` (its own
   `try/catch`, log on failure), then rethrow the Mongo error.
4. Outer `catch` still handles `ER_DUP_ENTRY` for idempotent sends (C3).

## Alternatives considered

| Option | Why rejected |
|---|---|
| MySQL trigger + message broker (user's preferred production fix) | Correct eventual consistency, but new infra and scope for this take-home |
| Write Mongo first | `_id` must match MySQL `insertId`; orphaned bodies are harmless but IDs cannot be chosen upfront |
| Outbox table + background worker | Same pattern as broker without triggers; more moving parts than compensating delete |
| Store body in MySQL only | Removes dual-write entirely; out of C2 scope |
| Mongo-first with UUID `_id` | Schema and API contract change |

## Contracts

| Case | MySQL | Mongo | HTTP |
|---|---|---|---|
| Both writes succeed | 1 row | 1 doc | 201 |
| Mongo fails, rollback succeeds | unchanged | none | 5xx (error handler) |
| Mongo fails, rollback fails | orphan row | none | 5xx + error log |
| Retry after successful rollback | new row on replay | new doc | 201 |
| Idempotent replay (C3) | existing row | body completed if missing | 200 |

## Failure modes

- **Process crash** between MySQL INSERT and Mongo insert: orphan row possible; C3 replay can still
  complete the body via `ensureMessageBody`.
- **Rollback DELETE fails**: logged; caller sees Mongo error; orphan may remain until manual fix or
  idempotent replay with same `clientId`.
- **Duplicate key on Mongo (11000)**: treated as Mongo failure; rollback runs, then error propagates
  (extremely unlikely on fresh `insertId`).

## How to verify

```bash
npm test -- src/services/messages-dual-write-rollback.test.ts
```

Compare row counts when stack is up:

```bash
docker compose exec mysql mysql -uroot -proot relay -N -e "SELECT COUNT(*) FROM messages"
docker compose exec mongo mongosh relay --quiet --eval 'db.message_bodies.countDocuments()'
```
