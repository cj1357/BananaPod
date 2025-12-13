export type GenerationMode = "image" | "video";
export type ImageAspectRatio = "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "4:5" | "5:4" | "9:16" | "16:9" | "21:9";
export type ImageSize = "1K" | "2K" | "4K";

export type ImageConfig = {
  aspectRatio?: ImageAspectRatio;
  imageSize?: ImageSize;
};

export type ClientImageRef =
  | { kind: "dataUrl"; dataUrl: string; mimeType: string }
  | { kind: "mediaId"; mediaId: string };

export type GenerateImageResult =
  | { ok: true; mediaId: string; mediaUrl: string; mimeType: string; textResponse: string | null }
  | { ok: false; textResponse: string | null };

export async function authCheck(userKey: string): Promise<void> {
  const res = await fetch("/api/auth/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userKey }),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function authLogout(): Promise<void> {
  const res = await fetch("/api/auth/logout", { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
}

export async function generateImageFromText(prompt: string, imageConfig?: ImageConfig): Promise<GenerateImageResult> {
  const res = await fetch("/api/generate/image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "generate", prompt, imageConfig }),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as GenerateImageResult;
}

export async function editImage(
  prompt: string,
  images: ClientImageRef[],
  mask?: ClientImageRef,
  imageConfig?: ImageConfig
): Promise<GenerateImageResult> {
  const res = await fetch("/api/generate/image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "edit", prompt, images, mask, imageConfig }),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as GenerateImageResult;
}

export async function videoStart(prompt: string, aspectRatio: "16:9" | "9:16", image?: ClientImageRef): Promise<{ operationName: string }> {
  const res = await fetch("/api/video/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, aspectRatio, image }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { ok: boolean; operationName: string };
  if (!data.operationName) throw new Error("Missing operationName");
  return { operationName: data.operationName };
}

export async function videoStatus(operationName: string): Promise<
  | { ok: true; done: false }
  | { ok: true; done: true; mediaId?: string; mediaUrl?: string; mimeType?: string; error?: string }
> {
  const res = await fetch(`/api/video/status?name=${encodeURIComponent(operationName)}`);
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as any;
}

export type HistoryItem = {
  id: string;
  kind: "image" | "video";
  prompt: string;
  created_at: number;
  mime_type: string;
};

export async function historyList(limit: number, cursor?: string | null): Promise<{ items: HistoryItem[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`/api/history?${params.toString()}`);
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { ok: boolean; items: HistoryItem[]; nextCursor: string | null };
  return { items: data.items, nextCursor: data.nextCursor };
}

export async function historyDelete(id: string): Promise<void> {
  const res = await fetch(`/api/history/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}


