import { ArrowUpRight, Clock3 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { Article } from "@/lib/types";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function ArticleCard({ article, index }: { article: Article; index: number }) {
  return (
    <article className="article-card">
      <Link href={`/artigos/${article.slug}`} className="article-card-link" aria-label={`Ler ${article.title}`}>
        <div className="article-visual">
          {article.coverImage ? (
            <Image src={article.coverImage} alt="" fill sizes="(max-width: 780px) 100vw, 33vw" />
          ) : (
            <div className="article-visual-fallback" aria-hidden="true">
              <span>{String(index + 1).padStart(2, "0")}</span>
              <span className="article-orbit" />
            </div>
          )}
          <ArrowUpRight className="article-arrow" aria-hidden="true" />
        </div>
        <div className="article-meta">
          <span>{dateFormatter.format(new Date(article.publishedAt))}</span>
          <span><Clock3 aria-hidden="true" /> {article.readingTime} min</span>
        </div>
        <h3>{article.title}</h3>
        <p>{article.excerpt}</p>
        <div className="tag-row" aria-label="Tecnologias relacionadas">
          {article.tags.map((tag) => <span key={tag}>{tag}</span>)}
        </div>
      </Link>
    </article>
  );
}
