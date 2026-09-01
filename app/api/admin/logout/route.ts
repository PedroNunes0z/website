import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, isAdminSession } from "@/lib/auth";
import { isSameOrigin } from "@/lib/request-security";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request) || !(await isAdminSession())) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
