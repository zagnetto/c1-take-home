# Typing indicator

## Goal

Show when another participant in the active conversation is typing. Ephemeral only — never persisted
to MySQL or Mongo.

## Protocol (`src/ws/protocol.ts`)

### Inbound (client → server)

```json
{ "type": "typing", "conversationId": 1, "isTyping": true }
```

- `userId` is **not** sent by the client; the server derives it from the authenticated WebSocket
  session (`ws.userId`).
- `isTyping` must be a boolean (`true` or `false`).

### Outbound (server → clients)

```json
{ "type": "typing", "conversationId": 1, "userId": 2, "isTyping": true }
```

Fan-out uses the existing publish-only Redis path (`relay:events` → local room delivery).

## Server (`src/ws/hub.ts`)

1. Accept inbound `typing` frames on an open, authenticated socket.
2. Validate `conversationId` is a positive finite integer and `isTyping` is boolean.
3. Require `conversationId ∈ ws.subs` (membership already enforced at subscribe time).
4. Publish `{ type: 'typing', conversationId, userId: ws.userId, isTyping }` via `broadcast()`.
5. Track per-socket `typingConversations: Set<number>` while `isTyping === true`.
6. On `close`, `error`, or heartbeat terminate: publish `isTyping: false` for every conversation in
   `typingConversations` (best-effort cleanup).
7. Local delivery **skips sockets whose `userId` matches the frame's `userId`** — the typer does not
   see their own indicator (including other tabs).

Malformed or unauthorized frames are ignored silently (same as `subscribe`).

## Client (`web/app.js`, `web/index.html`)

### Sending

| Event | Action |
|---|---|
| `#text` input with non-empty value | Send `isTyping: true`; repeat at most once every **2 s** while still typing |
| `#text` cleared | Send `isTyping: false` |
| Message submit | Send `isTyping: false` |
| `#text` blur | Send `isTyping: false` |
| Switch conversation / enter search | Send `isTyping: false` for previous conversation |

### Receiving

| Event | Action |
|---|---|
| `typing` frame, `isTyping: true` | Show indicator; restart **4 s** expiry timer for that user |
| `typing` frame, `isTyping: false` | Hide that user immediately |
| Expiry timer fires | Hide that user (disconnect / missed stop safety net) |
| `message` frame from user | Hide typing for that `senderId` |
| Own `userId` in frame | Ignore (server already filters; belt-and-suspenders) |

Display at the bottom of `#messages` (below all bubbles) as `#N is typing…`. Only for
`activeConversation`. Both users must be in the **same** conversation (e.g. Bob and Alice share
conversation 1; Carol and Bob do not).

## Alternatives considered

| Option | Why rejected |
|---|---|
| Redis TTL key per user/conversation | Unnecessary for MVP; client expiry + explicit `false` suffice |
| HTTP endpoint for typing | Extra latency; WS already authenticated and subscribed |
| Echo typing to sender's tabs | Not needed for this task |
| Server-side typing rate limit | Client debounce is enough for seeded demo scale |

## Contributions

**User proposed**
- Pub/sub-only flow: client sends typing start/stop over WS; server identifies user from session token
  and publishes to other participants
- Explicit `isTyping: false` when input cleared
- Server publishes stop on disconnect (via heartbeat/close path)

**Agent proposed**
- Client debounce (2 s pulse) while typing — **adopted**
- Receiver-side 4 s expiry as safety net — **adopted**
- Also send `isTyping: false` on submit, blur, conversation switch — **adopted**
- `src/ws/protocol.ts` as single frame union — **adopted**
- Membership check via `ws.subs` (no extra MySQL query) — **adopted**

**Agreed in Phase 2**
- No Redis typing keys; publish-only path
- No echo to typer
- Fail open if Redis publish fails (typing is cosmetic)
