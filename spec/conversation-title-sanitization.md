# SEC1: backend sanitization for conversation titles

## Goal

Close **SEC1** from `docs/architecture-audit.md`: conversation titles must not persist HTML/script markup in MySQL. Sanitization happens on write at the API boundary so the database never stores executable markup, regardless of how a client renders the value later.

## Design

Extend `src/validation/messageInput.ts`:

- `sanitizeStoredText(raw, maxLength)` — shared stripper for all user text persisted to a store
- `sanitizeConversationTitle(raw)` — wrapper with `MAX_CONVERSATION_TITLE_LENGTH = 200` (matches `VARCHAR(200)`)
- `sanitizeMessageBody` — now delegates to `sanitizeStoredText` (same rules, different cap)

`POST /api/conversations` (`src/routes/conversations.ts`, migrated from `.js`):

- Validate `title` through `sanitizeConversationTitle`; reject empty/oversized/markup-only input with `400`
- Validate `participantIds` with `parsePositiveInt` (same helper as messages)

Rules applied before INSERT:

1. trim
2. reject if over max length
3. remove C0 control chars (except `\n\r\t` not expected in titles — still stripped via regex)
4. remove `<script>…</script>`, `<style>…</style>`, all remaining `<…>` tags
5. collapse whitespace runs to a single space

## Contracts

- `POST /api/conversations` with `title: "Support <img …> ticket"` → `201`, stored/returned title `"Support ticket"`
- Pure markup title → `400` `{ error: 'title is required and must be non-empty text' }`
- Title over 200 chars → `400` with length message
- `GET /api/conversations` returns the sanitized title from MySQL

## Contributions

**User proposed**
- Backend XSS protection; no scripts/markup should live in the database.

**Agent proposed**
- Shared `sanitizeStoredText` for message body and conversation title — **adopted**
- Migrate `conversations.js` → `conversations.ts` — **adopted**
- Strict `participantIds` integer parse while touching the route — **adopted**

**Agreed**
- Sanitize on write; frontend `innerHTML` fix remains optional defense-in-depth.

## Alternatives considered

| Option | Why rejected |
|---|---|
| Fix only frontend (`textContent`) | DB would still hold malicious strings for other consumers |
| HTML entity escape entire title | Would display entities literally if a future UI decodes them |
| Allow `<b>` etc. | Chat titles are plain text; stripping all tags is simpler and safer |

## Out of scope

- Re-sanitizing existing seeded/demo rows (already plain text)
- Frontend `renderSidebar` `innerHTML` → `textContent` (recommended follow-up)
