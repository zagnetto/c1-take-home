# TypeScript setup (backend only)

## What changed

- **Backend** (`src/`, `docker/db/`): fully TypeScript; `tsc --noEmit` is green after fixing
  `allowImportingTsExtensions`, MySQL `RowDataPacket` typings, and related strict-mode issues.
- **Frontend** (`web/app.js`): stays plain JavaScript — no build step, served statically as before.
  A brief `web/src/app.ts` + `tsc` emit experiment was reverted (see below).

## Verification

```bash
npm run typecheck   # backend only, 0 errors
npm test            # 73/73 pass
```

## Scripts

| Script | Purpose |
|---|---|
| `typecheck` | `tsc --noEmit` for `src/` and `docker/db/` |

## Frontend decision

Browsers run JavaScript only. TypeScript on the client requires a compile step (second file on disk
or a bundler). The user chose **one file — `web/app.js`** over `web/src/app.ts` → `web/js/app.js`.

## Contributions

**User proposed**
- Convert JS modules to TypeScript and review TS project setup.
- Revert frontend to a single `web/app.js` (simplest).

**Agent proposed**
- Backend typecheck fixes (`allowImportingTsExtensions`, `RowDataPacket`, etc.) — **adopted**
- Frontend TS via `tsc` emit — **rejected** (user preferred one plain JS file)

**Alternatives considered**
- `web/app.ts` in git + generated `app.js` gitignored — rejected (still two files at runtime).
- esbuild for web — rejected (new dependency).

**Dead ends**
- `rootDir: web`, `outDir: web` — TypeScript TS18003 when input and output share a tree.

**Supersedes:** initial web TS layout described in the first draft of this note (Aug 2026).

