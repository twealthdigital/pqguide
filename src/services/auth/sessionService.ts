import type { ActiveSessionRecord, AuthenticatedUser, SessionClearReason } from '../../core/types';
import { safeParseJson } from '../../core/security';
import { localStore } from '../storage/localStore';

export const SESSION_KEY = 'pqguide_active_session_v2';
const LEGACY_SESSION_KEY = 'pqguide_active_session_v1';
const LEGACY_SA_SESSION_KEY = 'pqguide_sa_session_v1';
export const SA_SESSION_HINT_KEY = 'pqguide_sa_session_hint_v1';
const SESSION_EXPIRY_NOTICE_KEY = 'pqguide_session_expired_notice_v1';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export interface MemorySuperAdminSession {
  account: AuthenticatedUser;
  csrfToken: string;
  issuedAt: number;
  expiresAt: number;
}

/**
 * Super Admin sessions are backed by a server-issued HttpOnly cookie.
 * Only the non-sensitive user profile and CSRF token are kept strictly in JS memory
 * (never in localStorage or sessionStorage).
 */
let superAdminMemorySession: MemorySuperAdminSession | null = null;

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
    ss.removeItem(LEGACY_SA_SESSION_KEY);
    ss.removeItem(SA_SESSION_HINT_KEY);
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
      const ss = getSessionStorage();
      if (ss) {
        try {
          ss.removeItem(SESSION_KEY);
        } catch {
          // Ignore
        }
      }
    } else {
      localStore.removeItem(SESSION_KEY);
      writeTransientSession(record);
    }
    localStore.removeItem(LEGACY_SESSION_KEY);
    localStore.removeItem(LEGACY_SA_SESSION_KEY);
    this.consumeExpiredNotice();
    return record;
  },

  setSuperAdminMemorySession(
    account: AuthenticatedUser,
    csrfToken: string,
    rememberMe = false
  ): void {
    const now = Date.now();
    superAdminMemorySession = {
      account: {
        ...account,
        role: 'super_admin',
      },
      csrfToken,
      issuedAt: now,
      expiresAt: now + SESSION_TTL_MS,
    };
    localStore.removeItem(LEGACY_SA_SESSION_KEY);
    const ss = getSessionStorage();
    if (rememberMe || !ss) {
      localStore.setItem(SA_SESSION_HINT_KEY, '1');
      if (ss) {
        try {
          ss.removeItem(SA_SESSION_HINT_KEY);
          ss.removeItem(LEGACY_SA_SESSION_KEY);
        } catch {
          // Ignore
        }
      }
    } else {
      localStore.removeItem(SA_SESSION_HINT_KEY);
      try {
        ss.setItem(SA_SESSION_HINT_KEY, '1');
        ss.removeItem(LEGACY_SA_SESSION_KEY);
      } catch {
        localStore.setItem(SA_SESSION_HINT_KEY, '1');
      }
    }
  },

  readSuperAdminMemorySession(): MemorySuperAdminSession | null {
    if (!superAdminMemorySession) return null;
    if (Date.now() > superAdminMemorySession.expiresAt) {
      superAdminMemorySession = null;
      return null;
    }
    return superAdminMemorySession;
  },

  readSuperAdminCsrfToken(): string | null {
    return this.readSuperAdminMemorySession()?.csrfToken ?? null;
  },

  hasSuperAdminSessionHint(): boolean {
    const ss = getSessionStorage();
    if (ss) {
      try {
        if (ss.getItem(SA_SESSION_HINT_KEY) === '1') return true;
      } catch {
        // Ignore
      }
    }
    return localStore.getItem(SA_SESSION_HINT_KEY) === '1';
  },

  clearSuperAdminSession(): void {
    superAdminMemorySession = null;
    localStore.removeItem(LEGACY_SA_SESSION_KEY);
    localStore.removeItem(SA_SESSION_HINT_KEY);
    const ss = getSessionStorage();
    if (ss) {
      try {
        ss.removeItem(LEGACY_SA_SESSION_KEY);
        ss.removeItem(SA_SESSION_HINT_KEY);
      } catch {
        // Ignore
      }
    }
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
    const saMem = this.readSuperAdminMemorySession();
    const session = this.readSession();
    if (saMem && (!session || saMem.expiresAt <= session.expiresAt)) {
      return Math.max(0, saMem.expiresAt - Date.now());
    }
    if (!session) return saMem ? Math.max(0, saMem.expiresAt - Date.now()) : null;
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
    this.clearSuperAdminSession();
    if (reason === 'expired') {
      setExpiryNoticeFlag();
    }
  },
};
