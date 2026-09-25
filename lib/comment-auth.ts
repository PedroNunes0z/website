import bcrypt from "bcryptjs";
import { createHash, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getRedis } from "@/lib/redis";

export const COMMENT_COOKIE = "pn_comment_session";
const SESSION_SECONDS = 60 * 60 * 24 * 14;

export interface CommentUser {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
}

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) throw new Error("AUTH_SECRET_NOT_CONFIGURED");
  return new TextEncoder().encode(value);
}

function userKey(email: string) {
  const hash = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
  return `pedronunes:comment-user:v1:${hash}`;
}

export async function findCommentUser(email: string) {
  const redis = getRedis();
  if (!redis) throw new Error("STORAGE_NOT_CONFIGURED");
  return redis.get<CommentUser>(userKey(email));
}

export async function registerCommentUser(name: string, email: string, password: string) {
  const redis = getRedis();
  if (!redis) throw new Error("STORAGE_NOT_CONFIGURED");
  const user: CommentUser = {
    id: randomUUID(), name, email: email.toLowerCase(),
    passwordHash: await bcrypt.hash(password, 12),
  };
  const created = await redis.set(userKey(email), user, { nx: true });
  return created ? user : null;
}

export async function verifyCommentPassword(user: CommentUser | null, password: string) {
  // Mantém tempo semelhante quando a conta não existe.
  const hash = user?.passwordHash ?? "$2b$12$M7CUvmtVm1dYyUx/06x9I.x6s1E9e8Rvk8y/PiMUiWsaUq2zKYcaq";
  return bcrypt.compare(password, hash);
}

export async function setCommentSession(user: CommentUser) {
  const token = await new SignJWT({ role: "commenter", name: user.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_SECONDS}s`)
    .sign(secret());
  (await cookies()).set(COMMENT_COOKIE, token, {
    httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production",
    path: "/", maxAge: SESSION_SECONDS,
  });
}

export async function getCommentSession() {
  const token = (await cookies()).get(COMMENT_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (payload.role !== "commenter" || !payload.sub || typeof payload.name !== "string") return null;
    return { id: payload.sub, name: payload.name };
  } catch {
    return null;
  }
}

export async function clearCommentSession() {
  (await cookies()).set(COMMENT_COOKIE, "", {
    httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production",
    path: "/", maxAge: 0,
  });
}
