import { safeParseJson } from '../../core/security';

const memoryFallback = new Map<string, string>();

function getNativeStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Restricted storage environment
  }
  return null;
}

export const localStore = {
  getItem(key: string): string | null {
    const native = getNativeStorage();
    if (native) {
      try {
        return native.getItem(key);
      } catch {
        return memoryFallback.get(key) ?? null;
      }
    }
    return memoryFallback.get(key) ?? null;
  },

  setItem(key: string, value: string): void {
    memoryFallback.set(key, value);
    const native = getNativeStorage();
    if (native) {
      try {
        native.setItem(key, value);
      } catch {
        // Ignore quota errors cleanly; memory fallback still retains state
      }
    }
  },

  removeItem(key: string): void {
    memoryFallback.delete(key);
    const native = getNativeStorage();
    if (native) {
      try {
        native.removeItem(key);
      } catch {
        // Ignore storage errors cleanly
      }
    }
  },

  getJson<T>(key: string): T | null {
    return safeParseJson<T>(this.getItem(key));
  },

  setJson(key: string, value: unknown): void {
    try {
      this.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore serialization quota errors
    }
  },
};
