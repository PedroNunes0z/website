# Pedro Nunes — Portfolio & Editorial Platform

[![Next.js](https://img.shields.io/badge/Next.js-16.3.4-000000?style=flat-square&logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.2-20232A?style=flat-square&logo=react&logoColor=61DAFB)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vercel](https://img.shields.io/badge/Deploy-Vercel-000000?style=flat-square&logo=vercel&logoColor=white)](https://vercel.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-FF8D4F?style=flat-square)](LICENSE)

Portfólio profissional e plataforma editorial de Pedro Nunes. O projeto combina uma experiência pública de alto contraste, um asset 3D interativo em Three.js e uma área administrativa protegida para criar e publicar artigos em Markdown.

## Visão geral

O site foi construído com foco em identidade, performance e manutenção. A experiência pública apresenta competências, trajetória, resultados e artigos. A área administrativa centraliza o fluxo editorial sem expor credenciais ou operações de escrita ao cliente.

### Principais recursos

- Hero interativo com modelo 3D do Sol otimizado de 41,34 MB para 1,32 MB
- Identidade Black/Orange/White com `#FF8D4F` sobre preto
- Fontes Tektur para títulos e JetBrains Mono para texto
- Seções de competências, impacto, sobre, artigos e contato
- Listagem e páginas individuais de artigos com metadados sociais próprios
- Editor Markdown com títulos, citações, links, referências, imagens e botões
- Destaque de sintaxe com `rehype-highlight`
- Upload de imagens para Vercel Blob
- Persistência editorial em Upstash Redis
- Autenticação por hash bcrypt e sessão JWT em cookie `httpOnly`
- Proteção centralizada de rotas administrativas
- Limitação de tentativas de login e validação de origem nas mutações
- Sitemap, robots, Open Graph e layout responsivo

## Stack

| Camada | Tecnologias |
| --- | --- |
| Aplicação | Next.js 16, React 19, TypeScript |
| Interface | CSS, Lucide, Tektur, JetBrains Mono |
| 3D | Three.js, React Three Fiber, Drei |
| Conteúdo | React Markdown, remark-gfm, rehype-highlight |
| Autenticação | bcryptjs, jose, cookies `httpOnly` |
| Dados | Upstash Redis |
| Imagens | Vercel Blob |
| Hospedagem | Vercel |

## Estrutura

```text
app/
  admin/                    painel e autenticação
  api/admin/                rotas protegidas de login, artigos e upload
  artigos/                  listagem e páginas editoriais
  globals.css               sistema visual completo
components/                 interface pública, Markdown e painel
lib/                        autenticação, validação, dados e conteúdo inicial
public/
  models/sun/               modelo glTF, buffer e textura
  og.png                    cartão social do site
scripts/
  hash-password.mjs         geração do hash administrativo
```

## Ambiente local

### Requisitos

- Node.js 20.9 ou superior
- npm 10 ou superior
- Uma instância Upstash Redis para persistência
- Um store Vercel Blob para upload de imagens

### Instalação

```bash
git clone https://github.com/PedroNunes0z/website.git
cd website
npm install
cp .env.example .env.local
```

No PowerShell, use:

```powershell
Copy-Item .env.example .env.local
```

Gere o hash da senha administrativa:

```bash
npm run hash-password -- "uma-senha-longa-e-exclusiva"
```

Copie o resultado para `ADMIN_PASSWORD_HASH` e crie um segredo de sessão com pelo menos 32 caracteres para `AUTH_SECRET`.

Inicie o ambiente:

```bash
npm run dev
```

A aplicação estará disponível em `http://localhost:3000`. O painel editorial fica em `http://localhost:3000/admin`.

## Variáveis de ambiente

| Variável | Obrigatória | Finalidade |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Sim | Origem pública usada em metadados, sitemap e validação |
| `AUTH_SECRET` | Sim | Assinatura das sessões administrativas |
| `ADMIN_PASSWORD_HASH` | Sim | Hash bcrypt da senha do administrador |
| `UPSTASH_REDIS_REST_URL` | Sim | Endpoint REST do Redis |
| `UPSTASH_REDIS_REST_TOKEN` | Sim | Token REST do Redis |
| `KV_REST_API_URL` | Alternativa | Nome compatível com integrações KV existentes |
| `KV_REST_API_TOKEN` | Alternativa | Token da integração KV existente |
| `BLOB_READ_WRITE_TOKEN` | Para uploads | Credencial de escrita do Vercel Blob |

Sem Redis, a interface pública usa artigos demonstrativos versionados no projeto. O painel permanece acessível quando a autenticação está configurada, mas as operações de gravação e exclusão retornam uma mensagem de configuração pendente.

## Conteúdo Markdown

O editor aceita Markdown com GitHub Flavored Markdown. Exemplos:

````markdown
## Título da seção

Texto com **ênfase** e [link](https://exemplo.com).

```ts
export const ready = true;
```

![Descrição](https://exemplo.com/imagem.jpg)

[Abrir recurso](https://exemplo.com "button")

### Referências

- [Documentação oficial](https://exemplo.com/docs)
````

O atributo de título `"button"` transforma o link em uma ação visual. HTML arbitrário não é interpretado, reduzindo a superfície de injeção de conteúdo.

## Scripts

| Comando | Descrição |
| --- | --- |
| `npm run dev` | Inicia o servidor de desenvolvimento |
| `npm run build` | Gera a versão de produção |
| `npm start` | Executa a versão compilada |
| `npm run lint` | Valida regras de código e acessibilidade |
| `npm run typecheck` | Valida os tipos TypeScript |
| `npm run hash-password -- "senha"` | Gera um hash bcrypt com custo 12 |

## Deploy na Vercel

1. Importe este repositório na Vercel.
2. Adicione Upstash Redis pelo Marketplace e associe a integração ao projeto.
3. Crie um store Vercel Blob e associe-o ao projeto.
4. Cadastre `NEXT_PUBLIC_SITE_URL`, `AUTH_SECRET` e `ADMIN_PASSWORD_HASH` nos ambientes desejados.
5. Confirme os nomes das credenciais Redis e Blob geradas pelas integrações.
6. Faça o deploy. A Vercel detecta o framework e executa `npm run build` automaticamente.

Use valores diferentes para produção e ambientes de preview. Nunca versionar `.env.local`, hashes temporários ou tokens de serviços.

## Segurança

- A senha original nunca é armazenada; apenas seu hash bcrypt é configurado.
- A sessão expira após oito horas e usa cookie `httpOnly`, `SameSite=Strict` e `Secure` em produção.
- Todas as rotas administrativas são protegidas no servidor e verificam a sessão novamente nas operações sensíveis.
- Requisições de escrita exigem uma origem reconhecida.
- O login é limitado por endereço quando o Redis está disponível.
- Uploads aceitam apenas JPG, PNG, WebP ou GIF com até 4 MB.

## Créditos do asset 3D

Este projeto utiliza [Sun Model](https://sketchfab.com/3d-models/sun-model-b9e1dfd765984d9b8f998bd4a6be97b5), de [Black Hole](https://sketchfab.com/blckhole), licenciado sob [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). A licença original acompanha o modelo em `public/models/sun/license.txt`.

## Licença

O código deste projeto está disponível sob a licença MIT. O asset 3D mantém sua licença CC BY 4.0 e seus requisitos próprios de atribuição.
