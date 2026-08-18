# S1 — idempotent Mongo seed for message bodies

## Goal

Stop `docker/db/seed.ts` from wiping user-created message bodies on every `docker compose up`, while
still inserting the three demo bodies on a fresh MongoDB.

Identified as **S1** in `docs/architecture-audit.md`.

## Non-goals

- Repairing bodies after a partial Mongo wipe while MySQL still has rows (needs a separate backfill).
- Adding named volumes to `docker-compose.yml` (reproduction aid only; not required for the fix).
- Changing MySQL init (`docker/db/mysql.sql`) — it already runs only on an empty data directory.

## Contributions

**User proposed**
- Reproduce S1 with row-count comparison after `docker compose down && docker compose up` (equal counts
  — led to diagnosing a flawed reproduction, not disproving the bug).
- Final fix: insert default demo bodies **only when the collection is empty**; remove `deleteMany`
  entirely.

**Agent proposed**
- Upsert demo records `_id: 1..3` with `updateOne` + `upsert` instead of `deleteMany` + `insertMany` —
  **rejected** (user chose skip-if-empty; upsert only repairs demo ids, not user bodies, with more code
  for no gain on the main failure mode).

**Agreed in Phase 2**
- Extract seed logic into a testable function.
- `countDocuments() === 0` → `insertMany` the three demo bodies; otherwise log and exit without writes.
- No `deleteMany`.

## Design

`docker/db/seedMessageBodies.ts` exports `seedMessageBodies(collection)`:

1. Read `existingCount = await bodies.countDocuments()`.
2. If `existingCount > 0`, return `{ action: 'skipped', existingCount }`.
3. Else `insertMany` the three fixed demo documents and return `{ action: 'inserted', count: 3 }`.

`docker/db/seed.ts` connects Mongo and delegates to that function.

## Alternatives considered

| Option | Why it lost |
|---|---|
| Upsert ids 1–3 without `deleteMany` | More code; only re-seeds demo rows; same blind spot on partial Mongo wipe as skip-if-empty. |
| Run seed only on first compose project boot | Harder to express in Compose than an empty-collection check inside the script. |
| Named volumes + conditional seed service | Does not remove the destructive `deleteMany`; masks reproduction instead of fixing root cause. |

## Contracts

- On empty `message_bodies`: exactly three documents with `_id` 1, 2, 3 (unchanged demo content).
- On non-empty collection: zero writes; existing documents preserved.
- Stdout: `seeded 3 message bodies` or `message bodies already present (N), skipping seed`.

## Failure modes

| Case | Behaviour |
|---|---|
| Mongo empty, MySQL has extra messages | Only demo bodies inserted; extra MySQL rows still lack bodies (pre-existing dual-write gap). |
| Seed runs twice on empty collection | Second run is a no-op if the first insert succeeded. |
| Mongo unavailable | Seed container exits with error; `api` does not start (`depends_on: service_completed_successfully`). |

## How to verify

Unit tests: `src/seedMessageBodies.test.ts` (empty → insert; non-empty → skip).

Integration (stack running, MySQL row already added):

```bash
docker compose exec mysql mysql -uroot -proot relay -e \
  "INSERT INTO messages (conversation_id, sender_id, client_id) VALUES (1, 1, 's1-verify');"
docker compose run --rm seed
docker compose exec mysql mysql -uroot -proot relay -N -e "SELECT COUNT(*) FROM messages"
docker compose exec mongo mongosh relay --quiet --eval 'db.message_bodies.countDocuments()'
```

After fix: MySQL count unchanged; Mongo count unchanged (not reset to 3).
