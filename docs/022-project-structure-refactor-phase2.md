# Project structure refactor — Phase 2 (constants and helpers)

## What shipped

Mechanical extraction of limits, Redis key contracts, pagination math, and MySQL error
classification into dedicated modules. No HTTP or persistence behaviour changed.

### New modules

| Path | Contents |
|---|---|
| `src/constants/messages.ts` | `MAX_MESSAGE_BODY_LENGTH`, `DEFAULT_MESSAGE_LIMIT`, `MAX_MESSAGE_LIMIT` |
| `src/constants/conversations.ts` | `MAX_CONVERSATION_TITLE_LENGTH` |
| `src/constants/redis.ts` | `REALTIME_EVENTS_CHANNEL`, `sessionTokenKey`, `sessionUserSlotKey` |
| `src/constants/errors.ts` | `INFRA_ERROR_CODES`, `INFRA_ERROR_NAMES` |
| `src/helpers/pagination.ts` | `parseLimit`, `buildMessagesPage`, list page types |
| `src/helpers/mysqlErrors.ts` | `isDuplicateTitleError` |

### Deleted

- `src/services/realtimeKeys.ts`
- `src/services/sessionKeys.ts`
- `src/routes/messagesPagination.ts`
- `src/routes/tests/messagesPagination.test.ts` → `src/helpers/tests/pagination.test.ts`

### Test helpers

- `testHelpers/httpSession.ts` exports `TEST_BASE_URL`, `SESSION_COOKIE` (`config.sessionCookieName`), `trackSession`.
- Seven route integration tests deduplicated to import shared helpers.

## Contributions

**User proposed**
- Constants in dedicated files; helpers for pure utilities; consolidate test `BASE` / cookie literals.

**Agent proposed**
- Redis key builders in `constants/redis.ts` (namespace contracts, not transform logic) — **adopted**
- `isInfrastructureError` stays in middleware; only `Set`s move — **adopted**
- `helpers/tests/mysqlErrors.test.ts` — **adopted**
- `TEST_BASE_URL` export name — **adopted**

**Agreed in Phase 2**
- Single PR; `npm test` green; no new dependencies.

**Changed during implementation**
- `conversations-validation.test.ts` uses a unique title suffix so reruns do not hit 409 from leftover rows.
- `messages-validation.test.ts` compares `createdAt` within one second (MySQL `DATETIME` vs ISO ms).

## Alternatives considered

| Option | Why not |
|---|---|
| Move `isInfrastructureError` to `helpers/errors.ts` | User chose middleware-only; classification is Express-specific. |
| Keep `BASE` export name | User chose `TEST_BASE_URL` to signal test-only scope. |

## Verification

```bash
npm test
# 73 tests, 0 failures (after Phase 2)
```

New unit coverage: `helpers/tests/pagination.test.ts` (5), `helpers/tests/mysqlErrors.test.ts` (2).

## Dead ends

None — import rewiring was straightforward; no circular deps after `wsSession.ts` reads `config.sessionCookieName` directly instead of importing from `httpSession.ts`.

## Follow-ups

- Phase 3: move `src/validation/` → `src/helpers/validation/`.
- Phase 4–5: extract services and controllers.
