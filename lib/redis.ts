import { Redis } from "@upstash/redis";

let redisClient: Redis | null | undefined;

export function getRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient;

  const firstConfiguredValue = (...values: Array<string | undefined>) =>
    values.find((value) => value?.trim())?.trim();

  const url = firstConfiguredValue(
    process.env.PN_KV_REST_API_URL,
    process.env.UPSTASH_REDIS_REST_URL,
    process.env.KV_REST_API_URL,
  );
  const token = firstConfiguredValue(
    process.env.PN_KV_REST_API_TOKEN,
    process.env.UPSTASH_REDIS_REST_TOKEN,
    process.env.KV_REST_API_TOKEN,
  );

  redisClient = url && token ? new Redis({ url, token }) : null;
  return redisClient;
}

export function hasPersistentStorage() {
  return getRedis() !== null;
}
