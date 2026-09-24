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

- Hero com o modelo 3D The Universe! (543 KB), zoom por scroll, rotação por arraste e enquadramento responsivo sem cortes
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
- Área `/games` com Haxball e hóquei jogáveis contra bots ou em salas públicas online

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
| Multiplayer | Salas e snapshots no Upstash Redis, sincronização por polling |

## Estrutura

```text
app/
  admin/                    painel e autenticação
  api/admin/                rotas protegidas de login, artigos e upload
  artigos/                  listagem e páginas editoriais
  games/                    catálogo e partidas de Haxball e hóquei
  api/games/                salas públicas e sincronização das partidas
  globals.css               sistema visual completo
components/                 interface pública, Markdown e painel
lib/                        autenticação, dados, salas e física dos jogos
public/
  models/the_universe.glb   modelo 3D do hero, de Stark
  models/the_universe.LICENSE.txt  atribuição e licença do modelo
  models/sun/               asset anterior e sua licença, preservados
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

## Jogos

Em `/games`, escolha Haxball ou hóquei. A física, os controles, as colisões e as regras dos HTML fornecidos foram integrados ao Canvas da aplicação com a identidade visual preta, laranja e branca. Os HTML de exemplo não são necessários em produção.

| Jogo | Contra bot | Salas públicas |
| --- | --- | --- |
| Haxball | Você escolhe de 0 a 4 bots aliados e de 1 a 5 adversários. A partida termina em 5 gols. | Até 5 jogadores por equipe. |
| Hóquei | Duelo 1v1 contra bot, até 7 gols. | Um jogador por equipe. |

Use WASD ou as setas para mover. No Haxball, mantenha o botão esquerdo do mouse pressionado para carregar o chute e solte para chutar na direção apontada; `Shift` acelera e `Q` aplica curva. No hóquei, mova o taco para impulsionar o disco. O botão **Reiniciar** está disponível no modo bot e para o criador da sala online.

Para jogar online, informe um nome, crie ou entre em uma sala pública e compartilhe o link ou o código exibido. A partida começa quando houver pelo menos um jogador em cada equipe. Não há contas nem autenticação nesta versão. Uma aba que recarrega tenta retomar a participação; jogadores inativos são removidos, e salas sem atividade expiram. O primeiro jogador ativo hospeda a simulação no navegador e publica o estado no Redis; os demais enviam comandos e recebem snapshots por polling. Portanto, a latência e o consumo de requisições variam conforme a rede e o plano do Redis/Vercel. O modo contra bot funciona sem Redis; o modo online exige as variáveis REST abaixo.

## Variáveis de ambiente

| Variável | Obrigatória | Finalidade |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Sim em produção | Origem pública usada em metadados, sitemap e validação; se ausente ou vazia, o build usa `http://localhost:3000` |
| `AUTH_SECRET` | Sim | Assinatura das sessões administrativas |
| `ADMIN_PASSWORD_HASH` | Sim | Hash bcrypt da senha do administrador |
| `PN_KV_REST_API_URL` | Sim, se usar o prefixo `PN_` | Endpoint REST do Redis com prefixo personalizado |
| `PN_KV_REST_API_TOKEN` | Sim, se usar o prefixo `PN_` | Token REST do Redis com prefixo personalizado |
| `PN_KV_REST_API_READ_ONLY_TOKEN` | Opcional | Token somente leitura, usado para consultar artigos públicos |
| `UPSTASH_REDIS_REST_URL` | Alternativa | Endpoint REST do Redis |
| `UPSTASH_REDIS_REST_TOKEN` | Alternativa | Token REST do Redis |
| `KV_REST_API_URL` | Alternativa | Nome compatível com integrações KV existentes |
| `KV_REST_API_TOKEN` | Alternativa | Token da integração KV existente |
| `BLOB_READ_WRITE_TOKEN` | Para uploads | Credencial de escrita do Vercel Blob |

O cliente `@upstash/redis` usa o endpoint REST HTTPS e os tokens REST. Para gravações administrativas, o aplicativo usa `PN_KV_REST_API_TOKEN`; o token `PN_KV_REST_API_READ_ONLY_TOKEN` fica restrito às leituras públicas. Se as variáveis `PN_` estiverem vazias ou ausentes, tenta os nomes Upstash e KV padrão. URLs TCP `rediss://` como `PN_KV_URL` e `PN_REDIS_URL` não são usadas por este cliente.

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

O hero utiliza [The Universe!](https://skfb.ly/SZJ8), de [Stark](https://sketchfab.com/stark3d), licenciado sob [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/). A atribuição também aparece no rodapé e acompanha o arquivo em `public/models/the_universe.LICENSE.txt`.

O GLB original e sua geometria foram preservados. Na exibição, o modelo é centralizado, redimensionado uniformemente e recebe iluminação e rotação próprias da interface. A transparência das camadas externas `Mat_Orb` e `Mat_Orb2` é suavizada em cópias dos materiais para revelar as órbitas internas. O enquadramento usa uma esfera que inclui toda a geometria e considera o campo de visão horizontal e vertical da câmera. O canvas não aplica máscara circular nem margens negativas; os limites de zoom preservam uma margem de segurança em todas as orientações.

### Interação com o modelo

- A rolagem da página aproxima progressivamente a câmera, sem deslocar o modelo no eixo vertical.
- Sobre o canvas, a roda do mouse aproxima ou afasta o modelo. Fora dele, a página continua rolando normalmente.
- Botão esquerdo + arraste gira a vista. Pan está desativado para manter a geometria centralizada.
- Com o modelo focado, `+` e `-` ajustam o zoom; as setas giram a vista; `Home` restaura o enquadramento.
- A primeira interação manual pausa a rotação automática. Com movimento reduzido, a rotação automática e a suavização são desativadas, mas os controles manuais continuam disponíveis.
- Hovers preservam mudanças de cor e degradê, sem animações de deslocamento vertical.

O asset anterior, [Sun Model](https://sketchfab.com/3d-models/sun-model-b9e1dfd765984d9b8f998bd4a6be97b5), de [Black Hole](https://sketchfab.com/blckhole), permanece arquivado em `public/models/sun/` com sua licença CC BY 4.0, mas não é carregado pelo hero.

## Licença

O código deste projeto está disponível sob a licença MIT. O asset 3D mantém sua licença CC BY 4.0 e seus requisitos próprios de atribuição.
