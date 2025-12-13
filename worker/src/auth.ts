import { getCookie, setCookie } from "./http";

const SESSION_COOKIE = "bp_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export type AuthResult = { userKey: string; sessionId: string };

export async function isAllowedUserKey(usersKv: KVNamespace, userKey: string): Promise<boolean> {
  if (!userKey) return false;
  const v = await usersKv.get(userKey);
  return v === "1";
}

export async function createSession(
  usersKv: KVNamespace,
  userKey: string
): Promise<{ sessionId: string; setCookieHeader: string }> {
  const sessionId = crypto.randomUUID();
  await usersKv.put(`session:${sessionId}`, userKey, { expirationTtl: SESSION_TTL_SECONDS });
  const cookie = setCookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAgeSeconds: SESSION_TTL_SECONDS,
  });
  return { sessionId, setCookieHeader: cookie };
}

export async function destroySession(usersKv: KVNamespace, sessionId: string): Promise<string> {
  await usersKv.delete(`session:${sessionId}`);
  return setCookie(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAgeSeconds: 0,
  });
}

export async function requireAuth(request: Request, usersKv: KVNamespace): Promise<AuthResult | null> {
  const sessionId = getCookie(request, SESSION_COOKIE);
  if (!sessionId) return null;
  const userKey = await usersKv.get(`session:${sessionId}`);
  if (!userKey) return null;
  const allowed = await isAllowedUserKey(usersKv, userKey);
  if (!allowed) return null;
  return { userKey, sessionId };
}


