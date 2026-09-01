import { ArrowDownRight, ArrowRight, ArrowUpRight, Braces, CloudCog, DatabaseZap, Gauge, Layers3, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { ArticleCard } from "@/components/article-card";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { SectionHeading } from "@/components/section-heading";
import { SunScene } from "@/components/sun-scene";
import { getArticles } from "@/lib/articles";

const stack = ["Java", "Spring Boot", "TypeScript", "React", "Next.js", "PostgreSQL"];

const capabilities = [
  {
    icon: Braces,
    number: "01",
    title: "Frontend",
    text: "Interfaces acessíveis, responsivas e orientadas à performance com React, Next.js e TypeScript.",
    items: ["React", "Next.js", "TypeScript", "PWA"],
  },
  {
    icon: Layers3,
    number: "02",
    title: "Backend",
    text: "APIs e regras de negócio sólidas, com autenticação, observabilidade e contratos bem definidos.",
    items: ["Java", "Spring Boot", "Node.js", "REST"],
  },
  {
    icon: DatabaseZap,
    number: "03",
    title: "Dados & Cloud",
    text: "Persistência e infraestrutura pensadas para disponibilidade, custo e crescimento sustentável.",
    items: ["PostgreSQL", "Redis", "AWS", "Vercel"],
  },
];

export const dynamic = "force-dynamic";

export default async function Home() {
  const articles = (await getArticles()).slice(0, 3);

  return (
    <>
      <Header />
      <main>
        <section className="hero shell" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow"><span /> Full Stack Developer</p>
            <h1 id="hero-title">
              Software com
              <strong>engenharia, clareza</strong>
              e escala.
            </h1>
            <p className="hero-intro">
              Eu sou Pedro Nunes. Transformo desafios complexos em produtos digitais rápidos,
              seguros e fáceis de evoluir.
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href="#projetos">
                Explorar trabalho <ArrowDownRight aria-hidden="true" />
              </a>
              <a className="text-link" href="https://github.com/PedroNunes0z" target="_blank" rel="noreferrer">
                GitHub <ArrowUpRight aria-hidden="true" />
              </a>
            </div>
          </div>
          <SunScene />
          <div className="hero-index" aria-hidden="true">
            <span>01</span>
            <span>/</span>
            <span>04</span>
          </div>
        </section>

        <section className="stack-band" id="skills" aria-label="Principais tecnologias">
          <div className="marquee shell">
            {stack.map((item) => <span key={item}>{item}</span>)}
          </div>
        </section>

        <section className="section shell capabilities" aria-labelledby="skills-title">
          <SectionHeading
            index="02"
            eyebrow="Competências"
            title="Do conceito à produção."
            description="Engenharia aplicada em todas as camadas para construir produtos coerentes, rápidos e sustentáveis."
          />
          <div className="capability-grid">
            {capabilities.map(({ icon: Icon, number, title, text, items }) => (
              <article className="capability-card" key={title}>
                <div className="capability-top">
                  <Icon aria-hidden="true" />
                  <span>{number}</span>
                </div>
                <h3>{title}</h3>
                <p>{text}</p>
                <div className="tag-row">
                  {items.map((item) => <span key={item}>{item}</span>)}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="section impact-section" id="projetos" aria-labelledby="impact-title">
          <div className="shell">
            <SectionHeading
              index="03"
              eyebrow="Impacto"
              title="Complexidade convertida em resultado."
            />
            <div className="impact-grid">
              <div className="impact-story">
                <p className="impact-label">Descontey! · 2025 — presente</p>
                <h3 id="impact-title">Infraestrutura preparada para milhares de decisões simultâneas.</h3>
                <p>
                  Liderança técnica e desenvolvimento full stack de uma plataforma de cupons,
                  conteúdo e automação, com foco em escala, custo e velocidade percebida.
                </p>
                <div className="impact-pillars">
                  <span><Gauge aria-hidden="true" /> Performance</span>
                  <span><CloudCog aria-hidden="true" /> Cloud</span>
                  <span><ShieldCheck aria-hidden="true" /> Confiabilidade</span>
                </div>
              </div>
              <div className="metric-grid">
                <div><strong>30K</strong><span>usuários simultâneos considerados na arquitetura</span></div>
                <div><strong>75%</strong><span>de redução no tempo de resposta de consultas</span></div>
                <div><strong>95+</strong><span>em auditorias Lighthouse de performance</span></div>
                <div><strong>2026</strong><span>conclusão prevista em Sistemas para Internet</span></div>
              </div>
            </div>
          </div>
        </section>

        <section className="section shell about-section" id="sobre" aria-labelledby="about-title">
          <SectionHeading index="04" eyebrow="Sobre" title="Construir bem é pensar além do código." />
          <div className="about-grid">
            <div className="about-code" aria-hidden="true">
              <div className="code-toolbar"><span /><span /><span /><em>PedroNunes.java</em></div>
              <pre><code><span className="code-keyword">public class</span>{" "}<span className="code-type">PedroNunes</span>{" {\n\n  "}<span className="code-keyword">private final</span>{" String role =\n    "}<span className="code-string">&quot;Full Stack Developer&quot;</span>{";\n\n  "}<span className="code-keyword">private final boolean</span>{" alwaysLearning =\n    "}<span className="code-value">true</span>{";\n}"}</code></pre>
            </div>
            <div className="about-copy">
              <p className="about-lead" id="about-title">
                Sou desenvolvedor Full Stack, pesquisador PIBITI e estudante de Sistemas para Internet no IF Sudeste MG.
              </p>
              <p>
                Trabalho entre arquitetura, backend e experiências web modernas. Minha prática combina engenharia de software,
                decisões orientadas por dados e atenção aos detalhes que tornam um produto confiável para quem usa e sustentável para quem mantém.
              </p>
              <p>
                Atualmente também atuo como Software Engineer e Project Lead na Descontey!, conectando visão de produto, performance e infraestrutura.
              </p>
              <a className="text-link" href="mailto:contato.pedronunes.dev@gmail.com">
                Iniciar uma conversa <ArrowUpRight aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>

        <section className="section articles-section" id="artigos" aria-labelledby="articles-title">
          <div className="shell">
            <SectionHeading
              index="05"
              eyebrow="Artigos"
              title="Notas sobre engenharia e produto."
              description="Experimentos, decisões e aprendizados compartilhados de forma direta."
            />
            <div className="article-grid">
              {articles.map((article, index) => <ArticleCard article={article} index={index} key={article.id} />)}
            </div>
            <div className="section-action">
              <Link href="/artigos" className="button button-secondary">Ver todos os artigos <ArrowRight aria-hidden="true" /></Link>
            </div>
          </div>
        </section>

        <section className="contact-section">
          <div className="shell contact-inner">
            <p>Tem um desafio interessante?</p>
            <h2>Vamos construir algo que permaneça relevante.</h2>
            <a className="button contact-button" href="mailto:contato.pedronunes.dev@gmail.com">
              contato.pedronunes.dev@gmail.com <ArrowUpRight aria-hidden="true" />
            </a>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
