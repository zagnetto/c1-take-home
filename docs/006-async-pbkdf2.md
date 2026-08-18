# C1 — async PBKDF2 keeps signature without blocking the event loop

## Symptom

Under concurrent `POST /api/messages`, unrelated reads (`GET /api/conversations`) and WebSocket
traffic slow to seconds. The whole process appears stuck, not just message sends.

## Reproduction

```bash
# terminal 1 — baseline read latency
while true; do curl -s -o /dev/null -w '%{time_total}\n' 'localhost:3000/api/conversations?userId=1'; done

# terminal 2 — 50 parallel sends
seq 1 50 | xargs -P 50 -I{} curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST localhost:3000/api/messages -H 'content-type: application/json' \
  -d '{"conversationId":1,"senderId":1,"body":"concurrent {}"}'
```

**Before fix:** terminal 1 times jump from ~milliseconds to seconds during the burst.

## Root cause

`src/services/messages.ts` called `crypto.pbkdf2Sync(...)` on every send. That API runs on the main
thread and does not use libuv's thread pool, so ~17 ms+ of CPU per message monopolises the event loop
before any database I/O. Fifty parallel requests queue entirely on that thread.

## Fix

Replaced `pbkdf2Sync` with async `crypto.pbkdf2` via `util.promisify` (same password, salt,
iterations, key length, digest). Extracted `computeMessageSignature()` for clarity and testing.
The hex stored in Mongo `message_bodies.signature` is unchanged.

## Verification

- `npm test` — `computeMessageSignature` output equals legacy `pbkdf2Sync` for a fixed body.
- Manual: curl burst + parallel `GET` — read latency stays in milliseconds (see Reproduction).

## Contributions

**User proposed**
- **Keep `signature`** — explicitly rejected removing the field; handling CPU-heavy work without
  blocking the event loop is part of the assignment, not something to delete away.
- **Two fix variants:** (1) async method for the same hash, (2) Node.js worker threads — asked which
  is better for a take-home.

**Agent proposed**
- **Remove `signature` entirely** (from `docs/architecture-audit.md` C1 recommendation) — field is
  written to Mongo but never read; dropping it is the smallest production fix. **Rejected by user**
  (see above).
- **`crypto.pbkdf2` via `util.promisify`** — **adopted.** Same output as sync, stdlib only,
  minimal diff.
- **Worker threads** — **rejected for C1:** `crypto.pbkdf2` already runs in libuv's thread pool;
  a dedicated worker duplicates that with extra files and serialization, without benefit for built-in
  crypto.

**Agreed in Phase 2**
- Keep `signature`; switch to async `pbkdf2`; no worker threads; document the rejected removal
  option and both user variants with rationale.

## Alternatives considered

| Option | Outcome |
|---|---|
| Remove `signature` + `pbkdf2Sync` | Agent recommendation from audit; user rejected — bypasses the concurrency lesson |
| Async `crypto.pbkdf2` | **Chosen** — unblocks event loop, identical hex, no new dependencies |
| Worker threads | User variant; rejected — redundant over libuv thread pool for `crypto.pbkdf2` |
| HMAC instead of PBKDF2 | Faster but different algorithm and hex — changes the stored contract |
| Background queue / outbox | Lowers POST latency but complicates dual-write (C2); out of C1 scope |

## Dead ends

None — went straight from agreed design to implementation.
