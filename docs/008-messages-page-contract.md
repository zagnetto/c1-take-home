# Messages page contract and scroll-up UX

## Symptom

After pagination landed, reopening a conversation either showed only one page or the client looped
HTTP requests using sidebar `messageCount` as ground truth — fragile and unlike normal chat apps.

## Fix

### Backend (`src/routes/messages.js`)

- `GET /api/messages` now returns `{ messages, hasMore, nextBefore }`.
- SQL fetches `limit + 1` rows; `buildMessagesPage()` trims and sets cursors.

### Frontend (`web/app.js`)

- **Open:** one page (`limit=50`), scroll to bottom.
- **`hasMore`:** hint «↑ scroll up for earlier messages».
- **Scroll up:** fetch with `before=nextBefore`, prepend via `DocumentFragment`.
- Removed `loadMessagesForOpen()`.

## Verification

```bash
npm test -- src/routes/messagesPagination.test.ts
npm test -- src/routes/message-read.test.ts   # needs docker compose up

curl -s 'localhost:3000/api/messages?conversationId=1&limit=1' | jq '{count: (.messages|length), hasMore, nextBefore}'
curl -s 'localhost:3000/api/messages?conversationId=1&before=2&limit=10' | jq '.messages | map(.id)'
```

## Contributions

**User proposed**
- API envelope + scroll-up UX as one implementation

**Agent proposed**
- `buildMessagesPage()` + unit tests — **adopted**
- Scroll hint when `hasMore` — **adopted**

## Alternatives considered

See `spec/messages-page-contract.md`.

## Dead ends

- `loadMessagesForOpen()` using client `messageCount` — replaced by explicit `hasMore` from server.
