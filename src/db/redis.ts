import Redis from 'ioredis';
import { config } from '../config.ts';
import { REALTIME_EVENTS_CHANNEL } from '../services/realtimeKeys.ts';

function attachRedisErrorLogging(client: Redis, label: string): void {
  client.on('error', (err) => {
    console.error(`[redis:${label}]`, err);
  });
}

export const redis = new Redis(config.redisUrl, {
  lazyConnect: false,
  maxRetriesPerRequest: 3,
});
attachRedisErrorLogging(redis, 'client');

let subscriber: Redis | undefined;

/** Dedicated connection — subscriber mode cannot run other commands. */
export function redisSubscriber(): Redis {
  if (!subscriber) {
    subscriber = new Redis(config.redisUrl, {
      lazyConnect: false,
      maxRetriesPerRequest: null,
    });
    attachRedisErrorLogging(subscriber, 'subscriber');
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

export async function closeRedis(): Promise<void> {
  if (subscriber) {
    await subscriber.unsubscribe(REALTIME_EVENTS_CHANNEL).catch(() => undefined);
    await subscriber.quit();
    subscriber = undefined;
  }
  await redis.quit();
}
