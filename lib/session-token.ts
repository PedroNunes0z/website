import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "pn_admin_session";
export const SESSION_DURATION = 60 * 60 * 8;

function getSecret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) {
    throw new Error("AUTH_SECRET_NOT_CONFIGURED");
  }
  return new TextEncoder().encode(value);
}

export async function createSessionToken() {
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("portfolio-admin")
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION}s`)
    .sign(getSecret());
}

export async function verifySessionToken(token?: string) {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ["HS256"],
      subject: "portfolio-admin",
    });
    return payload.role === "admin";
  } catch {
    return false;
  }
}
