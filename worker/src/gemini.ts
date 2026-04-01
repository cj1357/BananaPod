const DEFAULT_IMAGE_MODEL = "google/gemini-3.1-flash-image-preview";
const VIDEO_MODEL = "veo-3.1-generate-preview";

type ImageAspectRatio = "auto" | "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "4:5" | "5:4" | "9:16" | "16:9" | "21:9";
type ImageSize = "1K" | "2K" | "4K";

export type ImageConfig = {
  aspectRatio?: ImageAspectRatio;
  imageSize?: ImageSize;
};

export type ImageInputBase64 = {
  base64: string; // raw base64, not dataURL
  mimeType: string;
};

type GeminiPart =
  | { text: string }
  | {
    inlineData: {
      mimeType: string;
      data: string;
    };
  };

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> };
    finishReason?: string;
  }>;
  error?: { message?: string };
};

type VideoOperationResponse = {
  name?: string;
  done?: boolean;
  error?: { message: string };
  response?: {
    generateVideoResponse?: {
      generatedSamples?: Array<{ video?: { uri?: string } }>;
    };
    videos?: Array<{ uri?: string; gcsUri?: string; mimeType?: string }>;
  };
};

// ── URL / Headers (Standard Mode: global endpoint + Bearer token) ──

function buildVertexUrl(projectId: string, modelPath: string): string {
  // Global 端点: https://aiplatform.googleapis.com/v1/projects/{PROJECT}/locations/global/publishers/google/models/{MODEL}:{METHOD}
  return `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/global/publishers/google/models/${modelPath}`;
}

function buildBearerHeaders(accessToken: string): HeadersInit {
  return {
    "Authorization": `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

// ── Retry with exponential backoff (for 429 / 503) ──

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000; // 2s → 4s → 8s

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(input: RequestInfo, init?: RequestInit): Promise<Response> {
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(input, init);

    // Only retry on 429 (rate limit) or 503 (overloaded)
    if (response.status !== 429 && response.status !== 503) {
      return response;
    }

    lastResponse = response;

    if (attempt < MAX_RETRIES) {
      // Use Retry-After header if provided, otherwise exponential backoff
      const retryAfter = response.headers.get("Retry-After");
      let delayMs: number;
      if (retryAfter && !isNaN(Number(retryAfter))) {
        delayMs = Number(retryAfter) * 1000;
      } else {
        delayMs = BASE_DELAY_MS * Math.pow(2, attempt);
      }
      // Add jitter (±25%)
      delayMs = delayMs * (0.75 + Math.random() * 0.5);
      console.log(`[Vertex AI] ${response.status} rate limited, retry ${attempt + 1}/${MAX_RETRIES} after ${Math.round(delayMs)}ms`);
      await sleep(delayMs);
    }
  }

  return lastResponse!;
}

// ── Request body builders ──

// ── OpenRouter request helpers ──

type OpenRouterContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

function buildOpenRouterImageBody(model: string, parts: GeminiPart[], imageConfig?: ImageConfig): string {
  const openRouterParts: OpenRouterContentPart[] = parts.map(p => {
    if ("text" in p) {
      return { type: "text", text: p.text };
    } else {
      return { type: "image_url", image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } };
    }
  });

  const body: Record<string, unknown> = {
    model,
    messages: [
      {
        role: "user",
        // Only one part if it's text, otherwise array of parts
        content: openRouterParts.length === 1 && openRouterParts[0].type === "text" 
          ? openRouterParts[0].text 
          : openRouterParts,
      },
    ],
    provider: {
      only: ["google"],
    },
  };

  const orImageConfig: Record<string, unknown> = {};
  if (imageConfig?.imageSize) orImageConfig.image_size = imageConfig.imageSize;
  if (imageConfig?.aspectRatio && imageConfig.aspectRatio !== "auto") orImageConfig.aspect_ratio = imageConfig.aspectRatio;

  if (Object.keys(orImageConfig).length > 0) {
    body.image_config = orImageConfig;
  }
  
  body.modalities = ["image", "text"];

  return JSON.stringify(body);
}

async function parseOpenRouterResponse(response: Response): Promise<GeminiResponse[]> {
  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`OpenRouter API failed: ${response.status} ${response.statusText} - ${rawText}`);
  }

  const data = JSON.parse(rawText);
  const choice = data.choices?.[0];
  const message = choice?.message;
  
  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
  
  if (message?.content) {
    parts.push({ text: message.content });
  }
  
  if (message?.images && Array.isArray(message.images)) {
    for (const img of message.images) {
      const dataUrl = img.image_url?.url || "";
      if (dataUrl.startsWith("data:image/")) {
        const matches = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          parts.push({
            inlineData: {
              mimeType: matches[1],
              data: matches[2]
            }
          });
        }
      }
    }
  }

  return [
    {
      candidates: [
        {
          content: { parts },
          finishReason: choice?.finish_reason,
        }
      ]
    }
  ];
}

// ── Core request function ──

async function requestOpenRouterImageGeneration(opts: {
  openRouterApiKey: string;
  apiEndpoint?: string;
  model: string;
  parts: GeminiPart[];
  imageConfig?: ImageConfig;
}): Promise<GeminiResponse[]> {
  const url = opts.apiEndpoint ? `https://${opts.apiEndpoint}/v1/chat/completions` : "https://openrouter.ai/api/v1/chat/completions";
  const headers = {
    "Authorization": `Bearer ${opts.openRouterApiKey}`,
    "Content-Type": "application/json",
  };
  const response = await fetchWithRetry(url, {
    method: "POST",
    headers,
    body: buildOpenRouterImageBody(opts.model, opts.parts, opts.imageConfig),
  });
  return await parseOpenRouterResponse(response);
}

function extractImageResponse(responses: GeminiResponse[]): {
  newImageBase64: string | null;
  newImageMimeType: string | null;
  textResponse: string | null;
} {
  let newImageBase64: string | null = null;
  let newImageMimeType: string | null = null;
  const textParts: string[] = [];
  let blockedReason: string | null = null;

  for (const response of responses) {
    if (response.error?.message) {
      throw new Error(response.error.message);
    }

    const candidate = response.candidates?.[0];
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.inlineData?.data) {
          newImageBase64 = part.inlineData.data;
          newImageMimeType = part.inlineData.mimeType;
        } else if (part.text) {
          textParts.push(part.text);
        }
      }
      continue;
    }

    if (candidate?.finishReason) {
      blockedReason = `The AI response was blocked or did not contain content. (Reason: ${candidate.finishReason})`;
    }
  }

  const textResponse = textParts.join("\n").trim() || blockedReason;
  if (!newImageBase64) {
    return {
      newImageBase64: null,
      newImageMimeType: null,
      textResponse: textResponse || "The AI did not generate an image. Please try a different prompt.",
    };
  }

  return { newImageBase64, newImageMimeType, textResponse: textResponse || null };
}

// ── Exported API functions ──

export async function geminiGenerateImageFromText(opts: {
  openRouterApiKey: string;
  apiEndpoint?: string;
  prompt: string;
  imageModel?: string;
  imageConfig?: ImageConfig;
}): Promise<{ newImageBase64: string | null; newImageMimeType: string | null; textResponse: string | null }> {
  const model = opts.imageModel || DEFAULT_IMAGE_MODEL;
  return extractImageResponse(await requestOpenRouterImageGeneration({
    openRouterApiKey: opts.openRouterApiKey,
    apiEndpoint: opts.apiEndpoint,
    model,
    parts: [{ text: opts.prompt }],
    imageConfig: opts.imageConfig,
  }));
}

export async function geminiEditImage(opts: {
  openRouterApiKey: string;
  apiEndpoint?: string;
  prompt: string;
  images: ImageInputBase64[];
  mask?: ImageInputBase64;
  imageModel?: string;
  imageConfig?: ImageConfig;
}): Promise<{ newImageBase64: string | null; newImageMimeType: string | null; textResponse: string | null }> {
  const imageParts: GeminiPart[] = opts.images.map((img) => ({
    inlineData: { data: img.base64, mimeType: img.mimeType },
  }));
  const textPart: GeminiPart = { text: opts.prompt };
  const parts: GeminiPart[] = opts.mask
    ? [textPart, ...imageParts, { inlineData: { data: opts.mask.base64, mimeType: opts.mask.mimeType } }]
    : [...imageParts, textPart];

  const model = opts.imageModel || DEFAULT_IMAGE_MODEL;
  return extractImageResponse(await requestOpenRouterImageGeneration({
    openRouterApiKey: opts.openRouterApiKey,
    apiEndpoint: opts.apiEndpoint,
    model,
    parts,
    imageConfig: opts.imageConfig,
  }));
}

export async function geminiAnalyzeImage(opts: {
  openRouterApiKey: string;
  apiEndpoint?: string;
  prompt: string;
  image: ImageInputBase64;
  imageModel?: string;
}): Promise<{ textResponse: string }> {
  const model = opts.imageModel || "google/gemini-3.1-pro-preview";
  const url = opts.apiEndpoint ? `https://${opts.apiEndpoint}/v1/chat/completions` : "https://openrouter.ai/api/v1/chat/completions";
  const headers = {
    "Authorization": `Bearer ${opts.openRouterApiKey}`,
    "Content-Type": "application/json",
  };

  const body = JSON.stringify({
    model,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: opts.prompt },
        { type: "image_url", image_url: { url: `data:${opts.image.mimeType};base64,${opts.image.base64}` } }
      ],
    }],
    temperature: 0.4,
    provider: {
      only: ["google"],
    },
  });

  const response = await fetchWithRetry(url, { method: "POST", headers, body });
  const responses = await parseOpenRouterResponse(response);

  const textParts: string[] = [];
  for (const r of responses) {
    if (r.error?.message) throw new Error(r.error.message);
    for (const part of r.candidates?.[0]?.content?.parts ?? []) {
      if (part.text) textParts.push(part.text);
    }
  }

  return { textResponse: textParts.join("\n").trim() || "Unable to analyze the image." };
}

export async function geminiVideoStart(opts: {
  accessToken: string;
  projectId: string;
  prompt: string;
  aspectRatio: "16:9" | "9:16";
  image?: ImageInputBase64;
}): Promise<{ operationName: string }> {
  const instance: Record<string, unknown> = { prompt: opts.prompt };
  if (opts.image) {
    instance.image = {
      bytesBase64Encoded: opts.image.base64,
      mimeType: opts.image.mimeType,
    };
  }

  const url = buildVertexUrl(opts.projectId, `${VIDEO_MODEL}:predictLongRunning`);
  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: buildBearerHeaders(opts.accessToken),
    body: JSON.stringify({
      instances: [instance],
      parameters: { aspectRatio: opts.aspectRatio, sampleCount: 1 },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to start Vertex video generation: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = (await response.json()) as VideoOperationResponse;
  const operationName = data.name;
  if (!operationName) throw new Error("Failed to get operation name from video generation request.");
  return { operationName };
}

export async function geminiVideoStatus(opts: {
  accessToken: string;
  projectId: string;
  operationName: string;
}): Promise<VideoOperationResponse> {
  const url = buildVertexUrl(opts.projectId, `${VIDEO_MODEL}:fetchPredictOperation`);
  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: buildBearerHeaders(opts.accessToken),
    body: JSON.stringify({
      operationName: opts.operationName,
    }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to check Vertex video status: ${response.status} ${response.statusText} - ${errorText}`);
  }
  return (await response.json()) as VideoOperationResponse;
}
