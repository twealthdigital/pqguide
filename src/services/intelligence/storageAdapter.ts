import type { AcademicDocFormat, StorageObjectRef } from '../../core/types';

export interface DocumentBinaryPayload {
  key: string;
  dataUrl?: string;
  bytes?: Uint8Array;
  mimeType: string;
  sizeBytes: number;
  storedAt: string;
}

export interface DocumentStorageAdapter {
  readonly kind: 'indexeddb' | 'memory';
  putBinary(payload: {
    folder: 'originals' | 'optimized' | 'diagrams';
    docId: string;
    fileName: string;
    mimeType: string;
    bytes?: Uint8Array;
    dataUrl?: string;
  }): Promise<StorageObjectRef>;
  getBinary(key: string): Promise<DocumentBinaryPayload | null>;
  deleteBinary(key: string): Promise<void>;
}

const DB_NAME = 'pqguide_doc_binaries_v1';
const STORE_NAME = 'blobs';
const memoryMap = new Map<string, DocumentBinaryPayload>();

function canUseIndexedDb(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.indexedDB !== 'undefined' &&
    typeof window.indexedDB.open === 'function'
  );
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'));
  });
}

class HybridDocumentStorageAdapter implements DocumentStorageAdapter {
  get kind(): 'indexeddb' | 'memory' {
    return canUseIndexedDb() ? 'indexeddb' : 'memory';
  }

  async putBinary(payload: {
    folder: 'originals' | 'optimized' | 'diagrams';
    docId: string;
    fileName: string;
    mimeType: string;
    bytes?: Uint8Array;
    dataUrl?: string;
  }): Promise<StorageObjectRef> {
    const safeName = payload.fileName.replace(/[^\w.\-]+/g, '_').slice(0, 80) || 'file';
    const key = `${payload.folder}/${payload.docId}/${Date.now()}_${safeName}`;
    const sizeBytes =
      payload.bytes?.byteLength ??
      (payload.dataUrl ? Math.ceil((payload.dataUrl.length * 3) / 4) : 0);
    const storedAt = new Date().toISOString();

    const record: DocumentBinaryPayload = {
      key,
      dataUrl: payload.dataUrl,
      bytes: payload.bytes,
      mimeType: payload.mimeType,
      sizeBytes,
      storedAt,
    };

    memoryMap.set(key, record);

    if (canUseIndexedDb()) {
      try {
        const db = await openDb();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).put(record);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error ?? new Error('Failed writing blob'));
        });
        db.close();
        return {
          adapter: 'indexeddb',
          key,
          sizeBytes,
          mimeType: payload.mimeType,
          storedAt,
        };
      } catch {
        // Fallback to memory cache without blocking document scanning
      }
    }

    return {
      adapter: 'memory',
      key,
      sizeBytes,
      mimeType: payload.mimeType,
      storedAt,
    };
  }

  async getBinary(key: string): Promise<DocumentBinaryPayload | null> {
    const cached = memoryMap.get(key);
    if (cached) return cached;

    if (canUseIndexedDb()) {
      try {
        const db = await openDb();
        const found = await new Promise<DocumentBinaryPayload | null>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const req = tx.objectStore(STORE_NAME).get(key);
          req.onsuccess = () => resolve((req.result as DocumentBinaryPayload | undefined) ?? null);
          req.onerror = () => reject(req.error ?? new Error('Failed reading blob'));
        });
        db.close();
        if (found) {
          memoryMap.set(key, found);
          return found;
        }
      } catch {
        return null;
      }
    }

    return null;
  }

  async deleteBinary(key: string): Promise<void> {
    memoryMap.delete(key);
    if (canUseIndexedDb()) {
      try {
        const db = await openDb();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).delete(key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error ?? new Error('Failed deleting blob'));
        });
        db.close();
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

export const documentStorageAdapter: DocumentStorageAdapter =
  new HybridDocumentStorageAdapter();

/**
 * In-memory per-session cache keyed by SHA-256 to avoid redundant OCR/extraction
 * when the same document is re-inspected or retried.
 */
export interface CachedExtractionEntry {
  sha256: string;
  detectedFormat: AcademicDocFormat;
  pageCount: number;
  extractedText: string;
  cachedAt: string;
}

const extractionCache = new Map<string, CachedExtractionEntry>();

export function getCachedExtractionByHash(sha256: string): CachedExtractionEntry | null {
  return extractionCache.get(sha256) ?? null;
}

export function setCachedExtractionByHash(entry: CachedExtractionEntry): void {
  if (extractionCache.size > 40) {
    const oldestKey = extractionCache.keys().next().value;
    if (oldestKey) extractionCache.delete(oldestKey);
  }
  extractionCache.set(entry.sha256, entry);
}
