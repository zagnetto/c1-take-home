import Redis from 'ioredis';
import { config } from '../config.ts';

export const redis = new Redis(config.redisUrl, {
  lazyConnect: false,
  maxRetriesPerRequest: 3,
});

let subscriber: Redis | undefined;

/** Dedicated connection — subscriber mode cannot run other commands. */
export function redisSubscriber(): Redis {
  if (!subscriber) {
    subscriber = new Redis(config.redisUrl, {
      lazyConnect: false,
      maxRetriesPerRequest: null,
    });
  }
  return subscriber;
}

export async function waitForRedis(retries = 40): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      await redis.ping();
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw new Error(`redis not reachable: ${lastErr}`);
}
