import crypto from 'node:crypto';
import type { AuthenticatedUser } from '../src/core/types';
import { createOtpEngine, type OtpDeliveryMode, type OtpEngineDeps } from './otpService.ts';

export const SUPER_ADMIN_KEY = 'pqguide:super_admin:record';
export const SUPER_ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const SA_RL_WINDOW_MS = 10 * 60 * 1000;
export const SA_MAX_INIT_REQUESTS = 10;
export const SA_MAX_LOGIN_REQUESTS = 15;
export const SA_MAX_RESET_REQUESTS = 15;

const DEV_ONLY_FALLBACK_HMAC_SECRET =
  'pqguide-local-dev-only-otp-hmac-secret-do-not-use-in-prod';

export interface StoredSuperAdminRecord {
  id: string;
  fullName: string;
  email: string;
  role: 'super_admin';
  status: 'active';
  adminVerified: true;
  isEmailVerified: true;
  needsPasswordSetup: false;
  assignedSchoolCode: 'ALL';
  matricNumber: 'SUPER-ADMIN';
  faculty: 'Platform Administration';
  department: 'Central Security & Operations';
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
  updatedAt?: string;
  createdBy: 'production-bootstrap';
}

export interface SuperAdminEngineDeps extends OtpEngineDeps {
  otpEngine?: ReturnType<typeof createOtpEngine>;
}

const GET_SUPER_ADMIN_LUA = `
return redis.call('GET', KEYS[1])
`.trim();

const INIT_SUPER_ADMIN_LUA = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  return {'ERR', 'EXISTS'}
end
redis.call('SET', KEYS[1], ARGV[1])
return {'OK'}
`.trim();

const UPDATE_SUPER_ADMIN_LUA = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  return {'ERR', 'MISSING'}
end
redis.call('SET', KEYS[1], ARGV[1])
return {'OK'}
`.trim();

const RATE_LIMIT_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[1]))
end
if current > tonumber(ARGV[2]) then
  local ttlMs = redis.call('PTTL', KEYS[1])
  if ttlMs < 0 then
    redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[1]))
    ttlMs = tonumber(ARGV[1])
  end
  return {'LIMIT', tostring(math.max(1, math.ceil(ttlMs / 1000)))}
end
return {'OK', tostring(current)}
`.trim();

class SuperAdminStoreUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SuperAdminStoreUnavailableError';
  }
}

interface SuperAdminStore {
  readonly kind: 'upstash' | 'memory-dev';
  checkRateLimit(
    key: string,
    windowMs: number,
    maxRequests: number
  ): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }>;
  getRecord(): Promise<StoredSuperAdminRecord | null>;
  initRecord(record: StoredSuperAdminRecord): Promise<boolean>;
  updateRecord(record: StoredSuperAdminRecord): Promise<boolean>;
}

class UpstashSuperAdminStore implements SuperAdminStore {
  readonly kind = 'upstash' as const;
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrl: string, token: string, fetchImpl: typeof fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  private async runCommand<T = unknown>(command: Array<string | number>): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(command),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new SuperAdminStoreUnavailableError('Unable to reach authentication store.');
    }

    if (!response.ok) {
      throw new SuperAdminStoreUnavailableError(
        `Authentication store returned HTTP ${response.status}.`
      );
    }

    let payload: { result?: T; error?: string };
    try {
      payload = (await response.json()) as { result?: T; error?: string };
    } catch {
      throw new SuperAdminStoreUnavailableError('Invalid response from authentication store.');
    }

    if (payload.error) {
      throw new SuperAdminStoreUnavailableError('Authentication store command failed.');
    }

    return payload.result as T;
  }

  async checkRateLimit(
    key: string,
    windowMs: number,
    maxRequests: number
  ): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> {
    const res = await this.runCommand<string[]>([
      'EVAL',
      RATE_LIMIT_LUA,
      1,
      key,
      windowMs,
      maxRequests,
    ]);
    if (Array.isArray(res) && res[0] === 'LIMIT') {
      return { allowed: false, retryAfterSeconds: Math.max(1, Number(res[1]) || 1) };
    }
    return { allowed: true };
  }

  async getRecord(): Promise<StoredSuperAdminRecord | null> {
    const raw = await this.runCommand<string | null>([
      'EVAL',
      GET_SUPER_ADMIN_LUA,
      1,
      SUPER_ADMIN_KEY,
    ]);
    if (!raw || typeof raw !== 'string') return null;
    try {
      return JSON.parse(raw) as StoredSuperAdminRecord;
    } catch {
      return null;
    }
  }

  async initRecord(record: StoredSuperAdminRecord): Promise<boolean> {
    const res = await this.runCommand<string[]>([
      'EVAL',
      INIT_SUPER_ADMIN_LUA,
      1,
      SUPER_ADMIN_KEY,
      JSON.stringify(record),
    ]);
    return Array.isArray(res) && res[0] === 'OK';
  }

  async updateRecord(record: StoredSuperAdminRecord): Promise<boolean> {
    const res = await this.runCommand<string[]>([
      'EVAL',
      UPDATE_SUPER_ADMIN_LUA,
      1,
      SUPER_ADMIN_KEY,
      JSON.stringify(record),
    ]);
    return Array.isArray(res) && res[0] === 'OK';
  }
}

class DevMemorySuperAdminStore implements SuperAdminStore {
  readonly kind = 'memory-dev' as const;
  private record: StoredSuperAdminRecord | null = null;
  private readonly rateLimits = new Map<string, { count: number; resetAt: number }>();
  private readonly now: () => number;

  constructor(now: () => number) {
    this.now = now;
  }

  async checkRateLimit(
    key: string,
    windowMs: number,
    maxRequests: number
  ): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> {
    const nowMs = this.now();
    const existing = this.rateLimits.get(key);
    if (!existing || nowMs >= existing.resetAt) {
      this.rateLimits.set(key, { count: 1, resetAt: nowMs + windowMs });
      return { allowed: true };
    }
    if (existing.count >= maxRequests) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - nowMs) / 1000)),
      };
    }
    existing.count += 1;
    return { allowed: true };
  }

  async getRecord(): Promise<StoredSuperAdminRecord | null> {
    return this.record;
  }

  async initRecord(record: StoredSuperAdminRecord): Promise<boolean> {
    if (this.record) return false;
    this.record = record;
    return true;
  }

  async updateRecord(record: StoredSuperAdminRecord): Promise<boolean> {
    if (!this.record) return false;
    this.record = record;
    return true;
  }
}

function cleanEnvValue(raw: string | undefined): string {
  const trimmed = raw?.trim() || '';
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function isValidHttpUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

interface ResolvedSuperAdminConfig {
  isProdLike: boolean;
  hmacSecret: string;
  setupSecret: string;
  bootstrapEmail: string;
  upstashUrl: string;
  upstashToken: string;
  persistenceError?: string;
}

function resolveSuperAdminConfig(
  env: Record<string, string | undefined>
): ResolvedSuperAdminConfig {
  const isProdLike =
    env.NODE_ENV === 'production' ||
    env.VERCEL === '1' ||
    env.VERCEL_ENV === 'production' ||
    env.VERCEL_ENV === 'preview';

  const rawHmac = cleanEnvValue(env.OTP_HMAC_SECRET);
  const setupSecret = cleanEnvValue(env.SUPER_ADMIN_SETUP_SECRET);
  const bootstrapEmail = cleanEnvValue(env.SUPER_ADMIN_BOOTSTRAP_EMAIL).toLowerCase();
  const upstashUrl = cleanEnvValue(env.UPSTASH_REDIS_REST_URL);
  const upstashToken = cleanEnvValue(env.UPSTASH_REDIS_REST_TOKEN);

  if ((upstashUrl && !upstashToken) || (!upstashUrl && upstashToken)) {
    return {
      isProdLike,
      hmacSecret: '',
      setupSecret,
      bootstrapEmail,
      upstashUrl: '',
      upstashToken: '',
      persistenceError: 'Incomplete persistent authentication store configuration.',
    };
  }

  if (upstashUrl && !isValidHttpUrl(upstashUrl)) {
    return {
      isProdLike,
      hmacSecret: '',
      setupSecret,
      bootstrapEmail,
      upstashUrl: '',
      upstashToken: '',
      persistenceError: 'Invalid authentication store URL configuration.',
    };
  }

  if (isProdLike && (!upstashUrl || !upstashToken)) {
    return {
      isProdLike,
      hmacSecret: '',
      setupSecret,
      bootstrapEmail,
      upstashUrl: '',
      upstashToken: '',
      persistenceError: 'Persistent authentication store is required in production.',
    };
  }

  if (isProdLike && (!rawHmac || rawHmac.length < 16)) {
    return {
      isProdLike,
      hmacSecret: '',
      setupSecret,
      bootstrapEmail,
      upstashUrl,
      upstashToken,
      persistenceError: 'Server signing secret is not configured for production.',
    };
  }

  if (rawHmac && rawHmac.length < 16) {
    return {
      isProdLike,
      hmacSecret: '',
      setupSecret,
      bootstrapEmail,
      upstashUrl,
      upstashToken,
      persistenceError: 'Server signing secret must be at least 16 characters.',
    };
  }

  return {
    isProdLike,
    hmacSecret: rawHmac || DEV_ONLY_FALLBACK_HMAC_SECRET,
    setupSecret,
    bootstrapEmail,
    upstashUrl,
    upstashToken,
  };
}

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeEqualStrings(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function hashScryptPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyScryptPassword(password: string, salt: string, storedHex: string): boolean {
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const stored = Buffer.from(storedHex, 'hex');
    if (derived.length !== stored.length) return false;
    return crypto.timingSafeEqual(derived, stored);
  } catch {
    return false;
  }
}

function normalizeEmail(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 160;
}

function sanitizeLine(raw: unknown, maxLen: number): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function validateStrongSuperAdminPassword(password: string): string | null {
  if (!password || password.length < 10) {
    return 'Super Admin passwords must be at least 10 characters long.';
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    return 'Super Admin passwords require uppercase letters, lowercase letters, and at least one number.';
  }
  return null;
}

function toPublicAccount(record: StoredSuperAdminRecord): AuthenticatedUser {
  const { passwordHash: _h, passwordSalt: _s, ...publicUser } = record;
  return publicUser;
}

interface SessionTokenPayload {
  sub: string;
  email: string;
  role: 'super_admin';
  iat: number;
  exp: number;
}

function signSessionToken(
  hmacSecret: string,
  record: StoredSuperAdminRecord,
  nowMs: number
): string {
  const payload: SessionTokenPayload = {
    sub: record.id,
    email: record.email,
    role: 'super_admin',
    iat: nowMs,
    exp: nowMs + SUPER_ADMIN_SESSION_TTL_MS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', hmacSecret)
    .update(`pqguide-sa-session:v1:${encodedPayload}`)
    .digest('hex');
  return `${encodedPayload}.${signature}`;
}

function verifySignedSessionToken(
  hmacSecret: string,
  token: string,
  nowMs: number
): SessionTokenPayload | null {
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0 || dotIdx === token.length - 1) return null;
  const encodedPayload = token.slice(0, dotIdx);
  const sigHex = token.slice(dotIdx + 1);
  if (!/^[a-f0-9]{64}$/i.test(sigHex)) return null;

  const expectedHex = crypto
    .createHmac('sha256', hmacSecret)
    .update(`pqguide-sa-session:v1:${encodedPayload}`)
    .digest('hex');

  const sigBuf = Buffer.from(sigHex, 'hex');
  const expBuf = Buffer.from(expectedHex, 'hex');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8')
    ) as Partial<SessionTokenPayload>;
    if (
      typeof parsed.sub !== 'string' ||
      typeof parsed.email !== 'string' ||
      parsed.role !== 'super_admin' ||
      typeof parsed.exp !== 'number' ||
      typeof parsed.iat !== 'number'
    ) {
      return null;
    }
    if (nowMs > parsed.exp) {
      return null;
    }
    return parsed as SessionTokenPayload;
  } catch {
    return null;
  }
}

export function createSuperAdminEngine(deps: SuperAdminEngineDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => Date.now());
  const devFallbackStore = new DevMemorySuperAdminStore(now);
  const otpEngine = deps.otpEngine ?? createOtpEngine(deps);

  function getEnv(): Record<string, string | undefined> {
    return deps.env ?? process.env;
  }

  function resolveStore(cfg: ResolvedSuperAdminConfig): SuperAdminStore {
    if (cfg.upstashUrl && cfg.upstashToken) {
      return new UpstashSuperAdminStore(cfg.upstashUrl, cfg.upstashToken, fetchImpl);
    }
    return devFallbackStore;
  }

  async function getStatus(): Promise<{
    status: number;
    body: {
      ok: boolean;
      serverSupported: boolean;
      initialized: boolean;
      setupConfigured: boolean;
      emailLockedToConfigured: boolean;
      storage: 'upstash' | 'memory-dev';
      error?: string;
    };
  }> {
    const cfg = resolveSuperAdminConfig(getEnv());
    if (cfg.persistenceError) {
      return {
        status: 503,
        body: {
          ok: false,
          serverSupported: cfg.isProdLike || Boolean(cfg.upstashUrl && cfg.upstashToken),
          initialized: false,
          setupConfigured: cfg.setupSecret.length >= 16,
          emailLockedToConfigured: Boolean(cfg.bootstrapEmail),
          storage: cfg.upstashUrl && cfg.upstashToken ? 'upstash' : 'memory-dev',
          error: cfg.persistenceError,
        },
      };
    }

    const store = resolveStore(cfg);
    const setupConfigured = cfg.setupSecret.length >= 16;
    const serverSupported =
      cfg.isProdLike || store.kind === 'upstash' || setupConfigured;

    try {
      const existing = await store.getRecord();
      return {
        status: 200,
        body: {
          ok: true,
          serverSupported,
          initialized: Boolean(existing),
          setupConfigured,
          emailLockedToConfigured: Boolean(cfg.bootstrapEmail),
          storage: store.kind,
        },
      };
    } catch {
      return {
        status: 503,
        body: {
          ok: false,
          serverSupported,
          initialized: false,
          setupConfigured,
          emailLockedToConfigured: Boolean(cfg.bootstrapEmail),
          storage: store.kind,
          error: 'Authentication store is temporarily unavailable.',
        },
      };
    }
  }

  async function initializeFirstSuperAdmin(params: {
    body: unknown;
    clientIp: string;
  }): Promise<{
    status: number;
    body: {
      ok: boolean;
      error?: string;
      retryAfterSeconds?: number;
      account?: AuthenticatedUser;
      sessionToken?: string;
    };
  }> {
    const cfg = resolveSuperAdminConfig(getEnv());
    if (cfg.persistenceError) {
      return {
        status: 503,
        body: { ok: false, error: cfg.persistenceError },
      };
    }

    if (!cfg.setupSecret || cfg.setupSecret.length < 16) {
      return {
        status: 503,
        body: {
          ok: false,
          error:
            'Super Admin initialization secret is not configured on the server.',
        },
      };
    }

    const store = resolveStore(cfg);
    const ipHash = sha256Hex(params.clientIp || 'unknown');
    try {
      const rl = await store.checkRateLimit(
        `pqguide:rl:sa_init:${ipHash}`,
        SA_RL_WINDOW_MS,
        SA_MAX_INIT_REQUESTS
      );
      if (!rl.allowed) {
        return {
          status: 429,
          body: {
            ok: false,
            error: `Too many initialization attempts. Please wait ${rl.retryAfterSeconds}s and try again.`,
            retryAfterSeconds: rl.retryAfterSeconds,
          },
        };
      }
    } catch {
      return {
        status: 503,
        body: { ok: false, error: 'Authentication store is temporarily unavailable.' },
      };
    }

    const bodyObj =
      params.body && typeof params.body === 'object'
        ? (params.body as Record<string, unknown>)
        : {};

    const suppliedSecret =
      typeof bodyObj.setupSecret === 'string' ? bodyObj.setupSecret.trim() : '';
    if (!suppliedSecret || !safeEqualStrings(suppliedSecret, cfg.setupSecret)) {
      return {
        status: 403,
        body: { ok: false, error: 'Invalid server setup authorization key.' },
      };
    }

    const fullName = sanitizeLine(bodyObj.fullName, 120);
    const email = normalizeEmail(bodyObj.email);
    const password = typeof bodyObj.password === 'string' ? bodyObj.password : '';
    const confirmPassword =
      typeof bodyObj.confirmPassword === 'string' ? bodyObj.confirmPassword : '';
    const confirmationPhrase =
      typeof bodyObj.confirmationPhrase === 'string'
        ? bodyObj.confirmationPhrase.trim().toUpperCase()
        : '';

    if (fullName.length < 2) {
      return {
        status: 400,
        body: { ok: false, error: 'Enter the Super Admin full name.' },
      };
    }
    if (!isValidEmail(email)) {
      return {
        status: 400,
        body: { ok: false, error: 'Enter a valid Super Admin email address.' },
      };
    }
    if (cfg.bootstrapEmail && email !== cfg.bootstrapEmail) {
      return {
        status: 403,
        body: {
          ok: false,
          error: 'This email is not authorized for first-time Super Admin initialization.',
        },
      };
    }

    const pwErr = validateStrongSuperAdminPassword(password);
    if (pwErr) {
      return { status: 400, body: { ok: false, error: pwErr } };
    }
    if (password !== confirmPassword) {
      return { status: 400, body: { ok: false, error: 'Passwords do not match.' } };
    }
    if (confirmationPhrase !== 'INITIALIZE SUPER ADMIN') {
      return {
        status: 400,
        body: {
          ok: false,
          error: 'Type INITIALIZE SUPER ADMIN in the confirmation field.',
        },
      };
    }

    const nowMs = now();
    const nowIso = new Date(nowMs).toISOString();
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashScryptPassword(password, salt);

    const record: StoredSuperAdminRecord = {
      id: `super-${nowMs}`,
      fullName,
      email,
      role: 'super_admin',
      status: 'active',
      adminVerified: true,
      isEmailVerified: true,
      needsPasswordSetup: false,
      assignedSchoolCode: 'ALL',
      matricNumber: 'SUPER-ADMIN',
      faculty: 'Platform Administration',
      department: 'Central Security & Operations',
      passwordHash,
      passwordSalt: salt,
      createdAt: nowIso,
      createdBy: 'production-bootstrap',
    };

    try {
      const created = await store.initRecord(record);
      if (!created) {
        return {
          status: 409,
          body: {
            ok: false,
            error: 'A Super Admin account has already been initialized for this platform.',
          },
        };
      }
      const sessionToken = signSessionToken(cfg.hmacSecret, record, nowMs);
      return {
        status: 200,
        body: {
          ok: true,
          account: toPublicAccount(record),
          sessionToken,
        },
      };
    } catch {
      return {
        status: 503,
        body: { ok: false, error: 'Authentication store is temporarily unavailable.' },
      };
    }
  }

  async function loginSuperAdmin(params: {
    body: unknown;
    clientIp: string;
  }): Promise<{
    status: number;
    body: {
      ok: boolean;
      error?: string;
      retryAfterSeconds?: number;
      account?: AuthenticatedUser;
      sessionToken?: string;
    };
  }> {
    const cfg = resolveSuperAdminConfig(getEnv());
    if (cfg.persistenceError) {
      return {
        status: 503,
        body: { ok: false, error: cfg.persistenceError },
      };
    }

    const store = resolveStore(cfg);
    const ipHash = sha256Hex(params.clientIp || 'unknown');
    try {
      const rl = await store.checkRateLimit(
        `pqguide:rl:sa_login:${ipHash}`,
        SA_RL_WINDOW_MS,
        SA_MAX_LOGIN_REQUESTS
      );
      if (!rl.allowed) {
        return {
          status: 429,
          body: {
            ok: false,
            error: `Too many sign-in attempts. Please wait ${rl.retryAfterSeconds}s and try again.`,
            retryAfterSeconds: rl.retryAfterSeconds,
          },
        };
      }
    } catch {
      return {
        status: 503,
        body: { ok: false, error: 'Authentication store is temporarily unavailable.' },
      };
    }

    const bodyObj =
      params.body && typeof params.body === 'object'
        ? (params.body as Record<string, unknown>)
        : {};
    const email = normalizeEmail(bodyObj.email);
    const password = typeof bodyObj.password === 'string' ? bodyObj.password : '';

    if (!isValidEmail(email) || !password) {
      return {
        status: 400,
        body: { ok: false, error: 'Enter your Super Admin email and password.' },
      };
    }

    try {
      const existing = await store.getRecord();
      if (!existing) {
        return {
          status: 404,
          body: {
            ok: false,
            error: 'No verified Super Admin account is initialized for this console yet.',
          },
        };
      }

      if (existing.status !== 'active') {
        return {
          status: 403,
          body: { ok: false, error: 'Super Admin account is not active.' },
        };
      }

      const emailMatch = safeEqualStrings(email, existing.email);
      const pwMatch = verifyScryptPassword(
        password,
        existing.passwordSalt,
        existing.passwordHash
      );
      if (!emailMatch || !pwMatch) {
        return {
          status: 401,
          body: { ok: false, error: 'Incorrect credentials. Check and try again.' },
        };
      }

      const sessionToken = signSessionToken(cfg.hmacSecret, existing, now());
      return {
        status: 200,
        body: {
          ok: true,
          account: toPublicAccount(existing),
          sessionToken,
        },
      };
    } catch {
      return {
        status: 503,
        body: { ok: false, error: 'Authentication store is temporarily unavailable.' },
      };
    }
  }

  async function verifySession(params: {
    body?: unknown;
    authorizationHeader?: string;
  }): Promise<{
    status: number;
    body: {
      ok: boolean;
      error?: string;
      account?: AuthenticatedUser;
    };
  }> {
    const cfg = resolveSuperAdminConfig(getEnv());
    if (cfg.persistenceError) {
      return {
        status: 503,
        body: { ok: false, error: cfg.persistenceError },
      };
    }

    let token = '';
    if (
      typeof params.authorizationHeader === 'string' &&
      params.authorizationHeader.toLowerCase().startsWith('bearer ')
    ) {
      token = params.authorizationHeader.slice(7).trim();
    } else if (params.body && typeof params.body === 'object') {
      const b = params.body as Record<string, unknown>;
      if (typeof b.sessionToken === 'string') token = b.sessionToken.trim();
    }

    if (!token) {
      return {
        status: 401,
        body: { ok: false, error: 'Super Admin session token is missing.' },
      };
    }

    const payload = verifySignedSessionToken(cfg.hmacSecret, token, now());
    if (!payload) {
      return {
        status: 401,
        body: { ok: false, error: 'Super Admin session is invalid or has expired.' },
      };
    }

    const store = resolveStore(cfg);
    try {
      const existing = await store.getRecord();
      if (
        !existing ||
        existing.id !== payload.sub ||
        existing.email !== payload.email ||
        existing.status !== 'active'
      ) {
        return {
          status: 401,
          body: { ok: false, error: 'Super Admin session is no longer active.' },
        };
      }
      return {
        status: 200,
        body: {
          ok: true,
          account: toPublicAccount(existing),
        },
      };
    } catch {
      return {
        status: 503,
        body: { ok: false, error: 'Authentication store is temporarily unavailable.' },
      };
    }
  }

  async function requestPasswordReset(params: {
    body: unknown;
    clientIp: string;
  }): Promise<{
    status: number;
    body: {
      ok: boolean;
      error?: string;
      email?: string;
      deliveryMode?: OtpDeliveryMode;
      cooldownSeconds?: number;
      retryAfterSeconds?: number;
      previewCode?: string;
    };
  }> {
    const cfg = resolveSuperAdminConfig(getEnv());
    if (cfg.persistenceError) {
      return {
        status: 503,
        body: { ok: false, error: cfg.persistenceError },
      };
    }

    const bodyObj =
      params.body && typeof params.body === 'object'
        ? (params.body as Record<string, unknown>)
        : {};
    const email = normalizeEmail(bodyObj.email);
    if (!isValidEmail(email)) {
      return {
        status: 400,
        body: { ok: false, error: 'Enter a valid Super Admin email address.' },
      };
    }

    const store = resolveStore(cfg);
    try {
      const existing = await store.getRecord();
      if (!existing || !safeEqualStrings(email, existing.email)) {
        return {
          status: 404,
          body: {
            ok: false,
            error: 'No verified Super Admin account matches that email address.',
          },
        };
      }
    } catch {
      return {
        status: 503,
        body: { ok: false, error: 'Authentication store is temporarily unavailable.' },
      };
    }

    const sent = await otpEngine.sendOtp({
      body: { email, purpose: 'reset' },
      clientIp: params.clientIp,
    });
    return {
      status: sent.status,
      body: {
        ...sent.body,
        ...(sent.body.ok ? { email } : {}),
      },
    };
  }

  async function resetPassword(params: {
    body: unknown;
    clientIp: string;
  }): Promise<{
    status: number;
    body: {
      ok: boolean;
      error?: string;
      identifier?: string;
      retryAfterSeconds?: number;
    };
  }> {
    const cfg = resolveSuperAdminConfig(getEnv());
    if (cfg.persistenceError) {
      return {
        status: 503,
        body: { ok: false, error: cfg.persistenceError },
      };
    }

    const store = resolveStore(cfg);
    const ipHash = sha256Hex(params.clientIp || 'unknown');
    try {
      const rl = await store.checkRateLimit(
        `pqguide:rl:sa_reset:${ipHash}`,
        SA_RL_WINDOW_MS,
        SA_MAX_RESET_REQUESTS
      );
      if (!rl.allowed) {
        return {
          status: 429,
          body: {
            ok: false,
            error: `Too many reset attempts. Please wait ${rl.retryAfterSeconds}s and try again.`,
            retryAfterSeconds: rl.retryAfterSeconds,
          },
        };
      }
    } catch {
      return {
        status: 503,
        body: { ok: false, error: 'Authentication store is temporarily unavailable.' },
      };
    }

    const bodyObj =
      params.body && typeof params.body === 'object'
        ? (params.body as Record<string, unknown>)
        : {};
    const email = normalizeEmail(bodyObj.email);
    const newPassword =
      typeof bodyObj.newPassword === 'string' ? bodyObj.newPassword : '';
    const confirmPassword =
      typeof bodyObj.confirmPassword === 'string' ? bodyObj.confirmPassword : '';
    const resetToken =
      typeof bodyObj.resetToken === 'string' ? bodyObj.resetToken.trim() : '';

    if (!isValidEmail(email)) {
      return {
        status: 400,
        body: { ok: false, error: 'Enter a valid Super Admin email address.' },
      };
    }
    const pwErr = validateStrongSuperAdminPassword(newPassword);
    if (pwErr) {
      return { status: 400, body: { ok: false, error: pwErr } };
    }
    if (newPassword !== confirmPassword) {
      return { status: 400, body: { ok: false, error: 'Passwords do not match.' } };
    }

    let existing: StoredSuperAdminRecord | null;
    try {
      existing = await store.getRecord();
    } catch {
      return {
        status: 503,
        body: { ok: false, error: 'Authentication store is temporarily unavailable.' },
      };
    }

    if (!existing || !safeEqualStrings(email, existing.email)) {
      return {
        status: 404,
        body: { ok: false, error: 'Super Admin account could not be found.' },
      };
    }

    const grant = await otpEngine.consumeResetGrant({
      body: { email, resetToken },
      clientIp: params.clientIp,
    });
    if (!grant.body.ok) {
      return {
        status: grant.status,
        body: {
          ok: false,
          error: grant.body.error,
          retryAfterSeconds: grant.body.retryAfterSeconds,
        },
      };
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashScryptPassword(newPassword, salt);
    const updated: StoredSuperAdminRecord = {
      ...existing,
      passwordHash,
      passwordSalt: salt,
      updatedAt: new Date(now()).toISOString(),
    };

    try {
      const saved = await store.updateRecord(updated);
      if (!saved) {
        return {
          status: 404,
          body: { ok: false, error: 'Super Admin account could not be updated.' },
        };
      }
      return {
        status: 200,
        body: {
          ok: true,
          identifier: existing.email,
        },
      };
    } catch {
      return {
        status: 503,
        body: { ok: false, error: 'Authentication store is temporarily unavailable.' },
      };
    }
  }

  return {
    getStatus,
    initializeFirstSuperAdmin,
    loginSuperAdmin,
    verifySession,
    requestPasswordReset,
    resetPassword,
  };
}

export const defaultSuperAdminEngine = createSuperAdminEngine();
