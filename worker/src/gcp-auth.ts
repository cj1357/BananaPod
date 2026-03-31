/**
 * GCP Service Account → OAuth2 Access Token (Web Crypto API)
 *
 * 在 Cloudflare Worker 中使用 Service Account JSON Key
 * 生成 RS256 JWT，然后换取 OAuth2 Access Token。
 *
 * 不依赖任何 Node.js 模块，完全基于 Web Crypto API (crypto.subtle)。
 */

export interface ServiceAccountKey {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
}

// ---------- helpers ----------

function base64urlEncode(data: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < data.length; i += chunkSize) {
    binary += String.fromCharCode(...data.subarray(i, i + chunkSize));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlEncodeString(str: string): string {
  return base64urlEncode(new TextEncoder().encode(str));
}

/**
 * Parse PEM private key to raw DER bytes, then import as CryptoKey.
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  // Strip PEM header/footer and whitespace
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");

  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return crypto.subtle.importKey(
    "pkcs8",
    bytes.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

// ---------- JWT creation ----------

async function createSignedJwt(
  email: string,
  privateKey: CryptoKey,
  tokenUri: string,
  scope: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const header = JSON.stringify({ alg: "RS256", typ: "JWT" });
  const payload = JSON.stringify({
    iss: email,
    sub: email,
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
    scope,
  });

  const signingInput = `${base64urlEncodeString(header)}.${base64urlEncodeString(payload)}`;
  const sigBytes = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(signingInput))
  );

  return `${signingInput}.${base64urlEncode(sigBytes)}`;
}

// ---------- Token exchange ----------

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

async function exchangeJwtForAccessToken(jwt: string, tokenUri: string): Promise<TokenResponse> {
  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${encodeURIComponent(jwt)}`,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GCP token exchange failed (${res.status}): ${text}`);
  }

  return (await res.json()) as TokenResponse;
}

// ---------- Token cache ----------

const cachedTokens: Record<string, { accessToken: string; expiresAt: number }> = {};
const cachedPrivateKeys: Record<string, CryptoKey> = {};

async function getAccessTokenFromObj(sa: ServiceAccountKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const cacheKey = sa.client_email;

  const cachedToken = cachedTokens[cacheKey];
  // Return cached token if still valid (with 5-min buffer)
  if (cachedToken && cachedToken.expiresAt > now + 300) {
    return cachedToken.accessToken;
  }

  const tokenUri = sa.token_uri || "https://oauth2.googleapis.com/token";
  const scope = "https://www.googleapis.com/auth/cloud-platform";

  // Cache the imported private key to avoid re-import on every request
  let privateKey = cachedPrivateKeys[cacheKey];
  if (!privateKey) {
    privateKey = await importPrivateKey(sa.private_key);
    cachedPrivateKeys[cacheKey] = privateKey;
  }

  const jwt = await createSignedJwt(sa.client_email, privateKey, tokenUri, scope);
  const tokenResponse = await exchangeJwtForAccessToken(jwt, tokenUri);

  cachedTokens[cacheKey] = {
    accessToken: tokenResponse.access_token,
    expiresAt: now + tokenResponse.expires_in,
  };

  return tokenResponse.access_token;
}

// Module-level rotation index
let currentIndex = 0;

export interface GcpAuthPool {
  length: number;
  getAuth: () => Promise<{ accessToken: string; projectId: string; clientEmail: string }>;
  getAuthByEmail: (email: string) => Promise<{ accessToken: string; projectId: string; clientEmail: string }>;
}

/**
 * Creates a GCP auth pool from one or more JSON strings.
 * Each string can be a single Service Account key or an array of keys.
 * Calling getAuth() will return the next credential in a round-robin fashion.
 */
export function createGcpAuthPool(inputs: string | string[]): GcpAuthPool {
  const keys: ServiceAccountKey[] = [];
  const inputArray = Array.isArray(inputs) ? inputs : [inputs];

  for (const input of inputArray) {
    if (!input || !input.trim()) continue;
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) {
        keys.push(...parsed);
      } else {
        keys.push(parsed);
      }
    } catch (e) {
      console.warn("Failed to parse a GCP_SERVICE_ACCOUNT_KEY entry", e instanceof Error ? e.message : String(e));
    }
  }

  if (keys.length === 0) {
    throw new Error("No valid GCP Service Account Keys provided in the configuration.");
  }

  return {
    length: keys.length,
    getAuth: async () => {
      const selected = keys[currentIndex];
      currentIndex = (currentIndex + 1) % keys.length;
      const accessToken = await getAccessTokenFromObj(selected);
      return { accessToken, projectId: selected.project_id, clientEmail: selected.client_email };
    },
    getAuthByEmail: async (email: string) => {
      const selected = keys.find(k => k.client_email === email);
      if (!selected) throw new Error(`GCP credential for ${email} not found`);
      const accessToken = await getAccessTokenFromObj(selected);
      return { accessToken, projectId: selected.project_id, clientEmail: selected.client_email };
    }
  };
}
