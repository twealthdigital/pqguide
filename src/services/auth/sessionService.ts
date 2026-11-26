import type { ActiveSessionRecord, SessionClearReason } from '../../core/types';
import { safeParseJson } from '../../core/security';
import { localStore } from '../storage/localStore';

export const SESSION_KEY = 'pqguide_active_session_v2';
const LEGACY_SESSION_KEY = 'pqguide_active_session_v1';
const SESSION_EXPIRY_NOTICE_KEY = 'pqguide_session_expired_notice_v1';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function getSessionStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      return window.sessionStorage;
    }
  } catch {
    // Restricted storage context
  }
  return null;
}

function readTransientSession(): ActiveSessionRecord | null {
  const ss = getSessionStorage();
  if (!ss) return null;
  try {
    return safeParseJson<ActiveSessionRecord>(ss.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

function writeTransientSession(record: ActiveSessionRecord): void {
  const ss = getSessionStorage();
  if (!ss) {
    // Fallback cleanly to localStore when sessionStorage is unavailable
    localStore.setJson(SESSION_KEY, record);
    return;
  }
  try {
    ss.setItem(SESSION_KEY, JSON.stringify(record));
  } catch {
    localStore.setJson(SESSION_KEY, record);
  }
}

function clearTransientSession(): void {
  const ss = getSessionStorage();
  if (!ss) return;
  try {
    ss.removeItem(SESSION_KEY);
  } catch {
    // Ignore storage removal errors
  }
}

function setExpiryNoticeFlag(): void {
  const ss = getSessionStorage();
  if (ss) {
    try {
      ss.setItem(SESSION_EXPIRY_NOTICE_KEY, '1');
      return;
    } catch {
      // Fall through to localStore
    }
  }
  localStore.setItem(SESSION_EXPIRY_NOTICE_KEY, '1');
}

function generateOpaqueSessionId(): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function isValidRecord(parsed: ActiveSessionRecord | null): parsed is ActiveSessionRecord {
  return Boolean(
    parsed &&
      typeof parsed.sessionId === 'string' &&
      typeof parsed.userId === 'string' &&
      typeof parsed.expiresAt === 'number'
  );
}

/**
 * Stores ONLY opaque session reference + expiration timestamps.
 * Never persists password hashes, salts, or unverified role overrides.
 *
 * When `rememberMe` is true (default), persists in localStorage up to 12 hours;
 * when false, stores in sessionStorage so closing the browser tab/window ends the session,
 * while still enforcing the 12-hour TTL.
 */
export const sessionService = {
  createSession(userId: string, rememberMe = true): ActiveSessionRecord {
    const now = Date.now();
    const record: ActiveSessionRecord = {
      sessionId: generateOpaqueSessionId(),
      userId,
      issuedAt: now,
      expiresAt: now + SESSION_TTL_MS,
      rememberMe,
    };

    if (rememberMe) {
      localStore.setJson(SESSION_KEY, record);
      clearTransientSession();
    } else {
      localStore.removeItem(SESSION_KEY);
      writeTransientSession(record);
    }
    localStore.removeItem(LEGACY_SESSION_KEY);
    this.consumeExpiredNotice();
    return record;
  },

  readSession(): ActiveSessionRecord | null {
    const persistent = localStore.getJson<ActiveSessionRecord>(SESSION_KEY);
    const transient = readTransientSession();
    const parsed = isValidRecord(transient)
      ? transient
      : isValidRecord(persistent)
        ? persistent
        : null;

    if (!parsed) {
      return null;
    }
    if (Date.now() > parsed.expiresAt) {
      this.clearSession('expired');
      return null;
    }
    return parsed;
  },

  getSessionRemainingMs(): number | null {
    const session = this.readSession();
    if (!session) return null;
    return Math.max(0, session.expiresAt - Date.now());
  },

  consumeExpiredNotice(): boolean {
    const ss = getSessionStorage();
    let hadNotice = false;
    if (ss) {
      try {
        if (ss.getItem(SESSION_EXPIRY_NOTICE_KEY) === '1') {
          hadNotice = true;
          ss.removeItem(SESSION_EXPIRY_NOTICE_KEY);
        }
      } catch {
        // Ignore
      }
    }
    if (localStore.getItem(SESSION_EXPIRY_NOTICE_KEY) === '1') {
      hadNotice = true;
      localStore.removeItem(SESSION_EXPIRY_NOTICE_KEY);
    }
    return hadNotice;
  },

  clearSession(reason: SessionClearReason = 'manual'): void {
    localStore.removeItem(SESSION_KEY);
    localStore.removeItem(LEGACY_SESSION_KEY);
    clearTransientSession();
    if (reason === 'expired') {
      setExpiryNoticeFlag();
    }
  },
};
