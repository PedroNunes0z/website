"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import { Bold, Code2, ImagePlus, Italic, Link2, MessageSquare, Reply, Send, Star, Trash2 } from "lucide-react";

interface CommentView {
  id: string;
  authorName: string;
  body: string;
  imageUrl: string | null;
  parentId: string | null;
  createdAt: string;
  own: boolean;
}

interface CommentsResponse {
  comments: CommentView[];
  rating: { average: number; count: number; mine: number };
  user: { id: string; name: string } | null;
}

const initial: CommentsResponse = { comments: [], rating: { average: 0, count: 0, mine: 0 }, user: null };

async function responseData(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir a operação.");
  return data;
}

function CommentBody({ body }: { body: string }) {
  return <div className="comment-markdown"><ReactMarkdown skipHtml allowedElements={["p", "strong", "em", "code", "pre", "blockquote", "a", "ul", "ol", "li", "br"]} components={{ a({ href, children }) { return <a href={href} target="_blank" rel="nofollow noopener noreferrer">{children}</a>; } }}>{body}</ReactMarkdown></div>;
}

export function ArticleComments({ slug }: { slug: string }) {
  const [data, setData] = useState<CommentsResponse>(initial);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [body, setBody] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [rating, setRating] = useState(0);
  const [replyTo, setReplyTo] = useState<CommentView | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const api = `/api/comments/${encodeURIComponent(slug)}`;

  const load = useCallback(async () => {
    try {
      const result = await responseData(await fetch(api, { cache: "no-store" }));
      setData(result);
      setRating(result.rating.mine);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Comentários indisponíveis.");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    let active = true;
    fetch(api, { cache: "no-store" }).then(responseData).then((result: CommentsResponse) => {
      if (!active) return;
      setData(result); setRating(result.rating.mine); setLoading(false);
    }).catch((cause: unknown) => {
      if (!active) return;
      setError(cause instanceof Error ? cause.message : "Comentários indisponíveis.");
      setLoading(false);
    });
    return () => { active = false; };
  }, [api]);

  const authenticate = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      await responseData(await fetch("/api/comments/auth", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: authMode, name, email, password }),
      }));
      setPassword("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível entrar.");
    } finally { setBusy(false); }
  };

  const logout = async () => {
    setBusy(true);
    try { await responseData(await fetch("/api/comments/auth", { method: "DELETE" })); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível sair."); }
    finally { setBusy(false); }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const form = new FormData();
      form.append("body", body);
      if (image) form.append("image", image);
      if (replyTo) form.append("parentId", replyTo.id);
      else if (rating) form.append("rating", String(rating));
      await responseData(await fetch(api, { method: "POST", body: form }));
      setBody(""); setImage(null); setReplyTo(null);
      if (fileInput.current) fileInput.current.value = "";
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível publicar.");
    } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Excluir este comentário?")) return;
    setBusy(true); setError("");
    try { await responseData(await fetch(`${api}?id=${encodeURIComponent(id)}`, { method: "DELETE" })); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível excluir."); }
    finally { setBusy(false); }
  };

  const wrap = (before: string, after = before) => {
    const input = textarea.current;
    if (!input) return;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const selected = body.slice(start, end) || "texto";
    setBody(body.slice(0, start) + before + selected + after + body.slice(end));
    requestAnimationFrame(() => { input.focus(); input.setSelectionRange(start + before.length, start + before.length + selected.length); });
  };

  const renderComment = (comment: CommentView, nested = false) => (
    <div className={`comment-item${nested ? " comment-reply" : ""}`} key={comment.id}>
      <div className="comment-avatar" aria-hidden="true">{comment.authorName.slice(0, 1).toUpperCase()}</div>
      <div className="comment-main">
        <div className="comment-meta"><strong>{comment.authorName}</strong><time dateTime={comment.createdAt}>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(comment.createdAt))}</time></div>
        <CommentBody body={comment.body} />
        {comment.imageUrl && <Image className="comment-image" src={comment.imageUrl} alt={`Imagem enviada por ${comment.authorName}`} width={720} height={480} unoptimized />}
        <div className="comment-actions">
          {!nested && data.user && <button type="button" onClick={() => { setReplyTo(comment); textarea.current?.focus(); }}><Reply size={14} /> Responder</button>}
          {comment.own && <button type="button" disabled={busy} onClick={() => void remove(comment.id)}><Trash2 size={14} /> Excluir</button>}
        </div>
      </div>
    </div>
  );

  const roots = data.comments.filter((comment) => !comment.parentId);
  const orphanReplies = data.comments.filter((comment) => comment.parentId && !data.comments.some((parent) => parent.id === comment.parentId));

  return <section className="comments-section shell" aria-labelledby="comments-heading">
    <div className="comments-heading"><div><span className="section-kicker">Comunidade / 01</span><h2 id="comments-heading">Discussão<span>.</span></h2><p>Compartilhe sua perspectiva. Comentários e imagens passam por moderação automática antes de aparecer.</p></div><div className="comments-rating"><Star size={20} aria-hidden="true" /><strong>{data.rating.count ? data.rating.average.toFixed(1).replace(".", ",") : "—"}</strong><span>{data.rating.count} {data.rating.count === 1 ? "avaliação" : "avaliações"}</span></div></div>
    {error && <p className="comments-error" role="alert">{error}</p>}
    {!data.user ? <form className="comments-auth" onSubmit={authenticate}>
      <div className="comments-auth-intro"><MessageSquare size={20} /><h3>Entre para participar</h3><p>Crie uma conta simples ou acesse a sua. O e-mail não aparece publicamente.</p></div>
      <div className="comments-auth-tabs"><button type="button" className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")}>Entrar</button><button type="button" className={authMode === "register" ? "active" : ""} onClick={() => setAuthMode("register")}>Criar conta</button></div>
      <div className="comments-auth-fields">{authMode === "register" && <label>Nome público<input required minLength={3} maxLength={24} autoComplete="nickname" value={name} onChange={(event) => setName(event.target.value)} /></label>}<label>E-mail<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Senha<input required type="password" minLength={10} maxLength={72} autoComplete={authMode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} /></label></div>
      <button className="comments-primary" disabled={busy} type="submit">{busy ? "Aguarde..." : authMode === "login" ? "Entrar e comentar" : "Criar conta"}</button>
    </form> : <form className="comment-composer" onSubmit={submit}>
      <div className="comment-composer-top"><div className="comment-avatar" aria-hidden="true">{data.user.name.slice(0, 1).toUpperCase()}</div><div><strong>{data.user.name}</strong><span>Comentando como leitor</span></div><button type="button" disabled={busy} onClick={() => void logout()}>Sair</button></div>
      {replyTo && <div className="comment-reply-target">Respondendo a {replyTo.authorName}<button type="button" onClick={() => setReplyTo(null)}>Cancelar</button></div>}
      <div className="comment-toolbar" aria-label="Formatação"><button type="button" title="Negrito" aria-label="Negrito" onClick={() => wrap("**")}><Bold size={16} /></button><button type="button" title="Itálico" aria-label="Itálico" onClick={() => wrap("*")}><Italic size={16} /></button><button type="button" title="Código" aria-label="Código" onClick={() => wrap("`")}><Code2 size={16} /></button><button type="button" title="Link" aria-label="Link" onClick={() => wrap("[", "](https://exemplo.com)")}><Link2 size={16} /></button><button type="button" title="Adicionar imagem" aria-label="Adicionar imagem" onClick={() => fileInput.current?.click()}><ImagePlus size={16} /></button></div>
      <textarea ref={textarea} required minLength={2} maxLength={2000} rows={5} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Escreva seu comentário..." aria-label="Comentário" />
      <input ref={fileInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setImage(event.target.files?.[0] ?? null)} />
      {image && <div className="comment-selected-image"><ImagePlus size={15} /> {image.name} <button type="button" onClick={() => { setImage(null); if (fileInput.current) fileInput.current.value = ""; }}>Remover</button></div>}
      <div className="comment-composer-bottom"><div>{!replyTo && <div className="comment-stars" aria-label="Avalie o artigo de 1 a 5 estrelas"><span>Sua nota</span>{[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" aria-label={`${value} ${value === 1 ? "estrela" : "estrelas"}`} aria-pressed={rating === value} onClick={() => setRating(value)}><Star size={17} fill={value <= rating ? "currentColor" : "none"} /></button>)}</div>}<small>Até 3 comentários por minuto · imagem de até 2 MB</small></div><button className="comments-primary" disabled={busy || body.trim().length < 2} type="submit"><Send size={16} /> {busy ? "Verificando..." : "Publicar"}</button></div>
    </form>}
    <div className="comments-list-head"><h3>Comentários</h3><span>{data.comments.length.toString().padStart(2, "0")}</span></div>
    {loading ? <p className="comments-empty">Carregando discussão...</p> : roots.length === 0 && orphanReplies.length === 0 ? <p className="comments-empty">Ainda não há comentários. Inicie a conversa.</p> : <div className="comments-list">{roots.map((comment) => <div key={comment.id}>{renderComment(comment)}{data.comments.filter((reply) => reply.parentId === comment.id).map((reply) => renderComment(reply, true))}</div>)}{orphanReplies.map((comment) => renderComment(comment, true))}</div>}
  </section>;
}
