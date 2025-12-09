import express from 'express';
import cors from 'cors';
import { GoogleGenAI, Modality, GenerateContentResponse, GenerateVideosOperation } from '@google/genai';
import dotenv from 'dotenv';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { fetch as undiciFetch, type RequestInit } from 'undici';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8086;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// API Key validation
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('GEMINI_API_KEY environment variable is not set');
  process.exit(1);
}

// SOCKS5 Proxy configuration (optional)
// Set SOCKS5_PROXY env var, e.g., socks5://127.0.0.1:1080
const SOCKS5_PROXY = process.env.SOCKS5_PROXY;
let proxyAgent: SocksProxyAgent | undefined;

if (SOCKS5_PROXY) {
  proxyAgent = new SocksProxyAgent(SOCKS5_PROXY);
  console.log(`Using SOCKS5 proxy: ${SOCKS5_PROXY}`);
}

// Create custom fetch with proxy support
const customFetch = (input: string | URL | Request, init?: RequestInit) => {
  const options: RequestInit = { ...init };
  if (proxyAgent) {
    options.dispatcher = proxyAgent;
  }
  return undiciFetch(input as string | URL, options);
};

const ai = new GoogleGenAI({ 
  apiKey: API_KEY,
  httpOptions: {
    fetch: customFetch as unknown as typeof fetch,
  },
});

// Model configuration via environment variables
const IMAGE_EDIT_MODEL = process.env.GEMINI_IMAGE_EDIT_MODEL || 'gemini-2.5-flash-image-preview';
const IMAGE_GEN_MODEL = process.env.GEMINI_IMAGE_GEN_MODEL || 'imagen-4.0-generate-001';
const VIDEO_GEN_MODEL = process.env.GEMINI_VIDEO_GEN_MODEL || 'veo-2.0-generate-001';

type ImageInput = {
  href: string;
  mimeType: string;
};

// Edit Image endpoint
app.post('/api/edit-image', async (req, res) => {
  try {
    const { images, prompt, mask } = req.body as {
      images: ImageInput[];
      prompt: string;
      mask?: ImageInput;
    };

    const imageParts = images.map(image => {
      const dataUrlParts = image.href.split(',');
      const base64Data = dataUrlParts.length > 1 ? dataUrlParts[1] : dataUrlParts[0];
      return {
        inlineData: {
          data: base64Data,
          mimeType: image.mimeType,
        },
      };
    });

    const maskPart = mask ? {
      inlineData: {
        data: mask.href.split(',')[1],
        mimeType: mask.mimeType,
      },
    } : null;

    const textPart = { text: prompt };

    const parts = maskPart
      ? [textPart, ...imageParts, maskPart]
      : [...imageParts, textPart];

    const response: GenerateContentResponse = await ai.models.generateContent({
      model: IMAGE_EDIT_MODEL,
      contents: {
        parts: parts,
      },
      config: {
        responseModalities: [Modality.IMAGE, Modality.TEXT],
      },
    });

    let newImageBase64: string | null = null;
    let newImageMimeType: string | null = null;
    let textResponse: string | null = null;

    if (response.candidates && response.candidates.length > 0 && response.candidates[0].content) {
      const responseParts = response.candidates[0].content.parts;
      for (const part of responseParts) {
        if (part.inlineData) {
          newImageBase64 = part.inlineData.data ?? null;
          newImageMimeType = part.inlineData.mimeType ?? null;
        } else if (part.text) {
          textResponse = part.text;
        }
      }
    } else {
      textResponse = 'The AI response was blocked or did not contain content.';
      if (response.candidates && response.candidates.length > 0 && response.candidates[0].finishReason) {
        textResponse += ` (Reason: ${response.candidates[0].finishReason})`;
      }
    }

    if (!newImageBase64) {
      console.warn('API response did not contain an image part.', response);
      textResponse = textResponse || 'The AI did not generate a new image. Please try a different prompt.';
    }

    res.json({ newImageBase64, newImageMimeType, textResponse });
  } catch (error) {
    console.error('Error calling Gemini API:', error);
    const message = error instanceof Error ? error.message : 'An unknown error occurred';
    res.status(500).json({ error: `Gemini API Error: ${message}` });
  }
});

// Generate Image from Text endpoint
app.post('/api/generate-image', async (req, res) => {
  try {
    const { prompt } = req.body as { prompt: string };

    const response = await ai.models.generateImages({
      model: IMAGE_GEN_MODEL,
      prompt: prompt,
      config: {
        numberOfImages: 1,
        outputMimeType: 'image/png',
      },
    });

    if (response.generatedImages && response.generatedImages.length > 0) {
      const image = response.generatedImages[0];
      res.json({
        newImageBase64: image.image?.imageBytes ?? null,
        newImageMimeType: 'image/png',
        textResponse: null
      });
    } else {
      res.json({
        newImageBase64: null,
        newImageMimeType: null,
        textResponse: 'The AI did not generate an image. Please try a different prompt.'
      });
    }
  } catch (error) {
    console.error('Error calling Gemini API for text-to-image:', error);
    const message = error instanceof Error ? error.message : 'An unknown error occurred';
    res.status(500).json({ error: `Gemini API Error: ${message}` });
  }
});

// Generate Video endpoint (with SSE for progress)
app.post('/api/generate-video', async (req, res) => {
  try {
    const { prompt, aspectRatio, image } = req.body as {
      prompt: string;
      aspectRatio: '16:9' | '9:16';
      image?: ImageInput;
    };

    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendProgress = (message: string) => {
      res.write(`data: ${JSON.stringify({ type: 'progress', message })}\n\n`);
    };

    sendProgress('Initializing video generation...');

    const imagePart = image ? {
      imageBytes: image.href.split(',')[1],
      mimeType: image.mimeType,
    } : undefined;

    let operation: GenerateVideosOperation = await ai.models.generateVideos({
      model: VIDEO_GEN_MODEL,
      prompt: prompt,
      image: imagePart,
      config: {
        numberOfVideos: 1,
        aspectRatio: aspectRatio,
      }
    });

    const progressMessages = [
      'Rendering frames...',
      'Compositing video...',
      'Applying final touches...',
      'Almost there...',
    ];
    let messageIndex = 0;

    sendProgress('Generation started, this may take a few minutes.');

    while (!operation.done) {
      sendProgress(progressMessages[messageIndex % progressMessages.length]);
      messageIndex++;
      await new Promise(resolve => setTimeout(resolve, 10000));
      operation = await ai.operations.getVideosOperation({ operation: operation });
    }

    if (operation.error) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: `Video generation failed: ${operation.error.message}` })}\n\n`);
      res.end();
      return;
    }

    const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!downloadLink) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'Video generation completed, but no download link was found.' })}\n\n`);
      res.end();
      return;
    }

    sendProgress('Downloading generated video...');
    const videoResponse = await customFetch(`${downloadLink}&key=${API_KEY}`);
    if (!videoResponse.ok) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: `Failed to download video: ${videoResponse.statusText}` })}\n\n`);
      res.end();
      return;
    }

    const videoBuffer = await videoResponse.arrayBuffer();
    const videoBase64 = Buffer.from(videoBuffer).toString('base64');
    const mimeType = videoResponse.headers.get('Content-Type') || 'video/mp4';

    res.write(`data: ${JSON.stringify({ type: 'complete', videoBase64, mimeType })}\n\n`);
    res.end();
  } catch (error) {
    console.error('Error calling Gemini API for video generation:', error);
    const message = error instanceof Error ? error.message : 'An unknown error occurred';
    res.write(`data: ${JSON.stringify({ type: 'error', error: `Gemini API Error: ${message}` })}\n\n`);
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`🍌 BananaPod API server running on http://localhost:${PORT}`);
});

