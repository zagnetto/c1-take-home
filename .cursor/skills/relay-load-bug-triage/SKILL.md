---
name: relay-load-bug-triage
description: Method and concrete suspect list for the defects in Relay that only appear under real traffic — event-loop blocking, N+1 queries, missing indexes, non-idempotent sends, dual-write inconsistency, unbounded reads, and process-local realtime state. Use when hunting a bug, investigating slowness, duplicated or empty messages, or verifying that a fix actually changed behaviour.
---

# Relay Load Bug Triage

The README's "a few things don't behave the way they should once there's real traffic" is the core of
this exercise. Work evidence-first: a fix without a before/after measurement is indistinguishable from
a guess.

## Method

1. **Reproduce** with the smallest command that shows the symptom (see
   [relay-dev-workflow](../relay-dev-workflow/SKILL.md) for burst and concurrency recipes).
2. **Measure** and keep the number: request timings, row counts, `EXPLAIN` output, log lines.
3. **Explain the mechanism** before editing. "It's slow" is not a root cause; "a synchronous 200k-round
   key derivation runs on the event loop per send, so every other request queues behind it" is.
4. **Fix narrowly**, no drive-by rewrites in the same commit.
5. **Re-measure with the same command** and record both numbers.
6. **Write it up** using the fix-note template in
   [relay-engineering-journal](../relay-engineering-journal/SKILL.md).

Distinguish the three failure classes early, because they need different instruments:

| Symptom | Likely class | Instrument |
|---|---|---|
| *Everything* slows down together, including trivial reads | Event loop blocked | Time a `GET` in one shell during a POST burst |
| One query slows as data grows | Missing index / N+1 | `EXPLAIN`, count queries per request |
| Works on one instance, breaks on three | Process-local state | `--scale api=3` |

## Suspects

Verified reading of the code, but treat each as a hypothesis to confirm with a measurement.

**Event loop blocked on every send** — `src/services/messages.ts` runs
`crypto.pbkdf2Sync(body, 'relay-signing', 200000, 32, 'sha256')` inline. It is synchronous, ~100ms+ of
pure CPU, and it holds the entire process. Ask first whether the `signature` field is needed at all;
if it is, it belongs in an async/threadpool path (`crypto.pbkdf2`) or out of the request path entirely.
Nothing reads it today.

**N+1 in the conversation list** — `src/routes/conversations.js` loops over conversations issuing a
`last message` query and a `COUNT(*)` query each. Collapse into one JOIN/aggregate query.

**No index on `messages.conversation_id`** — every message read and every `COUNT(*)` is a full scan;
`ORDER BY id DESC LIMIT 1` per conversation makes it worse. Confirm with `SHOW INDEX FROM messages`
and `EXPLAIN`, then add `(conversation_id, id)`.

**Sends are not idempotent** — the client generates a `clientId` UUID per send and the column exists,
but there is no unique index and no dedup, so a retry, a double-click, or a client-side resend creates
a second message. A unique index plus return-existing-on-conflict is the intended shape.

**Dual write without atomicity** — `createMessage` inserts into MySQL, then into Mongo. A failure or
crash between them leaves a message with no body, and `src/routes/messages.js` hides it behind
`?? ''`, so it silently renders as an empty bubble. Compare `COUNT(*)` in MySQL against
`countDocuments()` in Mongo.

**Unbounded history read** — `GET /api/messages` returns every message in a conversation plus an
`$in` over every id. It degrades linearly and has no limit; pagination convention is in
[relay-api-conventions](../relay-api-conventions/SKILL.md).

**Realtime is process-local** — `src/ws/hub.ts` keeps connections in a module-level `Set`, so with
`--scale api=3` a message reaches only the clients that happen to share an instance with the writer.
Since the frontend renders its own message from the WebSocket echo, the sender frequently sees nothing
at all. Details in [relay-realtime](../relay-realtime/SKILL.md).

**No error handling anywhere** — no `(err, req, res, next)` middleware and no `try/catch` in the async
handlers, so any driver error becomes an unhandled rejection: the request hangs and the process may
exit. `restart: on-failure` then quietly restarts it, which also **drops every WebSocket connection**
on that instance, and the frontend never reconnects (`connectWs` is only called on load). A single bad
input can therefore look like "realtime randomly stops working".

**No input bounds** — `body` is unbounded, `participantIds` is unbounded, and there is no rate limit
(that is the `tasks/rate-limiting.md` feature). A single client can flood a conversation.

**Missing reconnect on the client** — `web/app.js` never reconnects a closed socket and never resends
`subscribe` after a new conversation is created until a full reload. Worth a note even if you leave it.

## Reporting

Note per fix, kept short, in `docs/`. One file per fix or one file with dated entries — pick one and be
consistent. Always include the measurement, since that is what makes the claim checkable.
