import { NextRequest, NextResponse } from "next/server";
import { deleteArticle } from "@/lib/articles";
import { isAdminSession } from "@/lib/auth";
import { isSameOrigin } from "@/lib/request-security";

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request) || !(await isAdminSession())) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const deleted = await deleteArticle(id);
    return deleted
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: "Artigo não encontrado." }, { status: 404 });
  } catch (error) {
    if (error instanceof Error && error.message === "STORAGE_NOT_CONFIGURED") {
      return NextResponse.json({ error: "Configure o Redis para excluir artigos." }, { status: 503 });
    }
    return NextResponse.json({ error: "Não foi possível excluir o artigo." }, { status: 500 });
  }
}
