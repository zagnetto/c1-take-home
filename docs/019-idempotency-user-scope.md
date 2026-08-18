# Idempotency scoped per sender

## Symptom

Two users sending with the same `clientId` caused the second sender to receive the first user's
message metadata and body. The second message was never stored.

## Reproduction

With the old global `UNIQUE (client_id)` index:

```bash
CLIENT_ID=$(uuidgen)
COOKIE_A=$(curl -si -X POST localhost:3000/api/session | tr -d '\r' | awk '/^set-cookie:/ {print $2}')
COOKIE_B=$(curl -si -X POST localhost:3000/api/session | tr -d '\r' | awk '/^set-cookie:/ {print $2}')

curl -s -X POST localhost:3000/api/messages \
  -H "content-type: application/json" -H "Cookie: $COOKIE_A" \
  -d "{\"conversationId\":1,\"body\":\"from A\",\"clientId\":\"$CLIENT_ID\"}"

curl -s -X POST localhost:3000/api/messages \
  -H "content-type: application/json" -H "Cookie: $COOKIE_B" \
  -d "{\"conversationId\":1,\"body\":\"from B\",\"clientId\":\"$CLIENT_ID\"}"
```

**Before fix:** second response returned User A's `id` and body `"from A"` with `200`.

## Root cause

- `docker/db/mysql.sql` — global `UNIQUE INDEX idx_messages_client_id (client_id)`.
- `src/services/messages.ts:53-63` — duplicate lookup by `client_id` only, ignoring `sender_id`.
- On `ER_DUP_ENTRY`, `returnExistingMessage` returned whichever row matched globally.

## Fix

- Replaced index with `UNIQUE (sender_id, client_id)` in bootstrap schema and startup migration
  (`src/db/ensureIndexes.ts` drops legacy index when present).
- Scoped lookup: `WHERE sender_id = ? AND client_id = ?`.
- On replay, reject mismatched `conversationId` or body with `409 IdempotencyConflictError`.
- True retry (same sender, conversation, body) still returns `200` without broadcast (C3).

## Verification

```bash
npm test
docker compose restart api   # pick up source + run index migration on existing volumes
npm test -- src/routes/messages-idempotent.test.ts
```

Integration tests (`src/routes/messages-idempotent.test.ts`, requires `docker compose up`):

- duplicate retry → `200`, same `id` (C3 regression)
- concurrent duplicate → one `201`, one `200`
- two senders, same `clientId` → both `201`, different `id`, correct bodies
- same sender, same `clientId`, different body → `409`
- same sender, same `clientId`, different conversation → `409`

## Contributions

**User proposed**
- Fix PR 2 from `docs/017-critical-high-review.md` — isolate idempotency between users.
- Index scope `(sender_id, client_id)` and `409` on payload mismatch — agreed in Phase 2.

**Agent proposed**
- Composite unique index + scoped lookup — **adopted**
- Semantic validation on replay; `409` for mismatch — **adopted**
- Idempotent index migration in `ensureIndexes()` — **adopted**
- Cross-user and conflict integration tests — **adopted**

## Alternatives considered

See `spec/idempotency-user-scope.md`.

## Dead ends

None.
