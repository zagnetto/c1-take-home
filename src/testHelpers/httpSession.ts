import '../testHelpers/hostEnv.ts';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import Redis from 'ioredis';
import { config } from '../config.ts';
import { sessionTokenKey, sessionUserSlotKey } from '../services/sessionKeys.ts';

const BASE = process.env.RELAY_TEST_URL ?? 'http://localhost:3000';
const SESSION_COOKIE = 'relay_session';

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function stackAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function redisAvailable(): Promise<boolean> {
  const probe = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 1000,
    lazyConnect: true,
  });
  try {
    await probe.connect();
    await probe.ping();
    await probe.quit();
    return true;
  } catch {
    await probe.quit().catch(() => undefined);
    return false;
  }
}

export function parseSessionCookie(setCookie: string | null): string | undefined {
  if (!setCookie) return undefined;
  const match = setCookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return match?.[1];
}

const createdSessionKeys: string[] = [];
let cleanupRedis: Redis | undefined;

export function trackSession(token: string, userId: number): void {
  createdSessionKeys.push(sessionTokenKey(token), sessionUserSlotKey(userId));
}

export async function tryCreateSession(): Promise<
  { userId: number; cookie: string; token: string } | null
> {
  const res = await fetch(`${BASE}/api/session`, { method: 'POST' });
  if (res.status === 503) return null;
  assert.equal(res.status, 201, `expected 201 from POST /api/session, got ${res.status}`);
  const body = (await res.json()) as { userId: number };
  const token = parseSessionCookie(res.headers.get('set-cookie'));
  assert.ok(token, 'POST /api/session must set relay_session cookie');
  trackSession(token, body.userId);
  return { userId: body.userId, cookie: `${SESSION_COOKIE}=${token}`, token };
}

export async function createSession(): Promise<{ userId: number; cookie: string; token: string }> {
  const session = await tryCreateSession();
  assert.ok(session, 'expected 201 from POST /api/session');
  return session;
}

/** Claim a session for a specific seeded userId (1–3), seeding Redis directly when the pool is full. */
export async function createSessionAs(
  targetUserId: number,
): Promise<{ userId: number; cookie: string; token: string } | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const session = await tryCreateSession();
    if (!session) break;
    if (session.userId === targetUserId) return session;
  }

  if (!cleanupRedis) await initHttpTestCleanup();
  if (!cleanupRedis) return null;

  const { seedRedisSession } = await import('./wsSession.ts');
  const seeded = await seedRedisSession(targetUserId, cleanupRedis);
  trackSession(seeded.token, targetUserId);
  return { userId: targetUserId, cookie: seeded.cookie, token: seeded.token };
}

export async function initHttpTestCleanup(): Promise<void> {
  if (await redisAvailable()) {
    cleanupRedis = new Redis(config.redisUrl, { maxRetriesPerRequest: 1 });
  }
}

export async function cleanupHttpTestSessions(): Promise<void> {
  if (cleanupRedis && createdSessionKeys.length) {
    await cleanupRedis.del(...createdSessionKeys);
    createdSessionKeys.length = 0;
  }
}

export async function closeHttpTestCleanup(): Promise<void> {
  await cleanupRedis?.quit();
}
