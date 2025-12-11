import type { Board, UserEffect, WheelAction, ImageAspectRatio, ImageSize } from '../types';

const DB_NAME = 'BananaPodDB';
const DB_VERSION = 1;
const BOARDS_STORE = 'boards';
const SETTINGS_STORE = 'settings';

export interface AppSettings {
  activeBoardId: string;
  language: 'en' | 'zho';
  uiTheme: { color: string; opacity: number };
  buttonTheme: { color: string; opacity: number };
  drawingOptions: { strokeColor: string; strokeWidth: number };
  wheelAction: WheelAction;
  userEffects: UserEffect[];
  generationMode: 'image' | 'video';
  videoAspectRatio: '16:9' | '9:16';
  imageAspectRatio: ImageAspectRatio | 'auto';
  imageSize: ImageSize;
  // API Configuration
  apiKey: string;
  apiBaseUrl: string;
}

let dbInstance: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('Failed to open IndexedDB:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      // Create boards store
      if (!db.objectStoreNames.contains(BOARDS_STORE)) {
        db.createObjectStore(BOARDS_STORE, { keyPath: 'id' });
      }
      
      // Create settings store (single record with key 'app')
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE);
      }
    };
  });
}

export async function saveBoards(boards: Board[]): Promise<void> {
  try {
    const db = await openDB();
    const transaction = db.transaction(BOARDS_STORE, 'readwrite');
    const store = transaction.objectStore(BOARDS_STORE);

    // Clear existing boards and add new ones
    return new Promise((resolve, reject) => {
      const clearRequest = store.clear();
      
      clearRequest.onsuccess = () => {
        let completed = 0;
        const total = boards.length;

        if (total === 0) {
          resolve();
          return;
        }

        boards.forEach((board) => {
          const addRequest = store.add(board);
          addRequest.onsuccess = () => {
            completed++;
            if (completed === total) {
              resolve();
            }
          };
          addRequest.onerror = () => {
            reject(addRequest.error);
          };
        });
      };

      clearRequest.onerror = () => {
        reject(clearRequest.error);
      };

      transaction.onerror = () => {
        reject(transaction.error);
      };
    });
  } catch (error) {
    console.error('Failed to save boards:', error);
    throw error;
  }
}

export async function loadBoards(): Promise<Board[] | null> {
  try {
    const db = await openDB();
    const transaction = db.transaction(BOARDS_STORE, 'readonly');
    const store = transaction.objectStore(BOARDS_STORE);

    return new Promise((resolve, reject) => {
      const request = store.getAll();

      request.onsuccess = () => {
        const boards = request.result as Board[];
        resolve(boards.length > 0 ? boards : null);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('Failed to load boards:', error);
    return null;
  }
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<void> {
  try {
    const db = await openDB();
    const transaction = db.transaction(SETTINGS_STORE, 'readwrite');
    const store = transaction.objectStore(SETTINGS_STORE);

    return new Promise((resolve, reject) => {
      // Simply overwrite the settings (we always save complete settings)
      const request = store.put(settings, 'app');

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('Failed to save settings:', error);
    throw error;
  }
}

export async function loadSettings(): Promise<Partial<AppSettings> | null> {
  try {
    const db = await openDB();
    const transaction = db.transaction(SETTINGS_STORE, 'readonly');
    const store = transaction.objectStore(SETTINGS_STORE);

    return new Promise((resolve, reject) => {
      const request = store.get('app');

      request.onsuccess = () => {
        resolve(request.result || null);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('Failed to load settings:', error);
    return null;
  }
}

// Debounce utility for saving
export function debounce<T extends (...args: unknown[]) => void>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      func(...args);
    }, wait);
  };
}

// Pre-made debounced save functions (1 second delay)
export const debouncedSaveBoards = debounce((boards: Board[]) => {
  saveBoards(boards).catch(err => console.error('Auto-save boards failed:', err));
}, 1000);

export const debouncedSaveSettings = debounce((settings: Partial<AppSettings>) => {
  saveSettings(settings).catch(err => console.error('Auto-save settings failed:', err));
}, 1000);

// Clear all data (for debugging/reset)
export async function clearAllData(): Promise<void> {
  try {
    const db = await openDB();
    const transaction = db.transaction([BOARDS_STORE, SETTINGS_STORE], 'readwrite');
    
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        const request = transaction.objectStore(BOARDS_STORE).clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      }),
      new Promise<void>((resolve, reject) => {
        const request = transaction.objectStore(SETTINGS_STORE).clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      })
    ]);
    
    console.log('All data cleared from IndexedDB');
  } catch (error) {
    console.error('Failed to clear data:', error);
    throw error;
  }
}

