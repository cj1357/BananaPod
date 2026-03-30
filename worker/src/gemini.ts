const DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-image-preview";
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

function buildImageGenerationBody(parts: GeminiPart[], imageConfig?: ImageConfig): string {
  const vertexImageConfig: Record<string, unknown> = {};
  if (imageConfig?.imageSize) {
    vertexImageConfig.imageSize = imageConfig.imageSize;
  }
  if (imageConfig?.aspectRatio && imageConfig.aspectRatio !== "auto") {
    vertexImageConfig.aspectRatio = imageConfig.aspectRatio;
  }
  vertexImageConfig.imageOutputOptions = {
    mimeType: "image/png",
  };
  vertexImageConfig.personGeneration = "ALLOW_ALL";

  const body: Record<string, unknown> = {
    contents: [
      {
        role: "user",
        parts,
      },
    ],
    generationConfig: {
      temperature: 1,
      maxOutputTokens: 32768,
      responseModalities: ["IMAGE"],
      topP: 0.9,
    },
  };

  if (Object.keys(vertexImageConfig).length > 0) {
    (body.generationConfig as Record<string, unknown>).imageConfig = vertexImageConfig;
  }

  body.safetySettings = [
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
  ];

  return JSON.stringify(body);
}

async function parseGenerateContentResponse(response: Response): Promise<GeminiResponse[]> {
  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`Vertex generateContent failed: ${response.status} ${response.statusText} - ${rawText}`);
  }

  const trimmed = rawText.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed) as GeminiResponse | GeminiResponse[];
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    try {
      // Fast path for valid NDJSON or concatenated JSON objects (often returned un-streamed by Vertex if chunked)
      // We replace `}\n{` boundaries with `},{` and wrap the whole thing in an array bracket to form a valid JSON array.
      const normalized = `[${trimmed.replace(/}\s*\n\s*(?=\{)/g, "},")}]`;
      const parsed = JSON.parse(normalized) as GeminiResponse[];
      return parsed;
    } catch {
      throw new Error(`Unable to parse Vertex generateContent response: ${trimmed.slice(0, 1000)}`);
    }
  }
}

// ── Core request function ──

async function requestImageGeneration(opts: {
  accessToken: string;
  projectId: string;
  model: string;
  parts: GeminiPart[];
  imageConfig?: ImageConfig;
}): Promise<GeminiResponse[]> {
  const url = buildVertexUrl(opts.projectId, `${opts.model}:generateContent`);
  const headers = buildBearerHeaders(opts.accessToken);
  const response = await fetchWithRetry(url, {
    method: "POST",
    headers,
    body: buildImageGenerationBody(opts.parts, opts.imageConfig),
  });
  return await parseGenerateContentResponse(response);
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
  accessToken: string;
  projectId: string;
  prompt: string;
  imageModel?: string;
  imageConfig?: ImageConfig;
}): Promise<{ newImageBase64: string | null; newImageMimeType: string | null; textResponse: string | null }> {
  const model = opts.imageModel || DEFAULT_IMAGE_MODEL;
  return extractImageResponse(await requestImageGeneration({
    accessToken: opts.accessToken,
    projectId: opts.projectId,
    model,
    parts: [{ text: opts.prompt }],
    imageConfig: opts.imageConfig,
  }));
}

export async function geminiEditImage(opts: {
  accessToken: string;
  projectId: string;
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
  return extractImageResponse(await requestImageGeneration({
    accessToken: opts.accessToken,
    projectId: opts.projectId,
    model,
    parts,
    imageConfig: opts.imageConfig,
  }));
}

export async function geminiAnalyzeImage(opts: {
  accessToken: string;
  projectId: string;
  prompt: string;
  image: ImageInputBase64;
  imageModel?: string;
}): Promise<{ textResponse: string }> {
  const model = opts.imageModel || "gemini-3.1-pro-preview";
  const url = buildVertexUrl(opts.projectId, `${model}:generateContent`);
  const headers = buildBearerHeaders(opts.accessToken);

  const body = JSON.stringify({
    contents: [{
      role: "user",
      parts: [
        { inlineData: { data: opts.image.base64, mimeType: opts.image.mimeType } },
        { text: opts.prompt },
      ],
    }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 4096,
      responseModalities: ["TEXT"],
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
    ],
  });

  const response = await fetchWithRetry(url, { method: "POST", headers, body });
  const responses = await parseGenerateContentResponse(response);

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
