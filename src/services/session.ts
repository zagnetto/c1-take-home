import crypto from 'node:crypto';
import { pool } from '../db/mysql.ts';
import { redis } from '../db/redis.ts';
import { config } from '../config.ts';
import { sessionTokenKey, sessionUserSlotKey } from '../constants/redis.ts';

export interface SessionUser {
  userId: number;
  name: string;
}

async function getUserById(userId: number): Promise<SessionUser | null> {
  const [rows] = await pool.query('SELECT id, name FROM users WHERE id = ?', [userId]);
  const row = (rows as { id: number; name: string }[])[0];
  if (!row) return null;
  return { userId: row.id, name: row.name };
}

export async function lookupSession(token: string): Promise<SessionUser | null> {
  const userIdStr = await redis.get(sessionTokenKey(token));
  if (!userIdStr) return null;

  const userId = Number(userIdStr);
  if (!Number.isInteger(userId) || userId <= 0) return null;

  const slotToken = await redis.get(sessionUserSlotKey(userId));
  if (slotToken !== token) return null;

  return getUserById(userId);
}

export async function createSession(): Promise<
  { token: string; user: SessionUser } | 'pool_exhausted'
> {
  const [users] = await pool.query('SELECT id, name FROM users ORDER BY id ASC');
  const token = crypto.randomUUID();
  const ttl = config.sessionTtlSeconds;

  for (const row of users as { id: number; name: string }[]) {
    const claimed = await redis.set(sessionUserSlotKey(row.id), token, 'EX', ttl, 'NX');
    if (claimed !== 'OK') continue;

    await redis.set(sessionTokenKey(token), String(row.id), 'EX', ttl);
    return { token, user: { userId: row.id, name: row.name } };
  }

  return 'pool_exhausted';
}
