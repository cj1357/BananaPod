const DEFAULT_BASE_URL = "https://vertex.lordorange.top";
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

const IMAGE_SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
] as const;

function buildVertexUrl(baseUrl: string, path: string, apiKey: string): string {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL(path.replace(/^\//, ""), normalizedBaseUrl);
  url.searchParams.set("key", apiKey);
  return url.toString();
}

function buildImageGenerationBody(parts: GeminiPart[], imageConfig?: ImageConfig): string {
  return JSON.stringify({
    contents: [
      {
        role: "user",
        parts,
      },
    ],
    generationConfig: {
      temperature: 1,
      maxOutputTokens: 32768,
      responseModalities: ["TEXT", "IMAGE"],
      topP: 0.95,
      imageConfig: {
        aspectRatio: imageConfig?.aspectRatio ?? "auto",
        ...(imageConfig?.imageSize && { imageSize: imageConfig.imageSize }),
        imageOutputOptions: {
          mimeType: "image/png",
        },
        personGeneration: "ALLOW_ALL",
      },
      thinkingConfig: {
        thinkingLevel: "HIGH",
      },
    },
    safetySettings: IMAGE_SAFETY_SETTINGS,
  });
}

function splitTopLevelJsonObjects(rawText: string): string[] {
  const objects: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < rawText.length; i++) {
    const ch = rawText[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
      continue;
    }

    if (ch === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        objects.push(rawText.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return objects;
}

async function parseStreamGenerateContentResponse(response: Response): Promise<GeminiResponse[]> {
  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`Vertex streamGenerateContent failed: ${response.status} ${response.statusText} - ${rawText}`);
  }

  const trimmed = rawText.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed) as GeminiResponse | GeminiResponse[];
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    const chunks = splitTopLevelJsonObjects(trimmed);
    if (chunks.length > 0) {
      return chunks.map((chunk) => JSON.parse(chunk) as GeminiResponse);
    }
    throw new Error(`Unable to parse Vertex streamGenerateContent response: ${trimmed.slice(0, 1000)}`);
  }
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

export async function geminiGenerateImageFromText(opts: {
  apiKey: string;
  baseUrl?: string;
  prompt: string;
  imageModel?: string;
  imageConfig?: ImageConfig;
}): Promise<{ newImageBase64: string | null; newImageMimeType: string | null; textResponse: string | null }> {
  const baseUrl = opts.baseUrl || DEFAULT_BASE_URL;
  const model = opts.imageModel || DEFAULT_IMAGE_MODEL;
  const response = await fetch(
    buildVertexUrl(baseUrl, `v1/publishers/google/models/${model}:streamGenerateContent`, opts.apiKey),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: buildImageGenerationBody([{ text: opts.prompt }], opts.imageConfig),
    }
  );

  return extractImageResponse(await parseStreamGenerateContentResponse(response));
}

export async function geminiEditImage(opts: {
  apiKey: string;
  baseUrl?: string;
  prompt: string;
  images: ImageInputBase64[];
  mask?: ImageInputBase64;
  imageModel?: string;
  imageConfig?: ImageConfig;
}): Promise<{ newImageBase64: string | null; newImageMimeType: string | null; textResponse: string | null }> {
  const baseUrl = opts.baseUrl || DEFAULT_BASE_URL;
  const imageParts: GeminiPart[] = opts.images.map((img) => ({
    inlineData: { data: img.base64, mimeType: img.mimeType },
  }));
  const textPart: GeminiPart = { text: opts.prompt };
  const parts: GeminiPart[] = opts.mask
    ? [textPart, ...imageParts, { inlineData: { data: opts.mask.base64, mimeType: opts.mask.mimeType } }]
    : [...imageParts, textPart];

  const model = opts.imageModel || DEFAULT_IMAGE_MODEL;
  const response = await fetch(
    buildVertexUrl(baseUrl, `v1/publishers/google/models/${model}:streamGenerateContent`, opts.apiKey),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: buildImageGenerationBody(parts, opts.imageConfig),
    }
  );

  return extractImageResponse(await parseStreamGenerateContentResponse(response));
}

export async function geminiVideoStart(opts: {
  apiKey: string;
  baseUrl?: string;
  prompt: string;
  aspectRatio: "16:9" | "9:16";
  image?: ImageInputBase64;
}): Promise<{ operationName: string }> {
  const baseUrl = opts.baseUrl || DEFAULT_BASE_URL;
  const instance: Record<string, unknown> = { prompt: opts.prompt };
  if (opts.image) {
    instance.image = {
      bytesBase64Encoded: opts.image.base64,
      mimeType: opts.image.mimeType,
    };
  }

  const response = await fetch(
    buildVertexUrl(baseUrl, `v1/publishers/google/models/${VIDEO_MODEL}:predictLongRunning`, opts.apiKey),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instances: [instance],
        parameters: { aspectRatio: opts.aspectRatio, sampleCount: 1 },
      }),
    }
  );

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
  apiKey: string;
  baseUrl?: string;
  operationName: string;
}): Promise<VideoOperationResponse> {
  const baseUrl = opts.baseUrl || DEFAULT_BASE_URL;
  const response = await fetch(
    buildVertexUrl(baseUrl, `v1/publishers/google/models/${VIDEO_MODEL}:fetchPredictOperation`, opts.apiKey),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        operationName: opts.operationName,
      }),
    }
  );
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to check Vertex video status: ${response.status} ${response.statusText} - ${errorText}`);
  }
  return (await response.json()) as VideoOperationResponse;
}


