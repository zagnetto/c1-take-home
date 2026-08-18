---
name: relay-api-conventions
description: Conventions for Relay HTTP endpoints — router layout, input validation, error handling, response shapes, SQL usage, pagination, and the contract with the no-build frontend in web/app.js. Use when adding or changing anything under src/routes/, src/services/, or when a change affects an API response the frontend consumes.
---

# Relay API Conventions

## Layout

One router per resource in `src/routes/`, exported as `<name>Router`, mounted in `src/index.ts` under
`/api/<name>`. Handlers stay thin: parse and validate input, call a service in `src/services/`, shape
the response.

**Write new files in TypeScript.** `src/routes/conversations.js`, `messages.js`, and `search.js` are
`.js` and therefore unchecked (`checkJs: false`), which is why their DB rows are untyped `any`. When
you make more than a cosmetic change to one, rename it to `.ts`, type the rows, and update the import
in `src/index.ts` — the imports there already use the `.js` specifier, so adjust it to `.ts` to match
the rest of the codebase.

## Validation

Validate at the boundary and coerce once, before any I/O:

```ts
const conversationId = Number(req.query.conversationId);
if (!Number.isInteger(conversationId) || conversationId <= 0) {
  return res.status(400).json({ error: 'conversationId must be a positive integer' });
}
```

Note the existing checks use bare truthiness (`if (!conversationId)`), which silently rejects `0` and
accepts `"12abc"` via `Number()`. Prefer explicit integer checks in new code. Cap and trim strings —
`body` is currently unbounded, so a client can post megabytes.

## Errors

The app has **no error-handling middleware**, so a rejected promise inside an async handler becomes an
unhandled rejection instead of a response, and `restart: on-failure` hides the crash. When touching
route code:

- add a terminal error middleware (`(err, req, res, next)`) registered after the routers in
  `src/index.ts`, returning `{ error: string }` with a 500 and logging the real error server-side;
- never send stack traces or driver messages to the client;
- for expected failures return the specific status directly from the handler.

## Response conventions

- JSON only, keys in `camelCase`. Alias snake_case columns in SQL: `conversation_id AS conversationId`.
- Errors are always `{ error: string }` — the shape the existing routes use.
- Status codes: `201` on create, `400` on invalid input, `404` for an unknown id, `429` for rate
  limiting (always with `Retry-After`), `500` only for genuine bugs.
- Timestamps are whatever the driver returns today (`Date` from MySQL, ISO string from JSON). If you
  normalise them, normalise everywhere and update `web/app.js`.

## SQL

- Always parameterised (`?`). Never interpolate values into SQL.
- Existing pattern: `pool.execute` for writes, `pool.query` for reads.
- **No per-row queries inside a loop.** `GET /api/conversations` currently issues two extra queries
  per conversation; collapse that kind of thing into a single JOIN or aggregate.
- Check for a supporting index before adding a filtered or sorted query — `messages` has only a
  primary key today.
- There are no foreign keys, so referential checks must be explicit in code where they matter.

## Pagination

`GET /api/messages` returns an entire conversation with no limit. New or reworked list endpoints take
a bounded page:

```
GET /api/messages?conversationId=1&before=<messageId>&limit=50
```

Cap `limit` server-side (50 default, 200 max), keyset-paginate on `id`, and return rows in ascending
id order so the frontend can append without re-sorting.

## Frontend contract

`web/` is plain JS served statically with no build, so any response change means editing `web/app.js`
in the same commit. What it consumes today:

| Endpoint | Expected by the frontend |
|---|---|
| `GET /api/conversations?userId=1` | `[{ id, title, messageCount, lastMessage, unread? }]` — renders `title (messageCount)` and a dot when `unread` is truthy |
| `GET /api/messages?conversationId=` | `[{ senderId, body, ... }]` in display order |
| `POST /api/messages` | Accepts `{ conversationId, senderId, body, clientId }`; **the response is ignored** — the sent message is only rendered when it arrives back over the WebSocket |
| `POST /api/conversations` | Accepts `{ title, participantIds }` |
| `GET /api/search?q=` | `[{ conversationId, conversationTitle, body }]` |

`clientId` is a fresh `crypto.randomUUID()` per send and there is a nullable `messages.client_id`
column, but nothing deduplicates on it. Treat it as the intended idempotency key: a unique index plus
an upsert-or-return-existing path makes retries safe.

Two frontend behaviours worth remembering before you change the send path: it clears the input before
the request completes (a rejected send loses the text, which matters once rate limiting exists), and
it never inspects the status code (a `429` is invisible to the user until it is handled).
