"use client";

import {
  Bold,
  Code2,
  ExternalLink,
  FileImage,
  Heading2,
  Link2,
  LogOut,
  Monitor,
  Plus,
  Quote,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { ChangeEvent, useRef, useState } from "react";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import type { Article, ArticleStatus } from "@/lib/types";

interface EditorState {
  id?: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  coverImage: string;
  tags: string;
  status: ArticleStatus;
  featured: boolean;
  publishedAt: string;
}

function toInputDate(value = new Date().toISOString()) {
  return value.slice(0, 16);
}

const blankArticle = (): EditorState => ({
  title: "",
  slug: "",
  excerpt: "",
  content: "## Comece por aqui\n\nEscreva o conteúdo do artigo em Markdown.",
  coverImage: "",
  tags: "",
  status: "draft",
  featured: false,
  publishedAt: toInputDate(),
});

function articleToEditor(article: Article): EditorState {
  return {
    ...article,
    tags: article.tags.join(", "),
    publishedAt: toInputDate(article.publishedAt),
  };
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const snippets = [
  { label: "Título", icon: Heading2, before: "\n## Título da seção\n\n", after: "" },
  { label: "Negrito", icon: Bold, before: "**", after: "**" },
  { label: "Código", icon: Code2, before: "\n```ts\n", after: "\n```\n" },
  { label: "Citação", icon: Quote, before: "\n> ", after: "\n" },
  { label: "Link", icon: Link2, before: "[texto](https://exemplo.com)", after: "" },
  { label: "Referência", icon: ExternalLink, before: "\n### Referências\n\n- [Título](https://exemplo.com)\n", after: "" },
  { label: "Imagem", icon: FileImage, before: "\n![Descrição da imagem](https://exemplo.com/imagem.jpg)\n", after: "" },
  { label: "Botão", icon: Monitor, before: "\n[Texto do botão](https://exemplo.com \"button\")\n", after: "" },
];

export function AdminDashboard({
  initialArticles,
  storageConfigured,
}: {
  initialArticles: Article[];
  storageConfigured: boolean;
}) {
  const [articles, setArticles] = useState(initialArticles);
  const [editor, setEditor] = useState<EditorState>(
    initialArticles[0] ? articleToEditor(initialArticles[0]) : blankArticle(),
  );
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function update<K extends keyof EditorState>(key: K, value: EditorState[K]) {
    setEditor((current) => ({ ...current, [key]: value }));
  }

  function updateTitle(title: string) {
    setEditor((current) => ({
      ...current,
      title,
      slug: current.id ? current.slug : slugify(title),
    }));
  }

  function insertSnippet(before: string, after: string) {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? editor.content.length;
    const end = textarea?.selectionEnd ?? editor.content.length;
    const selection = editor.content.slice(start, end);
    const content = editor.content.slice(0, start) + before + selection + after + editor.content.slice(end);
    update("content", content);
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + before.length, start + before.length + selection.length);
    });
  }

  async function refreshArticles() {
    const response = await fetch("/api/admin/articles");
    if (response.ok) {
      const data = await response.json();
      setArticles(data.articles);
    }
  }

  async function save() {
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/admin/articles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...editor,
        tags: editor.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        publishedAt: new Date(editor.publishedAt).toISOString(),
      }),
    });
    const data = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setMessage(data.error ?? "Não foi possível salvar.");
      return;
    }

    setEditor(articleToEditor(data.article));
    await refreshArticles();
    setMessage(data.article.status === "published" ? "Artigo publicado com sucesso." : "Rascunho salvo com sucesso.");
  }

  async function remove() {
    if (!editor.id || !window.confirm("Excluir este artigo de forma permanente?")) return;
    setBusy(true);
    const response = await fetch(`/api/admin/articles/${editor.id}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setMessage(data.error ?? "Não foi possível excluir.");
      return;
    }
    await refreshArticles();
    setEditor(blankArticle());
    setMessage("Artigo excluído.");
  }

  async function uploadImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setMessage("Enviando imagem...");
    const form = new FormData();
    form.append("file", file);
    const response = await fetch("/api/admin/upload", { method: "POST", body: form });
    const data = await response.json().catch(() => ({}));
    setBusy(false);
    event.target.value = "";
    if (!response.ok) {
      setMessage(data.error ?? "Não foi possível enviar a imagem.");
      return;
    }
    insertSnippet(`\n![Descrição da imagem](${data.url})\n`, "");
    setMessage("Imagem enviada e inserida no artigo.");
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    window.location.assign("/admin/login");
  }

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div>
          <p className="brand">Pedro Nunes<span>.</span></p>
          <span className="admin-label">Editorial console</span>
        </div>
        <nav aria-label="Ações administrativas">
          <Link href="/" target="_blank">Ver site <ExternalLink aria-hidden="true" /></Link>
          <button type="button" onClick={logout}>Sair <LogOut aria-hidden="true" /></button>
        </nav>
      </header>

      {!storageConfigured ? (
        <div className="admin-warning" role="status">
          <strong>Modo de demonstração.</strong> Configure as variáveis do Upstash Redis para salvar, publicar e excluir artigos.
        </div>
      ) : null}

      <div className="admin-layout">
        <aside className="admin-sidebar">
          <div className="admin-sidebar-head">
            <div><span>Conteúdo</span><strong>{articles.length} artigos</strong></div>
            <button type="button" onClick={() => { setEditor(blankArticle()); setMessage(""); }} aria-label="Novo artigo"><Plus aria-hidden="true" /></button>
          </div>
          <div className="admin-article-list">
            {articles.map((article) => (
              <button
                className={editor.id === article.id ? "admin-article active" : "admin-article"}
                type="button"
                key={article.id}
                onClick={() => { setEditor(articleToEditor(article)); setMessage(""); }}
              >
                <span className={`status-dot ${article.status}`} />
                <span><strong>{article.title}</strong><small>{article.status === "published" ? "Publicado" : "Rascunho"}</small></span>
              </button>
            ))}
          </div>
        </aside>

        <section className="admin-editor">
          <div className="editor-head">
            <div>
              <span>{editor.id ? "Editando artigo" : "Novo artigo"}</span>
              <strong>{editor.title || "Sem título"}</strong>
            </div>
            <div className="editor-actions">
              {editor.id ? <button className="icon-button danger" type="button" onClick={remove} disabled={busy} aria-label="Excluir artigo"><Trash2 aria-hidden="true" /></button> : null}
              <button className="button button-primary" type="button" onClick={save} disabled={busy}><Save aria-hidden="true" /> {busy ? "Aguarde" : "Salvar"}</button>
            </div>
          </div>

          {message ? <p className="admin-message" role="status">{message}</p> : null}

          <div className="editor-grid">
            <label className="field field-wide">Título
              <input value={editor.title} onChange={(event) => updateTitle(event.target.value)} maxLength={120} />
            </label>
            <label className="field">Slug
              <input value={editor.slug} onChange={(event) => update("slug", slugify(event.target.value))} maxLength={120} />
            </label>
            <label className="field">Publicação
              <input type="datetime-local" value={editor.publishedAt} onChange={(event) => update("publishedAt", event.target.value)} />
            </label>
            <label className="field field-wide">Resumo
              <textarea className="short-textarea" value={editor.excerpt} onChange={(event) => update("excerpt", event.target.value)} maxLength={240} />
              <small>{editor.excerpt.length}/240</small>
            </label>
            <label className="field">Tags, separadas por vírgula
              <input value={editor.tags} onChange={(event) => update("tags", event.target.value)} placeholder="Next.js, Arquitetura" />
            </label>
            <label className="field">URL da capa
              <input type="url" value={editor.coverImage} onChange={(event) => update("coverImage", event.target.value)} placeholder="https://" />
            </label>
            <div className="field field-inline">
              <label>Status
                <select value={editor.status} onChange={(event) => update("status", event.target.value as ArticleStatus)}>
                  <option value="draft">Rascunho</option>
                  <option value="published">Publicado</option>
                </select>
              </label>
              <label className="check-field"><input type="checkbox" checked={editor.featured} onChange={(event) => update("featured", event.target.checked)} /> Artigo em destaque</label>
            </div>
          </div>

          <div className="markdown-editor">
            <div className="editor-tabs">
              <div>
                <button className={!preview ? "active" : ""} type="button" onClick={() => setPreview(false)}>Markdown</button>
                <button className={preview ? "active" : ""} type="button" onClick={() => setPreview(true)}>Prévia</button>
              </div>
              <div className="markdown-toolbar" aria-label="Ferramentas de Markdown">
                {snippets.map(({ label, icon: Icon, before, after }) => (
                  <button type="button" key={label} title={label} aria-label={label} onClick={() => insertSnippet(before, after)}><Icon aria-hidden="true" /></button>
                ))}
                <button type="button" title="Enviar imagem" aria-label="Enviar imagem" onClick={() => fileInputRef.current?.click()}><Upload aria-hidden="true" /></button>
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={uploadImage} hidden />
              </div>
            </div>
            {preview ? (
              <div className="editor-preview"><MarkdownRenderer content={editor.content} /></div>
            ) : (
              <textarea ref={textareaRef} className="markdown-textarea" value={editor.content} onChange={(event) => update("content", event.target.value)} spellCheck="true" />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
