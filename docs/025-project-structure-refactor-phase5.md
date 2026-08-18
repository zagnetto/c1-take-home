# Project structure refactor — Phase 5 (controllers + thin routes)

## What shipped

Introduced `src/controllers/` and reduced route files to Express wiring only: paths, middleware,
and `asyncHandler(controllerFn)` binding. Input validation, HTTP status mapping, and service
orchestration (including WebSocket broadcast on new messages) live in controllers. No behaviour
change.

### New controllers

| File | Handlers |
|---|---|
| `controllers/conversationsController.ts` | `list`, `create` |
| `controllers/messagesController.ts` | `create`, `list` |
| `controllers/sessionController.ts` | `createOrReuse` |
| `controllers/searchController.ts` | `search` |

### Route shape (after)

```ts
messagesRouter.get(
  '/',
  requireSession,
  requireConversationAccess({ source: 'query' }),
  asyncHandler(messagesController.list),
);
```

Routes import only controllers and middleware — no services, helpers, constants, or `ws/hub`.

### Layer compliance

| Layer | May import | Verified |
|---|---|---|
| `routes/` | controllers, middleware | ✓ |
| `controllers/` | services, helpers, constants, ws (broadcast) | ✓ |

`messagesController.create` keeps the `broadcast()` call — realtime fan-out is controller
orchestration, not persistence; moving it into `createMessage` would couple the service to WebSocket.

## Contributions

**User proposed**
- Separate `controllers/` folder; routes hold only wiring — Phase 5 scope from
  `spec/project-structure-refactor.md`.

**Agent proposed**
- Namespace import (`import * as messagesController`) in routes for readable binding lines — **adopted**
- Keep `broadcast` in `messagesController.create` rather than in service — **adopted** (orchestration vs persistence)
- `sessionController.createOrReuse` name for POST /api/session idempotent create — **adopted**

**Agreed in Phase 2**
- Layer import rules: routes → controllers → services.
- No barrel `index.ts` re-exports; explicit `.ts` ESM paths.

**Changed during implementation**
- None — mechanical extraction only.

## Alternatives considered

| Option | Why not |
|---|---|
| Move `broadcast` into `services/messages.ts` | Couples persistence to WebSocket; violates service layer purity. |
| Controller per file per handler (`list.ts`, `create.ts`) | Over-split for four small resources; one controller per domain matches spec table. |
| Inline arrow wrappers in routes | Spec target shape uses named controller exports bound via `asyncHandler`. |

## Verification

```bash
npm test
# 73 tests, 0 failures (after Phase 5)
```

Integration coverage unchanged: session, conversations CRUD/validation, messages send/list/idempotency,
conversation access, search stub.

## Dead ends

None.

## Next

Phase 6 — update `relay-architecture` skill and ship consolidated refactor doc.
