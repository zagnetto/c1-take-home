# C3 — idempotent message sends

## Goal

Make `POST /api/messages` safe to retry: the same `clientId` must always yield the same message
`id` and body, never a duplicate row or a second WebSocket broadcast.

## Design

### Server (`src/services/messages.ts`)

1. `INSERT` into MySQL as today.
2. On `ER_DUP_ENTRY` for `client_id`, load the existing row and return it with body from Mongo.
3. If MySQL row exists but Mongo body is missing (partial dual-write from C2), insert the body on
   replay and return the completed message.
4. Return `{ message, isNew }` so the route can skip `broadcast` on replay.

### Route (`src/routes/messages.js`)

- `201` + broadcast when `isNew`.
- `200` + no broadcast when idempotent replay.

### Client (`web/app.js`, `web/index.html`)

- Disable composer input and Send button while the POST is in flight; visually dimmed via `:disabled`
  styles.
- Generate one `clientId` per submit; reuse it for that request (proxy/client retries with the same
  body keep the same key).
- Restore input text if the fetch throws.

## Contracts

| Case | HTTP | Broadcast | DB rows |
|---|---|---|---|
| First send with `clientId` | 201 | yes | 1 MySQL + 1 Mongo |
| Retry with same `clientId` | 200 | no | unchanged |
| Send without `clientId` | 201 | yes | insert (no dedup) |

## Alternatives considered

| Option | Why rejected |
|---|---|
| Client-only: disable Send until response | Does not cover proxy retries or future clients |
| `409 Conflict` on duplicate | Worse contract; client must handle conflict separately |
| Redis dedup | Redundant when `client_id` already lives in MySQL |
| Pre-SELECT before every INSERT | Extra round-trip on the hot path; duplicate catch is enough |

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
- Skip WebSocket broadcast on idempotent replay — **adopted**
- Complete missing Mongo body on replay (partial dual-write) — **adopted**
- Reuse the same `clientId` for one submit attempt (not a fresh UUID on retry) — **adopted**
- Restore composer text when fetch throws — **adopted**

**Agreed in Phase 2**
- Both layers ship together: return-existing-on-conflict on the server and disabled composer on the client.
- Duplicate replay returns the same `id`, not `409`.
