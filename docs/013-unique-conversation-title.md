# Unique conversation titles and POST failure WS status

## Symptom

- Users could create multiple conversations named identically.
- After `POST /api/conversations` returned `400`/`409`, the status badge showed **Reconnecting…** even though the WebSocket was fine.

## Root cause

1. No uniqueness constraint or check on `conversations.title`.
2. `web/app.js` always called `loadConversations()` after POST (even on failure), which called `connectWs({ replace: true })`.
3. `wsIntentionalClose` was reset before the async `onclose` event, so intentional closes triggered `scheduleWsReconnect()`.

## Fix

- `UNIQUE INDEX idx_conversations_title` + pre-insert lookup + `409` on duplicate.
- Frontend: check `res.ok`, fix intentional-close handling, resubscribe without reconnect after successful create.

## Verification

```bash
npm test -- src/routes/conversations-duplicate-title.test.ts  # docker compose up
```

Manual: create conversation, retry same title → alert with error, status stays **Live**.

## Trade-offs

- Sanitized titles that collide after strip (e.g. `"A<b>"` and `"A<c>"` → both `"A"`) are rejected as duplicates — acceptable for plain-text titles.
