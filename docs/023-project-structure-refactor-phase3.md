# Project structure refactor — Phase 3 (validation → helpers/validation)

## What shipped

Mechanical move of input parsers and sanitizers from `src/validation/` into
`src/helpers/validation/`. No behaviour change — only paths and imports.

### Moved

| From | To |
|---|---|
| `src/validation/messageInput.ts` | `src/helpers/validation/messageInput.ts` |
| `src/validation/tests/messageInput.test.ts` | `src/helpers/validation/tests/messageInput.test.ts` |
| `src/validation/tests/web-xss-sinks.test.ts` | `src/helpers/validation/tests/web-xss-sinks.test.ts` |

### Import rewiring

| Consumer | Before | After |
|---|---|---|
| `routes/messages.ts` | `../validation/messageInput.ts` | `../helpers/validation/messageInput.ts` |
| `routes/conversations.ts` | `../validation/messageInput.ts` | `../helpers/validation/messageInput.ts` |
| `helpers/validation/messageInput.ts` | `../constants/*` | `../../constants/*` |

### Deleted

- `src/validation/` (empty after move)

## Contributions

**User proposed**
- `validation/` becomes `helpers/validation/` — pure input shaping fits under helpers.

**Agent proposed**
- Move `web-xss-sinks.test.ts` alongside validation tests (was already under `validation/tests/`) — **adopted**

**Agreed in Phase 2**
- Phase 3 is mechanical; `npm test` green at end; no new dependencies.

**Changed during implementation**
- Spec table updated to reflect Phase 1 test paths (`validation/tests/` not top-level `messageInput.test.ts`).
- `web-xss-sinks.test.ts` path to `web/app.js` adjusted (`../../../../web/app.js` from new depth).

## Alternatives considered

| Option | Why not |
|---|---|
| Leave `web-xss-sinks.test.ts` at top level | No `src/tests/` folder per spec; XSS tests stay with validation module that owns sanitizers. |
| Split sanitizers into separate files | Unnecessary for ~50 lines; defer until controllers/services split in Phase 4–5. |

## Verification

```bash
npm test
# 73 tests, 0 failures (after Phase 3)
```

Unit coverage unchanged: 6 cases in `helpers/validation/tests/messageInput.test.ts`, 2 in
`web-xss-sinks.test.ts`.

## Dead ends

None — no circular imports; constants paths only needed one extra `../` segment.

## Follow-ups

- Phase 4: extract persistence from routes into services (`conversations`, `messages` list, `search`).
- Phase 5: introduce controllers; thin routes.
