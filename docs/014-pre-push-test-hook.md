# Pre-push hook runs the test suite

## What and why

`git push` now runs `npm test` first. The push is blocked when any test fails; it proceeds only when
the suite exits 0 (including skipped integration tests when Docker is down — same as a manual
`npm test`).

Hooks live in `.githooks/` (version-controlled). Each clone runs `scripts/install-git-hooks.sh`
once to set `core.hooksPath=.githooks`. Bypass with `git push --no-verify` when needed.

## Verification

```bash
sh scripts/install-git-hooks.sh
.githooks/pre-push          # should print test output and exit 0
git push --dry-run          # hook does not run on dry-run; use a real push to confirm
```

## Contributions

**User proposed**
- Git hook before push that runs all tests; allow push only when every test passes.

**Agent proposed**
- Store hooks in `.githooks/` + local `core.hooksPath` install script (no Husky or other new dep) —
  **adopted**

## Alternatives considered

| Option | Why not |
|---|---|
| Husky | New npm dependency; overkill for one hook |
| Hook only in `.git/hooks/` | Not version-controlled; lost on fresh clones |
| Cursor `beforeShellExecution` hook | Gates agent shell commands, not the developer's `git push` |
