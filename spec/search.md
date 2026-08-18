# Search

## Goal

Make `GET /api/search?q=...` return matching message bodies so the sidebar search box in `web/app.js`
can list results. The frontend is already wired — only the backend stub in `src/services/search.ts`
needs a real implementation.

## Design

### Endpoint

`GET /api/search?q=<query>&limit=<n>&cursor=<token>` — protected by `requireSession`.

- Empty or whitespace-only `q` → `{ results: [], hasMore: false, nextCursor: null }`.
- Non-empty `q` → paginated search over message bodies the user is allowed to see.

### Response shape

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

`web/app.js` renders results and a **Load more** button when `hasMore` is true.

## Search pagination

See `docs/030-search-pagination.md` for cursor format and aggregation pipeline.

### Problem (motivation)

v1 caps at **50** hits sorted by relevance. A broad query (e.g. `the`, `order`) can match more;
the user cannot see the rest without re-running search or guessing narrower terms.

This differs from **conversation scroll-up**, which pages **one thread chronologically**. Search pages
**all member conversations by relevance** — same envelope idea (`hasMore` + cursor), different UX
(**Load more** button appends below, not scroll-up prepend).

### Proposed API

`GET /api/search?q=<query>&limit=<n>&cursor=<opaque>`

| Param | Default | Max | Notes |
|---|---|---|---|
| `q` | — | — | Required for first page; echoed on subsequent pages |
| `limit` | `50` | `50` | Same cap as messages default |
| `cursor` | omitted | — | Opaque token from previous response; omit on first page |

**Response** (replaces bare array):

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
  "nextCursor": "eyJzY29yZSI6MS4yMywibWQiOjF9"
}
```

- `nextCursor` is `null` when `hasMore` is false.
- Empty search / nothing searchable → `{ "results": [], "hasMore": false, "nextCursor": null }`
  (not bare `[]`).

**Cursor payload** (base64url JSON, server-signed or at minimum validated):

```json
{ "score": 1.23, "id": 42, "q": "order" }
```

- `score` — Mongo `textScore` of the **last** row on the page.
- `id` — `message_bodies._id` (MySQL message id) of that row — tie-breaker when scores equal.
- `q` — sanitized query string; reject cursor if `q` param does not match (prevent cursor reuse
  across searches).

**Mongo pipeline** (aggregation, not `skip`):

1. `$match`: `$text` + `conversationId ∈ userConversations`.
2. `$addFields`: `{ score: { $meta: 'textScore' } }`.
3. If cursor present: `$match` rows **after** cursor — `score < cursor.score` OR
   `(score == cursor.score AND _id < cursor.id)`.
4. `$sort`: `{ score: -1, _id: -1 }`.
5. `$limit`: `limit + 1` → trim page, set `hasMore`.

Why not `skip`/`offset`: user chose opaque cursor; keyset on `(score, id)` avoids degrading skip
and keeps pages stable if new messages arrive mid-search (new hits may appear on page 1 only, not
shift later pages).

### Frontend (`web/app.js`)

Search mode state: `searchQuery`, `searchCursor`, `searchHasMore`, `searchLoading`.

1. Submit search → `GET /api/search?q=…` → render `results`, show **Load more** when `hasMore`.
2. Button click → `GET /api/search?q=…&cursor=nextCursor` → **append** rows (do not replace).
3. Reuse `#messages` pane; `activeConversation = null` while in search mode.
4. Click result → `openConversation` (unchanged; optional follow-up: scroll to `messageId`).

### Access control

Unchanged — cursor does not bypass membership; every page re-resolves allowed conversation ids.

## Contracts (tests)

Integration tests in `src/routes/tests/search.test.ts` (requires `docker compose up`):

| Case | Expected |
|---|---|
| No session cookie | `401` |
| Empty `q` | `200` empty page envelope |
| Query matching a seeded body in user's conversation | `200`, ≥1 result with `messageId`, `conversationId`, `conversationTitle`, `body` |
| Query matching only another user's private conversation | empty page |
| Pagination with `limit` + `cursor` | second page appends without duplicate ids |
| Cursor for different `q` | `400` |
| Invalid cursor | `400` |

Unit tests: `src/helpers/tests/sanitizeTextSearchQuery.test.ts`, `src/helpers/tests/searchCursor.test.ts`.

## Alternatives considered

| Option | Why not |
|---|---|
| **Mongo regex** (`$regex`, case-insensitive substring) | Simpler UX for partial words, but collection scan — no index use; poor at scale. User chose `$text`. |
| **Hybrid $text + regex fallback** | Better short-query UX, but two code paths and inconsistent ranking; over-scoped for this task. |
| **MySQL FULLTEXT** | `messages` has no `body` column; bodies are in Mongo. Would require denormalisation or a migration. |
| **Search all, filter after** | Wastes work and risks leaking timing/metadata; pre-filter by `conversationId` is cheaper and safer. |
| **Redis search / Elasticsearch** | New dependency; not justified for seeded demo scale. |
| **Global search without session** | Leaks message content across users. Rejected. |
| **offset/skip pagination** | Simpler, but user chose keyset cursor on `(textScore, messageId)`. |
| **Scroll-down infinite load for search** | User chose explicit **Load more** button — clearer for ranked results. |
| **Reuse `nextBefore` from messages API** | Wrong semantics — search sorts by relevance, not message id chronology within one conversation. |

## Contributions

**User proposed (pagination extension)**
- Problem: 50-hit cap hides remaining matches; need to load all search results.
- Change response structure + update frontend, similar spirit to message pagination.
- **Load more** button (not scroll-up infinite load).
- Opaque cursor token (score + messageId), not offset.

**Agent proposed (pagination extension)**
- Add `messageId` to each hit — **adopted** (stable cursor + future jump-to-message).
- Keyset cursor via aggregation `$match` after `$addFields score` — **adopted**.
- Bind cursor to sanitized `q` to prevent cross-query reuse — **adopted**.
- Separate search-mode state in `web/app.js`; append on Load more — **adopted**.
- Do **not** reuse scroll-up handler from conversation view — **adopted** (different UX).

**Agreed in Phase 2 (pagination)**
- Page envelope, Load more UX, keyset cursor on `(textScore, messageId)`, `messageId` in results.

**User proposed (v1)**
- Implement search per `tasks/search.md`; MongoDB `$text`; member-only scope.

**Agent proposed (v1)**
- Add `requireSession` to `src/routes/search.ts` — **adopted**
- Pre-filter Mongo query with user's `conversationId`s from MySQL — **adopted**
- Sanitise `$text` query string before search — **adopted**
- Return full `body` in results — **adopted**

**Agreed in Phase 2 (v1)**
- `$text` on `message_bodies.body`, member-only scope, session required, full body, empty page for no matches.
