# SEC1: sanitize conversation titles before MySQL insert

## Symptom

A conversation titled `<img src=x onerror=alert(1)>` was stored verbatim and executed in the browser when `web/app.js` rendered the sidebar via `innerHTML`.

## Reproduction

```bash
curl -X POST http://localhost:3000/api/conversations \
  -H 'Content-Type: application/json' \
  -H 'Cookie: relay_session=…' \
  -d '{"title":"<img src=x onerror=alert(1)>","participantIds":[2]}'
# pre-fix: title stored with markup; post-fix: 201 with "title": "" rejected or sanitized
```

## Root cause

`src/routes/conversations.js` inserted `title` from the request body without sanitization (`INSERT … VALUES (?)`).

## Fix

1. Added `sanitizeStoredText` / `sanitizeConversationTitle` in `src/validation/messageInput.ts`.
2. Migrated route to `src/routes/conversations.ts`; `POST` validates and sanitizes `title` before INSERT.
3. `sanitizeMessageBody` now reuses the same helper (behaviour unchanged).

## Contributions

**User proposed** — backend XSS protection; no scripts in DB.

**Agent proposed** — shared text sanitizer, route migration, `participantIds` integer validation — **adopted**.

## Verification

```bash
npm test -- src/validation/messageInput.test.ts
npm test -- src/routes/conversations-validation.test.ts  # needs docker compose up
```

Unit: `Support <img …> ticket` → `Support ticket`; pure markup → `null`.

Integration: POST stores sanitized title; GET list returns same plain text without `<` or `>`.

## Trade-offs

- Legitimate `<` characters in titles are kept; only `<…>` tag patterns are removed.
- Existing malicious rows (if any) are not backfilled; only new writes are sanitized.
- Frontend SEC1 vector (`innerHTML`) still worth fixing separately for belt-and-suspenders.
