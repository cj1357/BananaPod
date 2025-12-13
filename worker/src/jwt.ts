type JwtHeader = { alg: "HS256"; typ: "JWT" };

export type JwtPayload = {
  userKey: string;
  iat: number; // seconds
  exp: number; // seconds
};

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlEncodeJson(obj: unknown): string {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  return base64UrlEncodeBytes(bytes);
}

function base64UrlDecodeToString(input: string): string {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function hmacSha256(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

export async function signJwt(secret: string, payload: JwtPayload): Promise<string> {
  const header: JwtHeader = { alg: "HS256", typ: "JWT" };
  const head = base64UrlEncodeJson(header);
  const body = base64UrlEncodeJson(payload);
  const signingInput = `${head}.${body}`;
  const sig = await hmacSha256(secret, signingInput);
  const sigB64u = base64UrlEncodeBytes(sig);
  return `${signingInput}.${sigB64u}`;
}

export async function verifyJwt(secret: string, token: string): Promise<JwtPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headB64, bodyB64, sigB64] = parts;
  if (!headB64 || !bodyB64 || !sigB64) return null;

  // Basic header check (optional but nice)
  try {
    const header = JSON.parse(base64UrlDecodeToString(headB64)) as JwtHeader;
    if (header.alg !== "HS256" || header.typ !== "JWT") return null;
  } catch {
    return null;
  }

  const signingInput = `${headB64}.${bodyB64}`;
  const expectedSig = await hmacSha256(secret, signingInput);
  const expected = base64UrlEncodeBytes(expectedSig);
  if (expected !== sigB64) return null;

  try {
    const payload = JSON.parse(base64UrlDecodeToString(bodyB64)) as JwtPayload;
    if (!payload.userKey || typeof payload.userKey !== "string") return null;
    if (typeof payload.exp !== "number" || typeof payload.iat !== "number") return null;
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) return null;
    return payload;
  } catch {
    return null;
  }
}


