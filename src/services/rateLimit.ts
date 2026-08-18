import { config } from '../config.ts';
import { messageRateLimitKey } from '../constants/redis.ts';
import { redis } from '../db/redis.ts';

// Lua via redis.eval — not convenience, but correctness under `--scale api=3`.
//
// A plain TypeScript sequence (INCR → PEXPIRE → check → DECR on 429) is easier to read but
// not atomic across API instances:
//   • GET-then-SET lets concurrent requests both see count=4 and pass (6+ sends).
//   • INCR then separate PEXPIRE leaks keys without TTL if the process dies in between.
//   • INCR → check → DECR on reject races with other instances; the cap drifts under burst.
//
// One eval runs INCR + PEXPIRE-on-first-hit + over-limit DECR + PTTL in a single Redis round
// trip, so the fixed window holds under xargs -P bursts and behind Envoy. Simpler alternatives
// (count 429s against quota, or skip DECR-on-reject) trade away semantics we want — see
// docs/028-rate-limiting.md § "Why Lua".
const RESERVE_MESSAGE_SEND_SLOT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local max = tonumber(ARGV[2])
if count > max then
  redis.call('DECR', KEYS[1])
  return {0, redis.call('PTTL', KEYS[1])}
end
return {1, redis.call('PTTL', KEYS[1])}
`;

// Release after createMessage fails or deduplicates (isNew: false). DECR + DEL-at-zero in one
// eval avoids a stale counter if two releases race; see reserve comment above.
const RELEASE_MESSAGE_SEND_SLOT = `
local count = redis.call('DECR', KEYS[1])
if count <= 0 then
  redis.call('DEL', KEYS[1])
end
return count
`;

export interface MessageRateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function retryAfterSecondsFromPttl(pttlMs: number): number {
  if (!Number.isFinite(pttlMs) || pttlMs <= 0) return 1;
  return Math.max(1, Math.ceil(pttlMs / 1000));
}

export async function reserveMessageSendSlot(
  conversationId: number,
  userId: number,
): Promise<MessageRateLimitResult> {
  const key = messageRateLimitKey(conversationId, userId);
  try {
    // Atomic reserve — see RESERVE_MESSAGE_SEND_SLOT comment above.
    const [allowedRaw, pttlRaw] = (await redis.eval(
      RESERVE_MESSAGE_SEND_SLOT,
      1,
      key,
      String(config.messageRateLimitWindowMs),
      String(config.messageRateLimitMax),
    )) as [number, number];

    const retryAfterSeconds = retryAfterSecondsFromPttl(Number(pttlRaw));
    return { allowed: Number(allowedRaw) === 1, retryAfterSeconds };
  } catch (err) {
    console.warn('[rateLimit] Redis unavailable — allowing message send', { conversationId, userId, err });
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

export async function releaseMessageSendSlot(conversationId: number, userId: number): Promise<void> {
  const key = messageRateLimitKey(conversationId, userId);
  try {
    // Atomic release — see RELEASE_MESSAGE_SEND_SLOT comment above.
    await redis.eval(RELEASE_MESSAGE_SEND_SLOT, 1, key);
  } catch (err) {
    console.warn('[rateLimit] failed to release reserved send slot', { conversationId, userId, err });
  }
}
