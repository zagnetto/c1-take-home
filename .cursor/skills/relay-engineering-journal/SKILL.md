---
name: relay-engineering-journal
description: Templates and rules for the written record this repo is graded on — fix notes and decision records in docs/, feature specs in spec/, contribution attribution (user vs agent), commit message style, and the final change summary. Use after fixing a bug, before implementing a feature, when recording a trade-off or a dead end, or when writing the wrap-up for the submission.
---

# Relay Engineering Journal

The README asks for two things beyond working code: **a short note per fix explaining what was actually
wrong**, and the working left *in* the repo — "notes, plans, decisions, dead ends". It says explicitly
that *how* you worked counts as much as the result, and that you should not tidy it away. Treat the
written record as a deliverable, not overhead.

When the user describes an approach, record it in **`## Contributions`** before implementing — and
update that section when you refine, extend, or reject parts of it in Phase 2–3.

## Where things go

| Folder | Contents |
|---|---|
| `spec/` | Written **before** building (TDD Phase 2): goal, design, contracts, contributions, alternatives |
| `docs/` | Written **with** shipping (TDD Phase 3): what actually happened, verification, final contributions, dead ends |
| `src/**/*.test.ts` | Executable checks — **not** in `spec/` |

Naming: `docs/NNN-short-slug.md` (`001-session-auth.md`), `spec/<short-slug>.md` (match the task
file when one exists: `spec/rate-limiting.md` for `tasks/rate-limiting.md`).

## Agent checklist

Before ending a turn, ask: **does the repo reflect what we decided?**

1. **New or changed feature?** → `spec/<slug>.md` exists/updated with contracts and `## Contributions`.
2. **User agreed to implement?** → Phase 3 includes `docs/NNN-*.md` (or updates it) in the same change as the code.
3. **User proposed a solution?** → It appears under **User proposed** in Contributions, even if modified.
4. **Agent added or changed something?** → Under **Agent proposed** with adopted / rejected / pending.
5. **Spec and code diverged?** → Update both `spec/` and `docs/`; say why in the doc note.

## Contributions section (required in spec and docs)

Use this in every `spec/` file and every `docs/` note for a feature or fix. Keep it factual — no
credit theatre, just a clear audit trail of the conversation.

```markdown
## Contributions

**User proposed**
- <idea in the user's words, e.g. "assign a free seeded user on load; cookie token; sessions in Redis">

**Agent proposed**
- <extension or refinement, e.g. "`DELETE /api/session` to release slots"> — **adopted**
- <alternative considered in Phase 2, e.g. "JWT in localStorage"> — **rejected** (<one-line reason>)

**Agreed in Phase 2**
- <bullet list of what both sides confirmed before implementation>

**Changed during implementation** (docs only, if anything shifted in Phase 3)
- <what changed and why>
```

Shorthand table form is fine when there are many items:

| Idea | Who | Status |
|---|---|---|
| Redis-backed session store | User | Adopted |
| `503` when user pool exhausted | Agent | Adopted |
| Session renewal on each request | Agent | Rejected (unnecessary with TTL) |

## Fix note template (`docs/NNN-*.md`)

```markdown
# <what was broken, in plain words>

## Symptom
What a user or operator observes.

## Reproduction
The exact command or steps, copy-pasteable.

## Root cause
The mechanism, pointing at file and line. Not "it was slow" — why it was slow.

## Fix
What changed and why.

## Contributions
<User / agent / agreed — use the section above. For bugs, note if the user pointed at the symptom or a suspected cause.>

## Alternatives considered
Each option that was weighed, and the specific reason it lost.

## Verification
Same reproduction, before and after, with numbers (including test red → green).

## Dead ends
What was tried and abandoned.

## Trade-offs and follow-ups
What this does not solve, and what you would do next.
```

## Spec template (`spec/<slug>.md`)

```markdown
# <feature>

## Goal
One or two sentences. Link `tasks/<name>.md` when applicable.

## Non-goals
What you are deliberately not building.

## Contributions
<User / agent / agreed — capture the conversation before code is written.>

## Design
The approach agreed for Phase 3.

## Alternatives considered
Each option that was rejected, and the specific reason it lost.

## Contracts
HTTP endpoints, request/response shapes, WebSocket frames, Redis keys and channels, schema changes.

## Failure modes
What happens when a dependency is down, a client disconnects, or two requests race.

## How to verify
Concrete steps, including the multi-instance check where relevant. Point at `src/**/*.test.ts` when tests exist.
```

## Decision records

For choices not tied to one bug or feature — test runner, `ioredis`, routes → TypeScript — write
`docs/NNN-*.md` with context, decision, consequences, and Contributions if the user suggested the
direction.

## Dead ends

Keep them. A note saying "tried in-process locking for the rate limit, abandoned because Envoy has no
session affinity so each instance kept its own counter" demonstrates more than silently shipping the
working version. A short `## Dead ends` section in the relevant note is enough.

## Commits

- `type(scope): imperative summary`, e.g. `fix(messages): move signing off the request path`,
  `feat(search): implement GET /api/search`, `docs(notes): record blocking pbkdf2 fix`.
- One logical change per commit. Bug fixes never ride along with refactors.
- Reference the note or spec in the body (`See docs/001-blocking-pbkdf2.md`, `See spec/session-auth.md`).
- Commit notes together with the change they describe.

## Final summary

Keep the submission summary in the repo as `docs/SUMMARY.md`:

```markdown
# Summary

## What was broken
- <one line each, linking the fix note>

## What I built
- <feature, linking the spec>

## What I changed structurally
- <refactors and why>

## What I would do next
- <ordered by value, with a sentence of reasoning>
```

Write it last, from the notes you already have. If writing it feels like archaeology, the notes were
not kept well enough along the way.
