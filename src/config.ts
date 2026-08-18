import { positiveIntFromEnv } from './helpers/envInt.ts';

const MESSAGE_RATE_LIMIT_MAX_DEFAULT = 5;
const MESSAGE_RATE_LIMIT_WINDOW_MS_DEFAULT = 10_000;

export const config = {
  port: Number(process.env.PORT) || 3000,
  mysqlUrl: process.env.MYSQL_URL || 'mysql://root:root@mysql:3306/relay?charset=utf8mb4',
  mongoUrl: process.env.MONGO_URL || 'mongodb://mongo:27017/relay',
  redisUrl: process.env.REDIS_URL || 'redis://redis:6379',
  sessionCookieName: 'relay_session',
  /** Default 24h — frees seeded user slots after idle expiry. */
  sessionTtlSeconds: Number(process.env.SESSION_TTL_SECONDS) || 86_400,
  /** Max new message sends per user per conversation within the window. */
  messageRateLimitMax: positiveIntFromEnv(
    process.env.MESSAGE_RATE_LIMIT_MAX,
    MESSAGE_RATE_LIMIT_MAX_DEFAULT,
  ),
  /** Fixed rate-limit window length in milliseconds. */
  messageRateLimitWindowMs: positiveIntFromEnv(
    process.env.MESSAGE_RATE_LIMIT_WINDOW_MS,
    MESSAGE_RATE_LIMIT_WINDOW_MS_DEFAULT,
  ),
};

export const messageRateLimitDefaults = {
  max: MESSAGE_RATE_LIMIT_MAX_DEFAULT,
  windowMs: MESSAGE_RATE_LIMIT_WINDOW_MS_DEFAULT,
} as const;
