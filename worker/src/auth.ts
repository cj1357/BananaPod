import { getCookie, setCookie } from "./http";

const SESSION_COOKIE = "bp_session";
const LEGACY_JWT_COOKIE = "bp_token";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export async function isAllowedUserKey(usersKv: KVNamespace, userKey: string): Promise<boolean> {
  if (!userKey) return false;
  const v = await usersKv.get(userKey);
  return (v ?? "").trim() === "1";
}

export async function createSession(
  db: D1Database,
  userKey: string
): Promise<{ sessionId: string; setCookieHeader: string; clearLegacyJwtCookieHeader: string }> {
  const sessionId = crypto.randomUUID();
  const nowMs = Date.now();
  const expiresAtMs = nowMs + SESSION_TTL_SECONDS * 1000;

  await db
    .prepare(`INSERT INTO sessions (session_id, user_key, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .bind(sessionId, userKey, nowMs, expiresAtMs)
    .run();

  const cookie = setCookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAgeSeconds: SESSION_TTL_SECONDS,
  });

  // Clear legacy JWT cookie if present (migration safety)
  const clearLegacy = setCookie(LEGACY_JWT_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAgeSeconds: 0,
  });

  return { sessionId, setCookieHeader: cookie, clearLegacyJwtCookieHeader: clearLegacy };
}

export async function destroySession(db: D1Database, sessionId: string): Promise<{ clearSessionCookieHeader: string }> {
  await db.prepare(`DELETE FROM sessions WHERE session_id = ?`).bind(sessionId).run();
  const clear = setCookie(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAgeSeconds: 0,
  });
  return { clearSessionCookieHeader: clear };
}

export async function requireAuth(
  request: Request,
  usersKv: KVNamespace,
  db: D1Database
): Promise<{ userKey: string; sessionId: string } | null> {
  const sessionId = getCookie(request, SESSION_COOKIE);
  if (!sessionId) return null;

  const row = await db
    .prepare(`SELECT user_key, expires_at FROM sessions WHERE session_id = ?`)
    .bind(sessionId)
    .first<{ user_key: string; expires_at: number }>();

  if (!row) return null;
  if (typeof row.expires_at === "number" && row.expires_at <= Date.now()) {
    // expired; best-effort cleanup
    await db.prepare(`DELETE FROM sessions WHERE session_id = ?`).bind(sessionId).run();
    return null;
  }

  const allowed = await isAllowedUserKey(usersKv, row.user_key);
  if (!allowed) return null;
  return { userKey: row.user_key, sessionId };
}


