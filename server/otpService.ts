import crypto from 'node:crypto';

export type OtpPurpose = 'signup' | 'reset' | 'admin_activate';
export type OtpDeliveryMode = 'email' | 'preview';

export const OTP_TTL_MS = 10 * 60 * 1000;
export const RESEND_COOLDOWN_SECONDS = 30;
export const RESEND_COOLDOWN_MS = RESEND_COOLDOWN_SECONDS * 1000;
export const MAX_VERIFY_ATTEMPTS = 5;
export const RESET_GRANT_TTL_MS = 10 * 60 * 1000;
export const IP_WINDOW_MS = 10 * 60 * 1000;
export const IP_MAX_SEND_REQUESTS = 15;
export const IP_MAX_VERIFY_REQUESTS = 30;

export interface OtpEngineDeps {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface SendOtpResult {
  status: number;
  body: {
    ok: boolean;
    error?: string;
    deliveryMode?: OtpDeliveryMode;
    cooldownSeconds?: number;
    retryAfterSeconds?: number;
    previewCode?: string;
  };
}

export interface VerifyOtpResult {
  status: number;
  body: {
    ok: boolean;
    error?: string;
    resetToken?: string;
    remainingAttempts?: number;
    retryAfterSeconds?: number;
  };
}

export interface ConsumeResetGrantResult {
  status: number;
  body: {
    ok: boolean;
    error?: string;
  };
}

export interface OtpStatusResult {
  status: number;
  body: {
    ok: boolean;
    configured: boolean;
    emailConfigured: boolean;
    persistenceConfigured: boolean;
    provider: 'resend' | 'preview';
    storage: 'upstash' | 'memory-dev';
    cooldownSeconds: number;
    error?: string;
  };
}

interface OtpStore {
  readonly kind: 'upstash' | 'memory-dev';
  checkRateLimit(key: string, windowMs: number, maxRequests: number): Promise<
    { allowed: true } | { allowed: false; retryAfterSeconds: number }
  >;
  issueOtp(params: {
    otpKey: string;
    digestHex: string;
    nowMs: number;
    cooldownMs: number;
    expiresAtMs: number;
    ttlMs: number;
  }): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }>;
  rollbackOtpIfDigest(otpKey: string, digestHex: string): Promise<void>;
  verifyAndConsumeOtp(params: {
    otpKey: string;
    candidateDigestHex: string;
    nowMs: number;
    maxAttempts: number;
    resetGrantKey?: string;
    resetGrantDigestHex?: string;
    resetGrantTtlMs?: number;
  }): Promise<
    | { ok: true }
    | {
        ok: false;
        reason: 'MISSING' | 'EXPIRED' | 'LOCKED' | 'MISMATCH';
        remainingAttempts?: number;
      }
  >;
  consumeResetGrant(resetGrantKey: string, grantDigestHex: string): Promise<boolean>;
}

const DEV_ONLY_FALLBACK_HMAC_SECRET =
  'pqguide-local-dev-only-otp-hmac-secret-do-not-use-in-prod';

const ISSUE_OTP_LUA = `
local lastSentAt = tonumber(redis.call('HGET', KEYS[1], 'lastSentAt') or '0')
local nowMs = tonumber(ARGV[2])
local cooldownMs = tonumber(ARGV[3])
if lastSentAt > 0 and (nowMs - lastSentAt) < cooldownMs then
  local waitSec = math.ceil((cooldownMs - (nowMs - lastSentAt)) / 1000)
  return {'COOLDOWN', tostring(math.max(1, waitSec))}
end
redis.call('HSET', KEYS[1], 'digestHex', ARGV[1], 'lastSentAt', ARGV[2], 'expiresAt', ARGV[4], 'attempts', '0')
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[5]))
return {'OK'}
`.trim();

const ROLLBACK_OTP_LUA = `
local digest = redis.call('HGET', KEYS[1], 'digestHex')
if digest == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
`.trim();

const VERIFY_OTP_LUA = `
local digest = redis.call('HGET', KEYS[1], 'digestHex')
if not digest then
  return {'ERR', 'MISSING'}
end
local expiresAt = tonumber(redis.call('HGET', KEYS[1], 'expiresAt') or '0')
if tonumber(ARGV[2]) > expiresAt then
  redis.call('DEL', KEYS[1])
  return {'ERR', 'EXPIRED'}
end
local attempts = tonumber(redis.call('HGET', KEYS[1], 'attempts') or '0')
if attempts >= tonumber(ARGV[3]) then
  redis.call('DEL', KEYS[1])
  return {'ERR', 'LOCKED'}
end
if digest == ARGV[1] then
  redis.call('DEL', KEYS[1])
  if ARGV[4] ~= '' and KEYS[2] then
    redis.call('SET', KEYS[2], ARGV[4], 'PX', tonumber(ARGV[5]))
  end
  return {'OK'}
end
local nextAttempts = redis.call('HINCRBY', KEYS[1], 'attempts', 1)
if nextAttempts >= tonumber(ARGV[3]) then
  redis.call('DEL', KEYS[1])
  return {'ERR', 'LOCKED'}
end
return {'ERR', 'MISMATCH', tostring(tonumber(ARGV[3]) - nextAttempts)}
`.trim();

const CONSUME_RESET_GRANT_LUA = `
local stored = redis.call('GET', KEYS[1])
if not stored then
  return {'ERR', 'MISSING'}
end
if stored == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return {'OK'}
end
return {'ERR', 'MISMATCH'}
`.trim();

const RATE_LIMIT_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[1]))
end
if current > tonumber(ARGV[2]) then
  local ttlMs = redis.call('PTTL', KEYS[1])
  return {'LIMIT', tostring(math.max(1, math.ceil(ttlMs / 1000)))}
end
return {'OK', tostring(current)}
`.trim();

class StoreUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreUnavailableError';
  }
}

class UpstashRedisOtpStore implements OtpStore {
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
      throw new StoreUnavailableError('Unable to reach verification store.');
    }

    if (!response.ok) {
      throw new StoreUnavailableError(`Verification store returned HTTP ${response.status}.`);
    }

    let payload: { result?: T; error?: string };
    try {
      payload = (await response.json()) as { result?: T; error?: string };
    } catch {
      throw new StoreUnavailableError('Invalid response from verification store.');
    }

    if (payload.error) {
      throw new StoreUnavailableError('Verification store command failed.');
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

  async issueOtp(params: {
    otpKey: string;
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
      params.otpKey,
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

  async rollbackOtpIfDigest(otpKey: string, digestHex: string): Promise<void> {
    try {
      await this.runCommand<number>(['EVAL', ROLLBACK_OTP_LUA, 1, otpKey, digestHex]);
    } catch {
      // Best-effort cleanup
    }
  }

  async verifyAndConsumeOtp(params: {
    otpKey: string;
    candidateDigestHex: string;
    nowMs: number;
    maxAttempts: number;
    resetGrantKey?: string;
    resetGrantDigestHex?: string;
    resetGrantTtlMs?: number;
  }): Promise<
    | { ok: true }
    | {
        ok: false;
        reason: 'MISSING' | 'EXPIRED' | 'LOCKED' | 'MISMATCH';
        remainingAttempts?: number;
      }
  > {
    const hasResetGrant = Boolean(
      params.resetGrantKey && params.resetGrantDigestHex && params.resetGrantTtlMs
    );
    const command: Array<string | number> = hasResetGrant
      ? [
          'EVAL',
          VERIFY_OTP_LUA,
          2,
          params.otpKey,
          params.resetGrantKey!,
          params.candidateDigestHex,
          params.nowMs,
          params.maxAttempts,
          params.resetGrantDigestHex!,
          params.resetGrantTtlMs!,
        ]
      : [
          'EVAL',
          VERIFY_OTP_LUA,
          1,
          params.otpKey,
          params.candidateDigestHex,
          params.nowMs,
          params.maxAttempts,
          '',
          0,
        ];

    const res = await this.runCommand<string[]>(command);
    if (Array.isArray(res) && res[0] === 'OK') {
      return { ok: true };
    }
    const reason = (Array.isArray(res) ? res[1] : 'MISSING') as
      | 'MISSING'
      | 'EXPIRED'
      | 'LOCKED'
      | 'MISMATCH';
    const remainingAttempts =
      reason === 'MISMATCH' && res[2] ? Number(res[2]) : undefined;
    return { ok: false, reason, remainingAttempts };
  }

  async consumeResetGrant(resetGrantKey: string, grantDigestHex: string): Promise<boolean> {
    const res = await this.runCommand<string[]>([
      'EVAL',
      CONSUME_RESET_GRANT_LUA,
      1,
      resetGrantKey,
      grantDigestHex,
    ]);
    return Array.isArray(res) && res[0] === 'OK';
  }
}

interface MemoryOtpEntry {
  digestHex: string;
  lastSentAt: number;
  expiresAt: number;
  attempts: number;
}

interface MemoryRateBucket {
  count: number;
  resetAt: number;
}

interface MemoryResetGrant {
  digestHex: string;
  expiresAt: number;
}

class DevMemoryOtpStore implements OtpStore {
  readonly kind = 'memory-dev' as const;
  private readonly otps = new Map<string, MemoryOtpEntry>();
  private readonly rateLimits = new Map<string, MemoryRateBucket>();
  private readonly resetGrants = new Map<string, MemoryResetGrant>();
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

  async issueOtp(params: {
    otpKey: string;
    digestHex: string;
    nowMs: number;
    cooldownMs: number;
    expiresAtMs: number;
  }): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
    const existing = this.otps.get(params.otpKey);
    if (existing && params.nowMs - existing.lastSentAt < params.cooldownMs) {
      const waitSec = Math.ceil(
        (params.cooldownMs - (params.nowMs - existing.lastSentAt)) / 1000
      );
      return { ok: false, retryAfterSeconds: Math.max(1, waitSec) };
    }
    this.otps.set(params.otpKey, {
      digestHex: params.digestHex,
      lastSentAt: params.nowMs,
      expiresAt: params.expiresAtMs,
      attempts: 0,
    });
    return { ok: true };
  }

  async rollbackOtpIfDigest(otpKey: string, digestHex: string): Promise<void> {
    const existing = this.otps.get(otpKey);
    if (existing && existing.digestHex === digestHex) {
      this.otps.delete(otpKey);
    }
  }

  async verifyAndConsumeOtp(params: {
    otpKey: string;
    candidateDigestHex: string;
    nowMs: number;
    maxAttempts: number;
    resetGrantKey?: string;
    resetGrantDigestHex?: string;
    resetGrantTtlMs?: number;
  }): Promise<
    | { ok: true }
    | {
        ok: false;
        reason: 'MISSING' | 'EXPIRED' | 'LOCKED' | 'MISMATCH';
        remainingAttempts?: number;
      }
  > {
    const entry = this.otps.get(params.otpKey);
    if (!entry) {
      return { ok: false, reason: 'MISSING' };
    }
    if (params.nowMs > entry.expiresAt) {
      this.otps.delete(params.otpKey);
      return { ok: false, reason: 'EXPIRED' };
    }
    if (entry.attempts >= params.maxAttempts) {
      this.otps.delete(params.otpKey);
      return { ok: false, reason: 'LOCKED' };
    }
    if (safeEqualHex(params.candidateDigestHex, entry.digestHex)) {
      this.otps.delete(params.otpKey);
      if (params.resetGrantKey && params.resetGrantDigestHex && params.resetGrantTtlMs) {
        this.resetGrants.set(params.resetGrantKey, {
          digestHex: params.resetGrantDigestHex,
          expiresAt: params.nowMs + params.resetGrantTtlMs,
        });
      }
      return { ok: true };
    }
    entry.attempts += 1;
    if (entry.attempts >= params.maxAttempts) {
      this.otps.delete(params.otpKey);
      return { ok: false, reason: 'LOCKED' };
    }
    return {
      ok: false,
      reason: 'MISMATCH',
      remainingAttempts: params.maxAttempts - entry.attempts,
    };
  }

  async consumeResetGrant(resetGrantKey: string, grantDigestHex: string): Promise<boolean> {
    const entry = this.resetGrants.get(resetGrantKey);
    if (!entry || this.now() > entry.expiresAt) {
      this.resetGrants.delete(resetGrantKey);
      return false;
    }
    if (!safeEqualHex(grantDigestHex, entry.digestHex)) {
      return false;
    }
    this.resetGrants.delete(resetGrantKey);
    return true;
  }
}

interface ResolvedOtpConfig {
  isProdLike: boolean;
  resendApiKey: string;
  emailFrom: string;
  hmacSecret: string;
  upstashUrl: string;
  upstashToken: string;
  configError?: string;
}

function isValidHttpUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
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

function resolveRuntimeConfig(env: Record<string, string | undefined>): ResolvedOtpConfig {
  const isProdLike =
    env.NODE_ENV === 'production' ||
    env.VERCEL === '1' ||
    env.VERCEL_ENV === 'production' ||
    env.VERCEL_ENV === 'preview';

  const resendApiKey = cleanEnvValue(env.RESEND_API_KEY);
  const emailFrom = cleanEnvValue(env.EMAIL_FROM) || 'PQGuide <onboarding@resend.dev>';
  const rawSecret = cleanEnvValue(env.OTP_HMAC_SECRET);
  const upstashUrl = cleanEnvValue(env.UPSTASH_REDIS_REST_URL);
  const upstashToken = cleanEnvValue(env.UPSTASH_REDIS_REST_TOKEN);

  if ((upstashUrl && !upstashToken) || (!upstashUrl && upstashToken)) {
    return {
      isProdLike,
      resendApiKey,
      emailFrom,
      hmacSecret: '',
      upstashUrl,
      upstashToken,
      configError: 'Verification storage configuration is incomplete.',
    };
  }

  if (upstashUrl && !isValidHttpUrl(upstashUrl)) {
    return {
      isProdLike,
      resendApiKey,
      emailFrom,
      hmacSecret: '',
      upstashUrl,
      upstashToken,
      configError: 'Verification storage endpoint configuration is invalid.',
    };
  }

  if (rawSecret && rawSecret.length < 16) {
    return {
      isProdLike,
      resendApiKey,
      emailFrom,
      hmacSecret: '',
      upstashUrl,
      upstashToken,
      configError: 'Verification signing configuration is invalid.',
    };
  }

  if (isProdLike) {
    if (!rawSecret) {
      return {
        isProdLike,
        resendApiKey,
        emailFrom,
        hmacSecret: '',
        upstashUrl,
        upstashToken,
        configError: 'Verification signing secret is not configured.',
      };
    }
    if (!upstashUrl || !upstashToken) {
      return {
        isProdLike,
        resendApiKey,
        emailFrom,
        hmacSecret: '',
        upstashUrl,
        upstashToken,
        configError: 'Persistent verification storage is not configured.',
      };
    }
    if (!resendApiKey) {
      return {
        isProdLike,
        resendApiKey,
        emailFrom,
        hmacSecret: '',
        upstashUrl,
        upstashToken,
        configError: 'Email verification delivery is not configured.',
      };
    }
  }

  return {
    isProdLike,
    resendApiKey,
    emailFrom,
    hmacSecret: rawSecret || DEV_ONLY_FALLBACK_HMAC_SECRET,
    upstashUrl,
    upstashToken,
  };
}

function isValidPurpose(value: unknown): value is OtpPurpose {
  return value === 'signup' || value === 'reset' || value === 'admin_activate';
}

function normalizeEmail(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().toLowerCase().slice(0, 160);
}

function isValidEmail(email: string): boolean {
  return Boolean(email) && email.length <= 160 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function sanitizeMatric(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 24);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashOtp(hmacSecret: string, email: string, purpose: OtpPurpose, code: string): string {
  return crypto
    .createHmac('sha256', hmacSecret)
    .update(`${purpose}:${email}:${code}`)
    .digest('hex');
}

function hashResetGrant(hmacSecret: string, email: string, token: string): string {
  return crypto
    .createHmac('sha256', hmacSecret)
    .update(`reset_grant:${email}:${token}`)
    .digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

async function sendVerificationEmailViaResend(params: {
  fetchImpl: typeof fetch;
  apiKey: string;
  from: string;
  to: string;
  code: string;
  purpose: OtpPurpose;
  matricNumber?: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const purposeLabel =
    params.purpose === 'signup'
      ? 'Human Verification for Student Registration'
      : params.purpose === 'admin_activate'
        ? 'School Admin Email Activation'
        : 'Password Reset Verification';

  const subject =
    params.purpose === 'signup'
      ? `${params.code} is your PQGuide verification code`
      : params.purpose === 'admin_activate'
        ? `${params.code} — Activate your PQGuide School Admin desk`
        : `${params.code} is your PQGuide password reset code`;

  const matricLine = params.matricNumber
    ? `<p style="margin:0 0 12px;color:#505460;font-size:14px;">Matric Number: <strong>${escapeHtml(params.matricNumber)}</strong></p>`
    : '';

  const html = `
    <div style="font-family:Inter,system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#F6F7F9;color:#1A1B20;">
      <div style="background:#FFFFFF;border:1px solid #E5E7EB;border-radius:20px;padding:24px;">
        <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#686C78;">PQGuide · ${escapeHtml(purposeLabel)}</p>
        <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#1A1B20;">Confirm you are human</h1>
        ${matricLine}
        <p style="margin:0 0 16px;color:#505460;font-size:14px;line-height:1.5;">
          Enter this 6-digit code in PQGuide to verify your email address. It expires in 10 minutes.
        </p>
        <div style="background:#1D1E23;color:#FFFFFF;border-radius:14px;padding:14px 18px;text-align:center;font-family:monospace;font-size:28px;font-weight:700;letter-spacing:0.22em;">
          ${escapeHtml(params.code)}
        </div>
        <p style="margin:16px 0 0;color:#686C78;font-size:12px;line-height:1.5;">
          If you did not request this verification code, you can safely ignore this email.
        </p>
      </div>
    </div>
  `.trim();

  const text = [
    `PQGuide - ${purposeLabel}`,
    params.matricNumber ? `Matric Number: ${params.matricNumber}` : '',
    `Your 6-digit verification code is: ${params.code}`,
    'This code expires in 10 minutes.',
  ]
    .filter(Boolean)
    .join('\n\n');

  let response: Response;
  try {
    response = await params.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: params.from,
        to: [params.to],
        subject,
        html,
        text,
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return {
      ok: false,
      status: 503,
      error: 'Unable to reach email delivery service. Please try again shortly.',
    };
  }

  if (response.ok) {
    return { ok: true };
  }

  let providerMsg = '';
  try {
    const body = (await response.json()) as { message?: string; name?: string };
    providerMsg = typeof body?.message === 'string' ? body.message.toLowerCase() : '';
  } catch {
    // Ignore parse errors
  }

  if (response.status === 401) {
    return {
      ok: false,
      status: 503,
      error: 'Email delivery service credentials are invalid. Please contact support.',
    };
  }

  if (
    response.status === 403 &&
    (providerMsg.includes('testing emails') ||
      providerMsg.includes('verify a domain') ||
      providerMsg.includes('own email'))
  ) {
    return {
      ok: false,
      status: 400,
      error:
        'Test mode can only deliver to the verified test inbox until a custom sending domain is configured.',
    };
  }

  if (response.status === 422 || response.status === 400) {
    return {
      ok: false,
      status: 400,
      error: 'Could not deliver verification email to that address. Check the email and try again.',
    };
  }

  if (response.status === 429) {
    return {
      ok: false,
      status: 429,
      error: 'Email delivery is temporarily busy. Please wait a moment and try again.',
    };
  }

  return {
    ok: false,
    status: 502,
    error: 'Email delivery service is temporarily unavailable. Please try again shortly.',
  };
}

export function createOtpEngine(deps: OtpEngineDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => Date.now());
  const devFallbackStore = new DevMemoryOtpStore(now);

  function getEnv(): Record<string, string | undefined> {
    return deps.env ?? process.env;
  }

  function resolveStore(cfg: ResolvedOtpConfig): OtpStore {
    if (cfg.upstashUrl && cfg.upstashToken) {
      return new UpstashRedisOtpStore(cfg.upstashUrl, cfg.upstashToken, fetchImpl);
    }
    return devFallbackStore;
  }

  function getStatus(): OtpStatusResult {
    const cfg = resolveRuntimeConfig(getEnv());
    const emailConfigured = Boolean(cfg.resendApiKey);
    const persistenceConfigured = Boolean(cfg.upstashUrl && cfg.upstashToken);
    const ready = !cfg.configError && (!cfg.isProdLike || (emailConfigured && persistenceConfigured));
    return {
      status: ready ? 200 : 503,
      body: {
        ok: ready,
        configured: emailConfigured && persistenceConfigured && !cfg.configError,
        emailConfigured,
        persistenceConfigured,
        provider: emailConfigured ? 'resend' : 'preview',
        storage: persistenceConfigured ? 'upstash' : 'memory-dev',
        cooldownSeconds: RESEND_COOLDOWN_SECONDS,
        error: cfg.configError,
      },
    };
  }

  async function sendOtp(params: {
    body: unknown;
    clientIp: string;
  }): Promise<SendOtpResult> {
    const cfg = resolveRuntimeConfig(getEnv());
    if (cfg.configError) {
      return {
        status: 503,
        body: { ok: false, error: cfg.configError },
      };
    }

    const store = resolveStore(cfg);
    const nowMs = now();
    const ipHash = sha256Hex(params.clientIp || 'unknown');

    try {
      const rl = await store.checkRateLimit(
        `pqguide:rl:otp_send:${ipHash}`,
        IP_WINDOW_MS,
        IP_MAX_SEND_REQUESTS
      );
      if (!rl.allowed) {
        return {
          status: 429,
          body: {
            ok: false,
            error: `Too many verification requests. Please wait ${rl.retryAfterSeconds}s and try again.`,
            retryAfterSeconds: rl.retryAfterSeconds,
          },
        };
      }
    } catch {
      return {
        status: 503,
        body: {
          ok: false,
          error: 'Verification service is temporarily unavailable. Please try again.',
        },
      };
    }

    const bodyObj =
      params.body && typeof params.body === 'object'
        ? (params.body as Record<string, unknown>)
        : {};
    const email = normalizeEmail(bodyObj.email);
    const purpose = bodyObj.purpose;
    const matricNumber = sanitizeMatric(bodyObj.matricNumber);

    if (!isValidEmail(email)) {
      return {
        status: 400,
        body: { ok: false, error: 'Enter a valid email address.' },
      };
    }
    if (!isValidPurpose(purpose)) {
      return {
        status: 400,
        body: { ok: false, error: 'Invalid verification purpose.' },
      };
    }

    const emailHash = sha256Hex(email);
    const otpKey = `pqguide:otp:${purpose}:${emailHash}`;
    const code = String(crypto.randomInt(100000, 1000000));
    const digestHex = hashOtp(cfg.hmacSecret, email, purpose, code);

    try {
      const issued = await store.issueOtp({
        otpKey,
        digestHex,
        nowMs,
        cooldownMs: RESEND_COOLDOWN_MS,
        expiresAtMs: nowMs + OTP_TTL_MS,
        ttlMs: OTP_TTL_MS,
      });

      if (!issued.ok) {
        return {
          status: 429,
          body: {
            ok: false,
            error: `Please wait ${issued.retryAfterSeconds}s before requesting another code.`,
            retryAfterSeconds: issued.retryAfterSeconds,
          },
        };
      }
    } catch {
      return {
        status: 503,
        body: {
          ok: false,
          error: 'Verification service is temporarily unavailable. Please try again.',
        },
      };
    }

    if (cfg.resendApiKey) {
      const sent = await sendVerificationEmailViaResend({
        fetchImpl,
        apiKey: cfg.resendApiKey,
        from: cfg.emailFrom,
        to: email,
        code,
        purpose,
        matricNumber: matricNumber || undefined,
      });

      if (!sent.ok) {
        await store.rollbackOtpIfDigest(otpKey, digestHex);
        return {
          status: sent.status,
          body: { ok: false, error: sent.error },
        };
      }

      return {
        status: 200,
        body: {
          ok: true,
          deliveryMode: 'email',
          cooldownSeconds: RESEND_COOLDOWN_SECONDS,
        },
      };
    }

    if (cfg.isProdLike) {
      await store.rollbackOtpIfDigest(otpKey, digestHex);
      return {
        status: 503,
        body: {
          ok: false,
          error: 'Email verification delivery is not configured.',
        },
      };
    }

    return {
      status: 200,
      body: {
        ok: true,
        deliveryMode: 'preview',
        cooldownSeconds: RESEND_COOLDOWN_SECONDS,
        previewCode: code,
      },
    };
  }

  async function verifyOtp(params: {
    body: unknown;
    clientIp: string;
  }): Promise<VerifyOtpResult> {
    const cfg = resolveRuntimeConfig(getEnv());
    if (cfg.configError) {
      return {
        status: 503,
        body: { ok: false, error: cfg.configError },
      };
    }

    const store = resolveStore(cfg);
    const nowMs = now();
    const ipHash = sha256Hex(params.clientIp || 'unknown');

    try {
      const rl = await store.checkRateLimit(
        `pqguide:rl:otp_verify:${ipHash}`,
        IP_WINDOW_MS,
        IP_MAX_VERIFY_REQUESTS
      );
      if (!rl.allowed) {
        return {
          status: 429,
          body: {
            ok: false,
            error: `Too many verification attempts. Please wait ${rl.retryAfterSeconds}s and try again.`,
            retryAfterSeconds: rl.retryAfterSeconds,
          },
        };
      }
    } catch {
      return {
        status: 503,
        body: {
          ok: false,
          error: 'Verification service is temporarily unavailable. Please try again.',
        },
      };
    }

    const bodyObj =
      params.body && typeof params.body === 'object'
        ? (params.body as Record<string, unknown>)
        : {};
    const email = normalizeEmail(bodyObj.email);
    const purpose = bodyObj.purpose;
    const rawCode = typeof bodyObj.code === 'string' ? bodyObj.code : '';
    const code = rawCode.replace(/\s+/g, '').trim();

    if (!isValidEmail(email)) {
      return {
        status: 400,
        body: { ok: false, error: 'Enter a valid email address.' },
      };
    }
    if (!isValidPurpose(purpose)) {
      return {
        status: 400,
        body: { ok: false, error: 'Invalid verification purpose.' },
      };
    }
    if (!/^\d{6}$/.test(code)) {
      return {
        status: 400,
        body: { ok: false, error: 'Enter the 6-digit verification code.' },
      };
    }

    const emailHash = sha256Hex(email);
    const otpKey = `pqguide:otp:${purpose}:${emailHash}`;
    const candidateDigestHex = hashOtp(cfg.hmacSecret, email, purpose, code);

    const resetToken =
      purpose === 'reset' ? crypto.randomBytes(24).toString('hex') : undefined;
    const resetGrantKey =
      purpose === 'reset' ? `pqguide:reset_grant:${emailHash}` : undefined;
    const resetGrantDigestHex =
      purpose === 'reset' && resetToken
        ? hashResetGrant(cfg.hmacSecret, email, resetToken)
        : undefined;

    try {
      const result = await store.verifyAndConsumeOtp({
        otpKey,
        candidateDigestHex,
        nowMs,
        maxAttempts: MAX_VERIFY_ATTEMPTS,
        resetGrantKey,
        resetGrantDigestHex,
        resetGrantTtlMs: purpose === 'reset' ? RESET_GRANT_TTL_MS : undefined,
      });

      if (!result.ok) {
        if (result.reason === 'EXPIRED' || result.reason === 'MISSING') {
          return {
            status: 400,
            body: {
              ok: false,
              error: 'Verification code expired or not found. Tap Resend code.',
            },
          };
        }
        if (result.reason === 'LOCKED') {
          return {
            status: 429,
            body: {
              ok: false,
              error: 'Too many incorrect attempts. Request a fresh verification code.',
              remainingAttempts: 0,
            },
          };
        }
        return {
          status: 400,
          body: {
            ok: false,
            error: 'Incorrect verification code. Check and try again.',
            remainingAttempts: result.remainingAttempts,
          },
        };
      }

      return {
        status: 200,
        body: resetToken ? { ok: true, resetToken } : { ok: true },
      };
    } catch {
      return {
        status: 503,
        body: {
          ok: false,
          error: 'Verification service is temporarily unavailable. Please try again.',
        },
      };
    }
  }

  async function consumeResetGrant(params: {
    body: unknown;
  }): Promise<ConsumeResetGrantResult> {
    const cfg = resolveRuntimeConfig(getEnv());
    if (cfg.configError) {
      return {
        status: 503,
        body: { ok: false, error: cfg.configError },
      };
    }

    const bodyObj =
      params.body && typeof params.body === 'object'
        ? (params.body as Record<string, unknown>)
        : {};
    const email = normalizeEmail(bodyObj.email);
    const resetToken =
      typeof bodyObj.resetToken === 'string' ? bodyObj.resetToken.trim() : '';

    if (!isValidEmail(email) || !resetToken || resetToken.length < 16) {
      return {
        status: 403,
        body: {
          ok: false,
          error: 'Password reset verification expired. Verify a fresh code first.',
        },
      };
    }

    const store = resolveStore(cfg);
    const emailHash = sha256Hex(email);
    const resetGrantKey = `pqguide:reset_grant:${emailHash}`;
    const grantDigestHex = hashResetGrant(cfg.hmacSecret, email, resetToken);

    try {
      const consumed = await store.consumeResetGrant(resetGrantKey, grantDigestHex);
      if (!consumed) {
        return {
          status: 403,
          body: {
            ok: false,
            error: 'Password reset session expired or already used. Verify a fresh code.',
          },
        };
      }
      return { status: 200, body: { ok: true } };
    } catch {
      return {
        status: 503,
        body: {
          ok: false,
          error: 'Verification service is temporarily unavailable. Please try again.',
        },
      };
    }
  }

  return {
    getStatus,
    sendOtp,
    verifyOtp,
    consumeResetGrant,
  };
}

export const defaultOtpEngine = createOtpEngine();
