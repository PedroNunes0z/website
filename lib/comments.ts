import { getReadRedis, getRedis } from "@/lib/redis";

export interface StoredComment {
  id: string;
  articleId: string;
  authorId: string;
  authorName: string;
  body: string;
  imageUrl: string | null;
  parentId: string | null;
  createdAt: string;
}

const indexKey = (articleId: string) => `pedronunes:comments:v1:${articleId}:index`;
const itemKey = (id: string) => `pedronunes:comments:v1:item:${id}`;
const ratingKey = (articleId: string) => `pedronunes:comments:v1:${articleId}:ratings`;

export async function listComments(articleId: string) {
  const redis = getReadRedis();
  if (!redis) return { comments: [] as StoredComment[], ratings: {} as Record<string, number> };
  const ids = await redis.zrange<string[]>(indexKey(articleId), 0, 99, { rev: true });
  const [items, ratings] = await Promise.all([
    Promise.all(ids.map((id) => redis.get<StoredComment>(itemKey(id)))),
    redis.hgetall<Record<string, number>>(ratingKey(articleId)),
  ]);
  return { comments: items.filter((item): item is StoredComment => item !== null), ratings: ratings ?? {} };
}

export async function getComment(id: string) {
  return getRedis()?.get<StoredComment>(itemKey(id)) ?? null;
}

export async function saveComment(comment: StoredComment) {
  const redis = getRedis();
  if (!redis) throw new Error("STORAGE_NOT_CONFIGURED");
  await redis.set(itemKey(comment.id), comment);
  await redis.zadd(indexKey(comment.articleId), { score: Date.parse(comment.createdAt), member: comment.id });
}

export async function deleteComment(comment: StoredComment) {
  const redis = getRedis();
  if (!redis) throw new Error("STORAGE_NOT_CONFIGURED");
  await redis.zrem(indexKey(comment.articleId), comment.id);
  await redis.del(itemKey(comment.id));
}

export async function saveRating(articleId: string, userId: string, rating: number) {
  const redis = getRedis();
  if (!redis) throw new Error("STORAGE_NOT_CONFIGURED");
  await redis.hset(ratingKey(articleId), { [userId]: rating });
}

export async function enforceCommentRate(key: string, limit: number, seconds: number) {
  const redis = getRedis();
  if (!redis) throw new Error("STORAGE_NOT_CONFIGURED");
  const count = await redis.incr(`pedronunes:comment-rate:v1:${key}`);
  if (count === 1) await redis.expire(`pedronunes:comment-rate:v1:${key}`, seconds);
  return count <= limit;
}
