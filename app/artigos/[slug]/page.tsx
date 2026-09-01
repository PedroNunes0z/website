import type { Metadata } from "next";
import { ArrowLeft, CalendarDays, Clock3 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { getArticleBySlug } from "@/lib/articles";

interface ArticlePageProps {
  params: Promise<{ slug: string }>;
}

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export async function generateMetadata({ params }: ArticlePageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = await getArticleBySlug(slug);
  if (!article) return { title: "Artigo não encontrado" };

  return {
    title: article.title,
    description: article.excerpt,
    openGraph: {
      type: "article",
      title: article.title,
      description: article.excerpt,
      publishedTime: article.publishedAt,
      modifiedTime: article.updatedAt,
      tags: article.tags,
      images: article.coverImage ? [{ url: article.coverImage }] : [],
    },
    twitter: {
      card: article.coverImage ? "summary_large_image" : "summary",
      title: article.title,
      description: article.excerpt,
      images: article.coverImage ? [article.coverImage] : [],
    },
  };
}

export const dynamic = "force-dynamic";

export default async function ArticlePage({ params }: ArticlePageProps) {
  const { slug } = await params;
  const article = await getArticleBySlug(slug);
  if (!article) notFound();

  return (
    <>
      <Header />
      <main className="article-page">
        <header className="article-header shell">
          <Link href="/artigos" className="back-link"><ArrowLeft aria-hidden="true" /> Todos os artigos</Link>
          <div className="tag-row article-header-tags">
            {article.tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
          <h1>{article.title}</h1>
          <p>{article.excerpt}</p>
          <div className="article-byline">
            <span><CalendarDays aria-hidden="true" /> {dateFormatter.format(new Date(article.publishedAt))}</span>
            <span><Clock3 aria-hidden="true" /> {article.readingTime} min de leitura</span>
          </div>
        </header>

        {article.coverImage ? (
          <div className="article-cover shell">
            <Image src={article.coverImage} alt="" width={1400} height={788} priority sizes="(max-width: 1180px) 100vw, 1180px" />
          </div>
        ) : (
          <div className="article-cover-fallback shell" aria-hidden="true"><span /><span /></div>
        )}

        <article className="article-body shell">
          <aside className="article-aside">
            <span>Escrito por</span>
            <strong>Pedro Nunes</strong>
            <span>Full Stack Developer</span>
          </aside>
          <MarkdownRenderer content={article.content} />
        </article>
      </main>
      <Footer />
    </>
  );
}
