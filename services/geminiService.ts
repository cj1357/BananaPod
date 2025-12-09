// Frontend API client - calls backend server instead of Gemini API directly

type ImageInput = {
  href: string;
  mimeType: string;
};

type ImageResult = {
  newImageBase64: string | null;
  newImageMimeType: string | null;
  textResponse: string | null;
};

const API_BASE = '/api';

export async function editImage(
  images: ImageInput[],
  prompt: string,
  mask?: ImageInput
): Promise<ImageResult> {
  const response = await fetch(`${API_BASE}/edit-image`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ images, prompt, mask }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
  }

  return response.json();
}

export async function generateImageFromText(prompt: string): Promise<ImageResult> {
  const response = await fetch(`${API_BASE}/generate-image`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
  }

  return response.json();
}

export async function generateVideo(
  prompt: string,
  aspectRatio: '16:9' | '9:16',
  onProgress: (message: string) => void,
  image?: ImageInput
): Promise<{ videoBlob: Blob; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    
    fetch(`${API_BASE}/generate-video`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt, aspectRatio, image }),
      signal: controller.signal,
    }).then(async response => {
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        reject(new Error(errorData.error || `HTTP error! status: ${response.status}`));
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        reject(new Error('No response body'));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.type === 'progress') {
                onProgress(data.message);
              } else if (data.type === 'complete') {
                // Convert base64 to Blob
                const binaryString = atob(data.videoBase64);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                  bytes[i] = binaryString.charCodeAt(i);
                }
                const videoBlob = new Blob([bytes], { type: data.mimeType });
                resolve({ videoBlob, mimeType: data.mimeType });
                return;
              } else if (data.type === 'error') {
                reject(new Error(data.error));
                return;
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e);
            }
          }
        }
      }

      reject(new Error('Stream ended without completion'));
    }).catch(reject);
  });
}
