# Conversation access boundary

**Goal:** one shared authorization rule — only conversation participants may read, write, or
receive realtime events for a conversation. Anonymous clients, other logged-in users, and
cross-origin WebSocket upgrades must not reach foreign data.

**Source:** `docs/017-critical-high-review.md` — PR 1.

## Problem

`conversation_participants` scopes the conversation list but does not guard other paths:

| Path | Today | Risk |
|---|---|---|
| `GET /api/messages` | no session, no membership | IDOR — enumerate `conversationId` |
| `POST /api/messages` | session only | send into foreign conversations |
| `GET /api/conversations` | `sessionOrQueryUserId` | `?userId=` impersonates any user |
| WebSocket `subscribe` | trusts client `conversationIds` | realtime leak without auth |

## Design (minimal)

### Shared service — already present

`src/services/conversationAccess.ts`:

- `assertConversationAccess(userId, conversationId)` → throws `ConversationNotFoundError`
- `filterMemberConversationIds(userId, ids)` → subset the user belongs to

Both use one SQL join on `conversation_participants`. **404** for missing *and* forbidden
conversations (same `{ error: 'conversation not found' }` body) — no existence oracle.

### HTTP

Wire existing `requireConversationAccess` middleware:

```
GET  /api/messages   → requireSession, requireConversationAccess({ source: 'query' })
POST /api/messages   → requireSession, requireConversationAccess({ source: 'body' })
GET  /api/conversations → requireSession  (drop sessionOrQueryUserId)
```

Delete `sessionOrQueryUserId` from `src/middleware/session.ts`.

Frontend (`web/app.js`) already uses `credentials: 'same-origin'` and never sends `?userId=`.

### WebSocket

Extend `src/ws/hub.ts` only — no protocol change for the frontend:

1. **`verifyClient` on upgrade:** parse `relay_session` cookie → `lookupSession`. Reject upgrade
   when session invalid.
2. **Origin check:** allow only when `Origin` host matches request `Host` (same-origin). Reject
   cross-origin upgrades even with a valid cookie.
3. **Store `userId` on the socket** after successful upgrade.
4. **On `subscribe`:** replace client ids with
   `await filterMemberConversationIds(userId, conversationIds)` before `setSubscriptions`.

No new env vars or dependencies. Cookie parsing reuses `parseCookies` from session middleware
(export it or move to a tiny shared helper).

### Out of scope (this PR)

- Idempotency scope (PR 2), XSS (PR 3), conversation list SQL (PR 4).
- `GET /api/search` — separate surface; not listed in PR 1 boundary.
- Session-auth spec change: `spec/session-auth.md` legacy `?userId=` contract is **superseded**
  here; update that spec in the same PR.

## Contracts

| Request | Auth | Membership | Success | Denied |
|---|---|---|---|---|
| `GET /api/conversations` | session cookie | implicit (SQL filters by user) | `200` list | `401` |
| `GET /api/messages?conversationId=` | session | required | `200` page | `401` / `404`* |
| `POST /api/messages` body `conversationId` | session | required | `201`/`200` | `401` / `404`* |
| WS upgrade | session cookie + same Origin | — | connection open | upgrade rejected |
| WS `subscribe` | (socket already authed) | filter ids | subs updated | foreign ids silently dropped |

\*Same status and error string for unknown id and non-member.

## Tests (Phase 1 — already written)

- `src/routes/conversation-access.test.ts` — HTTP anonymous, foreign member, POST guard, 404 parity.
- `src/ws/hub.auth.test.ts` — unauthenticated upgrade rejected, subscribe filtered, cross-origin rejected.

Additional test housekeeping when wiring:

- Replace `?userId=1` stack probes in older integration tests with `httpSession.stackAvailable` or
  `POST /api/session`.
- Flip `session.test.ts` legacy parity test to expect `401` on `?userId=`.

## Contributions

**User proposed**
- Implement PR 1 from `docs/017-critical-high-review.md` — unified conversation authorization
  boundary across HTTP and WebSocket.
- Minimal fix — smallest correct diff, no extra features.

**Agent proposed**
- Reuse already-drafted `conversationAccess` service + middleware instead of inline checks in each
  route — **adopted** (less duplication, one 404 shape).
- Authenticate WebSocket at **upgrade** via `verifyClient`, filter subscriptions with the same
  service — **adopted** (matches test contract; subscribe-only auth leaves anonymous sockets open).
- Origin = same host as `Host` header — **adopted** (no new config; sufficient for same-origin SPA).
- Remove `sessionOrQueryUserId` entirely rather than deprecate — **adopted** (frontend unaffected;
  tests switch to session cookie).

**Agreed in Phase 2**
- Shared `conversationAccess` service + middleware for HTTP; WS auth at upgrade; remove legacy
  `?userId=`; 404 parity for missing/forbidden conversations.

**Changed during implementation**
- Legacy `?userId=` removed; `spec/session-auth.md` updated to match.

## Alternatives considered

- **Middleware only on `GET /api/messages`, leave WS for later.** Rejected: leaves realtime leak;
  PR 1 scope explicitly includes WebSocket.
- **Auth on `subscribe` frame with token in JSON.** Rejected: protocol change, frontend work; upgrade
  auth reuses existing cookie with no client changes.
- **403 for forbidden vs 404 for missing.** Rejected: PR 1 criterion forbids existence oracle.
- **Separate WS session lookup module.** Rejected: duplicates `lookupSession`; import from
  `services/session.ts`.

## Dead ends

None yet — implementation not started.
