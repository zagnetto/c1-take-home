# Project structure refactor

## Goal

Reorganise `src/` so HTTP boundaries, domain logic, persistence, shared utilities, and tests have
clear homes. Routes stop owning SQL and business rules; all DB access lives in services; constants
and pure helpers are extracted; tests move into per-module `tests/` subfolders.

This is an incremental refactor — one domain at a time — with `npm test` green after each phase.

## Target layout

```
src/
├── index.ts
├── config.ts
├── shutdown.ts
├── routes/              # Express Router only: paths, middleware, controller binding
├── controllers/         # req/res: parse input, call service, map errors → HTTP status/json
├── services/            # domain logic + all MySQL / Mongo / Redis queries
├── constants/           # limits, Redis key names, infra error codes (no I/O)
├── helpers/             # pure utilities (pagination math, MySQL error classification, …)
│   └── validation/      # input parsers and sanitizers (was src/validation/)
├── middleware/
├── db/                  # connection singletons, ensureIndexes — no business queries
├── ws/
└── testHelpers/         # shared fixtures for integration tests (httpSession, wsSession, …)

src/routes/tests/
src/controllers/tests/   # if controller unit tests are added
src/services/tests/
src/ws/tests/
src/middleware/tests/
src/helpers/tests/
src/db/tests/
…
```

Top-level loose tests (`src/shutdown.test.ts`, `src/web-xss-sinks.test.ts`, …) move into the
nearest module's `tests/` folder (`src/tests/` is **not** used — keep tests beside the code they
exercise).

## Layer rules

| Layer | May import | Must not |
|---|---|---|
| `routes/` | controllers, middleware | `pool`, `mongo`, `redis`, SQL, domain logic |
| `controllers/` | services, helpers, constants | `pool`, `mongo`, `redis`, raw SQL |
| `services/` | db clients, helpers, constants, other services | Express types, `req`/`res` |
| `helpers/` | other helpers, constants | db clients, Express |
| `helpers/validation/` | constants | db clients, Express |
| `db/` | config | business/domain logic |

**Route handler shape (after refactor):**

```ts
messagesRouter.get('/', requireSession, requireConversationAccess({ source: 'query' }),
  asyncHandler(messagesController.list));
```

**Controller shape:**

```ts
export async function list(req: Request, res: Response) {
  const conversationId = parsePositiveInt(req.query.conversationId);
  if (conversationId == null) {
    return res.status(400).json({ error: 'conversationId must be a positive integer' });
  }
  const page = await listMessages({ conversationId, userId: req.sessionUser.userId, … });
  return res.json(page);
}
```

## File moves (planned)

### Phase 1 — tests (mechanical)

- Move every `src/**/*.test.ts` → `src/<module>/tests/<name>.test.ts`.
- Update relative imports inside moved tests.
- Test glob (already updated in `package.json`): `src/**/tests/**/*.test.ts`.

### Phase 2 — constants and helpers

| Current | Target |
|---|---|
| `validation/messageInput.ts` limits | `constants/messages.ts`, `constants/conversations.ts` |
| `routes/messagesPagination.ts` limits | `constants/messages.ts` |
| `routes/messagesPagination.ts` functions | `helpers/pagination.ts` |
| `services/realtimeKeys.ts` | `constants/redis.ts` |
| `services/sessionKeys.ts` | `constants/redis.ts` |
| `middleware/errorHandler.ts` error sets | `constants/errors.ts` |
| `routes/conversations.ts` `isDuplicateTitleError` | `helpers/mysqlErrors.ts` |
| duplicated `BASE` / `SESSION_COOKIE` in route tests | `testHelpers/httpSession.ts` only |

#### Phase 2 status

- **Phase 1 (tests):** done — all `*.test.ts` live under `src/**/tests/`; glob in `package.json` matches.
- **Phase 2 (constants/helpers):** done — see `docs/022-project-structure-refactor-phase2.md`.

#### New files (Phase 2)

**`src/constants/messages.ts`**

```ts
export const MAX_MESSAGE_BODY_LENGTH = 10_000;
export const DEFAULT_MESSAGE_LIMIT = 50;
export const MAX_MESSAGE_LIMIT = 200;
```

**`src/constants/conversations.ts`**

```ts
export const MAX_CONVERSATION_TITLE_LENGTH = 200;
```

**`src/constants/redis.ts`** — merge `realtimeKeys.ts` + `sessionKeys.ts`:

```ts
export const REALTIME_EVENTS_CHANNEL = 'relay:events';

export function sessionTokenKey(token: string): string {
  return `relay:session:${token}`;
}

export function sessionUserSlotKey(userId: number): string {
  return `relay:session:user:${userId}`;
}
```

Key-builder functions live here (not `helpers/`) because they are namespace contracts, not
transform logic — same as the original spec table.

**`src/constants/errors.ts`**

```ts
export const INFRA_ERROR_CODES = new Set([/* ECONNREFUSED, … */]);
export const INFRA_ERROR_NAMES = new Set([/* MongoNetworkError, … */]);
```

**`src/helpers/pagination.ts`** — pure functions + list response types from `messagesPagination.ts`:

```ts
import { DEFAULT_MESSAGE_LIMIT, MAX_MESSAGE_LIMIT } from '../constants/messages.ts';

export type MessageListItem = { … };
export type MessagesPageResponse = { … };

export function parseLimit(raw: unknown): number | null { … }
export function buildMessagesPage<T extends { id: number }>(…): { … } { … }
```

**`src/helpers/mysqlErrors.ts`**

```ts
export function isDuplicateTitleError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err
    && (err as { code: string }).code === 'ER_DUP_ENTRY';
}
```

#### Files to delete after import rewiring

| File | Reason |
|---|---|
| `src/services/realtimeKeys.ts` | → `constants/redis.ts` |
| `src/services/sessionKeys.ts` | → `constants/redis.ts` |
| `src/routes/messagesPagination.ts` | split into constants + helpers |

#### Import rewiring (production)

| Consumer | Before | After |
|---|---|---|
| `validation/messageInput.ts` | local `MAX_*` constants | `constants/messages.ts`, `constants/conversations.ts` |
| `routes/messages.ts` | `messagesPagination`, `MAX_MESSAGE_BODY_LENGTH` from validation | `helpers/pagination.ts`, `constants/messages.ts`; keep parsers from validation until Phase 3 |
| `routes/conversations.ts` | `isDuplicateTitleError` inline, limits from validation | `helpers/mysqlErrors.ts`, `constants/conversations.ts` |
| `middleware/errorHandler.ts` | local `INFRA_ERROR_*` sets | `constants/errors.ts` (sets only; see open question on `isInfrastructureError`) |
| `services/session.ts`, `db/redis.ts`, `ws/hub.ts` | `services/*Keys.ts` | `constants/redis.ts` |
| `testHelpers/httpSession.ts`, `testHelpers/wsSession.ts` | `services/sessionKeys.ts` | `constants/redis.ts` |

#### Test file moves (Phase 2)

| Current | Target |
|---|---|
| `src/routes/tests/messagesPagination.test.ts` | `src/helpers/tests/pagination.test.ts` |

Update import to `../pagination.ts`. No new test cases — existing five tests stay as regression
guard for the move.

Optional (recommended): `src/helpers/tests/mysqlErrors.test.ts` with one case for `ER_DUP_ENTRY`
and one negative — cheap coverage for extracted helper; skip if user prefers zero new tests.

#### Test helper consolidation

**Problem:** five route integration tests duplicate `BASE`, `SESSION_COOKIE`, `stackAvailable`,
`redisAvailable`, `parseSessionCookie`, and local `createSession` (~40 lines each). Three others
already import partial helpers from `testHelpers/httpSession.ts`.

**Fix:** export from `testHelpers/httpSession.ts`:

```ts
export const TEST_BASE_URL = process.env.RELAY_TEST_URL ?? 'http://localhost:3000';
export const SESSION_COOKIE = config.sessionCookieName; // was hardcoded 'relay_session'
```

Refactor these files to import shared helpers instead of local copies:

- `routes/tests/session.test.ts`
- `routes/tests/conversations-validation.test.ts`
- `routes/tests/conversations-duplicate-title.test.ts`
- `routes/tests/messages-idempotent.test.ts`
- `routes/tests/messages-validation.test.ts`
- `routes/tests/message-read.test.ts` (replace local `BASE` only)
- `routes/tests/conversation-access.test.ts` (replace local `BASE` only)

`wsSession.ts`: replace local `SESSION_COOKIE` with `config.sessionCookieName` (or import from
`httpSession.ts` if we export it).

`session.test.ts` keeps its own Redis cleanup hooks — it tests the session endpoint lifecycle and
cannot fully delegate to `createSession()` from httpSession without changing assertion style. It
still drops duplicated `BASE` / cookie name / availability probes.

#### Execution order (single PR, verify `npm test` after each step)

1. Add `constants/*` — no consumers yet; trivial compile check.
2. Add `helpers/pagination.ts`, `helpers/mysqlErrors.ts`.
3. Rewire production imports; delete obsolete source files.
4. Update `validation/messageInput.ts` to import limits from constants (validation path unchanged
   until Phase 3).
5. Move `messagesPagination.test.ts` → `helpers/tests/pagination.test.ts`.
6. Export test constants from `httpSession.ts`; dedupe route tests.
7. Full `npm test`.

#### What stays untouched in Phase 2

- `src/validation/` path and parsers (`parsePositiveInt`, `sanitize*`, …) — Phase 3.
- Route handlers, SQL, pool/mongo calls — Phase 4–5.
- `isInfrastructureError` / `isMalformedJsonBody` — stay in `middleware/errorHandler.ts` unless
  user chooses to extract (open question below).
- `MessageListItem` / `MessagesPageResponse` types — stay in `helpers/pagination.ts` until Phase 4+
  (`src/types/` only if duplication appears).

#### Open questions — resolved

| Question | Decision |
|---|---|
| `isInfrastructureError` location | **Set-и → `constants/errors.ts`; функція лишається в `middleware/errorHandler.ts`** |
| `helpers/tests/mysqlErrors.test.ts` | **Так** — два кейси (`ER_DUP_ENTRY` + negative) |
| Test base URL export name | **`TEST_BASE_URL`** з `testHelpers/httpSession.ts` |

### Phase 3 — validation → helpers/validation

| Current | Target |
|---|---|
| `src/validation/messageInput.ts` | `src/helpers/validation/messageInput.ts` |
| `src/validation/tests/messageInput.test.ts` | `src/helpers/validation/tests/messageInput.test.ts` |
| `src/validation/tests/web-xss-sinks.test.ts` | `src/helpers/validation/tests/web-xss-sinks.test.ts` |

Imports change from `../validation/messageInput.ts` → `../helpers/validation/messageInput.ts`
(or relative equivalent). Delete empty `src/validation/` after migration.

#### Phase 3 status

- **Done** — see `docs/023-project-structure-refactor-phase3.md`.

### Phase 4 — services (persistence extraction)

| Current location | New service function |
|---|---|
| `routes/conversations.ts` `LIST_CONVERSATIONS_SQL`, `findConversationIdByTitle`, INSERT | `services/conversations.ts` |
| `routes/messages.ts` GET handler (pool + mongo join) | `services/messages.ts` → `listMessages` |
| `routes/search.js` stub | `services/search.ts` + rename route to `.ts` |

Existing `services/messages.ts` (`createMessage`) stays; GET logic joins it in the same module.

#### Phase 4 status

- **Done** — see `docs/024-project-structure-refactor-phase4.md`.

### Phase 5 — controllers + thin routes

| Route file | Controller | Service |
|---|---|---|
| `routes/conversations.ts` | `controllers/conversationsController.ts` | `services/conversations.ts` |
| `routes/messages.ts` | `controllers/messagesController.ts` | `services/messages.ts` |
| `routes/session.ts` | `controllers/sessionController.ts` | `services/session.ts` |
| `routes/search.ts` | `controllers/searchController.ts` | `services/search.ts` |

Delete `routes/messagesPagination.ts` once constants and helpers are split.

#### Phase 5 status

- **Done** — see `docs/025-project-structure-refactor-phase5.md`.
- Routes import only controllers and middleware; validation and HTTP mapping live in controllers.
- `messagesController.create` keeps `broadcast()` — controller orchestration, not service persistence.

### Phase 6 — documentation

- Update `.cursor/skills/relay-architecture/SKILL.md` (add controllers layer).
- Ship `docs/NNN-project-structure-refactor.md` when code lands.

## Types (optional, phase 4+)

Shared interfaces (`CreatedMessage`, `ConversationListItem`, …) may move to `src/types/` when
controllers and services both need them. Not required for the first migration pass — exporting from
the owning service is acceptable until duplication appears.

## Explicit non-goals

- **No `repositories/` layer** — services own queries directly; the codebase is small enough.
- **No barrel `index.ts` re-exports** — keep explicit ESM paths with `.ts` extensions.
- **No new npm dependencies** for the refactor itself.

## Test command

```json
"test": "node --import tsx --test --test-force-exit --test-concurrency=1 \"src/**/tests/**/*.test.ts\""
```

Until Phase 1 moves files, run tests with the old glob or move tests in the same PR that updates
the glob. After Phase 1, only `tests/` paths match.

## Migration order

1. Phase 1 — move tests, fix imports, verify green.
2. Phase 2 — extract constants/helpers (no behaviour change).
3. Phase 3 — `validation/` → `helpers/validation/`.
4. Phase 4 — extract services (conversations first, then messages read, then search).
5. Phase 5 — introduce controllers, thin routes.
6. Phase 6 — skill + docs update.

One domain per change set when possible; run full test suite after each phase.

## Alternatives considered

| Option | Why not |
|---|---|
| Top-level `tests/` mirroring `src/` | User asked for co-located `tests/` subfolders; keeps test context obvious. |
| Keep `validation/` at top level | User chose `helpers/validation/` — validation is pure input shaping, fits under helpers. |
| `repositories/` between services and db | Extra indirection for ~10 queries; services already the convention in architecture skill. |
| Big-bang rewrite in one PR | High merge conflict and regression risk; incremental phases keep `npm test` trustworthy. |
| Co-located `*.test.ts` next to source | Current layout; user explicitly requested `tests/` subfolders. |

## Contributions

**User proposed**
- All tests in corresponding `tests/` subfolders.
- Separate `controllers/` folder — routes today hold all logic.
- All DB queries in services, not controllers or helpers.
- Constants in dedicated files.
- Helper functions in dedicated helper modules.
- `validation/` becomes `helpers/validation/`.

**Agent proposed**
- Layer import rules table (routes → controllers → services) — **adopted**
- Incremental six-phase migration order — **adopted**
- Optional `src/types/` when interfaces are shared — **adopted** (deferred to phase 4+)
- No `repositories/` layer for this codebase size — **adopted**
- Consolidate duplicated test constants into `testHelpers/` — **adopted**
- Update `relay-architecture` skill after code lands — **adopted**

**Agreed in Phase 2 (planning)**
- Target layout and layer rules above.
- Test glob: `src/**/tests/**/*.test.ts`.
- `helpers/validation/` replaces `src/validation/`.
- Refactor is documentation-first; code phases follow user approval per domain.

**Agreed for migration Phase 2** (confirmed)
- Single PR for all Phase 2 extractions; `npm test` green at end.
- Redis key builders stay as functions in `constants/redis.ts` (not `helpers/`).
- `TEST_BASE_URL` export from `httpSession.ts`; `SESSION_COOKIE` reads `config.sessionCookieName`.
- `isInfrastructureError` stays in `middleware/errorHandler.ts`; only the `Set`s move to `constants/errors.ts`.
- Add `helpers/tests/mysqlErrors.test.ts` (two cases).
- No new npm dependencies.
