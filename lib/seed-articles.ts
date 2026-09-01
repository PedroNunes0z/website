import type { Article } from "@/lib/types";

export const seedArticles: Article[] = [
  {
    id: "seed-architecture",
    title: "Arquitetura que acompanha o crescimento do produto",
    slug: "arquitetura-que-acompanha-o-crescimento",
    excerpt:
      "Decisões práticas para evoluir um produto web sem transformar a base de código em um freio.",
    coverImage: "",
    tags: ["Arquitetura", "Next.js", "Performance"],
    status: "published",
    featured: true,
    publishedAt: "2026-08-18T12:00:00.000Z",
    updatedAt: "2026-08-18T12:00:00.000Z",
    readingTime: 6,
    content: `## Comece pelos limites do domínio

Uma arquitetura útil torna as decisões importantes explícitas. Antes de escolher bibliotecas, identifique quais partes do produto mudam juntas, quais dados precisam permanecer consistentes e onde existem integrações externas.

> O melhor desenho não é o mais sofisticado; é aquele que a equipe consegue explicar, observar e evoluir.

## Um contrato simples

Camadas pequenas e contratos claros reduzem o acoplamento. O exemplo abaixo mantém a regra de negócio independente do transporte HTTP:

\`\`\`ts
export interface ArticleRepository {
  findPublished(): Promise<Article[]>;
  save(article: Article): Promise<void>;
}

export async function publishArticle(
  article: Article,
  repository: ArticleRepository,
) {
  article.publish();
  await repository.save(article);
}
\`\`\`

## Observe antes de otimizar

Métricas de latência, taxa de erro e uso de recursos mostram onde o sistema realmente precisa de atenção. Otimização sem medida costuma apenas deslocar complexidade.

[Conheça meu trabalho no GitHub](https://github.com/PedroNunes0z "button")

### Referências

- [Web.dev: performance](https://web.dev/performance/)
- [Next.js: App Router](https://nextjs.org/docs/app)
`,
  },
  {
    id: "seed-cache",
    title: "Cache distribuído sem perder a previsibilidade",
    slug: "cache-distribuido-sem-perder-a-previsibilidade",
    excerpt:
      "Como escolher chaves, expiração e invalidação com base no comportamento real da aplicação.",
    coverImage: "",
    tags: ["Redis", "Backend", "Escalabilidade"],
    status: "published",
    featured: false,
    publishedAt: "2026-07-29T12:00:00.000Z",
    updatedAt: "2026-07-29T12:00:00.000Z",
    readingTime: 5,
    content: `## Cache é uma decisão de consistência

Adicionar Redis não resolve automaticamente um gargalo. Primeiro defina quanto tempo o dado pode ficar desatualizado e qual será a fonte de verdade.

\`\`\`ts
const key = \`article:list:v2:\${locale}\`;
const cached = await redis.get(key);

if (cached) return cached;

const articles = await repository.findPublished();
await redis.set(key, articles, { ex: 300 });
return articles;
\`\`\`

## Estratégia operacional

Use nomes de chave versionados, TTL explícito e métricas de acerto. Para dados críticos, prefira invalidação orientada a eventos e trate a ausência do cache como o caminho normal.
`,
  },
  {
    id: "seed-pwa",
    title: "O que uma PWA precisa entregar além da instalação",
    slug: "pwa-alem-da-instalacao",
    excerpt:
      "Confiabilidade, acessibilidade e percepção de velocidade como requisitos centrais de uma experiência progressiva.",
    coverImage: "",
    tags: ["PWA", "UX", "Acessibilidade"],
    status: "published",
    featured: false,
    publishedAt: "2026-06-12T12:00:00.000Z",
    updatedAt: "2026-06-12T12:00:00.000Z",
    readingTime: 4,
    content: `## Progressiva de verdade

Instalar um ícone na tela inicial é apenas uma parte. Uma boa PWA continua compreensível em redes instáveis, preserva o foco do teclado, oferece estados de carregamento honestos e evita bloquear tarefas essenciais.

## Checklist essencial

- HTML semântico e navegação por teclado
- Estratégia de cache adequada para cada recurso
- Interface responsiva desde o menor viewport
- Mensagens de erro que orientam a recuperação
- Métricas de campo para Core Web Vitals
`,
  },
];
