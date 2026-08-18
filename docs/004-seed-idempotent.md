# S1 — seed script no longer wipes message bodies

## Symptom

After `docker compose up`, user-written messages can appear as empty chat bubbles: MySQL still lists
the rows, but MongoDB has no matching `message_bodies` document (hidden by `?? ''` in
`src/routes/messages.js`).

## Reproduction

The sequence in `docs/architecture-audit.md` (`down && up`, then compare counts) **does not show the
bug** with the stock `docker-compose.yml`, because MySQL and Mongo have no named volumes — both
stores reset when containers are removed.

Working reproduction (MySQL persists, seed re-runs):

```bash
docker compose up -d
docker compose exec mysql mysql -uroot -proot relay -e \
  "INSERT INTO messages (conversation_id, sender_id, client_id) VALUES (1, 1, 's1-repro');"
docker compose exec mongo mongosh relay --quiet --eval \
  'db.message_bodies.insertOne({_id: 4, conversationId: 1, senderId: 1, body: "kept", createdAt: new Date()})'
docker compose run --rm seed
docker compose exec mysql mysql -uroot -proot relay -N -e "SELECT COUNT(*) FROM messages"
docker compose exec mongo mongosh relay --quiet --eval 'db.message_bodies.countDocuments()'
docker compose exec mongo mongosh relay --quiet --eval 'db.message_bodies.findOne({_id: 4})'
```

**Before fix:** MySQL `4`, Mongo `3`, `findOne({_id: 4})` → `null`.

## Root cause

`docker/db/seed.ts` ran `deleteMany({})` on every `docker compose up` because the `seed` one-shot
service is a dependency of `api` with `service_completed_successfully`. MySQL init SQL runs only on
an empty data directory; Mongo had no equivalent guard — the seed always wiped the collection first.

## Fix

Extracted `seedMessageBodies()` in `docker/db/seedMessageBodies.ts`:

- If `countDocuments() > 0` → skip (no writes).
- If empty → `insertMany` the three demo bodies.
- Removed `deleteMany` entirely.

## Contributions

**User proposed**
- Verify S1 with count comparison after restart (surfaced that the audit repro needs persistent MySQL
  or a seed-only rerun).
- Final approach: seed demo bodies only when the collection is empty; drop `deleteMany`.

**Agent proposed**
- Upsert `_id: 1..3` instead of wipe-and-reinsert — **rejected** after user chose skip-if-empty
  (simpler, same protection for user data; upsert only helps re-repair demo rows, not the S1 failure).

**Agreed in Phase 2**
- Skip-if-empty + no `deleteMany`; unit tests on `seedMessageBodies`.

## Alternatives considered

| Option | Why it lost |
|---|---|
| Upsert demo ids 1–3 | Extra complexity; does not restore user bodies on partial Mongo loss. |
| Skip-if-empty (chosen) | Minimal diff; fixes every re-run of seed while data exists. |
| Volumes-only / compose-level “run seed once” | Leaves destructive script in place. |

## Verification

Unit tests (`npm test`):

- `seedMessageBodies inserts demo bodies when collection is empty` — pass.
- `seedMessageBodies skips when collection already has documents` — pass.

Integration after fix (same repro commands): MySQL `4`, Mongo `4`, `findOne({_id: 4})` retains body.

## Dead ends

- Treating equal MySQL/Mongo counts after `docker compose down && docker compose up` as disproof of
  S1 — both databases were resetting together without named volumes.

## Trade-offs and follow-ups

Skip-if-empty does not backfill bodies if Mongo is wiped while MySQL survives; that remains a manual /
operational recovery scenario. A future improvement would be per-message body repair or transactional
dual-write (see C2 in the architecture audit).
