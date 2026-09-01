import { articleSchema, type ArticlePayload } from "@/lib/article-schema";
import { getRedis } from "@/lib/redis";
import { seedArticles } from "@/lib/seed-articles";
import type { Article } from "@/lib/types";

const ARTICLES_KEY = "pedronunes:articles:v1";

function estimateReadingTime(content: string) {
  const words = content.trim().split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 210));
}

function sortByDate(articles: Article[]) {
  return [...articles].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
}

export async function getArticles(options: { includeDrafts?: boolean } = {}) {
  const redis = getRedis();
  const stored = redis ? await redis.get<Article[]>(ARTICLES_KEY) : null;
  const articles = stored ?? seedArticles;
  const visible = options.includeDrafts
    ? articles
    : articles.filter((article) => article.status === "published");

  return sortByDate(visible);
}

export async function getArticleBySlug(slug: string, includeDrafts = false) {
  const articles = await getArticles({ includeDrafts });
  return articles.find((article) => article.slug === slug) ?? null;
}

export async function saveArticle(payload: ArticlePayload) {
  const redis = getRedis();
  if (!redis) {
    throw new Error("STORAGE_NOT_CONFIGURED");
  }

  const input = articleSchema.parse(payload);
  const articles = (await redis.get<Article[]>(ARTICLES_KEY)) ?? seedArticles;
  const now = new Date().toISOString();
  const existingIndex = input.id
    ? articles.findIndex((article) => article.id === input.id)
    : -1;

  const slugConflict = articles.some(
    (article) => article.slug === input.slug && article.id !== input.id,
  );
  if (slugConflict) throw new Error("SLUG_CONFLICT");

  const article: Article = {
    ...input,
    id: input.id ?? crypto.randomUUID(),
    updatedAt: now,
    readingTime: estimateReadingTime(input.content),
  };

  if (existingIndex >= 0) articles[existingIndex] = article;
  else articles.push(article);

  await redis.set(ARTICLES_KEY, articles);
  return article;
}

export async function deleteArticle(id: string) {
  const redis = getRedis();
  if (!redis) throw new Error("STORAGE_NOT_CONFIGURED");

  const articles = (await redis.get<Article[]>(ARTICLES_KEY)) ?? seedArticles;
  const filtered = articles.filter((article) => article.id !== id);
  if (filtered.length === articles.length) return false;

  await redis.set(ARTICLES_KEY, filtered);
  return true;
}
