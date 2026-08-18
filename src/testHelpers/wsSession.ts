import '../testHelpers/hostEnv.ts';
import crypto from 'node:crypto';
import Redis from 'ioredis';
import { config } from '../config.ts';
import { sessionTokenKey, sessionUserSlotKey } from '../services/sessionKeys.ts';

const SESSION_COOKIE = 'relay_session';

export function wsSessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}`;
}

export async function seedRedisSession(
  userId: number,
  redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 2000 }),
): Promise<{ token: string; cookie: string; keys: string[] }> {
  const token = crypto.randomUUID();
  const ttl = config.sessionTtlSeconds;
  await redis.set(sessionTokenKey(token), String(userId), 'EX', ttl);
  await redis.set(sessionUserSlotKey(userId), token, 'EX', ttl);
  return {
    token,
    cookie: wsSessionCookie(token),
    keys: [sessionTokenKey(token), sessionUserSlotKey(userId)],
  };
}

export async function clearRedisSessionKeys(
  redis: Redis,
  keys: string[],
): Promise<void> {
  if (keys.length) await redis.del(...keys);
}

export function wsConnectHeaders(cookie: string, port: number): Record<string, string> {
  return {
    Cookie: cookie,
    Origin: `http://127.0.0.1:${port}`,
  };
}
