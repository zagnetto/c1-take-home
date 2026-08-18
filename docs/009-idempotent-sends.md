# C3 — idempotent message sends

## Symptom

Under slow responses or retries, the same logical send created duplicate messages in a conversation.
Users double-submitted when the UI felt stuck; proxy or client retries with the same payload also
created a second row.

## Reproduction

```bash
CLIENT_ID=$(uuidgen)
COOKIE=$(curl -si -X POST localhost:3000/api/session | tr -d '\r' | awk '/^set-cookie:/ {print $2}')

curl -s -X POST localhost:3000/api/messages \
  -H "content-type: application/json" -H "Cookie: $COOKIE" \
  -d "{\"conversationId\":1,\"body\":\"dup test\",\"clientId\":\"$CLIENT_ID\"}"

curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/api/messages \
  -H "content-type: application/json" -H "Cookie: $COOKIE" \
  -d "{\"conversationId\":1,\"body\":\"dup test\",\"clientId\":\"$CLIENT_ID\"}"
```

**Before fix:** both requests returned `201` with different `id` values.

## Root cause

`client_id` existed in MySQL and the frontend sent a UUID per send, but `createMessage` always
executed a blind `INSERT` with no deduplication (`src/services/messages.ts`). The unique index alone
would only turn a retry into a database error, not a safe replay.

## Fix

**Server**
- Catch `ER_DUP_ENTRY` on `client_id`, load the existing row, return the same `id` and body (`200`).
- Complete a missing Mongo body on replay when MySQL was written but Mongo was not (partial dual-write).
- Skip WebSocket `broadcast` on replay so subscribers do not see a duplicate frame.

**Client**
- Disable the composer input and Send button until the POST settles; `:disabled` styles dim both
  controls while in flight.
- One `clientId` per submit attempt; restore input text if `fetch` throws.

## Verification

```bash
npm test
```

Integration tests in `src/routes/messages-idempotent.test.ts` (requires `docker compose up`):

- duplicate `clientId` → `200` with the same `id` as the first `201`
- two concurrent posts with the same `clientId` → one `201`, one `200`, same `id`

## Contributions

**User proposed**
- **Return existing on conflict** on the server (`client_id` as idempotency key) — raised as the
  likely best fix and asked to confirm against alternatives.
- **Block send on the client** until the HTTP response returns — as a complementary UX guard, not a
  substitute for server-side dedup.
- Send button (and composer) must be **visually disabled** while the response is still pending.
- **Implement the combined approach** discussed in Phase 2: server idempotency plus client blocking,
  not client-only.

**Agent proposed**
- Defense-in-depth framing: server idempotency is required; client disable is complementary — **adopted**
- Skip broadcast on idempotent replay — **adopted**
- Complete missing Mongo body on replay — **adopted**
- Reuse one `clientId` per submit; restore text on fetch failure — **adopted**

**Agreed in Phase 2**
- Both layers ship together: return-existing-on-conflict on the server and disabled composer on the client.
- Duplicate replay returns the same `id`, not `409`.

## Alternatives considered

See `spec/idempotent-sends.md`.

## Dead ends

None.
