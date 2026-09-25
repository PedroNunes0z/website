import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clearCommentSession, findCommentUser, getCommentSession, registerCommentUser, setCommentSession, verifyCommentPassword } from "@/lib/comment-auth";
import { moderateCommentText } from "@/lib/comment-moderation";
import { enforceCommentRate } from "@/lib/comments";
import { getRedis } from "@/lib/redis";
import { getClientAddress, isSameOrigin } from "@/lib/request-security";

const credentials = z.object({
  mode: z.enum(["register", "login"]),
  name: z.string().trim().min(3).max(24).optional(),
  email: z.email().max(254).transform((value) => value.trim().toLowerCase()),
  password: z.string().min(10).max(72),
});

export async function GET() {
  const user = await getCommentSession();
  return NextResponse.json({ user });
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  if (!getRedis() || !process.env.AUTH_SECRET) return NextResponse.json({ error: "Comentários indisponíveis no momento." }, { status: 503 });
  if (Number(request.headers.get("content-length") ?? 0) > 4096) return NextResponse.json({ error: "Dados muito extensos." }, { status: 413 });
  const parsed = credentials.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Confira nome, e-mail e senha (mínimo de 10 caracteres)." }, { status: 400 });
  const { mode, name, email, password } = parsed.data;
  if (Buffer.byteLength(password, "utf8") > 72) return NextResponse.json({ error: "A senha deve ter no máximo 72 bytes." }, { status: 400 });
  const address = getClientAddress(request);
  if (!(await enforceCommentRate(`auth:${address}`, 10, 15 * 60))) return NextResponse.json({ error: "Muitas tentativas. Aguarde 15 minutos." }, { status: 429 });

  try {
    if (mode === "register") {
      const cleanName = name?.replace(/\s+/g, " ");
      if (!cleanName || !/^[\p{L}\p{N}_. -]+$/u.test(cleanName)) return NextResponse.json({ error: "Use um nome de 3 a 24 caracteres, sem símbolos especiais." }, { status: 400 });
      await moderateCommentText(cleanName);
      const user = await registerCommentUser(cleanName, email, password);
      if (!user) return NextResponse.json({ error: "Já existe uma conta com este e-mail." }, { status: 409 });
      await setCommentSession(user);
      return NextResponse.json({ user: { id: user.id, name: user.name } }, { status: 201 });
    }
    const user = await findCommentUser(email);
    if (!(await verifyCommentPassword(user, password)) || !user) return NextResponse.json({ error: "E-mail ou senha inválidos." }, { status: 401 });
    await setCommentSession(user);
    return NextResponse.json({ user: { id: user.id, name: user.name } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível entrar." }, { status: 503 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  await clearCommentSession();
  return NextResponse.json({ ok: true });
}
