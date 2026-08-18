# Session auth

## Goal

Replace the hardcoded `userId = 1` in `web/app.js` with server-assigned identity: on load the client
obtains a free seeded user (Alice/Bob/Carol), stores an opaque session token in an HttpOnly cookie, and
subsequent API calls derive `userId`/`senderId` from that session. Sessions live in Redis so they work
across `--scale api=3`.

## Design

### Redis keys

| Key | Value | TTL |
|---|---|---|
| `relay:session:<token>` | `userId` (string) | `SESSION_TTL_SECONDS` (default 24h) |
| `relay:session:user:<userId>` | `<token>` | same |

Slot claim uses `SET … NX EX` on the user key so two concurrent tab opens cannot grab the same seeded
user. Token lookup verifies the user slot still points at the same token.

### HTTP

| Method | Path | Behaviour |
|---|---|---|
| `POST` | `/api/session` | Valid cookie → `200 { userId, name }`. Else claim first free seeded user → `201` + `Set-Cookie: relay_session=…; HttpOnly`. Pool full → `503 { error: 'no users available' }`. |
| `GET` | `/api/conversations` | Session cookie required → list for that user. |
| `POST` | `/api/conversations` | Session required; caller is always included in `participantIds`. |
| `POST` | `/api/messages` | Session required; `senderId` from session (body field ignored). Membership in `conversationId` required (`404` when absent or foreign). |

`GET /api/messages` also requires session and conversation membership. Legacy `?userId=` was removed in
`spec/conversation-access.md`.

### Frontend

1. `POST /api/session` with `credentials: 'same-origin'` on load.
2. Show `name` in `#userBadge` (sidebar header).
3. All authenticated fetches use `credentials: 'same-origin'`; stop sending `senderId` / `userId`.

## Contracts (tests in `src/routes/session.test.ts`)

- New session: `201`, seeded `userId`, HttpOnly cookie.
- Resume: `200`, same `userId`.
- Fourth session when 1–3 occupied: `503`.
- `GET /api/conversations` with cookie returns that user's conversations; `?userId=` without cookie → `401`.
- `POST /api/messages` uses session `senderId`, not body.

## Alternatives considered

| Option | Why not |
|---|---|
| JWT in cookie | Hard to track occupied seeded users; logout/slot release needs a blocklist anyway. |
| MySQL session table | Extra round-trips; Redis already runs for realtime/rate-limit. |
| In-memory sessions | Breaks with multiple API instances behind Envoy. |

## Contributions

**User proposed**
- Assign a free seeded user on client load; store auth token in cookie; sessions in Redis; backend
  resolves identity from token; show the current user on the client.

**Agent proposed**
- Dual Redis keys (`session:<token>` + `session:user:<id>`) with `SET NX` for atomic slot claim —
  **adopted**.
- Keep legacy `?userId=` on `GET /api/conversations` for curl/smoke tests — **superseded** by
  `spec/conversation-access.md` (session-only).
- 24h TTL to auto-release slots — **adopted**.
- `#userBadge` pill in sidebar header — **adopted**.

**Agreed in Phase 2**
- Redis-backed opaque token in HttpOnly cookie; seeded user pool (ids 1–3); `503` when exhausted.
