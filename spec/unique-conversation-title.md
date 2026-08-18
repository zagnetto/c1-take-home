# Unique conversation titles and POST error UX

## Goal

1. Reject creating a conversation when another row already has the same sanitized title.
2. Stop the UI from entering WebSocket "Reconnecting…" after a failed `POST /api/conversations`.

## Design

### Backend — unique title

- `UNIQUE INDEX idx_conversations_title ON conversations (title)` in schema + `ensureIndexes` for existing DBs.
- `POST /api/conversations`: lookup by title before insert; return `409 { error: 'a conversation with this title already exists' }`.
- Catch `ER_DUP_ENTRY` on insert as a race fallback (same `409`).

Uniqueness is **global** on the sanitized title string (one canonical title per conversation row).

### Frontend — reconnecting bug

Root cause: `connectWs({ replace: true })` cleared `wsIntentionalClose` immediately after `ws.close()`, but `onclose` fires asynchronously → handler treated intentional closes as disconnects → `scheduleWsReconnect()`.

Fixes:

1. Reset `wsIntentionalClose` inside `onclose` when the close was intentional.
2. `loadConversations({ reconnectWs })` — only replace WebSocket on initial session load; after create, resubscribe on the open socket.
3. `newConv` handler checks `res.ok`; on error shows `alert` and **does not** call `loadConversations`.

## Contracts

- First `POST` with title `"Foo"` → `201`.
- Second `POST` with `"Foo"` → `409`.
- Failed POST leaves WS status `"Live"` (connected).

## Contributions

**User proposed**
- Block duplicate conversation names.
- Failed POST should not show reconnecting.

**Agent proposed**
- Global unique index + pre-insert check — **adopted**
- Fix intentional-close race in `connectWs` — **adopted**
- Resubscribe instead of reconnect after successful create — **adopted**

## Alternatives considered

| Option | Why rejected |
|---|---|
| Per-user unique titles only | Title lives on `conversations` row; global unique matches data model |
| Application check only, no index | Race under concurrent POSTs |
| Toast UI instead of `alert` | No toast component; `alert` matches existing `prompt` flow |
