# Project structure refactor — complete

## What shipped

Six incremental phases reorganised `src/` so HTTP boundaries, domain logic, persistence, shared
utilities, and tests each have a clear home. Routes no longer own SQL or business rules; controllers
handle HTTP mapping; services own all DB access. `npm test` stayed green after every phase.

### Final layout

```
src/
├── index.ts, config.ts, shutdown.ts
├── routes/              # Express Router: paths, middleware, controller binding
├── controllers/         # req/res: validate, call service, map errors → HTTP
├── services/            # domain logic + MySQL / Mongo / Redis queries
├── constants/           # limits, Redis keys, infra error code sets
├── helpers/             # pure utilities (pagination, mysqlErrors, …)
│   └── validation/      # input parsers and sanitizers
├── middleware/
├── db/                  # connection singletons, ensureIndexes
├── ws/
└── testHelpers/         # shared integration-test fixtures

src/**/tests/            # co-located tests (glob: src/**/tests/**/*.test.ts)
```

### Phase summary

| Phase | Scope | Doc |
|---|---|---|
| 1 | Move all `*.test.ts` into per-module `tests/` subfolders | (mechanical; no separate note) |
| 2 | Extract `constants/*`, `helpers/pagination`, `helpers/mysqlErrors`; dedupe test helpers | `docs/022-project-structure-refactor-phase2.md` |
| 3 | `validation/` → `helpers/validation/` | `docs/023-project-structure-refactor-phase3.md` |
| 4 | Persistence out of routes into `services/`; `search.js` → `search.ts` | `docs/024-project-structure-refactor-phase4.md` |
| 5 | Introduce `controllers/`; thin routes | `docs/025-project-structure-refactor-phase5.md` |
| 6 | Update `relay-architecture` skill; this consolidated note | — |

### Layer compliance (after Phase 5)

| Layer | May import | Must not |
|---|---|---|
| `routes/` | controllers, middleware | db clients, SQL, domain logic |
| `controllers/` | services, helpers, constants, `ws/hub` | db clients, raw SQL |
| `services/` | db clients, helpers, constants, other services | Express, `req`/`res` |
| `helpers/` | other helpers, constants | db clients, Express |
| `db/` | config | business queries |

`messagesController.create` keeps `broadcast()` — realtime fan-out is controller orchestration, not
persistence.

### Key modules

| Area | Files |
|---|---|
| Controllers | `conversationsController`, `messagesController`, `sessionController`, `searchController` |
| Services | `conversations`, `messages` (`createMessage`, `listMessages`), `session`, `search`, `conversationAccess` |
| Constants | `messages`, `conversations`, `redis`, `errors` |
| Helpers | `pagination`, `mysqlErrors`, `validation/messageInput` |

## Contributions

**User proposed**
- All tests in corresponding `tests/` subfolders.
- Separate `controllers/` folder; routes hold only wiring.
- All DB queries in services, not controllers or helpers.
- Constants in dedicated files; helpers for pure utilities.
- `validation/` becomes `helpers/validation/`.
- Update architecture skill when code lands.

**Agent proposed**
- Layer import rules table (routes → controllers → services) — **adopted**
- Incremental six-phase migration order — **adopted**
- Optional `src/types/` when interfaces are shared — **adopted** (deferred; no duplication yet)
- No `repositories/` layer — **adopted**
- Consolidate duplicated test constants into `testHelpers/` — **adopted**
- Redis key builders in `constants/redis.ts` (namespace contracts) — **adopted**
- `broadcast` stays in controller, not service — **adopted**

**Agreed across phases**
- Test glob: `src/**/tests/**/*.test.ts`.
- No barrel `index.ts` re-exports; explicit `.ts` ESM paths.
- No new npm dependencies for the refactor.
- `isInfrastructureError` stays in middleware; only error `Set`s moved to `constants/errors.ts`.

**Changed during implementation**
- Phase 2: unique title suffix in validation tests; `createdAt` comparison tolerance for MySQL `DATETIME`.
- Phase 4: `LIST_CONVERSATIONS_SQL` exported from service for EXPLAIN regression test.
- Phase 6: architecture skill also updated stale notes (all routes TypeScript, session auth, Redis usage).

## Alternatives considered

| Option | Why not |
|---|---|
| Top-level `tests/` mirroring `src/` | User chose co-located `tests/` subfolders. |
| Keep `validation/` at top level | Fits under `helpers/` as pure input shaping. |
| `repositories/` between services and db | Extra indirection for ~10 queries. |
| Big-bang rewrite in one PR | High regression risk; incremental phases kept `npm test` trustworthy. |
| Move `broadcast` into `services/messages.ts` | Couples persistence to WebSocket. |
| `src/types/` in Phase 4–5 | No shared-interface duplication yet; types export from owning service. |

## Verification

```bash
npm test
# 73 tests, 0 failures (after Phase 5; unchanged through Phase 6 docs)
```

Phase 6 is documentation-only — no production code changes.

## Dead ends

None across the refactor. Import rewiring in Phases 2–3 was straightforward; Phases 4–5 were
mechanical extractions with no circular dependencies.

## Explicit non-goals (unchanged)

- No `repositories/` layer.
- No barrel re-exports.
- No new npm dependencies for the refactor itself.

## Follow-ups

- Introduce `src/types/` when controllers and services both need the same interface and exporting
  from the owning service becomes awkward.
- Remaining tasks in `tasks/` (search, rate limiting, typing indicator, multi-instance) should follow
  the layer rules above.
