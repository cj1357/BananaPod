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

export type GenerateImageItem = { mediaId: string; mediaUrl: string; mimeType: string; textResponse: string | null };

export type GenerateImageResult =
  | { ok: true; items: GenerateImageItem[] }
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

export async function generateImageFromText(prompt: string, imageConfig?: ImageConfig, count: number = 1): Promise<GenerateImageResult> {
  const res = await fetch("/api/generate/image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "generate", prompt, imageConfig, count }),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as GenerateImageResult;
}

type SSEEvent =
  | { event: "start"; data: { ok: boolean; requested: number } }
  | { event: "item"; data: GenerateImageItem & { index?: number } }
  | { event: "skip"; data: { index: number; textResponse: string | null } }
  | { event: "done"; data: { ok: boolean; produced: number; textResponse: string | null } }
  | { event: "error"; data: { message: string } };

async function consumeSSE(res: Response, onEvent: (evt: SSEEvent) => void): Promise<void> {
  if (!res.body) throw new Error("No response body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const flush = () => {
    // events are separated by blank line
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";
    for (const raw of parts) {
      const lines = raw.split("\n");
      let eventName = "message";
      const dataLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      const dataStr = dataLines.join("\n");
      if (!dataStr) continue;
      const data = JSON.parse(dataStr);
      onEvent({ event: eventName as any, data } as SSEEvent);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    flush();
  }
  buffer += decoder.decode();
  flush();
}

export async function generateImageFromTextStream(
  prompt: string,
  imageConfig: ImageConfig | undefined,
  count: number,
  onItem: (item: GenerateImageItem) => void,
  onProgress?: (produced: number, requested: number) => void
): Promise<{ produced: number; textResponse: string | null }> {
  const res = await fetch("/api/generate/image", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ action: "generate", prompt, imageConfig, count, stream: true }),
  });
  if (!res.ok) throw new Error(await res.text());
  let produced = 0;
  let requested = count;
  let lastText: string | null = null;

  await consumeSSE(res, (evt) => {
    if (evt.event === "start") requested = evt.data.requested;
    if (evt.event === "item") {
      produced += 1;
      onProgress?.(produced, requested);
      onItem(evt.data);
    }
    if (evt.event === "done") lastText = evt.data.textResponse;
    if (evt.event === "error") throw new Error(evt.data.message);
  });

  return { produced, textResponse: lastText };
}

export async function editImageStream(
  prompt: string,
  images: ClientImageRef[],
  mask: ClientImageRef | undefined,
  imageConfig: ImageConfig | undefined,
  count: number,
  onItem: (item: GenerateImageItem) => void,
  onProgress?: (produced: number, requested: number) => void
): Promise<{ produced: number; textResponse: string | null }> {
  const res = await fetch("/api/generate/image", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ action: "edit", prompt, images, mask, imageConfig, count, stream: true }),
  });
  if (!res.ok) throw new Error(await res.text());
  let produced = 0;
  let requested = count;
  let lastText: string | null = null;

  await consumeSSE(res, (evt) => {
    if (evt.event === "start") requested = evt.data.requested;
    if (evt.event === "item") {
      produced += 1;
      onProgress?.(produced, requested);
      onItem(evt.data);
    }
    if (evt.event === "done") lastText = evt.data.textResponse;
    if (evt.event === "error") throw new Error(evt.data.message);
  });

  return { produced, textResponse: lastText };
}

export async function editImage(
  prompt: string,
  images: ClientImageRef[],
  mask?: ClientImageRef,
  imageConfig?: ImageConfig,
  count: number = 1
): Promise<GenerateImageResult> {
  const res = await fetch("/api/generate/image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "edit", prompt, images, mask, imageConfig, count }),
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


