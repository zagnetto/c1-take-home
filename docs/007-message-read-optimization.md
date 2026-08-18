# D2 + D6 + D7 — message read path indexes, N+1 collapse, pagination

## Symptom

- Conversation list slows as data grows (`1 + 2N` SQL queries per request).
- Message history loads the entire conversation into memory with an unbounded Mongo `$in`.
- `EXPLAIN` on `messages WHERE conversation_id = ?` shows a full table scan (no supporting index).

## Reproduction

```bash
docker compose up -d --build

# N+1 and missing index (before fix on old schema):
docker compose exec mysql mysql -uroot -proot relay -e "SHOW INDEX FROM messages"
docker compose exec mysql mysql -uroot -proot relay -e \
  "EXPLAIN SELECT * FROM messages WHERE conversation_id = 1"

# Unbounded read:
curl -s 'localhost:3000/api/messages?conversationId=1' | jq length
```

## Root cause

- `docker/db/mysql.sql` defined only primary keys on `messages` (D2).
- `src/routes/conversations.js` looped conversations issuing last-message + count queries each (D6).
- `src/routes/messages.js` selected all rows with no `LIMIT` (D7).

## Fix

1. **Indexes**
   - MySQL: `(conversation_id, id)` on `messages`, `(user_id, conversation_id)` on
     `conversation_participants`, unique `client_id`, unique `users.email` — in `mysql.sql` and
     `src/db/ensureIndexes.ts` (startup, idempotent).
   - Mongo: `{ conversationId: 1 }` and text index on `body` at startup.

2. **Conversation list** — one query with grouped stats + join on `MAX(id)`.

3. **Message history** — keyset pagination (`before`, `limit` default 50 / max 200), Mongo `$in`
   scoped to the page.

4. **Frontend** — load newest page with `limit=200`; prepend older pages on scroll-to-top via
   `DocumentFragment` (single DOM insert, preserves ascending order).

## Verification

```bash
npm test -- src/routes/messagesPagination.test.ts
npm test -- src/routes/message-read.test.ts   # integration; needs docker compose up

docker compose exec mysql mysql -uroot -proot relay -e "SHOW INDEX FROM messages"
# expect idx_messages_conversation_id on (conversation_id, id)

curl -s 'localhost:3000/api/conversations?userId=1' | jq '.[0] | {messageCount, lastMessage}'
curl -s 'localhost:3000/api/messages?conversationId=1&limit=1' | jq '.[0].id'
curl -s 'localhost:3000/api/messages?conversationId=1&before=2&limit=10' | jq 'map(.id)'
```

**After fix:** conversation list is one SQL round-trip; message endpoint returns bounded pages in
ascending `id` order; `SHOW INDEX` lists the new indexes on existing volumes after API restart.

## Contributions

**User proposed**
- D2 + D6 + D7 as one group; add all necessary indexes for MySQL and Mongo

**Agent proposed**
- Startup `ensureIndexes()` for existing Docker volumes — **adopted**
- `parseLimit()` helper + unit test — **adopted**
- Frontend scroll-up load for `before` pages — **adopted**

**Changed during implementation**
- Scroll-up order bug: forward-loop `prepend` reversed each page; fixed with `DocumentFragment` +
  one `prepend` and shared `createMessageElement()`.
- Reopen showed only one page: `openConversation` now calls `loadMessagesForOpen()` using sidebar
  `messageCount` to fetch every page on open (still capped at 200 per HTTP request).

## Alternatives considered

See `spec/message-read-optimization.md`.

## Dead ends

None.
