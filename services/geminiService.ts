const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";
const IMAGE_MODEL = "gemini-3-pro-image-preview";
const VIDEO_MODEL = "veo-3.1-generate-preview";

// Default timeout: 5 minutes for image generation
const DEFAULT_TIMEOUT = 300000;

export interface ApiConfig {
  apiKey: string;
  baseUrl?: string;
}

// Fetch with timeout support
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeout: number = DEFAULT_TIMEOUT
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeout / 1000} seconds. Please try again.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

type ImageInput = {
  href: string;
  mimeType: string;
};

type ImageAspectRatio = '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9';
type ImageSize = '1K' | '2K' | '4K';

interface ImageConfig {
  aspectRatio?: ImageAspectRatio;
  imageSize?: ImageSize;
}

interface GeminiPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts: GeminiPart[];
    };
    finishReason?: string;
  }>;
}

interface VideoOperationResponse {
  name?: string;
  done?: boolean;
  error?: {
    message: string;
  };
  response?: {
    generateVideoResponse?: {
      generatedSamples?: Array<{
        video?: {
          uri?: string;
        };
      }>;
    };
  };
}

export async function editImage(
  apiConfig: ApiConfig,
  images: ImageInput[],
  prompt: string,
  mask?: ImageInput,
  imageConfig?: ImageConfig
): Promise<{ newImageBase64: string | null; newImageMimeType: string | null; textResponse: string | null }> {
  if (!apiConfig.apiKey) {
    throw new Error("API Key is not configured. Please set your API Key in Settings.");
  }

  const baseUrl = apiConfig.baseUrl || DEFAULT_BASE_URL;

  const imageParts: GeminiPart[] = images.map(image => {
    const dataUrlParts = image.href.split(',');
    const base64Data = dataUrlParts.length > 1 ? dataUrlParts[1] : dataUrlParts[0];
    return {
      inlineData: {
        data: base64Data,
        mimeType: image.mimeType,
      },
    };
  });

  const maskPart: GeminiPart | null = mask ? {
    inlineData: {
      data: mask.href.split(',')[1],
      mimeType: mask.mimeType,
    },
  } : null;

  const textPart: GeminiPart = { text: prompt };

  // For inpainting with a mask, the API expects: prompt, then image, then mask.
  const parts = maskPart
    ? [textPart, ...imageParts, maskPart]
    : [...imageParts, textPart];

  try {
    const response = await fetchWithTimeout(`${baseUrl}/v1beta/models/${IMAGE_MODEL}:generateContent`, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiConfig.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: parts,
        }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          ...(imageConfig && {
            imageConfig: {
              ...(imageConfig.aspectRatio && { aspectRatio: imageConfig.aspectRatio }),
              ...(imageConfig.imageSize && { imageSize: imageConfig.imageSize }),
            },
          }),
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data: GeminiResponse = await response.json();

    let newImageBase64: string | null = null;
    let newImageMimeType: string | null = null;
    let textResponse: string | null = null;

    if (data.candidates && data.candidates.length > 0 && data.candidates[0].content) {
      const responseParts = data.candidates[0].content.parts;
      for (const part of responseParts) {
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
      console.warn("API response did not contain an image part.", data);
      textResponse = textResponse || "The AI did not generate a new image. Please try a different prompt.";
    }

    return { newImageBase64, newImageMimeType, textResponse };
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    if (error instanceof Error) {
      throw new Error(`Gemini API Error: ${error.message}`);
    }
    throw new Error("An unknown error occurred while contacting the Gemini API.");
  }
}

export async function generateImageFromText(
  apiConfig: ApiConfig,
  prompt: string,
  imageConfig?: ImageConfig
): Promise<{ newImageBase64: string | null; newImageMimeType: string | null; textResponse: string | null }> {
  if (!apiConfig.apiKey) {
    throw new Error("API Key is not configured. Please set your API Key in Settings.");
  }

  const baseUrl = apiConfig.baseUrl || DEFAULT_BASE_URL;

  try {
    const response = await fetchWithTimeout(`${baseUrl}/v1beta/models/${IMAGE_MODEL}:generateContent`, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiConfig.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt }
          ],
        }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          ...(imageConfig && {
            imageConfig: {
              ...(imageConfig.aspectRatio && { aspectRatio: imageConfig.aspectRatio }),
              ...(imageConfig.imageSize && { imageSize: imageConfig.imageSize }),
            },
          }),
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data: GeminiResponse = await response.json();

    let newImageBase64: string | null = null;
    let newImageMimeType: string | null = null;
    let textResponse: string | null = null;

    if (data.candidates && data.candidates.length > 0 && data.candidates[0].content) {
      const responseParts = data.candidates[0].content.parts;
      for (const part of responseParts) {
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
        textResponse: textResponse || "The AI did not generate an image. Please try a different prompt."
      };
    }

    return { newImageBase64, newImageMimeType, textResponse };
  } catch (error) {
    console.error("Error calling Gemini API for text-to-image:", error);
    if (error instanceof Error) {
      throw new Error(`Gemini API Error: ${error.message}`);
    }
    throw new Error("An unknown error occurred while contacting the Gemini API.");
  }
}

export async function generateVideo(
  apiConfig: ApiConfig,
  prompt: string,
  aspectRatio: '16:9' | '9:16',
  onProgress: (message: string) => void,
  image?: ImageInput
): Promise<{ videoBlob: Blob; mimeType: string }> {
  if (!apiConfig.apiKey) {
    throw new Error("API Key is not configured. Please set your API Key in Settings.");
  }

  const baseUrl = apiConfig.baseUrl || DEFAULT_BASE_URL;

  onProgress('Initializing video generation...');

  // Build the instance object
  const instance: Record<string, unknown> = {
    prompt: prompt,
  };

  // Add image if provided (for image-to-video)
  if (image) {
    instance.image = {
      bytesBase64Encoded: image.href.split(',')[1],
      mimeType: image.mimeType,
    };
  }

  try {
    // Start video generation (long-running operation) - 60s timeout for initial request
    const startResponse = await fetchWithTimeout(`${baseUrl}/v1beta/models/${VIDEO_MODEL}:predictLongRunning`, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiConfig.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        instances: [instance],
        parameters: {
          aspectRatio: aspectRatio,
          sampleCount: 1,
        }
      }),
    }, 60000);

    if (!startResponse.ok) {
      const errorText = await startResponse.text();
      throw new Error(`Failed to start video generation: ${startResponse.status} ${startResponse.statusText} - ${errorText}`);
    }

    const startData: VideoOperationResponse = await startResponse.json();
    const operationName = startData.name;

    if (!operationName) {
      throw new Error("Failed to get operation name from video generation request.");
    }

    const progressMessages = [
      'Rendering frames...',
      'Compositing video...',
      'Applying final touches...',
      'Almost there...',
    ];
    let messageIndex = 0;

    onProgress('Generation started, this may take a few minutes.');

    // Poll for completion
    while (true) {
      onProgress(progressMessages[messageIndex % progressMessages.length]);
      messageIndex++;

      await new Promise(resolve => setTimeout(resolve, 10000));

      // 30s timeout for status checks
      const statusResponse = await fetchWithTimeout(`${baseUrl}/v1beta/${operationName}`, {
        method: 'GET',
        headers: {
          'x-goog-api-key': apiConfig.apiKey,
        },
      }, 30000);

      if (!statusResponse.ok) {
        const errorText = await statusResponse.text();
        throw new Error(`Failed to check video status: ${statusResponse.status} ${statusResponse.statusText} - ${errorText}`);
      }

      const statusData: VideoOperationResponse = await statusResponse.json();

      if (statusData.done) {
        if (statusData.error) {
          throw new Error(`Video generation failed: ${statusData.error.message}`);
        }

        const downloadLink = statusData.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
        if (!downloadLink) {
          throw new Error("Video generation completed, but no download link was found.");
        }

        onProgress('Downloading generated video...');
        
        // Download the video using the URI with API key - 5 minute timeout for video download
        const videoResponse = await fetchWithTimeout(downloadLink, {
          headers: {
            'x-goog-api-key': apiConfig.apiKey,
          },
        }, 300000);

        if (!videoResponse.ok) {
          throw new Error(`Failed to download video: ${videoResponse.statusText}`);
        }

        const videoBlob = await videoResponse.blob();
        const mimeType = videoResponse.headers.get('Content-Type') || 'video/mp4';

        return { videoBlob, mimeType };
      }
    }
  } catch (error) {
    console.error("Error generating video:", error);
    if (error instanceof Error) {
      throw new Error(`Video Generation Error: ${error.message}`);
    }
    throw new Error("An unknown error occurred while generating the video.");
  }
}
