---
name: relay-realtime
description: Contracts and design rules for Relay's WebSocket layer — frame envelope, per-connection subscriptions, cross-instance fan-out through Redis pub/sub, typing indicators, presence, and unread state. Use when touching src/ws/, broadcasting events, adding a live feature, or making realtime survive docker compose --scale api=3.
---

# Relay Realtime

## How it works today

`src/ws/hub.ts` attaches a `WebSocketServer` to the same HTTP server (so WS and HTTP share port 3000
and Envoy's websocket upgrade config). State is a **process-local `Set` of connections**, each with a
`subs: Set<number>` of conversation ids.

- Inbound, the only frame handled: `{ type: 'subscribe', conversationIds: number[] }`. It *replaces*
  the subscription set. Malformed JSON is ignored silently.
- Outbound, produced by `broadcast(conversationId, payload)` from `src/routes/messages.js`:
  `{ type: 'message', id, conversationId, senderId, body, createdAt }`.
- `web/app.js` connects after loading conversations, subscribes to all of them, and ignores every
  frame whose `type` is not `'message'`.

**The sender's own message is only rendered when it comes back over the WebSocket.** The POST response
is discarded. So a broken fan-out looks like "my message vanished", not just "the other person didn't
see it".

## Rules

1. **Every frame is a JSON object with a `type` discriminator.** Keep the inbound and outbound frame
   unions in one module (e.g. `src/ws/protocol.ts`) and import it from both the hub and the routes, so
   there is a single place to check when the frontend and backend disagree.
2. **Additive changes only** on frames the frontend already handles; `web/app.js` has no build step
   and no versioning.
3. **Nothing in a module-level variable that must be shared.** Envoy round-robins with **no session
   affinity**, so the POST that creates a message and the WebSocket that must receive it routinely
   live on different instances. Anything process-local silently breaks at `--scale api=3`.
4. **Realtime is a notification channel, not a source of truth.** A client that missed frames must be
   able to recover by re-fetching. Do not make correctness depend on delivery.
5. **Never trust the socket for identity.** The connection carries no authenticated user; if a feature
   needs a user id, take it from the subscribe frame and note the trust assumption.

## Making fan-out work across instances

Publish to Redis and let every instance deliver to its own local subscribers, **including the instance
that originated the event**. One code path, no double-send:

```
POST /api/messages
  → persist
  → publish JSON to Redis channel
  → (no direct local send)

each instance's subscriber connection
  → receives the message
  → sends to local sockets subscribed to that conversationId
```

The alternative (send locally *and* publish, with the origin filtering its own message back out)
needs an instance id in the payload and is easy to get subtly wrong. Prefer publish-only.

Practical notes:

- A Redis connection in subscriber mode cannot run other commands — use a dedicated subscriber
  connection plus the shared publisher client. See
  [relay-redis-conventions](../relay-redis-conventions/SKILL.md) for channel naming and client setup.
- Subscribe once at startup, not per WebSocket connection.
- One channel with the conversation id in the payload is simpler to reason about than a channel per
  conversation; per-conversation channels need dynamic (un)subscription as clients come and go. Pick
  one and write down why.
- Clean up on `close` **and** `error`, and handle backpressure by dropping for sockets that are not
  `OPEN` (the current code already checks `readyState`).
- Add a heartbeat (server `ping`, terminate on missed pong) if you care about half-open connections;
  Envoy's `timeout: 0s` means dead sockets are not reaped for you.

## Typing indicator

- Ephemeral: never write it to MySQL or Mongo.
- Frame shape to add: inbound `{ type: 'typing', conversationId, userId }` and outbound
  `{ type: 'typing', conversationId, userId, isTyping }` — fan out through the same Redis path as
  messages.
- Debounce on the client (send at most once every ~2s while typing) and expire on the receiver after
  ~3-5s without a refresh, so a disconnect cannot leave a stuck "is typing".
- Never echo a user's typing state back to that same user's other tabs unless you decide to; state the
  choice.
- If you keep typing state in Redis rather than purely in flight, use a short TTL key per
  conversation/user and let expiry do the cleanup.

## Unread state

Currently browser-memory only: set when a frame arrives for a non-active conversation, cleared on
open, lost on reload, and never per-device consistent. To make it real, store a read position
(`conversation_participants.last_read_message_id`) and compute the unread count in
`GET /api/conversations`, then have the client mark-read when it opens a conversation. That is a
schema change plus a new endpoint — worth a spec note before implementing.

## Verifying

1. `docker compose up -d --scale api=3`
2. Two browser tabs (or two `wscat` clients) on the same conversation.
3. Send from one; the other must update, and the sender must see its own message.
4. Repeat several times so round-robin puts the writer and reader on different instances.
5. Reload both tabs and repeat, confirming resubscription works.
