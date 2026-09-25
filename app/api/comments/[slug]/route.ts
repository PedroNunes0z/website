import { put, del } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { getCommentSession } from "@/lib/comment-auth";
import { CommentModerationError, moderateCommentImage, moderateCommentText } from "@/lib/comment-moderation";
import { deleteComment, enforceCommentRate, getComment, listComments, saveComment, saveRating, type StoredComment } from "@/lib/comments";
import { getArticleBySlug } from "@/lib/articles";
import { getRedis } from "@/lib/redis";
import { getClientAddress, isSameOrigin } from "@/lib/request-security";
import { isAdminSession } from "@/lib/auth";

interface Context { params: Promise<{ slug: string }> }

async function articleFor(context: Context) {
  const { slug } = await context.params;
  return slug.length <= 120 ? getArticleBySlug(slug) : null;
}

export async function GET(_request: NextRequest, context: Context) {
  const article = await articleFor(context);
  if (!article) return NextResponse.json({ error: "Artigo não encontrado." }, { status: 404 });
  const [data, user, admin] = await Promise.all([listComments(article.id), getCommentSession(), isAdminSession()]);
  const values = Object.values(data.ratings).map(Number).filter((value) => Number.isInteger(value) && value >= 1 && value <= 5);
  const comments = data.comments.map((comment) => ({
    id: comment.id, authorName: comment.authorName, body: comment.body,
    imageUrl: comment.imageUrl, parentId: comment.parentId, createdAt: comment.createdAt,
    own: comment.authorId === user?.id || admin,
  }));
  return NextResponse.json({
    comments,
    rating: { count: values.length, average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0, mine: user ? Number(data.ratings[user.id] ?? 0) : 0 },
    user,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest, context: Context) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  const user = await getCommentSession();
  if (!user) return NextResponse.json({ error: "Entre na sua conta para comentar." }, { status: 401 });
  const article = await articleFor(context);
  if (!article) return NextResponse.json({ error: "Artigo não encontrado." }, { status: 404 });
  if (!getRedis()) return NextResponse.json({ error: "Comentários indisponíveis no momento." }, { status: 503 });
  if (Number(request.headers.get("content-length") ?? 0) > 3 * 1024 * 1024) return NextResponse.json({ error: "Envio muito grande." }, { status: 413 });
  if (!(await enforceCommentRate(`post:${user.id}`, 3, 60)) || !(await enforceCommentRate(`post-ip:${getClientAddress(request)}`, 12, 60))) {
    return NextResponse.json({ error: "Limite de 3 comentários por minuto. Tente novamente em instantes." }, { status: 429 });
  }
  try {
    const form = await request.formData();
    const body = String(form.get("body") ?? "").trim();
    const parentId = String(form.get("parentId") ?? "").trim() || null;
    const ratingValue = String(form.get("rating") ?? "");
    const rating = ratingValue ? Number(ratingValue) : null;
    const image = form.get("image");
    if (body.length < 2 || body.length > 2000) return NextResponse.json({ error: "Escreva entre 2 e 2.000 caracteres." }, { status: 400 });
    if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) return NextResponse.json({ error: "A nota deve ser de 1 a 5." }, { status: 400 });
    if (parentId) {
      const parent = await getComment(parentId);
      if (!parent || parent.articleId !== article.id || parent.parentId) return NextResponse.json({ error: "Resposta inválida." }, { status: 400 });
    }
    await moderateCommentText(`${user.name}\n${body}`);
    let imageUrl: string | null = null;
    if (image instanceof File && image.size > 0) {
      if (!process.env.BLOB_READ_WRITE_TOKEN) return NextResponse.json({ error: "Upload de imagens indisponível no momento." }, { status: 503 });
      await moderateCommentImage(image);
      const ext = image.type === "image/png" ? "png" : image.type === "image/webp" ? "webp" : "jpg";
      const blob = await put(`comments/${article.id}/${crypto.randomUUID()}.${ext}`, image, { access: "public" });
      imageUrl = blob.url;
    }
    const comment: StoredComment = {
      id: crypto.randomUUID(), articleId: article.id, authorId: user.id, authorName: user.name,
      body, imageUrl, parentId, createdAt: new Date().toISOString(),
    };
    try {
      await saveComment(comment);
      if (rating !== null && !parentId) await saveRating(article.id, user.id, rating);
    } catch (error) {
      await deleteComment(comment).catch(() => {});
      if (imageUrl) await del(imageUrl).catch(() => {});
      throw error;
    }
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof CommentModerationError) {
      return NextResponse.json({ error: error.message }, { status: error.kind === "unavailable" ? 503 : 400 });
    }
    console.error("[comments/post] Comment submission failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "Não foi possível enviar o comentário. Tente novamente." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  const user = await getCommentSession();
  const admin = await isAdminSession();
  if (!user && !admin) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const article = await articleFor(context);
  if (!article) return NextResponse.json({ error: "Artigo não encontrado." }, { status: 404 });
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Comentário inválido." }, { status: 400 });
  const comment = await getComment(id);
  if (!comment || comment.articleId !== article.id) return NextResponse.json({ error: "Comentário não encontrado." }, { status: 404 });
  if (!admin && comment.authorId !== user?.id) return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  await deleteComment(comment);
  if (comment.imageUrl) await del(comment.imageUrl).catch(() => {});
  return NextResponse.json({ ok: true });
}
