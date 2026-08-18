# Unified conversation access boundary (PR 1)

## Symptom

Any client could read or receive realtime events for conversations they did not belong to:

- `GET /api/messages` had no session or membership check — anonymous IDOR over `conversationId`.
- `GET /api/conversations?userId=` impersonated any seeded user without a cookie.
- `POST /api/messages` authenticated the sender but not their participation in `conversationId`.
- WebSocket `subscribe` trusted client-supplied `conversationIds` with no auth on upgrade.

## Reproduction

```bash
# Before fix: 200 with message bodies
curl -s 'localhost:3000/api/messages?conversationId=1&limit=10' | jq '.messages | length'

# Before fix: another user's conversation list
curl -s 'localhost:3000/api/conversations?userId=2' | jq 'map(.id)'
```

After fix:

```bash
curl -s -o /dev/null -w '%{http_code}\n' 'localhost:3000/api/messages?conversationId=1&limit=10'
# 401

curl -s -o /dev/null -w '%{http_code}\n' 'localhost:3000/api/conversations?userId=1'
# 401

COOKIE=$(curl -s -D - -o /dev/null -X POST http://localhost:3000/api/session \
  | rg -i 'set-cookie: relay_session=([^;]+)' -r '$1')
curl -s -o /dev/null -w '%{http_code}\n' -H "Cookie: relay_session=$COOKIE" \
  'http://localhost:3000/api/messages?conversationId=99999&limit=10'
# 404 (same as forbidden foreign id)
```

## Root cause

Participation was enforced only in the SQL for `GET /api/conversations` (`WHERE p.user_id = ?`). Other
HTTP paths and the WebSocket hub never called `conversation_participants`. Legacy
`sessionOrQueryUserId` in `src/middleware/session.ts:49-70` treated `?userId=` as proof of identity.

## Fix

- **`src/services/conversationAccess.ts`** — `assertConversationAccess` and
  `filterMemberConversationIds` (single join on `conversation_participants`).
- **`src/middleware/conversationAccess.ts`** — Express middleware; returns **404** for missing and
  forbidden conversations (no existence oracle).
- **HTTP wiring** — `requireSession` + membership on `GET`/`POST /api/messages`; `requireSession` only
  on `GET /api/conversations`; removed `sessionOrQueryUserId`.
- **`src/ws/hub.ts`** — `verifyClient` validates session cookie and same-origin `Origin`; `subscribe`
  filters ids through `filterMemberConversationIds`.

## Verification

| Check | Before | After |
|---|---|---|
| `npm test` (no Redis on host) | N/A | 30 pass, 30 skip, 0 fail |
| Anonymous `GET /api/messages` | 200 | **401** |
| Legacy `?userId=` list | 200 | **401** |
| Member `GET /api/messages?conversationId=1` | 200 | **200** |
| Member `GET …conversationId=99999` | 200 (empty/leak) | **404** |
| Red tests in `conversation-access.test.ts` | fail | pass (with stack + Redis) |

## Contributions

**User proposed**
- Implement PR 1 from `docs/017-critical-high-review.md` — unified conversation authorization.
- Minimal fix scope; confirmed spec in Phase 2.

**Agent proposed**
- Reuse shared `conversationAccess` service for HTTP and WS — **adopted**.
- WebSocket auth at upgrade via `verifyClient` — **adopted**.
- Same **404** for missing and forbidden conversations — **adopted**.
- Remove `sessionOrQueryUserId` entirely — **adopted**.

**Changed during implementation**
- Updated integration tests and WS unit tests to authenticate with seeded Redis sessions.
- Renamed resilience cap test to assert membership filtering (seed data has no 75 conversations).

## Alternatives considered

See `spec/conversation-access.md`.

## Dead ends

None.
