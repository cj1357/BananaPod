const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";
const IMAGE_MODEL = "gemini-3-pro-image-preview";
const VIDEO_MODEL = "veo-3.1-generate-preview";

type ImageAspectRatio = "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "4:5" | "5:4" | "9:16" | "16:9" | "21:9";
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
};

export async function geminiGenerateImageFromText(opts: {
  apiKey: string;
  baseUrl?: string;
  prompt: string;
  imageConfig?: ImageConfig;
}): Promise<{ newImageBase64: string | null; newImageMimeType: string | null; textResponse: string | null }> {
  const baseUrl = opts.baseUrl || DEFAULT_BASE_URL;
  const response = await fetch(`${baseUrl}/v1beta/models/${IMAGE_MODEL}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": opts.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: opts.prompt }] }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        ...(opts.imageConfig && {
          imageConfig: {
            ...(opts.imageConfig.aspectRatio && { aspectRatio: opts.imageConfig.aspectRatio }),
            ...(opts.imageConfig.imageSize && { imageSize: opts.imageConfig.imageSize }),
          },
        }),
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini generateContent failed: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = (await response.json()) as GeminiResponse;
  return extractImageResponse(data);
}

export async function geminiEditImage(opts: {
  apiKey: string;
  baseUrl?: string;
  prompt: string;
  images: ImageInputBase64[];
  mask?: ImageInputBase64;
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

  const response = await fetch(`${baseUrl}/v1beta/models/${IMAGE_MODEL}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": opts.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        ...(opts.imageConfig && {
          imageConfig: {
            ...(opts.imageConfig.aspectRatio && { aspectRatio: opts.imageConfig.aspectRatio }),
            ...(opts.imageConfig.imageSize && { imageSize: opts.imageConfig.imageSize }),
          },
        }),
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini generateContent failed: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = (await response.json()) as GeminiResponse;
  return extractImageResponse(data);
}

function extractImageResponse(data: GeminiResponse): {
  newImageBase64: string | null;
  newImageMimeType: string | null;
  textResponse: string | null;
} {
  let newImageBase64: string | null = null;
  let newImageMimeType: string | null = null;
  let textResponse: string | null = null;

  if (data.candidates && data.candidates.length > 0 && data.candidates[0].content) {
    const parts = data.candidates[0].content.parts;
    for (const part of parts) {
      if (part.inlineData) {
        newImageBase64 = part.inlineData.data;
        newImageMimeType = part.inlineData.mimeType;
      } else if (part.text) {
        textResponse = part.text;
      }
    }
  } else {
    textResponse = "The AI response was blocked or did not contain content.";
    if (data.candidates && data.candidates.length > 0 && data.candidates[0].finishReason) {
      textResponse += ` (Reason: ${data.candidates[0].finishReason})`;
    }
  }

  if (!newImageBase64) {
    return {
      newImageBase64: null,
      newImageMimeType: null,
      textResponse: textResponse || "The AI did not generate an image. Please try a different prompt.",
    };
  }

  return { newImageBase64, newImageMimeType, textResponse };
}

type VideoOperationResponse = {
  name?: string;
  done?: boolean;
  error?: { message: string };
  response?: {
    generateVideoResponse?: {
      generatedSamples?: Array<{ video?: { uri?: string } }>;
    };
  };
};

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

  const response = await fetch(`${baseUrl}/v1beta/models/${VIDEO_MODEL}:predictLongRunning`, {
    method: "POST",
    headers: {
      "x-goog-api-key": opts.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      instances: [instance],
      parameters: { aspectRatio: opts.aspectRatio, sampleCount: 1 },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to start video generation: ${response.status} ${response.statusText} - ${errorText}`);
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
  const response = await fetch(`${baseUrl}/v1beta/${opts.operationName}`, {
    method: "GET",
    headers: { "x-goog-api-key": opts.apiKey },
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to check video status: ${response.status} ${response.statusText} - ${errorText}`);
  }
  return (await response.json()) as VideoOperationResponse;
}


