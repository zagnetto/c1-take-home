# Track package-lock.json and use npm ci in Docker

## What shipped

The repo now tracks `package-lock.json` (lockfileVersion 3, generated from current
`package.json`). The app Docker image installs dependencies with **`npm ci`** instead of
**`npm install`**, so builds use the exact versions pinned in the lockfile.

Files:

- `package-lock.json` — added to git
- `docker/app/Dockerfile` — `RUN npm ci` (still copies `package*.json` before install)

## Why

`npm install` in Docker resolves semver ranges on every build, so two builds of the same commit
can pull different transitive versions. `npm ci` fails if the lockfile is out of sync with
`package.json` and installs exactly what the lockfile specifies — better for reproducible images
and CI.

Dev dependencies stay installed in the image because runtime uses `tsx` (`npm start`).

## Verification

```bash
docker compose build api
npm ci   # local sanity check against the committed lockfile
```

## Contributions

**User proposed**
- Commit the untracked `package-lock.json` and switch Docker from `npm install` to `npm ci`.

**Agent proposed**
- Decision record in `docs/033-package-lock-npm-ci.md` — **adopted**

## Alternatives considered

| Option | Why not |
|---|---|
| Keep `npm install` without a lockfile | Non-reproducible Docker builds |
| `npm ci --omit=dev` | Would drop `tsx` / `typescript` needed for `npm start` |
| Pin exact versions in `package.json` only | Does not lock transitive deps; lockfile is the standard npm approach |

## Dead ends

None.
