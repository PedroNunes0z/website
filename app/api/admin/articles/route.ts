import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { articleSchema } from "@/lib/article-schema";
import { getArticles, saveArticle } from "@/lib/articles";
import { isAdminSession } from "@/lib/auth";
import { isSameOrigin } from "@/lib/request-security";

export async function GET() {
  if (!(await isAdminSession())) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  return NextResponse.json({ articles: await getArticles({ includeDrafts: true }) });
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request) || !(await isAdminSession())) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const payload = articleSchema.parse(await request.json());
    const article = await saveArticle(payload);
    return NextResponse.json({ article }, { status: payload.id ? 200 : 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Revise os campos do artigo.", fields: error.flatten() }, { status: 400 });
    }
    if (error instanceof Error && error.message === "STORAGE_NOT_CONFIGURED") {
      return NextResponse.json({ error: "Configure o Redis para salvar artigos." }, { status: 503 });
    }
    if (error instanceof Error && error.message === "SLUG_CONFLICT") {
      return NextResponse.json({ error: "Já existe um artigo com este slug." }, { status: 409 });
    }
    return NextResponse.json({ error: "Não foi possível salvar o artigo." }, { status: 500 });
  }
}
