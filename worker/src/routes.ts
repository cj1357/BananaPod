import { errorJson, json, parseJsonSafe } from "./http";
import { createSession, destroySession, isAllowedUserKey, requireAuth } from "./auth";
import { decodeBase64ToUint8Array, encodeUint8ArrayToBase64 } from "./crypto";
import { deleteHistoryById, getHistoryById, insertHistory, listHistory } from "./db";
import { geminiEditImage, geminiGenerateImageFromText, geminiVideoStart, geminiVideoStatus, type ImageConfig, type ImageInputBase64 } from "./gemini";

export type Env = {
  USERS_KV: KVNamespace;
  MEDIA_BUCKET: R2Bucket;
  DB: D1Database;
  GEMINI_API_KEY: string;
  BASE_URL?: string;
};

type ClientImageRef =
  | { kind: "dataUrl"; dataUrl: string; mimeType: string }
  | { kind: "mediaId"; mediaId: string };

function dataUrlToBase64(dataUrl: string): string {
  const idx = dataUrl.indexOf(",");
  if (idx === -1) return dataUrl;
  return dataUrl.slice(idx + 1);
}

async function clientRefToBase64(env: Env, userKey: string, ref: ClientImageRef): Promise<ImageInputBase64> {
  if (ref.kind === "dataUrl") {
    return { base64: dataUrlToBase64(ref.dataUrl), mimeType: ref.mimeType };
  }
  const row = await getHistoryById(env.DB, ref.mediaId);
  if (!row || row.user_key !== userKey) throw new Error("Media not found");
  const obj = await env.MEDIA_BUCKET.get(row.r2_key);
  if (!obj) throw new Error("Media not found");
  const bytes = new Uint8Array(await obj.arrayBuffer());
  return { base64: encodeUint8ArrayToBase64(bytes), mimeType: row.mime_type };
}

function mediaUrl(id: string): string {
  return `/api/media/${encodeURIComponent(id)}`;
}

function extFromMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  if (mime === "video/mp4") return "mp4";
  return "bin";
}

export async function routeApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  // --- Auth ---
  if (url.pathname === "/api/auth/check" && request.method === "POST") {
    const bodyText = await request.text();
    const body = parseJsonSafe<{ userKey?: string }>(bodyText);
    const userKey = (body?.userKey ?? "").trim();
    if (!userKey) return errorJson(400, "Missing userKey");

    const allowed = await isAllowedUserKey(env.USERS_KV, userKey);
    if (!allowed) return errorJson(401, "Invalid userKey");

    const { setCookieHeader, clearLegacyJwtCookieHeader } = await createSession(env.DB, userKey);
    const headers = new Headers();
    // IMPORTANT: Set-Cookie headers must NOT be comma-joined.
    headers.append("Set-Cookie", setCookieHeader);
    headers.append("Set-Cookie", clearLegacyJwtCookieHeader);
    return json({ ok: true }, { status: 200, headers });
  }

  // everything below requires session auth
  const auth = await requireAuth(request, env.USERS_KV, env.DB);
  if (!auth) return errorJson(401, "Unauthorized");

  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    const { clearSessionCookieHeader } = await destroySession(env.DB, auth.sessionId);
    return json(
      { ok: true },
      {
        status: 200,
        headers: {
          "Set-Cookie": clearSessionCookieHeader,
        },
      }
    );
  }

  // --- Generate / Edit image ---
  if (url.pathname === "/api/generate/image" && request.method === "POST") {
    const bodyText = await request.text();
    const body = parseJsonSafe<{
      action?: "generate" | "edit";
      prompt?: string;
      count?: number;
      stream?: boolean;
      imageConfig?: ImageConfig;
      images?: ClientImageRef[];
      mask?: ClientImageRef;
    }>(bodyText);
    const prompt = (body?.prompt ?? "").trim();
    if (!prompt) return errorJson(400, "Missing prompt");

    const action = body?.action ?? "generate";
    const requestedCount = Number(body?.count ?? 1);
    const count = Math.max(1, Math.min(5, Number.isFinite(requestedCount) ? Math.floor(requestedCount) : 1));
    const wantStream = body?.stream === true || (request.headers.get("Accept") || "").includes("text/event-stream");

    let base64Images: ImageInputBase64[] | null = null;
    let mask: ImageInputBase64 | undefined;
    if (action === "edit") {
      const images = body?.images ?? [];
      if (images.length === 0) return errorJson(400, "Missing images for edit");
      base64Images = await Promise.all(images.map((r) => clientRefToBase64(env, auth.userKey, r)));
      mask = body?.mask ? await clientRefToBase64(env, auth.userKey, body.mask) : undefined;
    }

    // Streaming mode: send each generated image as soon as it's ready.
    if (wantStream) {
      const encoder = new TextEncoder();
      const headers = new Headers();
      headers.set("Content-Type", "text/event-stream; charset=utf-8");
      headers.set("Cache-Control", "no-cache");
      headers.set("Connection", "keep-alive");

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: string, data: unknown) => {
            controller.enqueue(encoder.encode(`event: ${event}\n`));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          };

          let produced = 0;
          let lastTextResponse: string | null = null;

          try {
            send("start", { ok: true, requested: count });

            for (let i = 0; i < count; i++) {
              const result =
                action === "edit"
                  ? await geminiEditImage({
                      apiKey: env.GEMINI_API_KEY,
                      baseUrl: env.BASE_URL,
                      prompt,
                      images: base64Images!,
                      mask,
                      imageConfig: body?.imageConfig,
                    })
                  : await geminiGenerateImageFromText({
                      apiKey: env.GEMINI_API_KEY,
                      baseUrl: env.BASE_URL,
                      prompt,
                      imageConfig: body?.imageConfig,
                    });

              lastTextResponse = result.textResponse ?? lastTextResponse;

              if (!result.newImageBase64 || !result.newImageMimeType) {
                send("skip", { index: i, textResponse: result.textResponse });
                continue;
              }

              const id = crypto.randomUUID();
              const bytes = decodeBase64ToUint8Array(result.newImageBase64);
              const mime = result.newImageMimeType;
              const r2Key = `${auth.userKey}/${id}.${extFromMime(mime)}`;
              await env.MEDIA_BUCKET.put(r2Key, bytes, { httpMetadata: { contentType: mime } });

              await insertHistory(env.DB, {
                id,
                user_key: auth.userKey,
                kind: "image",
                prompt,
                created_at: Date.now(),
                r2_key: r2Key,
                mime_type: mime,
                extra_json: result.textResponse ? JSON.stringify({ textResponse: result.textResponse }) : null,
              });

              produced++;
              send("item", { mediaId: id, mediaUrl: mediaUrl(id), mimeType: mime, textResponse: result.textResponse, index: i });
            }

            send("done", { ok: produced > 0, produced, textResponse: lastTextResponse });
          } catch (e) {
            send("error", { message: e instanceof Error ? e.message : "Unknown error" });
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, { status: 200, headers });
    }

    // Non-streaming mode (legacy): collect all and return once.
    const items: Array<{ mediaId: string; mediaUrl: string; mimeType: string; textResponse: string | null }> = [];
    let lastTextResponse: string | null = null;

    for (let i = 0; i < count; i++) {
      const result =
        action === "edit"
          ? await geminiEditImage({
              apiKey: env.GEMINI_API_KEY,
              baseUrl: env.BASE_URL,
              prompt,
              images: base64Images!,
              mask,
              imageConfig: body?.imageConfig,
            })
          : await geminiGenerateImageFromText({
              apiKey: env.GEMINI_API_KEY,
              baseUrl: env.BASE_URL,
              prompt,
              imageConfig: body?.imageConfig,
            });

      lastTextResponse = result.textResponse ?? lastTextResponse;
      if (!result.newImageBase64 || !result.newImageMimeType) continue;

      const id = crypto.randomUUID();
      const bytes = decodeBase64ToUint8Array(result.newImageBase64);
      const mime = result.newImageMimeType;
      const r2Key = `${auth.userKey}/${id}.${extFromMime(mime)}`;
      await env.MEDIA_BUCKET.put(r2Key, bytes, { httpMetadata: { contentType: mime } });

      await insertHistory(env.DB, {
        id,
        user_key: auth.userKey,
        kind: "image",
        prompt,
        created_at: Date.now(),
        r2_key: r2Key,
        mime_type: mime,
        extra_json: result.textResponse ? JSON.stringify({ textResponse: result.textResponse }) : null,
      });

      items.push({ mediaId: id, mediaUrl: mediaUrl(id), mimeType: mime, textResponse: result.textResponse });
    }

    if (items.length === 0) return json({ ok: false, textResponse: lastTextResponse }, { status: 200 });
    return json({ ok: true, items }, { status: 200 });
  }

  // --- Video start ---
  if (url.pathname === "/api/video/start" && request.method === "POST") {
    const bodyText = await request.text();
    const body = parseJsonSafe<{
      prompt?: string;
      aspectRatio?: "16:9" | "9:16";
      image?: ClientImageRef;
    }>(bodyText);
    const prompt = (body?.prompt ?? "").trim();
    if (!prompt) return errorJson(400, "Missing prompt");
    const aspectRatio = body?.aspectRatio ?? "16:9";
    const image = body?.image ? await clientRefToBase64(env, auth.userKey, body.image) : undefined;

    const { operationName } = await geminiVideoStart({
      apiKey: env.GEMINI_API_KEY,
      baseUrl: env.BASE_URL,
      prompt,
      aspectRatio,
      image,
    });

    await env.USERS_KV.put(
      `videoop:${operationName}`,
      JSON.stringify({ userKey: auth.userKey, prompt }),
      { expirationTtl: 60 * 60 * 24 } // 24h
    );

    return json({ ok: true, operationName });
  }

  // --- Video status (and finalize to R2 when done) ---
  if (url.pathname === "/api/video/status" && request.method === "GET") {
    const operationName = url.searchParams.get("name");
    if (!operationName) return errorJson(400, "Missing name");

    const opMetaRaw = await env.USERS_KV.get(`videoop:${operationName}`);
    const opMeta = opMetaRaw ? parseJsonSafe<{ userKey: string; prompt: string }>(opMetaRaw) : null;
    if (!opMeta || opMeta.userKey !== auth.userKey) return errorJson(404, "Operation not found");

    const status = await geminiVideoStatus({ apiKey: env.GEMINI_API_KEY, baseUrl: env.BASE_URL, operationName });
    if (!status.done) return json({ ok: true, done: false });
    if (status.error) return json({ ok: true, done: true, error: status.error.message });

    const downloadLink = status.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
    if (!downloadLink) return errorJson(500, "No download link found");

    const videoRes = await fetch(downloadLink, {
      headers: { "x-goog-api-key": env.GEMINI_API_KEY },
    });
    if (!videoRes.ok) return errorJson(500, `Failed to download video: ${videoRes.statusText}`);

    const mimeType = videoRes.headers.get("Content-Type") || "video/mp4";
    const buf = new Uint8Array(await videoRes.arrayBuffer());

    const id = crypto.randomUUID();
    const r2Key = `${auth.userKey}/${id}.${extFromMime(mimeType)}`;
    await env.MEDIA_BUCKET.put(r2Key, buf, { httpMetadata: { contentType: mimeType } });

    await insertHistory(env.DB, {
      id,
      user_key: auth.userKey,
      kind: "video",
      prompt: opMeta.prompt,
      created_at: Date.now(),
      r2_key: r2Key,
      mime_type: mimeType,
    });

    await env.USERS_KV.delete(`videoop:${operationName}`);

    return json({ ok: true, done: true, mediaId: id, mediaUrl: mediaUrl(id), mimeType });
  }

  // --- History list ---
  if (url.pathname === "/api/history" && request.method === "GET") {
    const limit = Number(url.searchParams.get("limit") ?? "20");
    const cursor = url.searchParams.get("cursor");
    const page = await listHistory(env.DB, auth.userKey, limit, cursor);
    return json({ ok: true, ...page });
  }

  // --- History delete ---
  if (url.pathname.startsWith("/api/history/") && request.method === "DELETE") {
    const id = url.pathname.slice("/api/history/".length);
    if (!id) return errorJson(400, "Missing id");
    const row = await deleteHistoryById(env.DB, id);
    if (!row || row.user_key !== auth.userKey) return errorJson(404, "Not found");
    await env.MEDIA_BUCKET.delete(row.r2_key);
    return json({ ok: true });
  }

  // --- Media stream ---
  if (url.pathname.startsWith("/api/media/") && request.method === "GET") {
    const id = url.pathname.slice("/api/media/".length);
    if (!id) return errorJson(400, "Missing id");
    const row = await getHistoryById(env.DB, id);
    if (!row || row.user_key !== auth.userKey) return errorJson(404, "Not found");
    // 若是 Range 请求（视频常见），先不做缓存以免缓存碎片；后续如需可扩展按 Range 处理。
    const rangeHeader = request.headers.get("Range");

    // IMPORTANT: 缓存必须在鉴权通过且确认 media 属于当前用户后才可用，避免跨用户泄漏。
    // 这里用“无 Cookie 的 URL 请求”作为 cache key，确保同一资源可被边缘复用。
    const cacheKey = new Request(url.toString(), { method: "GET" });
    const cache = caches.default;

    if (!rangeHeader) {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    }

    const obj = await env.MEDIA_BUCKET.get(row.r2_key);
    if (!obj) return errorJson(404, "Not found");

    const etag = (obj as unknown as { etag?: string }).etag;
    const ifNoneMatch = request.headers.get("If-None-Match");

    const headers = new Headers();
    headers.set("Content-Type", row.mime_type);
    headers.set("Accept-Ranges", "bytes");
    // mediaId 基本不可变：允许边缘缓存，显著降低中国访问时的回源与跨地域读取开销
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    if (etag) headers.set("ETag", etag);

    if (etag && ifNoneMatch && ifNoneMatch === etag) {
      return new Response(null, { status: 304, headers });
    }

    const res = new Response(obj.body, { status: 200, headers });
    if (!rangeHeader) {
      // clone() 以便同时返回给客户端并写入边缘缓存
      await cache.put(cacheKey, res.clone());
    }
    return res;
  }

  return errorJson(404, "Not Found");
}


