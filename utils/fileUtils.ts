
export const fileToDataUrl = (file: File): Promise<{ dataUrl: string; mimeType: string }> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                resolve({ dataUrl: reader.result, mimeType: file.type });
            } else {
                reject(new Error('Failed to read file as a data URL.'));
            }
        };
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(file);
    });
};

export const blobToDataUrl = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result);
            } else {
                reject(new Error('Failed to convert blob to data URL.'));
            }
        };
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(blob);
    });
};

// Load image with timeout (default 30 seconds)
export const loadImageWithTimeout = (src: string, timeout: number = 30000): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        const cleanup = () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
        };

        timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error(`Image loading timed out after ${timeout / 1000} seconds`));
        }, timeout);

        img.onload = () => {
            cleanup();
            resolve(img);
        };

        img.onerror = () => {
            cleanup();
            reject(new Error('Failed to load image'));
        };

        img.src = src;
    });
};