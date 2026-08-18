# D1 + D3: message boundary validation and unified createdAt

## Symptom

- The same message showed **different timestamps** depending on delivery path: WebSocket/POST used app `new Date()`, while `GET /api/messages` read MySQL `DEFAULT CURRENT_TIMESTAMP`.
- POST accepted `"12abc"` as `conversationId` (`Number()` → `NaN` into SQL), unbounded `body` strings, and stored raw HTML/script markup in Mongo.

## Reproduction

```bash
# D1 — compare POST response vs GET list (before fix)
curl -si -X POST localhost:3000/api/messages -H 'content-type: application/json' \
  -d '{"conversationId":1,"senderId":1,"body":"time probe","clientId":"'"$(uuidgen)"'"}'
curl -s 'localhost:3000/api/messages?conversationId=1' | jq '.messages[-1].createdAt'

# D3 — invalid id (pre-fix: driver error / 500; post-fix: 400)
curl -si -X POST localhost:3000/api/messages -H 'content-type: application/json' \
  -d '{"conversationId":"12abc","senderId":1,"body":"x","clientId":"'"$(uuidgen)"'"}'
```

## Root cause

- `src/services/messages.ts` — MySQL insert relied on `DEFAULT CURRENT_TIMESTAMP` while Mongo used a separate `new Date()` call milliseconds later.
- `src/routes/messages.js` — truthiness checks (`if (!conversationId || !body)`) and `Number(conversationId)` without integer validation; no body length cap or sanitization.

## Fix

1. **D1** — generate one `createdAt` in `createMessage`, pass it explicitly to `INSERT ... created_at` and Mongo `insertOne`.
2. **D3** — new `src/validation/messageInput.ts` with strict integer parsing, 10_000-char body cap, HTML-tag stripping, and control-char removal; wired in migrated `src/routes/messages.ts`.
3. **Payload cap** — `express.json({ limit: '32kb' })` in `src/index.ts`.
4. **SQL injection** — queries were already parameterised; validation now blocks non-integer ids before they reach the driver.

## Contributions

**User proposed**
- Fix D1 and D3; cap body; SQL-injection and XSS protection on write; document.

**Agent proposed**
- App-sourced `createdAt` for both stores — **adopted**
- In-repo sanitization (no new npm package) — **adopted**
- Route migration to TypeScript — **adopted**

**Changed during implementation**
- None.

## Alternatives considered

See `spec/message-boundary-validation.md`.

## Verification

Unit tests (`src/validation/messageInput.test.ts`):

```bash
npm test -- src/validation/messageInput.test.ts
# 3 passing
```

Integration tests (`src/routes/messages-validation.test.ts`, requires `docker compose up`):

- invalid `conversationId` → `400`
- oversized body → `400`
- `<script>` stripped; POST `createdAt` equals GET row `createdAt`

```bash
npm test -- src/routes/messages-validation.test.ts
```

## Dead ends

None.

## Trade-offs and follow-ups

- HTML **entities** (e.g. `&lt;`) in plain text are stored as-is; only tag patterns `<...>` are removed.
- Participant/conversation existence checks remain a separate hardening item (audit D3 bullet).
- `created_at` is still second-precision MySQL `TIMESTAMP`; sort order remains by `id`.
