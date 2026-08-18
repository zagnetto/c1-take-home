# Search pagination

## What shipped

Search results are no longer capped silently at 50. `GET /api/search` returns a page envelope with
`hasMore` and an opaque `nextCursor`; the UI shows a **Load more** button that appends the next page.

Extends `docs/029-search.md`.

## API

`GET /api/search?q=<query>&limit=<n>&cursor=<token>`

```json
{
  "results": [
    {
      "messageId": 1,
      "conversationId": 1,
      "conversationTitle": "Support — order #1042",
      "body": "Hi, any update on order #1042?"
    }
  ],
  "hasMore": true,
  "nextCursor": "eyJzY29yZSI6MS4yMywiaWQiOjF9"
}
```

- `limit` — default/max **50**.
- `nextCursor` — base64url JSON `{ score, id, q }` where `score` is Mongo `textScore` and `id` is
  `message_bodies._id`. Server rejects cursor when `q` does not match the current search.
- Empty / unsanitized query → `{ results: [], hasMore: false, nextCursor: null }`.

## Backend

- `src/helpers/searchCursor.ts` — encode/decode/parse limit.
- `src/services/search.ts` — aggregation pipeline: `$text` → `$addFields score` → keyset `$match`
  after cursor → `$sort { score: -1, _id: -1 }` → `$limit limit+1`.

## Frontend

- `web/app.js` — search mode state (`searchQuery`, `searchCursor`, `searchHasMore`); **Load more**
  button appends rows (not scroll-up like conversation history).

## Contributions

**User proposed**
- Pagination so users can see all search hits, not only the first 50.
- Change response shape + frontend; Load more button; opaque cursor (score + messageId).

**Agent proposed**
- Keyset cursor via aggregation (not `skip`) — **adopted**
- Add `messageId` to each result — **adopted**
- Bind cursor to sanitized `q` — **adopted**
- Integration test that posts 3 probe messages and pages with `limit=2` — **adopted**

## Alternatives considered

| Option | Why not |
|---|---|
| Bare array + higher limit | Still hides matches; no explicit “more exists” signal. |
| offset/skip | User chose keyset cursor; skip degrades on large offsets. |
| Scroll-down infinite load | User chose explicit Load more button. |

## Verification

```bash
docker compose restart api
npm test -- src/helpers/tests/searchCursor.test.ts
npm test -- src/routes/tests/search.test.ts
```

Manual: search a common term across many messages; **Load more** appears and appends rows.

## Dead ends

None.

## Trade-offs

- New messages during paging may appear only when re-running the search from page 1.
- `$text` word-match limitations unchanged (see `docs/029-search.md`).
