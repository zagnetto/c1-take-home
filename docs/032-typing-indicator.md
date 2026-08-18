# Typing indicator

## What shipped

Live typing indicator for conversation participants over the existing WebSocket + Redis fan-out path.

- **Inbound:** `{ type: 'typing', conversationId, isTyping }` — no client-supplied `userId`.
- **Outbound:** `{ type: 'typing', conversationId, userId, isTyping }` — `userId` from session.
- Server validates membership via `ws.subs`, publishes via `broadcast()`, skips delivery back to the
  typer.
- On disconnect / heartbeat terminate: best-effort `isTyping: false` for conversations the socket was
  typing in.
- Frontend: debounced pulses (2 s), explicit stop on empty/blur/submit/switch, 4 s receiver expiry,
  `.typing-indicator` row at the **bottom of `#messages`** (below all message bubbles).

## Files

| File | Change |
|---|---|
| `src/ws/protocol.ts` | Frame unions + `isOutboundTypingFrame` helper |
| `src/ws/hub.ts` | Inbound typing handler, self-filter, disconnect cleanup |
| `src/ws/tests/typing.test.ts` | 4 integration tests |
| `web/app.js` | Send/receive typing, UI state |
| `web/index.html` | `#typingIndicator` element + styles |
| `spec/typing-indicator.md` | Contract |

## Verification

```bash
node --import tsx --test --test-force-exit src/ws/tests/typing.test.ts
# 4 passed (requires Redis)
```

Manual:

1. Open two tabs as different seeded users on conversation 1.
2. Type in one tab — the other shows `#N is typing…`.
3. Clear input or send — indicator disappears.
4. Close typer tab — peer receives stop within one round-trip.

## Contributions

**User proposed**
- Pub/sub-only WS flow with session-derived user id
- Explicit `isTyping: false` when input cleared
- Server publishes stop on disconnect

**Agent proposed**
- Client debounce (2 s) and receiver expiry (4 s) — **adopted**
- Stop on submit, blur, conversation switch — **adopted**
- `src/ws/protocol.ts` — **adopted**

**Agreed in Phase 2**
- See `spec/typing-indicator.md`

## Alternatives considered

- Redis TTL typing keys — rejected (unnecessary for MVP).
- Echo to sender tabs — rejected.

## Dead ends

None.
