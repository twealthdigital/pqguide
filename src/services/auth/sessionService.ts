import type { ActiveSessionRecord } from '../../core/types';
import { localStore } from '../storage/localStore';

const SESSION_KEY = 'pqguide_active_session_v2';
const LEGACY_SESSION_KEY = 'pqguide_active_session_v1';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function generateOpaqueSessionId(): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Stores ONLY opaque session reference + expiration timestamps.
 * Never persists password hashes, salts, or unverified role overrides.
 */
export const sessionService = {
  createSession(userId: string): ActiveSessionRecord {
    const now = Date.now();
    const record: ActiveSessionRecord = {
      sessionId: generateOpaqueSessionId(),
      userId,
      issuedAt: now,
      expiresAt: now + SESSION_TTL_MS,
    };
    localStore.setJson(SESSION_KEY, record);
    localStore.removeItem(LEGACY_SESSION_KEY);
    return record;
  },

  readSession(): ActiveSessionRecord | null {
    const parsed = localStore.getJson<ActiveSessionRecord>(SESSION_KEY);
    if (
      !parsed ||
      typeof parsed.sessionId !== 'string' ||
      typeof parsed.userId !== 'string' ||
      typeof parsed.expiresAt !== 'number'
    ) {
      return null;
    }
    if (Date.now() > parsed.expiresAt) {
      this.clearSession();
      return null;
    }
    return parsed;
  },

  clearSession(): void {
    localStore.removeItem(SESSION_KEY);
    localStore.removeItem(LEGACY_SESSION_KEY);
  },
};
