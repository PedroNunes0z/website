import { Redis } from "@upstash/redis";

let redisClient: Redis | null | undefined;
let readRedisClient: Redis | null | undefined;

function firstConfiguredValue(...values: Array<string | undefined>) {
  return values.find((value) => value?.trim())?.trim();
}

function getRedisUrl() {
  return firstConfiguredValue(
    process.env.PN_KV_REST_API_URL,
    process.env.UPSTASH_REDIS_REST_URL,
    process.env.KV_REST_API_URL,
  );
}

function createRedis(token: string | undefined) {
  const url = getRedisUrl();
  return url && token ? new Redis({ url, token }) : null;
}

export function getRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient;

  const token = firstConfiguredValue(
    process.env.PN_KV_REST_API_TOKEN,
    process.env.UPSTASH_REDIS_REST_TOKEN,
    process.env.KV_REST_API_TOKEN,
  );

  redisClient = createRedis(token);
  return redisClient;
}

export function getReadRedis(): Redis | null {
  if (readRedisClient !== undefined) return readRedisClient;

  const token = firstConfiguredValue(
    process.env.PN_KV_REST_API_READ_ONLY_TOKEN,
    process.env.PN_KV_REST_API_TOKEN,
    process.env.UPSTASH_REDIS_REST_TOKEN,
    process.env.KV_REST_API_TOKEN,
  );

  readRedisClient = createRedis(token);
  return readRedisClient;
}

export function hasPersistentStorage() {
  return getRedis() !== null;
}
