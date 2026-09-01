import type { Metadata } from "next";
import { ArticleCard } from "@/components/article-card";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { getArticles } from "@/lib/articles";

export const metadata: Metadata = {
  title: "Artigos",
  description: "Artigos de Pedro Nunes sobre engenharia de software, arquitetura, backend, frontend e performance.",
};

export const dynamic = "force-dynamic";

export default async function ArticlesPage() {
  const articles = await getArticles();

  return (
    <>
      <Header />
      <main className="inner-page">
        <section className="page-hero shell">
          <div className="section-kicker"><span>05</span><span>Artigos</span></div>
          <h1>Ideias que sobrevivem ao deploy.</h1>
          <p>
            Notas de campo sobre engenharia de software, arquitetura e as decisões que tornam
            produtos digitais mais claros, rápidos e confiáveis.
          </p>
        </section>
        <section className="shell article-list-section" aria-label="Todos os artigos publicados">
          <div className="article-grid article-grid-all">
            {articles.map((article, index) => <ArticleCard article={article} index={index} key={article.id} />)}
          </div>
          {articles.length === 0 ? <p className="empty-state">Nenhum artigo publicado ainda.</p> : null}
        </section>
      </main>
      <Footer />
    </>
  );
}
