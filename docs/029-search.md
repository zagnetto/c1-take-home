# Message search

## What shipped

`GET /api/search?q=...` now searches message bodies in MongoDB and returns matches scoped to
conversations the authenticated user participates in. The sidebar search box in `web/app.js` works
without frontend changes.

## Design

1. **`requireSession`** on `src/routes/search.ts` — consistent with other protected reads.
2. **Mongo `$text`** on `message_bodies.body` using existing index `idx_message_bodies_body_text`
   (`src/db/ensureIndexes.ts`).
3. **Pre-filter** by the user's conversation ids from MySQL (`listUserConversationIds` in
   `src/services/conversationAccess.ts`) before querying Mongo.
4. **Sort** by text relevance (`textScore`), **cap** at 50 results.
5. **Bulk-load** conversation titles from MySQL for the hit set.
6. **`sanitizeTextSearchQuery`** (`src/helpers/sanitizeTextSearchQuery.ts`) strips `"`, `\`, and
   leading `+`/`-` on tokens. When nothing searchable remains, return `200 []`.

Full `body` text is returned unchanged (no truncation). Short or stop-word-only queries that Mongo
does not tokenize also return `200 []`.

## Response shape

```json
[{ "conversationId": 1, "conversationTitle": "Support — order #1042", "body": "Hi, any update on order #1042?" }]
```

## Contributions

**User proposed**
- Implement search per `tasks/search.md`; MongoDB `$text`; member-only scope.
- Keep full `body` in results (no truncation).
- Return empty array (`200 []`) for queries that sanitize to nothing or match nothing.

**Agent proposed**
- Add `requireSession` to the search route — **adopted**
- Pre-filter Mongo by user's conversation ids — **adopted**
- Extract `sanitizeTextSearchQuery` helper with unit tests — **adopted**
- Add `listUserConversationIds` to `conversationAccess.ts` — **adopted**

**Agreed in Phase 2**
- All of the above.

## Alternatives considered

| Option | Why not |
|---|---|
| Mongo regex substring search | No index use; collection scan at scale. |
| MySQL FULLTEXT | Bodies live in Mongo, not MySQL. |
| Global search without session | Would leak message content across users. |
| Truncate `body` in API | User chose to keep full text for v1. |

## Verification

```bash
npm test -- src/helpers/tests/sanitizeTextSearchQuery.test.ts
npm test -- src/routes/tests/search.test.ts   # requires docker compose up
```

Manual: log in, search sidebar for `order` — should list the seeded Support conversation message.

Integration tests cover: `401` without session, empty `q`, member hit, non-member exclusion,
sanitized-empty query.

## Dead ends

None — text index was already present; no schema or dependency changes needed.

## Trade-offs and follow-ups

- Mongo `$text` matches **words**, not arbitrary substrings (`ord` will not find `order`).
- English stop words and minimum token length may yield `[]` for very short queries — by design.
- No pagination on search results; 50-hit cap is sufficient for demo scale.
