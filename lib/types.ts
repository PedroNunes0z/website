export type ArticleStatus = "draft" | "published";

export interface Article {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  coverImage: string;
  tags: string[];
  status: ArticleStatus;
  featured: boolean;
  publishedAt: string;
  updatedAt: string;
  readingTime: number;
}

export type ArticleInput = Omit<Article, "id" | "updatedAt" | "readingTime"> & {
  id?: string;
};
