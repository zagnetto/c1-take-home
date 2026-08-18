# Messages page API contract + scroll-up UX

## Goal

Replace the bare array from `GET /api/messages` with an explicit pagination envelope, and align the
frontend with standard chat UX: **last page on open**, older messages on scroll-up.

## API contract

```
GET /api/messages?conversationId=1&before=<id>&limit=50
```

Response:

```json
{
  "messages": [{ "id": 4, "conversationId": 1, "senderId": 2, "createdAt": "…", "body": "…" }],
  "hasMore": true,
  "nextBefore": 4
}
```

| Field | Meaning |
|---|---|
| `messages` | Ascending by `id` (oldest → newest within the page) |
| `hasMore` | `true` when older messages exist before this page |
| `nextBefore` | Pass as `before` to load the next older page; `null` when `messages` is empty |

Server fetches `limit + 1` rows (newest-first SQL), trims to `limit`, sets `hasMore` from the extra
row. Logic in `buildMessagesPage()` (`src/routes/messagesPagination.ts`).

## Frontend UX

| Action | Behaviour |
|---|---|
| Open conversation | One request (`limit=50`); render page; scroll to bottom |
| `hasMore === true` | Show hint «↑ scroll up for earlier messages» |
| Scroll near top | `GET …&before=nextBefore` → prepend via `DocumentFragment` |
| New message (WS) | Append to bottom (unchanged) |

Removed: `loadMessagesForOpen()` loop that used sidebar `messageCount` as fetch target.

## Alternatives considered

| Option | Why rejected |
|---|---|
| Keep bare array + client heuristics (`length === limit`) | Fragile at exact page boundaries |
| Auto-load all pages on open | Slow and unbounded for large conversations |
| Include `totalCount` on every page | Extra `COUNT(*)` per request; `hasMore` is enough for scroll UX |

## Contributions

**User proposed**
- Implement API envelope (point 1) and scroll-up UX (point 2) as one change

**Agent proposed**
- `buildMessagesPage()` helper with unit tests — **adopted**
- Scroll hint banner when `hasMore` — **adopted**
- `MESSAGE_PAGE_LIMIT = 50` aligned with API default — **adopted**

**Agreed in Phase 2**
- Response shape `{ messages, hasMore, nextBefore }`
- Single page on open; older pages only via scroll-up
