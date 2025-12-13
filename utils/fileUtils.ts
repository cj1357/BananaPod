
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

// Load image with timeout (default 90 seconds)
export const loadImageWithTimeout = (src: string, timeout: number = 90000): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        let settled = false;

        const cleanup = () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
        };

        const resolveOnce = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(img);
        };

        const rejectOnce = (err: Error) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(err);
        };

        timeoutId = setTimeout(() => {
            rejectOnce(new Error(`Image loading timed out after ${timeout / 1000} seconds`));
        }, timeout);

        img.onload = () => {
            resolveOnce();
        };

        img.onerror = () => {
            rejectOnce(new Error('Failed to load image'));
        };

        img.src = src;

        // 兜底：某些情况下（缓存命中/快速完成/刷新时机）可能不会再触发 onload，
        // 这里主动检查 complete + naturalWidth，并尽量使用 decode() 确保可用。
        if (img.complete && ((img as any).naturalWidth || img.width)) {
            resolveOnce();
            return;
        }

        if (typeof (img as any).decode === 'function') {
            // decode() 可能因跨域/CORS 等失败，但不代表图片最终不能 onload；所以失败时不 reject。
            (img as any).decode()
                .then(() => resolveOnce())
                .catch(() => { /* ignore */ });
        }
    });
};