# Project structure refactor — Phase 4 (services / persistence extraction)

## What shipped

Moved MySQL/Mongo queries out of route handlers into `src/services/`. Routes still own input
validation and HTTP status mapping (controllers arrive in Phase 5). No behaviour change.

### New services

| File | Functions |
|---|---|
| `services/conversations.ts` | `LIST_CONVERSATIONS_SQL`, `findConversationIdByTitle`, `listConversations`, `createConversation` |
| `services/messages.ts` | `listMessages` (added alongside existing `createMessage`) |
| `services/search.ts` | `searchMessages` (stub — still returns `[]`) |

### Route changes

| Route | Before | After |
|---|---|---|
| `routes/conversations.ts` | Inline SQL + pool calls | Calls `listConversations`, `findConversationIdByTitle`, `createConversation` |
| `routes/messages.ts` GET | Inline pool + mongo join | Calls `listMessages` |
| `routes/search.js` | Stub inline | Renamed to `routes/search.ts`; calls `searchMessages` |

### Import rewiring

| Consumer | Before | After |
|---|---|---|
| `index.ts` | `./routes/search.js` | `./routes/search.ts` |
| `routes/tests/conversations-list-scaling.test.ts` | `LIST_CONVERSATIONS_SQL` from `../conversations.ts` | `../../services/conversations.ts` |

### Deleted

- `src/routes/search.js` (replaced by `search.ts`)

## Contributions

**User proposed**
- All DB queries in services, not routes or helpers — Phase 4 scope from `spec/project-structure-refactor.md`.

**Agent proposed**
- Export `ConversationListItem` and `SearchResult` from owning services (not `src/types/` yet) — **adopted**
- Keep validation and HTTP error mapping in routes until Phase 5 controllers — **adopted**
- Rename `search.js` → `search.ts` as part of the move — **adopted** (spec table)

**Agreed in Phase 2**
- No `repositories/` layer; services own queries directly.
- `LIST_CONVERSATIONS_SQL` stays exported for EXPLAIN regression test.

**Changed during implementation**
- None — mechanical extraction only.

## Alternatives considered

| Option | Why not |
|---|---|
| Move duplicate-title 409 mapping into service | HTTP concerns belong in routes/controllers; service throws `ER_DUP_ENTRY`, route maps to 409. |
| `src/types/` for shared interfaces | Spec defers until controllers need them; no duplication yet. |
| Implement real search in Phase 4 | Out of scope — stub moves to service only. |

## Verification

```bash
npm test
# 73 tests, 0 failures (after Phase 4)
```

Integration coverage unchanged: conversations list/scaling, messages pagination, idempotency,
duplicate title, conversation access.

## Dead ends

None.

## Next

Phase 5 — introduce `controllers/` and thin routes to handler binding only.
