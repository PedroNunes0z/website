import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSessionToken, setSessionCookie } from "@/lib/auth";
import { getRedis } from "@/lib/redis";
import { getClientAddress, isSameOrigin } from "@/lib/request-security";

const loginSchema = z.object({ password: z.string().min(1).max(256) });

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  }

  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (!hash || !process.env.AUTH_SECRET) {
    return NextResponse.json({ error: "Autenticação ainda não configurada." }, { status: 503 });
  }

  const redis = getRedis();
  const address = getClientAddress(request);
  const rateKey = `pedronunes:login:${address}`;

  if (redis) {
    const attempts = await redis.incr(rateKey);
    if (attempts === 1) await redis.expire(rateKey, 10 * 60);
    if (attempts > 7) {
      return NextResponse.json({ error: "Muitas tentativas. Aguarde alguns minutos." }, { status: 429 });
    }
  }

  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !(await bcrypt.compare(parsed.data.password, hash))) {
    return NextResponse.json({ error: "Senha inválida." }, { status: 401 });
  }

  if (redis) await redis.del(rateKey);
  const token = await createSessionToken();
  await setSessionCookie(token);
  return NextResponse.json({ ok: true });
}
