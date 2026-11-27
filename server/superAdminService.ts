import crypto from 'node:crypto';
import type { AuthenticatedUser } from '../src/core/types';
import {
  createOtpEngine,
  OTP_TTL_MS,
  RESEND_COOLDOWN_MS,
  sendVerificationEmailViaResend,
  type OtpDeliveryMode,
  type OtpEngineDeps,
} from './otpService.ts';

export const SUPER_ADMIN_KEY = 'pqguide:super_admin:record';
export const SA_INIT_OTP_KEY = 'pqguide:sa:init_otp';
export const SA_PENDING_INIT_KEY = 'pqguide:sa:pending_init';
export const SA_MFA_PREFIX = 'pqguide:sa:mfa:';
export const SA_SESSION_PREFIX = 'pqguide:sa:session:';

export const SA_SESSION_COOKIE_NAME = 'pqguide_sa_sid';
export const SUPER_ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const SA_PENDING_INIT_TTL_MS = 15 * 60 * 1000;
export const SA_MFA_TTL_MS = 5 * 60 * 1000;

export const SA_RL_WINDOW_MS = 10 * 60 * 1000;
export const SA_PW_FAIL_WINDOW_MS = 15 * 60 * 1000;
export const SA_MAX_INIT_REQUESTS = 10;
export const SA_MAX_LOGIN_REQUESTS = 15;
export const SA_MAX_PW_FAIL_ATTEMPTS = 8;
export const SA_MAX_TOTP_REQUESTS = 15;
export const SA_MAX_TOTP_FAIL_ATTEMPTS = 6;
export const SA_MAX_RESET_REQUESTS = 15;
export const SA_MAX_INIT_TOTP_ATTEMPTS = 5;
export const SA_MAX_MFA_TOTP_ATTEMPTS = 5;
export const SA_MAX_OTP_ATTEMPTS = 5;

const DEV_ONLY_FALLBACK_HMAC_SECRET =
  'pqguide-local-dev-only-otp-hmac-secret-do-not-use-in-prod';
const DEV_ONLY_FALLBACK_TOTP_KEY =
  'pqguide-local-dev-only-totp-aes256-encryption-key-do-not-use-in-prod';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface EncryptedTotpSecret {
  v: 1;
  alg: 'aes-256-gcm';
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface StoredRecoveryCodeHash {
  id: string;
  salt: string;
  hash: string;
  usedAt?: string;
}

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
  totpEnabled: true;
  totpEncrypted: EncryptedTotpSecret;
  lastTotpStep?: number;
  recoveryCodes: StoredRecoveryCodeHash[];
  sessionVersion: number;
  createdAt: string;
  updatedAt?: string;
  createdBy: 'production-bootstrap';
}

interface PendingInitRecord {
  tokenDigest: string;
  email: string;
  totpEncrypted: EncryptedTotpSecret;
  totpAttempts: number;
  expiresAt: number;
}

interface PendingMfaChallenge {
  sub: string;
  email: string;
  rememberMe: boolean;
  attempts: number;
  expiresAt: number;
}

interface StoredSuperAdminSessionRecord {
  sidHash: string;
  sub: string;
  email: string;
  sessionVersion: number;
  csrfToken: string;
  rememberMe: boolean;
  createdAt: number;
  expiresAt: number;
}

export interface SuperAdminEngineDeps extends OtpEngineDeps {
  otpEngine?: ReturnType<typeof createOtpEngine>;
}

const GET_KEY_LUA = `
return redis.call('GET', KEYS[1])
`.trim();

const SET_KEY_PX_LUA = `
redis.call('SET', KEYS[1], ARGV[1], 'PX', tonumber(ARGV[2]))
return {'OK'}
`.trim();

const DEL_KEY_LUA = `
return redis.call('DEL', KEYS[1])
`.trim();

const INIT_SUPER_ADMIN_ATOMIC_LUA = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  return {'ERR', 'EXISTS'}
end
redis.call('SET', KEYS[1], ARGV[1])
if KEYS[2] and KEYS[2] ~= '' then
  redis.call('DEL', KEYS[2])
end
return {'OK'}
`.trim();

const CAS_UPDATE_LUA = `
local current = redis.call('GET', KEYS[1])
if not current then
  return {'ERR', 'MISSING'}
end
if current ~= ARGV[1] then
  return {'ERR', 'CONFLICT'}
end
redis.call('SET', KEYS[1], ARGV[2])
return {'OK'}
`.trim();

const ISSUE_OTP_LUA = `
local lastSentAt = redis.call('HGET', KEYS[1], 'lastSentAt')
if lastSentAt then
  local elapsed = tonumber(ARGV[2]) - tonumber(lastSentAt)
  if elapsed < tonumber(ARGV[3]) then
    local waitSec = math.max(1, math.ceil((tonumber(ARGV[3]) - elapsed) / 1000))
    return {'COOLDOWN', tostring(waitSec)}
  end
end
redis.call('HSET', KEYS[1], 'digestHex', ARGV[1], 'lastSentAt', ARGV[2], 'expiresAt', ARGV[4], 'attempts', '0')
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[5]))
return {'OK'}
`.trim();

const ROLLBACK_OTP_LUA = `
local current = redis.call('HGET', KEYS[1], 'digestHex')
if current == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
`.trim();

const VERIFY_OTP_LUA = `
local digestHex = redis.call('HGET', KEYS[1], 'digestHex')
if not digestHex then
  return {'ERR', 'MISSING'}
end
local expiresAt = tonumber(redis.call('HGET', KEYS[1], 'expiresAt') or '0')
if tonumber(ARGV[2]) > expiresAt then
  redis.call('DEL', KEYS[1])
  return {'ERR', 'EXPIRED'}
end
local attempts = tonumber(redis.call('HGET', KEYS[1], 'attempts') or '0')
local maxAttempts = tonumber(ARGV[3])
if attempts >= maxAttempts then
  redis.call('DEL', KEYS[1])
  return {'ERR', 'LOCKED'}
end
if digestHex == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return {'OK'}
end
local nextAttempts = attempts + 1
redis.call('HSET', KEYS[1], 'attempts', tostring(nextAttempts))
if nextAttempts >= maxAttempts then
  redis.call('DEL', KEYS[1])
  return {'ERR', 'LOCKED'}
end
return {'ERR', 'MISMATCH', tostring(maxAttempts - nextAttempts)}
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
  getRaw(key: string): Promise<string | null>;
  setRawPx(key: string, value: string, ttlMs: number): Promise<void>;
  delKey(key: string): Promise<number>;
  getRecord(): Promise<StoredSuperAdminRecord | null>;
  initRecordAtomic(record: StoredSuperAdminRecord, clearPendingKey?: string): Promise<boolean>;
  casUpdateRecord(expectedRaw: string, nextRecord: StoredSuperAdminRecord): Promise<'ok' | 'missing' | 'conflict'>;
  issueInitOtp(params: {
    digestHex: string;
    nowMs: number;
    cooldownMs: number;
    expiresAtMs: number;
    ttlMs: number;
  }): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }>;
  rollbackInitOtp(digestHex: string): Promise<void>;
  verifyInitOtp(params: {
    digestHex: string;
    nowMs: number;
    maxAttempts: number;
  }): Promise<
    | { ok: true }
    | { ok: false; reason: 'missing' | 'expired' | 'locked' | 'mismatch'; remaining?: number }
  >;
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

  async getRaw(key: string): Promise<string | null> {
    const raw = await this.runCommand<string | null>(['EVAL', GET_KEY_LUA, 1, key]);
    return typeof raw === 'string' ? raw : null;
  }

  async setRawPx(key: string, value: string, ttlMs: number): Promise<void> {
    await this.runCommand(['EVAL', SET_KEY_PX_LUA, 1, key, value, ttlMs]);
  }

  async delKey(key: string): Promise<number> {
    const res = await this.runCommand<number>(['EVAL', DEL_KEY_LUA, 1, key]);
    return Number(res) || 0;
  }

  async getRecord(): Promise<StoredSuperAdminRecord | null> {
    const raw = await this.getRaw(SUPER_ADMIN_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredSuperAdminRecord;
    } catch {
      return null;
    }
  }

  async initRecordAtomic(
    record: StoredSuperAdminRecord,
    clearPendingKey = ''
  ): Promise<boolean> {
    const keys = clearPendingKey ? [SUPER_ADMIN_KEY, clearPendingKey] : [SUPER_ADMIN_KEY];
    const res = await this.runCommand<string[]>([
      'EVAL',
      INIT_SUPER_ADMIN_ATOMIC_LUA,
      keys.length,
      ...keys,
      JSON.stringify(record),
    ]);
    return Array.isArray(res) && res[0] === 'OK';
  }

  async casUpdateRecord(
    expectedRaw: string,
    nextRecord: StoredSuperAdminRecord
  ): Promise<'ok' | 'missing' | 'conflict'> {
    const res = await this.runCommand<string[]>([
      'EVAL',
      CAS_UPDATE_LUA,
      1,
      SUPER_ADMIN_KEY,
      expectedRaw,
      JSON.stringify(nextRecord),
    ]);
    if (Array.isArray(res) && res[0] === 'OK') return 'ok';
    if (Array.isArray(res) && res[1] === 'CONFLICT') return 'conflict';
    return 'missing';
  }

  async issueInitOtp(params: {
    digestHex: string;
    nowMs: number;
    cooldownMs: number;
    expiresAtMs: number;
    ttlMs: number;
  }): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
    const res = await this.runCommand<string[]>([
      'EVAL',
      ISSUE_OTP_LUA,
      1,
      SA_INIT_OTP_KEY,
      params.digestHex,
      params.nowMs,
      params.cooldownMs,
      params.expiresAtMs,
      params.ttlMs,
    ]);
    if (Array.isArray(res) && res[0] === 'COOLDOWN') {
      return { ok: false, retryAfterSeconds: Math.max(1, Number(res[1]) || 1) };
    }
    return { ok: true };
  }

  async rollbackInitOtp(digestHex: string): Promise<void> {
    await this.runCommand(['EVAL', ROLLBACK_OTP_LUA, 1, SA_INIT_OTP_KEY, digestHex]);
  }

  async verifyInitOtp(params: {
    digestHex: string;
    nowMs: number;
    maxAttempts: number;
  }): Promise<
    | { ok: true }
    | { ok: false; reason: 'missing' | 'expired' | 'locked' | 'mismatch'; remaining?: number }
  > {
    const res = await this.runCommand<string[]>([
      'EVAL',
      VERIFY_OTP_LUA,
      1,
      SA_INIT_OTP_KEY,
      params.digestHex,
      params.nowMs,
      params.maxAttempts,
    ]);
    if (Array.isArray(res) && res[0] === 'OK') return { ok: true };
    const code = Array.isArray(res) ? res[1] : 'MISSING';
    if (code === 'EXPIRED') return { ok: false, reason: 'expired' };
    if (code === 'LOCKED') return { ok: false, reason: 'locked' };
    if (code === 'MISMATCH') {
      return { ok: false, reason: 'mismatch', remaining: Number(res[2] ?? '0') };
    }
    return { ok: false, reason: 'missing' };
  }
}

class DevMemorySuperAdminStore implements SuperAdminStore {
  readonly kind = 'memory-dev' as const;
  private readonly kv = new Map<string, { value: string; expiresAtMs?: number }>();
  private initOtp:
    | {
        digestHex: string;
        lastSentAt: number;
        expiresAt: number;
        attempts: number;
        ttlDeadline: number;
      }
    | null = null;
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

  async getRaw(key: string): Promise<string | null> {
    const entry = this.kv.get(key);
    if (!entry) return null;
    if (entry.expiresAtMs !== undefined && this.now() >= entry.expiresAtMs) {
      this.kv.delete(key);
      return null;
    }
    return entry.value;
  }

  async setRawPx(key: string, value: string, ttlMs: number): Promise<void> {
    this.kv.set(key, { value, expiresAtMs: this.now() + ttlMs });
  }

  async delKey(key: string): Promise<number> {
    return this.kv.delete(key) ? 1 : 0;
  }

  async getRecord(): Promise<StoredSuperAdminRecord | null> {
    const raw = await this.getRaw(SUPER_ADMIN_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredSuperAdminRecord;
    } catch {
      return null;
    }
  }

  async initRecordAtomic(
    record: StoredSuperAdminRecord,
    clearPendingKey = ''
  ): Promise<boolean> {
    if (this.kv.has(SUPER_ADMIN_KEY)) return false;
    this.kv.set(SUPER_ADMIN_KEY, { value: JSON.stringify(record) });
    if (clearPendingKey) this.kv.delete(clearPendingKey);
    return true;
  }

  async casUpdateRecord(
    expectedRaw: string,
    nextRecord: StoredSuperAdminRecord
  ): Promise<'ok' | 'missing' | 'conflict'> {
    const existing = this.kv.get(SUPER_ADMIN_KEY);
    if (!existing) return 'missing';
    if (existing.value !== expectedRaw) return 'conflict';
    this.kv.set(SUPER_ADMIN_KEY, { value: JSON.stringify(nextRecord) });
    return 'ok';
  }

  async issueInitOtp(params: {
    digestHex: string;
    nowMs: number;
    cooldownMs: number;
    expiresAtMs: number;
    ttlMs: number;
  }): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
    const nowMs = this.now();
    if (this.initOtp && nowMs >= this.initOtp.ttlDeadline) {
      this.initOtp = null;
    }
    if (this.initOtp && params.nowMs - this.initOtp.lastSentAt < params.cooldownMs) {
      return {
        ok: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((params.cooldownMs - (params.nowMs - this.initOtp.lastSentAt)) / 1000)
        ),
      };
    }
    this.initOtp = {
      digestHex: params.digestHex,
      lastSentAt: params.nowMs,
      expiresAt: params.expiresAtMs,
      attempts: 0,
      ttlDeadline: nowMs + params.ttlMs,
    };
    return { ok: true };
  }

  async rollbackInitOtp(digestHex: string): Promise<void> {
    if (this.initOtp?.digestHex === digestHex) {
      this.initOtp = null;
    }
  }

  async verifyInitOtp(params: {
    digestHex: string;
    nowMs: number;
    maxAttempts: number;
  }): Promise<
    | { ok: true }
    | { ok: false; reason: 'missing' | 'expired' | 'locked' | 'mismatch'; remaining?: number }
  > {
    if (this.initOtp && this.now() >= this.initOtp.ttlDeadline) {
      this.initOtp = null;
    }
    if (!this.initOtp) return { ok: false, reason: 'missing' };
    if (params.nowMs > this.initOtp.expiresAt) {
      this.initOtp = null;
      return { ok: false, reason: 'expired' };
    }
    if (this.initOtp.attempts >= params.maxAttempts) {
      this.initOtp = null;
      return { ok: false, reason: 'locked' };
    }
    if (this.initOtp.digestHex === params.digestHex) {
      this.initOtp = null;
      return { ok: true };
    }
    this.initOtp.attempts += 1;
    if (this.initOtp.attempts >= params.maxAttempts) {
      this.initOtp = null;
      return { ok: false, reason: 'locked' };
    }
    return {
      ok: false,
      reason: 'mismatch',
      remaining: params.maxAttempts - this.initOtp.attempts,
    };
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

function normalizeEmail(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 160;
}

interface ResolvedSuperAdminConfig {
  isProdLike: boolean;
  hmacSecret: string;
  totpEncryptionKey: string;
  setupSecret: string;
  bootstrapEmail: string;
  upstashUrl: string;
  upstashToken: string;
  persistenceError?: string;
  totpKeyError?: string;
  bootstrapEmailError?: string;
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
  const rawTotpKey = cleanEnvValue(env.TOTP_ENCRYPTION_KEY);
  const setupSecret = cleanEnvValue(env.SUPER_ADMIN_SETUP_SECRET);
  const bootstrapEmail = cleanEnvValue(env.SUPER_ADMIN_BOOTSTRAP_EMAIL).toLowerCase();
  const upstashUrl = cleanEnvValue(env.UPSTASH_REDIS_REST_URL);
  const upstashToken = cleanEnvValue(env.UPSTASH_REDIS_REST_TOKEN);

  let persistenceError: string | undefined;
  if ((upstashUrl && !upstashToken) || (!upstashUrl && upstashToken)) {
    persistenceError = 'Incomplete persistent authentication store configuration.';
  } else if (upstashUrl && !isValidHttpUrl(upstashUrl)) {
    persistenceError = 'Invalid authentication store URL configuration.';
  } else if (isProdLike && (!upstashUrl || !upstashToken)) {
    persistenceError = 'Persistent authentication store is required in production.';
  } else if (isProdLike && (!rawHmac || rawHmac.length < 16)) {
    persistenceError = 'OTP_HMAC_SECRET is required in production (minimum 16 characters).';
  } else if (rawHmac && rawHmac.length < 16) {
    persistenceError = 'Server signing secret must be at least 16 characters.';
  }

  let totpKeyError: string | undefined;
  if (isProdLike && (!rawTotpKey || rawTotpKey.length < 32)) {
    totpKeyError = 'TOTP_ENCRYPTION_KEY is required in production (minimum 32 characters).';
  } else if (rawTotpKey && rawTotpKey.length < 32) {
    totpKeyError = 'TOTP_ENCRYPTION_KEY must be at least 32 characters.';
  }

  let bootstrapEmailError: string | undefined;
  if (isProdLike && (!bootstrapEmail || !isValidEmail(bootstrapEmail))) {
    bootstrapEmailError =
      'SUPER_ADMIN_BOOTSTRAP_EMAIL is mandatory in production.';
  } else if (bootstrapEmail && !isValidEmail(bootstrapEmail)) {
    bootstrapEmailError = 'SUPER_ADMIN_BOOTSTRAP_EMAIL must be a valid email address.';
  }

  return {
    isProdLike,
    hmacSecret: persistenceError ? '' : rawHmac || DEV_ONLY_FALLBACK_HMAC_SECRET,
    totpEncryptionKey: totpKeyError
      ? ''
      : rawTotpKey || (isProdLike ? '' : DEV_ONLY_FALLBACK_TOTP_KEY),
    setupSecret,
    bootstrapEmail,
    upstashUrl: persistenceError ? '' : upstashUrl,
    upstashToken: persistenceError ? '' : upstashToken,
    persistenceError,
    totpKeyError,
    bootstrapEmailError,
  };
}

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmacHex(secret: string, domain: string, value: string): string {
  return crypto.createHmac('sha256', secret).update(`${domain}:${value}`).digest('hex');
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
  const {
    passwordHash: _h,
    passwordSalt: _s,
    totpEncrypted: _te,
    totpEnabled: _ten,
    lastTotpStep: _lts,
    recoveryCodes: _rc,
    sessionVersion: _sv,
    ...publicUser
  } = record;
  return publicUser;
}

// ---------------------------------------------------------------------------
// RFC 6238 TOTP & AES-256-GCM Secret Protection
// ---------------------------------------------------------------------------

export function generateBase32Secret(byteLen = 20): string {
  const bytes = crypto.randomBytes(byteLen);
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function decodeBase32(rawSecret: string): Buffer {
  const clean = rawSecret.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpCode(
  secretBase32: string,
  timestampMs = Date.now(),
  stepSeconds = 30,
  digits = 6
): string {
  const key = decodeBase32(secretBase32);
  const counter = Math.floor(timestampMs / 1000 / stepSeconds);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter), 0);
  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const codeInt =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(codeInt % 10 ** digits).padStart(digits, '0');
}

function verifyTotpCode(
  secretBase32: string,
  rawCode: string,
  timestampMs: number,
  windowSteps = 1
): { valid: true; step: number } | { valid: false } {
  const clean = rawCode.replace(/\s+/g, '').trim();
  if (!/^\d{6}$/.test(clean)) return { valid: false };
  const currentStep = Math.floor(timestampMs / 1000 / 30);
  const candidateBuf = Buffer.from(clean, 'utf8');

  let matchedStep: number | null = null;
  for (let delta = -windowSteps; delta <= windowSteps; delta += 1) {
    const step = currentStep + delta;
    if (step < 0) continue;
    const expected = generateTotpCode(secretBase32, step * 30 * 1000, 30, 6);
    const expectedBuf = Buffer.from(expected, 'utf8');
    if (
      candidateBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(candidateBuf, expectedBuf)
    ) {
      matchedStep = step;
    }
  }
  return matchedStep !== null ? { valid: true, step: matchedStep } : { valid: false };
}

function deriveAes256Key(masterKey: string): Buffer {
  return Buffer.from(
    crypto.hkdfSync(
      'sha256',
      Buffer.from(masterKey, 'utf8'),
      Buffer.from('pqguide-totp-aes256-salt-v1', 'utf8'),
      Buffer.from('pqguide-sa-totp-secret', 'utf8'),
      32
    )
  );
}

function encryptTotpSecret(
  secretBase32: string,
  email: string,
  totpEncryptionKey: string
): EncryptedTotpSecret {
  const key = deriveAes256Key(totpEncryptionKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`pqguide:sa:totp:${email}`, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(secretBase32, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64url'),
    tag: tag.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  };
}

function decryptTotpSecret(
  payload: EncryptedTotpSecret,
  email: string,
  totpEncryptionKey: string
): string | null {
  try {
    if (payload.v !== 1 || payload.alg !== 'aes-256-gcm') return null;
    const key = deriveAes256Key(totpEncryptionKey);
    const iv = Buffer.from(payload.iv, 'base64url');
    const tag = Buffer.from(payload.tag, 'base64url');
    const ciphertext = Buffer.from(payload.ciphertext, 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(`pqguide:sa:totp:${email}`, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Single-Use Recovery Codes
// ---------------------------------------------------------------------------

function normalizeRecoveryCode(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function hashRecoveryCode(normalizedCode: string, salt: string, hmacSecret: string): string {
  return hmacHex(hmacSecret, `pqguide-sa-recovery:v1:${salt}`, normalizedCode);
}

function generateRecoveryCodesBundle(
  hmacSecret: string,
  count = 10
): { plaintextCodes: string[]; storedHashes: StoredRecoveryCodeHash[] } {
  const plaintextCodes: string[] = [];
  const storedHashes: StoredRecoveryCodeHash[] = [];

  for (let i = 0; i < count; i += 1) {
    const bytes = crypto.randomBytes(12);
    let raw = '';
    for (let j = 0; j < 12; j += 1) {
      raw += RECOVERY_ALPHABET[bytes[j] % RECOVERY_ALPHABET.length];
    }
    const formatted = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
    const salt = crypto.randomBytes(16).toString('hex');
    plaintextCodes.push(formatted);
    storedHashes.push({
      id: `rc_${i + 1}`,
      salt,
      hash: hashRecoveryCode(raw, salt, hmacSecret),
    });
  }

  return { plaintextCodes, storedHashes };
}

function consumeMatchingRecoveryCode(
  storedCodes: StoredRecoveryCodeHash[],
  rawCandidate: string,
  hmacSecret: string,
  usedAtIso: string
): { matched: true; updatedCodes: StoredRecoveryCodeHash[] } | { matched: false } {
  const normalized = normalizeRecoveryCode(rawCandidate);
  if (normalized.length < 8) return { matched: false };

  let matchedIndex = -1;
  for (let i = 0; i < storedCodes.length; i += 1) {
    const entry = storedCodes[i];
    if (entry.usedAt) continue;
    const candidateDigest = hashRecoveryCode(normalized, entry.salt, hmacSecret);
    if (safeEqualStrings(candidateDigest, entry.hash)) {
      matchedIndex = i;
    }
  }

  if (matchedIndex === -1) return { matched: false };
  const updatedCodes = storedCodes.map((entry, idx) =>
    idx === matchedIndex ? { ...entry, usedAt: usedAtIso } : entry
  );
  return { matched: true, updatedCodes };
}

// ---------------------------------------------------------------------------
// Cookie Builders & Parsers
// ---------------------------------------------------------------------------

export function parseCookieHeader(header: string | undefined): Record<string, string> {
  if (!header || typeof header !== 'string') return {};
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(val);
    } catch {
      result[key] = val;
    }
  }
  return result;
}

export function buildSuperAdminSessionCookie(params: {
  rawSessionId: string;
  isHttps: boolean;
  rememberMe: boolean;
}): string {
  const parts = [
    `${SA_SESSION_COOKIE_NAME}=${encodeURIComponent(params.rawSessionId)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
  ];
  if (params.isHttps) {
    parts.push('Secure');
  }
  if (params.rememberMe) {
    parts.push(`Max-Age=${Math.floor(SUPER_ADMIN_SESSION_TTL_MS / 1000)}`);
  }
  return parts.join('; ');
}

export function buildClearSuperAdminSessionCookie(isHttps: boolean): string {
  const parts = [
    `${SA_SESSION_COOKIE_NAME}=`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (isHttps) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

// ---------------------------------------------------------------------------
// Engine Factory
// ---------------------------------------------------------------------------

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

  async function issueServerCookieSession(params: {
    store: SuperAdminStore;
    record: StoredSuperAdminRecord;
    rememberMe: boolean;
    isHttps: boolean;
  }): Promise<{ csrfToken: string; setCookie: string }> {
    const rawSid = crypto.randomBytes(32).toString('hex');
    const sidHash = sha256Hex(rawSid);
    const csrfToken = crypto.randomBytes(32).toString('hex');
    const nowMs = now();

    const sessionPayload: StoredSuperAdminSessionRecord = {
      sidHash,
      sub: params.record.id,
      email: params.record.email,
      sessionVersion: params.record.sessionVersion || 1,
      csrfToken,
      rememberMe: params.rememberMe,
      createdAt: nowMs,
      expiresAt: nowMs + SUPER_ADMIN_SESSION_TTL_MS,
    };

    await params.store.setRawPx(
      `${SA_SESSION_PREFIX}${sidHash}`,
      JSON.stringify(sessionPayload),
      SUPER_ADMIN_SESSION_TTL_MS
    );

    const setCookie = buildSuperAdminSessionCookie({
      rawSessionId: rawSid,
      isHttps: params.isHttps,
      rememberMe: params.rememberMe,
    });

    return { csrfToken, setCookie };
  }

  async function updateRecordWithCas(
    store: SuperAdminStore,
    mutate: (current: StoredSuperAdminRecord) => StoredSuperAdminRecord | null
  ): Promise<{ ok: true; record: StoredSuperAdminRecord } | { ok: false; reason: 'missing' | 'conflict' }> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const currentRaw = await store.getRaw(SUPER_ADMIN_KEY);
      if (!currentRaw) return { ok: false, reason: 'missing' };
      let parsed: StoredSuperAdminRecord;
      try {
        parsed = JSON.parse(currentRaw) as StoredSuperAdminRecord;
      } catch {
        return { ok: false, reason: 'missing' };
      }
      const next = mutate(parsed);
      if (!next) return { ok: false, reason: 'conflict' };
      const res = await store.casUpdateRecord(currentRaw, next);
      if (res === 'ok') return { ok: true, record: next };
      if (res === 'missing') return { ok: false, reason: 'missing' };
    }
    return { ok: false, reason: 'conflict' };
  }

  function validateSetupSecretAndBootstrapEmail(
    cfg: ResolvedSuperAdminConfig,
    suppliedSecret: string,
    email: string
  ): { status: number; error: string } | null {
    if (!cfg.setupSecret || cfg.setupSecret.length < 16) {
      return {
        status: 503,
        error: 'Super Admin initialization secret is not configured on the server.',
      };
    }
    if (cfg.totpKeyError) {
      return { status: 503, error: cfg.totpKeyError };
    }
    if (cfg.bootstrapEmailError) {
      return { status: 503, error: cfg.bootstrapEmailError };
    }
    if (!suppliedSecret || !safeEqualStrings(suppliedSecret, cfg.setupSecret)) {
      return { status: 403, error: 'Invalid server setup authorization key.' };
    }
    if (!isValidEmail(email)) {
      return { status: 400, error: 'Enter a valid Super Admin email address.' };
    }
    if (cfg.bootstrapEmail && !safeEqualStrings(email, cfg.bootstrapEmail)) {
      return {
        status: 403,
        error: 'This email is not authorized for first-time Super Admin initialization.',
      };
    }
    if (cfg.isProdLike && !cfg.bootstrapEmail) {
      return {
        status: 503,
        error: 'SUPER_ADMIN_BOOTSTRAP_EMAIL is mandatory in production.',
      };
    }
    return null;
  }

  async function getStatus(): Promise<{
    status: number;
    body: {
      ok: boolean;
      serverSupported: boolean;
      initialized: boolean;
      setupConfigured: boolean;
      emailLockedToConfigured: boolean;
      totpEncryptionConfigured: boolean;
      bootstrapEmailRequired: boolean;
      storage: 'upstash' | 'memory-dev';
      error?: string;
    };
  }> {
    const cfg = resolveSuperAdminConfig(getEnv());
    const hasTotpEncryption = Boolean(cfg.totpEncryptionKey && !cfg.totpKeyError);
    const hasBootstrapEmail = Boolean(cfg.bootstrapEmail && !cfg.bootstrapEmailError);
    const setupConfigured =
      cfg.setupSecret.length >= 16 &&
      hasTotpEncryption &&
      (!cfg.isProdLike || hasBootstrapEmail);

    if (cfg.persistenceError) {
      return {
        status: 503,
        body: {
          ok: false,
          serverSupported: cfg.isProdLike || Boolean(cfg.upstashUrl && cfg.upstashToken),
          initialized: false,
          setupConfigured: false,
          emailLockedToConfigured: hasBootstrapEmail,
          totpEncryptionConfigured: hasTotpEncryption,
          bootstrapEmailRequired: cfg.isProdLike,
          storage: cfg.upstashUrl && cfg.upstashToken ? 'upstash' : 'memory-dev',
          error: cfg.persistenceError,
        },
      };
    }

    const store = resolveStore(cfg);
    const serverSupported =
      cfg.isProdLike || store.kind === 'upstash' || cfg.setupSecret.length >= 16;

    try {
      const existing = await store.getRecord();
      return {
        status: 200,
        body: {
          ok: true,
          serverSupported,
          initialized: Boolean(existing),
          setupConfigured,
          emailLockedToConfigured: hasBootstrapEmail,
          totpEncryptionConfigured: hasTotpEncryption,
          bootstrapEmailRequired: cfg.isProdLike,
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
          emailLockedToConfigured: hasBootstrapEmail,
          totpEncryptionConfigured: hasTotpEncryption,
          bootstrapEmailRequired: cfg.isProdLike,
          storage: store.kind,
          error: 'Authentication store is temporarily unavailable.',
        },
      };
    }
  }

  async function sendInitOtp(params: {
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
      return { status: 503, body: { ok: false, error: cfg.persistenceError } };
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
            error: `Too many initialization attempts. Wait ${rl.retryAfterSeconds}s and try again.`,
            retryAfterSeconds: rl.retryAfterSeconds,
          },
        };
      }
      const existing = await store.getRecord();
      if (existing) {
        return {
          status: 409,
          body: {
            ok: false,
            error: 'A Super Admin account has already been initialized for this platform.',
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
    const email = normalizeEmail(bodyObj.email);

    const gateErr = validateSetupSecretAndBootstrapEmail(cfg, suppliedSecret, email);
    if (gateErr) {
      return { status: gateErr.status, body: { ok: false, error: gateErr.error } };
    }

    const envObj = getEnv();
    const resendApiKey = cleanEnvValue(envObj.RESEND_API_KEY);
    const emailFrom = cleanEnvValue(envObj.EMAIL_FROM) || 'PQGuide <onboarding@resend.dev>';

    if (cfg.isProdLike && !resendApiKey) {
      return {
        status: 503,
        body: { ok: false, error: 'Email verification delivery is not configured.' },
      };
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const digestHex = hmacHex(cfg.hmacSecret, 'pqguide-sa-init-otp:v1', `${email}:${code}`);
    const nowMs = now();

    let issued: { ok: true } | { ok: false; retryAfterSeconds: number };
    try {
      issued = await store.issueInitOtp({
        digestHex,
        nowMs,
        cooldownMs: RESEND_COOLDOWN_MS,
        expiresAtMs: nowMs + OTP_TTL_MS,
        ttlMs: OTP_TTL_MS + 60_000,
      });
    } catch {
      return {
        status: 503,
        body: { ok: false, error: 'Authentication store is temporarily unavailable.' },
      };
    }

    if (!issued.ok) {
      return {
        status: 429,
        body: {
          ok: false,
          error: `Please wait ${issued.retryAfterSeconds}s before requesting another setup code.`,
          retryAfterSeconds: issued.retryAfterSeconds,
        },
      };
    }

    let deliveryMode: OtpDeliveryMode = 'email';
    let previewCode: string | undefined;

    if (!resendApiKey) {
      deliveryMode = 'preview';
      previewCode = code;
    } else {
      const delivery = await sendVerificationEmailViaResend({
        fetchImpl,
        apiKey: resendApiKey,
        from: emailFrom,
        to: email,
        code,
        purpose: 'super_admin_init',
      });

      if (!delivery.ok) {
        try {
          await store.rollbackInitOtp(digestHex);
        } catch {
          // Best-effort rollback
        }
        return {
          status: delivery.status,
          body: { ok: false, error: delivery.error },
        };
      }
    }

    return {
      status: 200,
      body: {
        ok: true,
        email,
        deliveryMode,
        cooldownSeconds: Math.ceil(RESEND_COOLDOWN_MS / 1000),
        ...(previewCode ? { previewCode } : {}),
      },
    };
  }

  async function verifyInitOtp(params: {
    body: unknown;
    clientIp: string;
  }): Promise<{
    status: number;
    body: {
      ok: boolean;
      error?: string;
      retryAfterSeconds?: number;
      enrollmentToken?: string;
      otpauthUri?: string;
      manualSecret?: string;
      expiresInSeconds?: number;
    };
  }> {
    const cfg = resolveSuperAdminConfig(getEnv());
    if (cfg.persistenceError) {
      return { status: 503, body: { ok: false, error: cfg.persistenceError } };
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
            error: `Too many verification attempts. Wait ${rl.retryAfterSeconds}s and try again.`,
            retryAfterSeconds: rl.retryAfterSeconds,
          },
        };
      }
      const existing = await store.getRecord();
      if (existing) {
        return {
          status: 409,
          body: {
            ok: false,
            error: 'A Super Admin account has already been initialized for this platform.',
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
    const email = normalizeEmail(bodyObj.email);
    const rawCode = typeof bodyObj.code === 'string' ? bodyObj.code.replace(/\s+/g, '').trim() : '';

    const gateErr = validateSetupSecretAndBootstrapEmail(cfg, suppliedSecret, email);
    if (gateErr) {
      return { status: gateErr.status, body: { ok: false, error: gateErr.error } };
    }
    if (!/^\d{6}$/.test(rawCode)) {
      return {
        status: 400,
        body: { ok: false, error: 'Enter the 6-digit verification code sent to your email.' },
      };
    }

    const digestHex = hmacHex(cfg.hmacSecret, 'pqguide-sa-init-otp:v1', `${email}:${rawCode}`);
    const nowMs = now();

    try {
      const verify = await store.verifyInitOtp({
        digestHex,
        nowMs,
        maxAttempts: SA_MAX_OTP_ATTEMPTS,
      });
      if (!verify.ok) {
        if (verify.reason === 'mismatch') {
          return {
            status: 401,
            body: {
              ok: false,
              error: `Incorrect setup code. ${verify.remaining ?? 0} attempt(s) remaining.`,
            },
          };
        }
        return {
          status: 401,
          body: {
            ok: false,
            error:
              verify.reason === 'expired'
                ? 'Setup verification code expired. Request a new code.'
                : verify.reason === 'locked'
                  ? 'Too many incorrect code attempts. Request a new setup code.'
                  : 'No active setup code found. Request a setup verification code first.',
          },
        };
      }

      const enrollmentToken = crypto.randomBytes(32).toString('hex');
      const totpSecretBase32 = generateBase32Secret(20);
      const totpEncrypted = encryptTotpSecret(
        totpSecretBase32,
        email,
        cfg.totpEncryptionKey
      );

      const pendingRecord: PendingInitRecord = {
        tokenDigest: sha256Hex(enrollmentToken),
        email,
        totpEncrypted,
        totpAttempts: 0,
        expiresAt: nowMs + SA_PENDING_INIT_TTL_MS,
      };
      await store.setRawPx(
        SA_PENDING_INIT_KEY,
        JSON.stringify(pendingRecord),
        SA_PENDING_INIT_TTL_MS
      );

      const label = encodeURIComponent(`PQGuide:${email}`);
      const otpauthUri = `otpauth://totp/${label}?secret=${totpSecretBase32}&issuer=PQGuide&algorithm=SHA1&digits=6&period=30`;

      return {
        status: 200,
        body: {
          ok: true,
          enrollmentToken,
          otpauthUri,
          manualSecret: totpSecretBase32,
          expiresInSeconds: Math.floor(SA_PENDING_INIT_TTL_MS / 1000),
        },
      };
    } catch {
      return {
        status: 503,
        body: { ok: false, error: 'Authentication store is temporarily unavailable.' },
      };
    }
  }

  async function initializeFirstSuperAdmin(params: {
    body: unknown;
    clientIp: string;
    isHttps?: boolean;
  }): Promise<{
    status: number;
    setCookie?: string;
    body: {
      ok: boolean;
      error?: string;
      retryAfterSeconds?: number;
      account?: AuthenticatedUser;
      csrfToken?: string;
      recoveryCodes?: string[];
    };
  }> {
    const cfg = resolveSuperAdminConfig(getEnv());
    if (cfg.persistenceError) {
      return { status: 503, body: { ok: false, error: cfg.persistenceError } };
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
      const existing = await store.getRecord();
      if (existing) {
        return {
          status: 409,
          body: {
            ok: false,
            error: 'A Super Admin account has already been initialized for this platform.',
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
    const email = normalizeEmail(bodyObj.email);
    const gateErr = validateSetupSecretAndBootstrapEmail(cfg, suppliedSecret, email);
    if (gateErr) {
      return { status: gateErr.status, body: { ok: false, error: gateErr.error } };
    }

    const enrollmentToken =
      typeof bodyObj.enrollmentToken === 'string' ? bodyObj.enrollmentToken.trim() : '';
    const totpCode =
      typeof bodyObj.totpCode === 'string' ? bodyObj.totpCode.replace(/\s+/g, '').trim() : '';
    const fullName = sanitizeLine(bodyObj.fullName, 120);
    const password = typeof bodyObj.password === 'string' ? bodyObj.password : '';
    const confirmPassword =
      typeof bodyObj.confirmPassword === 'string' ? bodyObj.confirmPassword : '';
    const confirmationPhrase =
      typeof bodyObj.confirmationPhrase === 'string'
        ? bodyObj.confirmationPhrase.trim().toUpperCase()
        : '';
    const rememberMe = Boolean(bodyObj.rememberMe);

    if (!enrollmentToken) {
      return {
        status: 400,
        body: { ok: false, error: 'Complete email OTP verification before finalizing setup.' },
      };
    }
    if (fullName.length < 2) {
      return { status: 400, body: { ok: false, error: 'Enter the Super Admin full name.' } };
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
    if (!/^\d{6}$/.test(totpCode)) {
      return {
        status: 400,
        body: {
          ok: false,
          error: 'Enter the 6-digit code from your authenticator app to confirm 2FA enrollment.',
        },
      };
    }

    const nowMs = now();
    let pending: PendingInitRecord | null = null;
    try {
      const pendingRaw = await store.getRaw(SA_PENDING_INIT_KEY);
      if (pendingRaw) {
        pending = JSON.parse(pendingRaw) as PendingInitRecord;
      }
    } catch {
      return {
        status: 503,
        body: { ok: false, error: 'Authentication store is temporarily unavailable.' },
      };
    }

    if (!pending || nowMs > pending.expiresAt) {
      return {
        status: 401,
        body: {
          ok: false,
          error: 'Authenticator enrollment session expired. Verify your setup email OTP again.',
        },
      };
    }
    if (
      !safeEqualStrings(sha256Hex(enrollmentToken), pending.tokenDigest) ||
      !safeEqualStrings(email, pending.email)
    ) {
      return {
        status: 403,
        body: { ok: false, error: 'Invalid setup enrollment session.' },
      };
    }

    const decryptedTotpSecret = decryptTotpSecret(
      pending.totpEncrypted,
      email,
      cfg.totpEncryptionKey
    );
    if (!decryptedTotpSecret) {
      return {
        status: 503,
        body: { ok: false, error: 'Unable to verify authenticator enrollment key.' },
      };
    }

    const totpCheck = verifyTotpCode(decryptedTotpSecret, totpCode, nowMs, 1);
    if (!totpCheck.valid) {
      const nextAttempts = (pending.totpAttempts ?? 0) + 1;
      try {
        if (nextAttempts >= SA_MAX_INIT_TOTP_ATTEMPTS) {
          await store.delKey(SA_PENDING_INIT_KEY);
          return {
            status: 401,
            body: {
              ok: false,
              error: 'Too many invalid authenticator attempts. Restart email OTP verification.',
            },
          };
        }
        const remainingMs = Math.max(1000, pending.expiresAt - nowMs);
        await store.setRawPx(
          SA_PENDING_INIT_KEY,
          JSON.stringify({ ...pending, totpAttempts: nextAttempts }),
          remainingMs
        );
      } catch {
        // Best-effort counter update
      }
      return {
        status: 401,
        body: {
          ok: false,
          error: 'Invalid 6-digit authenticator code. Check device time and try again.',
        },
      };
    }

    const nowIso = new Date(nowMs).toISOString();
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashScryptPassword(password, salt);
    const { plaintextCodes, storedHashes } = generateRecoveryCodesBundle(cfg.hmacSecret, 10);

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
      totpEnabled: true,
      totpEncrypted: encryptTotpSecret(decryptedTotpSecret, email, cfg.totpEncryptionKey),
      lastTotpStep: totpCheck.step,
      recoveryCodes: storedHashes,
      sessionVersion: 1,
      createdAt: nowIso,
      createdBy: 'production-bootstrap',
    };

    try {
      const created = await store.initRecordAtomic(record, SA_PENDING_INIT_KEY);
      if (!created) {
        return {
          status: 409,
          body: {
            ok: false,
            error: 'A Super Admin account has already been initialized for this platform.',
          },
        };
      }

      const session = await issueServerCookieSession({
        store,
        record,
        rememberMe,
        isHttps: Boolean(params.isHttps || cfg.isProdLike),
      });

      return {
        status: 200,
        setCookie: session.setCookie,
        body: {
          ok: true,
          account: toPublicAccount(record),
          csrfToken: session.csrfToken,
          recoveryCodes: plaintextCodes,
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
      requiresTotp?: boolean;
      mfaToken?: string;
      expiresInSeconds?: number;
    };
  }> {
    const cfg = resolveSuperAdminConfig(getEnv());
    if (cfg.persistenceError) {
      return { status: 503, body: { ok: false, error: cfg.persistenceError } };
    }
    if (cfg.totpKeyError) {
      return { status: 503, body: { ok: false, error: cfg.totpKeyError } };
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
    const rememberMe = Boolean(bodyObj.rememberMe);

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
        const failRl = await store.checkRateLimit(
          `pqguide:rl:sa_login_pw:${sha256Hex(existing.email)}`,
          SA_PW_FAIL_WINDOW_MS,
          SA_MAX_PW_FAIL_ATTEMPTS
        );
        if (!failRl.allowed) {
          return {
            status: 429,
            body: {
              ok: false,
              error: `Too many failed password attempts. Please wait ${failRl.retryAfterSeconds}s.`,
              retryAfterSeconds: failRl.retryAfterSeconds,
            },
          };
        }
        return {
          status: 401,
          body: { ok: false, error: 'Incorrect credentials. Check and try again.' },
        };
      }

      // Clear per-account password fail counter after valid password
      await store.delKey(`pqguide:rl:sa_login_pw:${sha256Hex(existing.email)}`);

      const mfaToken = crypto.randomBytes(32).toString('hex');
      const challenge: PendingMfaChallenge = {
        sub: existing.id,
        email: existing.email,
        rememberMe,
        attempts: 0,
        expiresAt: now() + SA_MFA_TTL_MS,
      };
      await store.setRawPx(
        `${SA_MFA_PREFIX}${sha256Hex(mfaToken)}`,
        JSON.stringify(challenge),
        SA_MFA_TTL_MS
      );

      return {
        status: 200,
        body: {
          ok: true,
          requiresTotp: true,
          mfaToken,
          expiresInSeconds: Math.floor(SA_MFA_TTL_MS / 1000),
        },
      };
    } catch {
      return {
        status: 503,
        body: { ok: false, error: 'Authentication store is temporarily unavailable.' },
      };
    }
  }

  async function verifyTotp(params: {
    body: unknown;
    clientIp: string;
    isHttps?: boolean;
  }): Promise<{
    status: number;
    setCookie?: string;
    body: {
      ok: boolean;
      error?: string;
      retryAfterSeconds?: number;
      account?: AuthenticatedUser;
      csrfToken?: string;
    };
  }> {
    const cfg = resolveSuperAdminConfig(getEnv());
    if (cfg.persistenceError) {
      return { status: 503, body: { ok: false, error: cfg.persistenceError } };
    }
    if (cfg.totpKeyError) {
      return { status: 503, body: { ok: false, error: cfg.totpKeyError } };
    }

    const store = resolveStore(cfg);
    const ipHash = sha256Hex(params.clientIp || 'unknown');
    try {
      const rl = await store.checkRateLimit(
        `pqguide:rl:sa_totp:${ipHash}`,
        SA_RL_WINDOW_MS,
        SA_MAX_TOTP_REQUESTS
      );
      if (!rl.allowed) {
        return {
          status: 429,
          body: {
            ok: false,
            error: `Too many 2FA attempts. Please wait ${rl.retryAfterSeconds}s and try again.`,
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
    const mfaToken = typeof bodyObj.mfaToken === 'string' ? bodyObj.mfaToken.trim() : '';
    const totpCode =
      typeof bodyObj.code === 'string'
        ? bodyObj.code.replace(/\s+/g, '').trim()
        : typeof bodyObj.totpCode === 'string'
          ? bodyObj.totpCode.replace(/\s+/g, '').trim()
          : '';
    const recoveryCode =
      typeof bodyObj.recoveryCode === 'string' ? bodyObj.recoveryCode.trim() : '';

    if (!mfaToken) {
      return {
        status: 400,
        body: { ok: false, error: 'Missing two-factor challenge token.' },
      };
    }
    if (!totpCode && !recoveryCode) {
      return {
        status: 400,
        body: { ok: false, error: 'Enter your 6-digit authenticator code or a recovery code.' },
      };
    }

    const mfaKey = `${SA_MFA_PREFIX}${sha256Hex(mfaToken)}`;
    const nowMs = now();

    try {
      const mfaRaw = await store.getRaw(mfaKey);
      if (!mfaRaw) {
        return {
          status: 401,
          body: {
            ok: false,
            error: 'Two-factor challenge expired or was already used. Sign in again.',
          },
        };
      }

      const challenge = JSON.parse(mfaRaw) as PendingMfaChallenge;
      if (nowMs > challenge.expiresAt) {
        await store.delKey(mfaKey);
        return {
          status: 401,
          body: { ok: false, error: 'Two-factor challenge expired. Sign in again.' },
        };
      }

      const existing = await store.getRecord();
      if (
        !existing ||
        existing.id !== challenge.sub ||
        existing.email !== challenge.email ||
        existing.status !== 'active'
      ) {
        await store.delKey(mfaKey);
        return {
          status: 401,
          body: { ok: false, error: 'Super Admin account is unavailable.' },
        };
      }

      let verifiedMethod: 'totp' | 'recovery' | null = null;
      let matchedTotpStep: number | undefined;

      if (totpCode) {
        const secret = decryptTotpSecret(
          existing.totpEncrypted,
          existing.email,
          cfg.totpEncryptionKey
        );
        if (!secret) {
          return {
            status: 503,
            body: { ok: false, error: 'Unable to verify authenticator configuration.' },
          };
        }
        const check = verifyTotpCode(secret, totpCode, nowMs, 1);
        if (check.valid) {
          if (existing.lastTotpStep !== undefined && check.step <= existing.lastTotpStep) {
            return {
              status: 401,
              body: {
                ok: false,
                error: 'This authenticator code was already used. Wait for the next code.',
              },
            };
          }
          verifiedMethod = 'totp';
          matchedTotpStep = check.step;
        }
      } else if (recoveryCode) {
        const nowIso = new Date(nowMs).toISOString();
        const rcCheck = consumeMatchingRecoveryCode(
          existing.recoveryCodes ?? [],
          recoveryCode,
          cfg.hmacSecret,
          nowIso
        );
        if (rcCheck.matched) {
          verifiedMethod = 'recovery';
        }
      }

      if (!verifiedMethod) {
        const failRl = await store.checkRateLimit(
          `pqguide:rl:sa_totp_fail:${sha256Hex(existing.email)}`,
          SA_RL_WINDOW_MS,
          SA_MAX_TOTP_FAIL_ATTEMPTS
        );
        const nextAttempts = (challenge.attempts ?? 0) + 1;
        if (!failRl.allowed || nextAttempts >= SA_MAX_MFA_TOTP_ATTEMPTS) {
          await store.delKey(mfaKey);
          return {
            status: !failRl.allowed ? 429 : 401,
            body: {
              ok: false,
              error: !failRl.allowed
                ? `Too many invalid 2FA attempts. Wait ${failRl.retryAfterSeconds}s and sign in again.`
                : 'Too many invalid authenticator attempts. Sign in again.',
              ...(failRl.allowed ? {} : { retryAfterSeconds: failRl.retryAfterSeconds }),
            },
          };
        }

        await store.setRawPx(
          mfaKey,
          JSON.stringify({ ...challenge, attempts: nextAttempts }),
          Math.max(1000, challenge.expiresAt - nowMs)
        );
        return {
          status: 401,
          body: {
            ok: false,
            error: totpCode
              ? 'Invalid 6-digit authenticator code.'
              : 'Invalid or already used recovery code.',
          },
        };
      }

      // Atomically consume MFA challenge token before persisting session
      const deletedCount = await store.delKey(mfaKey);
      if (deletedCount !== 1) {
        return {
          status: 401,
          body: { ok: false, error: 'Two-factor challenge has already been consumed.' },
        };
      }

      const nowIso = new Date(nowMs).toISOString();
      const casResult = await updateRecordWithCas(store, (current) => {
        if (verifiedMethod === 'totp' && matchedTotpStep !== undefined) {
          if (current.lastTotpStep !== undefined && matchedTotpStep <= current.lastTotpStep) {
            return null;
          }
          return {
            ...current,
            lastTotpStep: matchedTotpStep,
            updatedAt: nowIso,
          };
        }
        const rc = consumeMatchingRecoveryCode(
          current.recoveryCodes ?? [],
          recoveryCode,
          cfg.hmacSecret,
          nowIso
        );
        if (!rc.matched) return null;
        return {
          ...current,
          recoveryCodes: rc.updatedCodes,
          updatedAt: nowIso,
        };
      });

      if (!casResult.ok) {
        return {
          status: 401,
          body: { ok: false, error: 'Verification code was already consumed.' },
        };
      }

      await store.delKey(`pqguide:rl:sa_totp_fail:${sha256Hex(existing.email)}`);

      const rememberFinal =
        typeof bodyObj.rememberMe === 'boolean'
          ? bodyObj.rememberMe
          : challenge.rememberMe;

      const session = await issueServerCookieSession({
        store,
        record: casResult.record,
        rememberMe: rememberFinal,
        isHttps: Boolean(params.isHttps || cfg.isProdLike),
      });

      return {
        status: 200,
        setCookie: session.setCookie,
        body: {
          ok: true,
          account: toPublicAccount(casResult.record),
          csrfToken: session.csrfToken,
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
    cookieHeader?: string;
    isHttps?: boolean;
  }): Promise<{
    status: number;
    setCookie?: string;
    body: {
      ok: boolean;
      error?: string;
      account?: AuthenticatedUser;
      csrfToken?: string;
    };
  }> {
    const cfg = resolveSuperAdminConfig(getEnv());
    if (cfg.persistenceError) {
      return { status: 503, body: { ok: false, error: cfg.persistenceError } };
    }

    const cookies = parseCookieHeader(params.cookieHeader);
    const rawSid = cookies[SA_SESSION_COOKIE_NAME]?.trim() || '';
    const isHttps = Boolean(params.isHttps || cfg.isProdLike);

    if (!rawSid) {
      return {
        status: 401,
        body: { ok: false, error: 'Super Admin session cookie is missing.' },
      };
    }

    const store = resolveStore(cfg);
    const sidHash = sha256Hex(rawSid);
    const sessionKey = `${SA_SESSION_PREFIX}${sidHash}`;

    try {
      const sessionRaw = await store.getRaw(sessionKey);
      if (!sessionRaw) {
        return {
          status: 401,
          setCookie: buildClearSuperAdminSessionCookie(isHttps),
          body: { ok: false, error: 'Super Admin session is invalid or has expired.' },
        };
      }

      const session = JSON.parse(sessionRaw) as StoredSuperAdminSessionRecord;
      if (now() > session.expiresAt) {
        await store.delKey(sessionKey);
        return {
          status: 401,
          setCookie: buildClearSuperAdminSessionCookie(isHttps),
          body: { ok: false, error: 'Super Admin session has expired.' },
        };
      }

      const existing = await store.getRecord();
      if (
        !existing ||
        existing.id !== session.sub ||
        existing.email !== session.email ||
        existing.status !== 'active' ||
        (existing.sessionVersion || 1) !== session.sessionVersion
      ) {
        await store.delKey(sessionKey);
        return {
          status: 401,
          setCookie: buildClearSuperAdminSessionCookie(isHttps),
          body: { ok: false, error: 'Super Admin session is no longer active.' },
        };
      }

      return {
        status: 200,
        body: {
          ok: true,
          account: toPublicAccount(existing),
          csrfToken: session.csrfToken,
        },
      };
    } catch {
      return {
        status: 503,
        body: { ok: false, error: 'Authentication store is temporarily unavailable.' },
      };
    }
  }

  async function logoutSession(params: {
    cookieHeader?: string;
    csrfTokenHeader?: string;
    isHttps?: boolean;
  }): Promise<{
    status: number;
    setCookie?: string;
    body: { ok: boolean; error?: string };
  }> {
    const cfg = resolveSuperAdminConfig(getEnv());
    if (cfg.persistenceError) {
      return { status: 503, body: { ok: false, error: cfg.persistenceError } };
    }

    const isHttps = Boolean(params.isHttps || cfg.isProdLike);
    const cookies = parseCookieHeader(params.cookieHeader);
    const rawSid = cookies[SA_SESSION_COOKIE_NAME]?.trim() || '';
    if (!rawSid) {
      return {
        status: 401,
        setCookie: buildClearSuperAdminSessionCookie(isHttps),
        body: { ok: false, error: 'Super Admin session cookie is missing.' },
      };
    }

    const store = resolveStore(cfg);
    const sessionKey = `${SA_SESSION_PREFIX}${sha256Hex(rawSid)}`;
    try {
      const sessionRaw = await store.getRaw(sessionKey);
      if (!sessionRaw) {
        return {
          status: 401,
          setCookie: buildClearSuperAdminSessionCookie(isHttps),
          body: { ok: false, error: 'Super Admin session is invalid or has expired.' },
        };
      }

      const session = JSON.parse(sessionRaw) as StoredSuperAdminSessionRecord;
      const suppliedCsrf = params.csrfTokenHeader?.trim() || '';
      if (!suppliedCsrf || !safeEqualStrings(suppliedCsrf, session.csrfToken)) {
        return {
          status: 403,
          body: { ok: false, error: 'Invalid or missing CSRF security token.' },
        };
      }

      await store.delKey(sessionKey);
      return {
        status: 200,
        setCookie: buildClearSuperAdminSessionCookie(isHttps),
        body: { ok: true },
      };
    } catch {
      return {
        status: 503,
        body: { ok: false, error: 'Authentication store is temporarily unavailable.' },
      };
    }
  }

  async function logoutAllDevices(params: {
    cookieHeader?: string;
    csrfTokenHeader?: string;
    isHttps?: boolean;
  }): Promise<{
    status: number;
    setCookie?: string;
    body: { ok: boolean; error?: string };
  }> {
    const cfg = resolveSuperAdminConfig(getEnv());
    if (cfg.persistenceError) {
      return { status: 503, body: { ok: false, error: cfg.persistenceError } };
    }

    const isHttps = Boolean(params.isHttps || cfg.isProdLike);
    const cookies = parseCookieHeader(params.cookieHeader);
    const rawSid = cookies[SA_SESSION_COOKIE_NAME]?.trim() || '';
    if (!rawSid) {
      return {
        status: 401,
        setCookie: buildClearSuperAdminSessionCookie(isHttps),
        body: { ok: false, error: 'Super Admin session cookie is missing.' },
      };
    }

    const store = resolveStore(cfg);
    const sessionKey = `${SA_SESSION_PREFIX}${sha256Hex(rawSid)}`;
    try {
      const sessionRaw = await store.getRaw(sessionKey);
      if (!sessionRaw) {
        return {
          status: 401,
          setCookie: buildClearSuperAdminSessionCookie(isHttps),
          body: { ok: false, error: 'Super Admin session is invalid or has expired.' },
        };
      }

      const session = JSON.parse(sessionRaw) as StoredSuperAdminSessionRecord;
      const suppliedCsrf = params.csrfTokenHeader?.trim() || '';
      if (!suppliedCsrf || !safeEqualStrings(suppliedCsrf, session.csrfToken)) {
        return {
          status: 403,
          body: { ok: false, error: 'Invalid or missing CSRF security token.' },
        };
      }

      const nowIso = new Date(now()).toISOString();
      const updated = await updateRecordWithCas(store, (current) => {
        if (
          current.id !== session.sub ||
          current.email !== session.email ||
          (current.sessionVersion || 1) !== session.sessionVersion
        ) {
          return null;
        }
        return {
          ...current,
          sessionVersion: (current.sessionVersion || 1) + 1,
          updatedAt: nowIso,
        };
      });

      await store.delKey(sessionKey);

      if (!updated.ok) {
        return {
          status: 401,
          setCookie: buildClearSuperAdminSessionCookie(isHttps),
          body: { ok: false, error: 'Super Admin session is no longer active.' },
        };
      }

      return {
        status: 200,
        setCookie: buildClearSuperAdminSessionCookie(isHttps),
        body: { ok: true },
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
      return { status: 503, body: { ok: false, error: cfg.persistenceError } };
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
      return { status: 503, body: { ok: false, error: cfg.persistenceError } };
    }
    if (cfg.totpKeyError) {
      return { status: 503, body: { ok: false, error: cfg.totpKeyError } };
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
    const totpCode =
      typeof bodyObj.totpCode === 'string'
        ? bodyObj.totpCode.replace(/\s+/g, '').trim()
        : typeof bodyObj.code === 'string'
          ? bodyObj.code.replace(/\s+/g, '').trim()
          : '';
    const recoveryCode =
      typeof bodyObj.recoveryCode === 'string' ? bodyObj.recoveryCode.trim() : '';

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
    if (!totpCode && !recoveryCode) {
      return {
        status: 400,
        body: {
          ok: false,
          error:
            'Authenticator 2FA verification (6-digit TOTP code or single-use recovery code) is required to reset a Super Admin password.',
        },
      };
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

    const nowMs = now();
    const nowIso = new Date(nowMs).toISOString();
    let secondFactorMethod: 'totp' | 'recovery' | null = null;
    let matchedTotpStep: number | undefined;

    if (totpCode) {
      const secret = decryptTotpSecret(
        existing.totpEncrypted,
        existing.email,
        cfg.totpEncryptionKey
      );
      if (!secret) {
        return {
          status: 503,
          body: { ok: false, error: 'Unable to verify authenticator configuration.' },
        };
      }
      const check = verifyTotpCode(secret, totpCode, nowMs, 1);
      if (check.valid) {
        if (existing.lastTotpStep !== undefined && check.step <= existing.lastTotpStep) {
          return {
            status: 401,
            body: {
              ok: false,
              error: 'This authenticator code was already used. Wait for the next code.',
            },
          };
        }
        secondFactorMethod = 'totp';
        matchedTotpStep = check.step;
      }
    } else if (recoveryCode) {
      const rcCheck = consumeMatchingRecoveryCode(
        existing.recoveryCodes ?? [],
        recoveryCode,
        cfg.hmacSecret,
        nowIso
      );
      if (rcCheck.matched) {
        secondFactorMethod = 'recovery';
      }
    }

    if (!secondFactorMethod) {
      try {
        const failRl = await store.checkRateLimit(
          `pqguide:rl:sa_reset_2fa:${sha256Hex(existing.email)}`,
          SA_RL_WINDOW_MS,
          SA_MAX_TOTP_FAIL_ATTEMPTS
        );
        if (!failRl.allowed) {
          return {
            status: 429,
            body: {
              ok: false,
              error: `Too many invalid 2FA attempts during reset. Wait ${failRl.retryAfterSeconds}s.`,
              retryAfterSeconds: failRl.retryAfterSeconds,
            },
          };
        }
      } catch {
        return {
          status: 503,
          body: { ok: false, error: 'Authentication store is temporarily unavailable.' },
        };
      }
      return {
        status: 401,
        body: {
          ok: false,
          error: totpCode
            ? 'Invalid 6-digit authenticator code.'
            : 'Invalid or already used recovery code.',
        },
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

    try {
      const saved = await updateRecordWithCas(store, (current) => {
        if (secondFactorMethod === 'totp' && matchedTotpStep !== undefined) {
          if (current.lastTotpStep !== undefined && matchedTotpStep <= current.lastTotpStep) {
            return null;
          }
          return {
            ...current,
            passwordHash,
            passwordSalt: salt,
            lastTotpStep: matchedTotpStep,
            sessionVersion: (current.sessionVersion || 1) + 1,
            updatedAt: nowIso,
          };
        }
        const rc = consumeMatchingRecoveryCode(
          current.recoveryCodes ?? [],
          recoveryCode,
          cfg.hmacSecret,
          nowIso
        );
        if (!rc.matched) return null;
        return {
          ...current,
          passwordHash,
          passwordSalt: salt,
          recoveryCodes: rc.updatedCodes,
          sessionVersion: (current.sessionVersion || 1) + 1,
          updatedAt: nowIso,
        };
      });

      if (!saved.ok) {
        return {
          status: 401,
          body: { ok: false, error: 'Verification factor was already consumed. Try again.' },
        };
      }

      await store.delKey(`pqguide:rl:sa_reset_2fa:${sha256Hex(existing.email)}`);

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
    sendInitOtp,
    verifyInitOtp,
    initializeFirstSuperAdmin,
    loginSuperAdmin,
    verifyTotp,
    verifySession,
    logoutSession,
    logoutAllDevices,
    requestPasswordReset,
    resetPassword,
  };
}

export const defaultSuperAdminEngine = createSuperAdminEngine();
