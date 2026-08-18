# Message boundary validation and unified createdAt (D1 + D3)

## Goal

Fix two high-severity data-integrity issues from `docs/architecture-audit.md`:

- **D1** — `createdAt` diverges between MySQL (`DEFAULT CURRENT_TIMESTAMP`) and Mongo (`new Date()` in the app), so POST/WebSocket and `GET /api/messages` show different times for the same message.
- **D3** — POST `/api/messages` validates with truthiness checks, accepts unbounded `body`, and passes `NaN` conversation ids into SQL.

Also add explicit body size limits, keep SQL parameterised (no string interpolation), and sanitize message text before persistence to reduce stored XSS payloads.

## Design

### D1 — single createdAt source

1. Generate `createdAt = new Date()` once in `createMessage` **before** any write.
2. Insert into MySQL with explicit `created_at` column value (same `Date` object).
3. Insert into Mongo with the same `createdAt`.
4. Idempotent replays already read `created_at` from MySQL — unchanged.

Application time is the source of truth for both stores and for API/WebSocket responses.

### D3 — boundary validation

New module `src/validation/messageInput.ts`, used by `src/routes/messages.ts` (route migrated from `.js` to `.ts`):

| Field | Rule |
|---|---|
| `conversationId` | positive integer via strict parse (`/^\d+$/` for strings); reject `NaN`, floats, `"12abc"` |
| `body` | string, trim, max 10_000 chars, strip HTML tags and C0 control chars (except `\n\r\t`) |
| `clientId` | optional string, 1–64 chars |

Express JSON parser capped at `32kb` to reject oversized payloads before handler logic.

SQL remains fully parameterised (`?` placeholders). Validation ensures only valid integers reach the driver — defence in depth alongside existing parameter binding.

XSS: strip HTML tags at write time so Mongo never stores executable markup. Frontend already renders with `textContent`; this protects future consumers and direct DB reads.

## Contracts

### POST `/api/messages`

- `400` `{ error: 'conversationId must be a positive integer' }` for invalid ids.
- `400` `{ error: 'body must be at most 10000 characters' }` when raw body exceeds cap.
- `400` `{ error: 'body is required and must be non-empty text' }` for missing/blank/sanitized-empty body.
- `400` `{ error: 'clientId must be a string up to 64 characters' }` for invalid clientId.
- Successful create still `201`; idempotent replay still `200`.
- Response `createdAt` must equal `GET /api/messages` row `createdAt` for the same `id`.

### Constants

- `MAX_MESSAGE_BODY_LENGTH = 10_000`
- `express.json({ limit: '32kb' })`

## Contributions

**User proposed**
- Fix D1 (`createdAt` mismatch between MySQL and Mongo) and D3 (missing boundary validation, unbounded body).
- Cap body size, add SQL-injection and XSS protection on write, document the change.

**Agent proposed**
- Single app-generated `createdAt` written explicitly to both stores — **adopted**
- Shared `src/validation/messageInput.ts` helper — **adopted**
- Migrate `messages.js` → `messages.ts` per API conventions — **adopted**
- Strip HTML tags + control chars for XSS (no new dependency) — **adopted**
- Strict integer parse instead of `Number()` on untrusted strings — **adopted**

**Agreed in Phase 2**
- Implement validation, createdAt fix, tests, and `docs/011-*.md` in one pass per user request.

## Alternatives considered

| Option | Why rejected |
|---|---|
| Read MySQL `created_at` after insert and copy to Mongo | Extra round-trip; app timestamp is simpler and already returned to clients |
| HTML-entity escape entire body | Would show `&lt;` literally in UI if a future renderer decodes entities |
| `zod` / `validator` package | New dependency; rules are small enough for in-repo helpers |
| Reject any `<` character | Too strict for legitimate messages mentioning comparisons |

## Out of scope

- Conversation existence / participant membership checks (separate D3 follow-up in audit).
- Normalising `createdAt` to ISO strings in all API responses.
