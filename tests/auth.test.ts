import assert from 'node:assert/strict';
import fs from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import test, { after, beforeEach } from 'node:test';
import { createApiApp } from '../server.ts';
import { createOtpHttpHandlers } from '../server/httpAdapter.ts';
import {
  createOtpEngine,
  IP_MAX_SEND_REQUESTS,
  IP_MAX_VERIFY_REQUESTS,
  OTP_TTL_MS,
  RESEND_COOLDOWN_MS,
} from '../server/otpService.ts';
import statusHandler from '../api/auth/email-otp/status.ts';
import sendHandler from '../api/auth/email-otp/send.ts';
import verifyHandler from '../api/auth/email-otp/verify.ts';
import consumeResetHandler from '../api/auth/email-otp/consume-reset.ts';

// ---------------------------------------------------------------------------
// Upstash REST-compatible persistent in-memory Redis mock server
// Supports atomic EVAL Lua semantics matching server/otpService.ts scripts.
// ---------------------------------------------------------------------------

interface RedisEntry {
  type: 'hash' | 'string';
  hash?: Record<string, string>;
  str?: string;
  expiresAtMs?: number;
}

class MockUpstashRedisServer {
  private server: http.Server | null = null;
  private readonly data = new Map<string, RedisEntry>();
  private readonly nowFn: () => number;
  url = '';
  token = 'upstash-test-token-12345';

  constructor(nowFn: () => number) {
    this.nowFn = nowFn;
  }

  private purgeIfExpired(key: string): RedisEntry | undefined {
    const entry = this.data.get(key);
    if (!entry) return undefined;
    if (entry.expiresAtMs !== undefined && this.nowFn() >= entry.expiresAtMs) {
      this.data.delete(key);
      return undefined;
    }
    return entry;
  }

  clear(): void {
    this.data.clear();
  }

  snapshotKeys(): Array<[string, RedisEntry]> {
    return Array.from(this.data.entries());
  }

  private executeCommand(command: unknown[]): unknown {
    const op = String(command[0] ?? '').toUpperCase();
    if (op !== 'EVAL') {
      throw new Error(`Unsupported mock Redis command: ${op}`);
    }
    const script = String(command[1] ?? '');
    const numKeys = Number(command[2] ?? 0);
    const keys = command.slice(3, 3 + numKeys).map(String);
    const args = command.slice(3 + numKeys).map(String);

    // ISSUE_OTP_LUA
    if (script.includes("HGET', KEYS[1], 'lastSentAt'") && script.includes("'COOLDOWN'")) {
      const key = keys[0];
      const [digestHex, nowStr, cooldownStr, expiresAtStr, ttlStr] = args;
      const nowMs = Number(nowStr);
      const cooldownMs = Number(cooldownStr);
      const ttlMs = Number(ttlStr);
      const existing = this.purgeIfExpired(key);
      const lastSentAt = existing?.type === 'hash' ? Number(existing.hash?.lastSentAt ?? '0') : 0;
      if (lastSentAt > 0 && nowMs - lastSentAt < cooldownMs) {
        const waitSec = Math.ceil((cooldownMs - (nowMs - lastSentAt)) / 1000);
        return ['COOLDOWN', String(Math.max(1, waitSec))];
      }
      this.data.set(key, {
        type: 'hash',
        hash: {
          digestHex,
          lastSentAt: nowStr,
          expiresAt: expiresAtStr,
          attempts: '0',
        },
        expiresAtMs: this.nowFn() + ttlMs,
      });
      return ['OK'];
    }

    // ROLLBACK_OTP_LUA
    if (script.includes("HGET', KEYS[1], 'digestHex'") && script.includes('return 1')) {
      const key = keys[0];
      const digestHex = args[0];
      const existing = this.purgeIfExpired(key);
      if (existing?.type === 'hash' && existing.hash?.digestHex === digestHex) {
        this.data.delete(key);
        return 1;
      }
      return 0;
    }

    // VERIFY_OTP_LUA
    if (script.includes("HGET', KEYS[1], 'digestHex'") && script.includes("'MISMATCH'")) {
      const otpKey = keys[0];
      const resetGrantKey = keys[1];
      const [candidateDigest, nowStr, maxAttemptsStr, resetGrantDigest, resetGrantTtlStr] = args;
      const nowMs = Number(nowStr);
      const maxAttempts = Number(maxAttemptsStr);
      const existing = this.purgeIfExpired(otpKey);
      if (!existing || existing.type !== 'hash' || !existing.hash?.digestHex) {
        return ['ERR', 'MISSING'];
      }
      const expiresAt = Number(existing.hash.expiresAt ?? '0');
      if (nowMs > expiresAt) {
        this.data.delete(otpKey);
        return ['ERR', 'EXPIRED'];
      }
      const attempts = Number(existing.hash.attempts ?? '0');
      if (attempts >= maxAttempts) {
        this.data.delete(otpKey);
        return ['ERR', 'LOCKED'];
      }
      if (existing.hash.digestHex === candidateDigest) {
        this.data.delete(otpKey);
        if (resetGrantDigest && resetGrantKey) {
          this.data.set(resetGrantKey, {
            type: 'string',
            str: resetGrantDigest,
            expiresAtMs: this.nowFn() + Number(resetGrantTtlStr),
          });
        }
        return ['OK'];
      }
      const nextAttempts = attempts + 1;
      existing.hash.attempts = String(nextAttempts);
      if (nextAttempts >= maxAttempts) {
        this.data.delete(otpKey);
        return ['ERR', 'LOCKED'];
      }
      return ['ERR', 'MISMATCH', String(maxAttempts - nextAttempts)];
    }

    // CONSUME_RESET_GRANT_LUA
    if (script.includes("redis.call('GET', KEYS[1])") && script.includes("return {'ERR', 'MISMATCH'}")) {
      const key = keys[0];
      const grantDigest = args[0];
      const existing = this.purgeIfExpired(key);
      if (!existing || existing.type !== 'string' || !existing.str) {
        return ['ERR', 'MISSING'];
      }
      if (existing.str === grantDigest) {
        this.data.delete(key);
        return ['OK'];
      }
      return ['ERR', 'MISMATCH'];
    }

    // RATE_LIMIT_LUA
    if (script.includes("redis.call('INCR', KEYS[1])") && script.includes("'LIMIT'")) {
      const key = keys[0];
      const windowMs = Number(args[0]);
      const maxRequests = Number(args[1]);
      let existing = this.purgeIfExpired(key);
      if (!existing || existing.type !== 'string') {
        existing = {
          type: 'string',
          str: '1',
          expiresAtMs: this.nowFn() + windowMs,
        };
        this.data.set(key, existing);
      } else {
        existing.str = String(Number(existing.str ?? '0') + 1);
      }
      const current = Number(existing.str);
      if (current > maxRequests) {
        const ttlMs = Math.max(1, (existing.expiresAtMs ?? this.nowFn()) - this.nowFn());
        return ['LIMIT', String(Math.max(1, Math.ceil(ttlMs / 1000)))];
      }
      return ['OK', String(current)];
    }

    throw new Error('Unhandled Lua script in mock Redis');
  }

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      if (req.headers.authorization !== `Bearer ${this.token}`) {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        try {
          const command = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown[];
          const result = this.executeCommand(command);
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 200;
          res.end(JSON.stringify({ result }));
        } catch (err) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Bad command' }));
        }
      });
    });

    await new Promise<void>((resolve) => {
      this.server!.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = this.server.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('Failed to bind mock Redis server');
    }
    this.url = `http://127.0.0.1:${addr.port}`;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
  }
}

// ---------------------------------------------------------------------------
// Mock Resend + Fetch Router
// ---------------------------------------------------------------------------

interface CapturedEmail {
  authorization: string | null;
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  code: string;
}

function createResendAndFetchHarness(realFetch: typeof fetch) {
  const capturedEmails: CapturedEmail[] = [];
  let nextResendError: { status: number; body: Record<string, unknown> } | null = null;
  let throwResendNetworkError = false;

  const interceptedFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url === 'https://api.resend.com/emails') {
      if (throwResendNetworkError) {
        throw new Error('Simulated network failure');
      }
      if (nextResendError) {
        const errSpec = nextResendError;
        nextResendError = null;
        return new Response(JSON.stringify(errSpec.body), {
          status: errSpec.status,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const headers = new Headers(init?.headers);
      const payload = JSON.parse(String(init?.body ?? '{}')) as {
        from: string;
        to: string[];
        subject: string;
        html: string;
        text: string;
      };
      const match = payload.text.match(/\b(\d{6})\b/);
      capturedEmails.push({
        authorization: headers.get('Authorization'),
        from: payload.from,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        code: match ? match[1] : '',
      });
      return new Response(JSON.stringify({ id: `email_${capturedEmails.length}` }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return realFetch(input, init);
  };

  return {
    capturedEmails,
    setNextResendError(status: number, body: Record<string, unknown>) {
      nextResendError = { status, body };
    },
    setThrowNetworkError(val: boolean) {
      throwResendNetworkError = val;
    },
    fetchImpl: interceptedFetch,
  };
}

// ---------------------------------------------------------------------------
// Browser Storage Polyfill + Server Helper
// ---------------------------------------------------------------------------

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
}

const mockLocalStorage = new MemoryStorage();
const mockSessionStorage = new MemoryStorage();
(globalThis as Record<string, unknown>).window = {
  localStorage: mockLocalStorage,
  sessionStorage: mockSessionStorage,
  addEventListener: () => {},
  removeEventListener: () => {},
};

let virtualNow = Date.UTC(2026, 10, 26, 12, 0, 0);
const redis = new MockUpstashRedisServer(() => virtualNow);
const realFetch = globalThis.fetch.bind(globalThis);
const resendHarness = createResendAndFetchHarness(realFetch);

await redis.start();

const PROD_SECRET = 'pqguide-test-hmac-secret-32-chars-minimum-value';

function buildProdEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: 'production',
    RESEND_API_KEY: 're_test_live_key_secret',
    EMAIL_FROM: 'PQGuide <onboarding@resend.dev>',
    OTP_HMAC_SECRET: PROD_SECRET,
    UPSTASH_REDIS_REST_URL: redis.url,
    UPSTASH_REDIS_REST_TOKEN: redis.token,
    ...overrides,
  };
}

async function startTestAppServer(
  envOverrides: Record<string, string | undefined> = {},
  customNow: () => number = () => virtualNow
) {
  const app = createApiApp({
    env: buildProdEnv(envOverrides),
    fetchImpl: resendHarness.fetchImpl,
    now: customNow,
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Failed to start Express test server');
  }
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  return {
    baseUrl,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

let activeServerBaseUrl = '';

// Route relative /api/* fetches from authService to the active Express server
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (url.startsWith('/api/')) {
    assert.ok(activeServerBaseUrl, 'activeServerBaseUrl must be set before calling /api/*');
    return realFetch(`${activeServerBaseUrl}${url}`, init);
  }
  return realFetch(input, init);
}) as typeof fetch;

const { authService } = await import('../src/services/authService.ts');
const { archiveRepository } = await import('../src/services/archiveRepository.ts');

beforeEach(() => {
  virtualNow = Date.UTC(2026, 10, 26, 12, 0, 0);
  redis.clear();
  resendHarness.capturedEmails.length = 0;
  resendHarness.setThrowNetworkError(false);
  mockLocalStorage.clear();
  mockSessionStorage.clear();
  process.env.NODE_ENV = 'test-dev-bootstrap';
  authService.resetLocalDevData('RESET DEV DATA');
  archiveRepository.resetAllForDev();
  activeServerBaseUrl = '';
  delete process.env.NODE_ENV;
});

after(async () => {
  await redis.stop();
});

// ---------------------------------------------------------------------------
// 1. Student Signup & Resend Email OTP Delivery (+ safe error handling)
// ---------------------------------------------------------------------------
test('1. Student signup validates fields, sends 6-digit OTP via Resend, hides OTP in prod, and blocks unverified login', async () => {
  const srv = await startTestAppServer();
  activeServerBaseUrl = srv.baseUrl;
  try {
    // Password mismatch rejected cleanly without dispatching OTP
    const mismatch = await authService.startSignup({
      fullName: 'Tolu Adeyemi',
      matricNumber: '230404001',
      level: '200L',
      faculty: 'Science',
      department: 'Computer Science',
      email: 'pqguide@gmail.com',
      password: 'Password123',
      confirmPassword: 'Password999',
    });
    assert.equal(mismatch.ok, false);
    assert.match(mismatch.error ?? '', /do not match/i);
    assert.equal(resendHarness.capturedEmails.length, 0);

    // Valid signup triggers Resend email OTP
    const started = await authService.startSignup({
      fullName: 'Tolu Adeyemi',
      matricNumber: '230404001',
      level: '200L',
      faculty: 'Science',
      department: 'Computer Science',
      email: 'pqguide@gmail.com',
      password: 'Password123',
      confirmPassword: 'Password123',
    });
    assert.equal(started.ok, true);
    assert.equal(started.data?.deliveryMode, 'email');
    assert.equal(started.data?.cooldownSeconds, 30);
    // Never expose OTP in production response
    assert.equal(started.data?.verificationCode, undefined);

    assert.equal(resendHarness.capturedEmails.length, 1);
    const mail = resendHarness.capturedEmails[0];
    assert.equal(mail.authorization, 'Bearer re_test_live_key_secret');
    assert.equal(mail.from, 'PQGuide <onboarding@resend.dev>');
    assert.deepEqual(mail.to, ['pqguide@gmail.com']);
    assert.match(mail.code, /^\d{6}$/);

    // Verify Redis does not store plaintext OTP anywhere
    const redisDump = JSON.stringify(redis.snapshotKeys());
    assert.equal(redisDump.includes(mail.code), false);

    // Unverified account CANNOT sign in before OTP verification
    const unverifiedSignin = await authService.signinWithPortal(
      'student',
      '230404001',
      'Password123'
    );
    assert.equal(unverifiedSignin.ok, false);
    assert.match(unverifiedSignin.error ?? '', /no verified student account/i);

    // Resend error handling (403 sandbox restriction & 401 invalid API key) never leaks secrets
    resendHarness.setNextResendError(403, {
      message: 'You can only send testing emails to your own email address (pqguide@gmail.com).',
    });
    const sandboxErr = await realFetch(`${srv.baseUrl}/api/auth/email-otp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'other-student@example.com', purpose: 'signup' }),
    });
    assert.equal(sandboxErr.status, 400);
    const sandboxBody = (await sandboxErr.json()) as { ok: boolean; error: string };
    assert.equal(sandboxBody.ok, false);
    assert.match(sandboxBody.error, /verified test inbox/i);
    assert.equal(sandboxBody.error.includes('re_test'), false);

    resendHarness.setNextResendError(401, { message: 'API key re_test_live_key_secret invalid' });
    const authErr = await realFetch(`${srv.baseUrl}/api/auth/email-otp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'other2@example.com', purpose: 'signup' }),
    });
    assert.equal(authErr.status, 503);
    const authBody = (await authErr.json()) as { error: string };
    assert.equal(authBody.error.includes('re_test_live_key_secret'), false);
    assert.match(authBody.error, /credentials are invalid/i);
  } finally {
    await srv.close();
  }
});

// ---------------------------------------------------------------------------
// 2. Correct OTP verification, matric login, & duplicate prevention
// ---------------------------------------------------------------------------
test('2. Correct OTP activates verified student for matric login and prevents duplicate matric/email', async () => {
  const srv = await startTestAppServer();
  activeServerBaseUrl = srv.baseUrl;
  try {
    await authService.startSignup({
      fullName: 'Adaeze Obi',
      matricNumber: '240101012',
      level: '100L',
      faculty: 'Computing & Information Sciences',
      department: 'Cybersecurity',
      email: 'pqguide@gmail.com',
      password: 'Password123',
      confirmPassword: 'Password123',
    });

    const code = resendHarness.capturedEmails[0].code;
    const verified = await authService.verifySignupCode('pqguide@gmail.com', code);
    assert.equal(verified.ok, true);
    assert.equal(verified.data?.account.matricNumber, '240101012');
    assert.equal(verified.data?.account.role, 'student');
    assert.equal(verified.data?.account.isEmailVerified, true);
    assert.notEqual(authService.getActiveSession(), null);

    // Sign out and sign back in with 9-digit matric number + password
    authService.clearActiveSession();
    assert.equal(authService.getActiveSession(), null);

    const matricSignin = await authService.signinWithPortal('student', '240101012', 'Password123');
    assert.equal(matricSignin.ok, true);
    assert.equal(matricSignin.data?.account.email, 'pqguide@gmail.com');

    // Students CANNOT sign in with email on the student portal
    const emailSignin = await authService.signinWithPortal(
      'student',
      'pqguide@gmail.com',
      'Password123'
    );
    assert.equal(emailSignin.ok, false);
    assert.match(emailSignin.error ?? '', /digits only|9 digits/i);

    // Duplicate matric rejected
    const dupMatric = await authService.startSignup({
      fullName: 'Copy Cat',
      matricNumber: '240101012',
      faculty: 'Science',
      department: 'Physics & Electronics',
      email: 'fresh@gmail.com',
      password: 'Password123',
      confirmPassword: 'Password123',
    });
    assert.equal(dupMatric.ok, false);
    assert.match(dupMatric.error ?? '', /matric number already exists/i);

    // Duplicate email rejected
    const dupEmail = await authService.startSignup({
      fullName: 'Copy Cat',
      matricNumber: '240101099',
      faculty: 'Science',
      department: 'Physics & Electronics',
      email: 'pqguide@gmail.com',
      password: 'Password123',
      confirmPassword: 'Password123',
    });
    assert.equal(dupEmail.ok, false);
    assert.match(dupEmail.error ?? '', /already registered/i);
  } finally {
    await srv.close();
  }
});

// ---------------------------------------------------------------------------
// 3. Incorrect OTP rejection & max verification attempt lock
// ---------------------------------------------------------------------------
test('3. Incorrect OTP is rejected and locks after 5 failed attempts', async () => {
  const srv = await startTestAppServer();
  activeServerBaseUrl = srv.baseUrl;
  try {
    await authService.startSignup({
      fullName: 'Test Student',
      matricNumber: '230404002',
      faculty: 'Science',
      department: 'Computer Science',
      email: 'pqguide@gmail.com',
      password: 'Password123',
      confirmPassword: 'Password123',
    });
    const realCode = resendHarness.capturedEmails[0].code;
    const wrongCode = realCode === '111111' ? '222222' : '111111';

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const res = await realFetch(`${srv.baseUrl}/api/auth/email-otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'pqguide@gmail.com', purpose: 'signup', code: wrongCode }),
      });
      assert.equal(res.status, 400);
      const body = (await res.json()) as { ok: boolean; remainingAttempts: number };
      assert.equal(body.ok, false);
      assert.equal(body.remainingAttempts, 5 - attempt);
    }

    // 5th wrong attempt locks & deletes the OTP
    const fifth = await realFetch(`${srv.baseUrl}/api/auth/email-otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'pqguide@gmail.com', purpose: 'signup', code: wrongCode }),
    });
    assert.equal(fifth.status, 429);
    const fifthBody = (await fifth.json()) as { ok: boolean; remainingAttempts: number };
    assert.equal(fifthBody.ok, false);
    assert.equal(fifthBody.remainingAttempts, 0);

    // Even the real code now fails because the OTP was invalidated on lock
    const afterLock = await authService.verifySignupCode('pqguide@gmail.com', realCode);
    assert.equal(afterLock.ok, false);
  } finally {
    await srv.close();
  }
});

// ---------------------------------------------------------------------------
// 4. Expired OTP rejection (10-minute TTL)
// ---------------------------------------------------------------------------
test('4. Expired OTP is rejected after 10 minutes', async () => {
  const srv = await startTestAppServer();
  activeServerBaseUrl = srv.baseUrl;
  try {
    await authService.startSignup({
      fullName: 'Expiry Student',
      matricNumber: '230404003',
      faculty: 'Science',
      department: 'Computer Science',
      email: 'pqguide@gmail.com',
      password: 'Password123',
      confirmPassword: 'Password123',
    });
    const code = resendHarness.capturedEmails[0].code;

    // Advance past 10 minutes
    virtualNow += OTP_TTL_MS + 1000;

    const verifyExpired = await authService.verifySignupCode('pqguide@gmail.com', code);
    assert.equal(verifyExpired.ok, false);
    assert.match(verifyExpired.error ?? '', /expired or not found/i);
  } finally {
    await srv.close();
  }
});

// ---------------------------------------------------------------------------
// 5. OTP reuse rejection & concurrent atomic verification
// ---------------------------------------------------------------------------
test('5. OTP is single-use and rejects concurrent duplicate verification requests', async () => {
  const srv = await startTestAppServer();
  activeServerBaseUrl = srv.baseUrl;
  try {
    const sendRes = await realFetch(`${srv.baseUrl}/api/auth/email-otp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'pqguide@gmail.com', purpose: 'signup' }),
    });
    assert.equal(sendRes.status, 200);
    const code = resendHarness.capturedEmails[0].code;

    const [r1, r2] = await Promise.all([
      realFetch(`${srv.baseUrl}/api/auth/email-otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'pqguide@gmail.com', purpose: 'signup', code }),
      }),
      realFetch(`${srv.baseUrl}/api/auth/email-otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'pqguide@gmail.com', purpose: 'signup', code }),
      }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    assert.deepEqual(statuses, [200, 400]);

    // Sequential reuse also fails
    const r3 = await realFetch(`${srv.baseUrl}/api/auth/email-otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'pqguide@gmail.com', purpose: 'signup', code }),
    });
    assert.equal(r3.status, 400);
  } finally {
    await srv.close();
  }
});

// ---------------------------------------------------------------------------
// 6. Resend cooldown
// ---------------------------------------------------------------------------
test('6. Resend cooldown enforces 30s wait and aligns server retryAfterSeconds', async () => {
  const srv = await startTestAppServer();
  activeServerBaseUrl = srv.baseUrl;
  try {
    await authService.startSignup({
      fullName: 'Cooldown Student',
      matricNumber: '230404004',
      faculty: 'Science',
      department: 'Computer Science',
      email: 'pqguide@gmail.com',
      password: 'Password123',
      confirmPassword: 'Password123',
    });

    const immediateResend = await authService.resendCode('pqguide@gmail.com', 'signup');
    assert.equal(immediateResend.ok, false);
    assert.equal(immediateResend.retryAfterSeconds, 30);

    virtualNow += 15_000;
    const midResend = await authService.resendCode('pqguide@gmail.com', 'signup');
    assert.equal(midResend.ok, false);
    assert.equal(midResend.retryAfterSeconds, 15);

    virtualNow += RESEND_COOLDOWN_MS;
    const allowedResend = await authService.resendCode('pqguide@gmail.com', 'signup');
    assert.equal(allowedResend.ok, true);
    assert.equal(allowedResend.data?.cooldownSeconds, 30);
    assert.equal(resendHarness.capturedEmails.length, 2);
  } finally {
    await srv.close();
  }
});

// ---------------------------------------------------------------------------
// 7. Previous OTP invalidation after resend & purpose/email isolation
// ---------------------------------------------------------------------------
test('7. Previous OTP is invalidated after resend and isolated by purpose and email', async () => {
  const srv = await startTestAppServer();
  activeServerBaseUrl = srv.baseUrl;
  try {
    await authService.startSignup({
      fullName: 'Rotation Student',
      matricNumber: '230404005',
      faculty: 'Science',
      department: 'Computer Science',
      email: 'pqguide@gmail.com',
      password: 'Password123',
      confirmPassword: 'Password123',
    });
    const firstCode = resendHarness.capturedEmails[0].code;

    virtualNow += RESEND_COOLDOWN_MS + 1000;
    const resent = await authService.resendCode('pqguide@gmail.com', 'signup');
    assert.equal(resent.ok, true);
    const secondCode = resendHarness.capturedEmails[1].code;

    // Cross-purpose fails
    const wrongPurpose = await realFetch(`${srv.baseUrl}/api/auth/email-otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'pqguide@gmail.com', purpose: 'reset', code: secondCode }),
    });
    assert.equal(wrongPurpose.status, 400);

    // Cross-email fails
    const wrongEmail = await realFetch(`${srv.baseUrl}/api/auth/email-otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'other@example.com', purpose: 'signup', code: secondCode }),
    });
    assert.equal(wrongEmail.status, 400);

    // First OTP was invalidated on resend (unless random collision matched)
    if (firstCode !== secondCode) {
      const oldAttempt = await authService.verifySignupCode('pqguide@gmail.com', firstCode);
      assert.equal(oldAttempt.ok, false);
    }

    // Second OTP succeeds
    const validAttempt = await authService.verifySignupCode('pqguide@gmail.com', secondCode);
    assert.equal(validAttempt.ok, true);
  } finally {
    await srv.close();
  }
});

// ---------------------------------------------------------------------------
// 8. Forgot-password OTP, single-use reset token, and password reset
// ---------------------------------------------------------------------------
test('8. Forgot-password verifies OTP, enforces single-use resetToken, and resets password', async () => {
  const srv = await startTestAppServer();
  activeServerBaseUrl = srv.baseUrl;
  try {
    await authService.startSignup({
      fullName: 'Reset Student',
      matricNumber: '230404006',
      faculty: 'Science',
      department: 'Computer Science',
      email: 'pqguide@gmail.com',
      password: 'Password123',
      confirmPassword: 'Password123',
    });
    await authService.verifySignupCode('pqguide@gmail.com', resendHarness.capturedEmails[0].code);
    authService.clearActiveSession();

    // Request password reset by matric number
    const reqReset = await authService.requestPasswordReset('230404006', 'student');
    assert.equal(reqReset.ok, true);
    assert.equal(reqReset.data?.email, 'pqguide@gmail.com');
    const resetCode = resendHarness.capturedEmails[1].code;

    // Cannot complete password reset without verified resetToken
    const forgedReset = await authService.completePasswordReset(
      'pqguide@gmail.com',
      'NewPass123',
      'NewPass123',
      'forged-token-1234567890'
    );
    assert.equal(forgedReset.ok, false);

    // Verify reset OTP
    const verifiedReset = await authService.verifyResetCode('pqguide@gmail.com', resetCode);
    assert.equal(verifiedReset.ok, true);
    const resetToken = verifiedReset.data?.resetToken ?? '';
    assert.ok(resetToken.length >= 32);

    // Cannot reuse the OTP itself
    const reuseOtp = await authService.verifyResetCode('pqguide@gmail.com', resetCode);
    assert.equal(reuseOtp.ok, false);

    // Password mismatch rejected WITHOUT consuming resetToken
    const mismatchPw = await authService.completePasswordReset(
      'pqguide@gmail.com',
      'NewPass123',
      'Different123',
      resetToken
    );
    assert.equal(mismatchPw.ok, false);

    // Valid matching password consumes resetToken and updates password
    const saved = await authService.completePasswordReset(
      'pqguide@gmail.com',
      'NewPass123',
      'NewPass123',
      resetToken
    );
    assert.equal(saved.ok, true);
    assert.equal(saved.data?.identifier, '230404006');

    // Old password rejected, new password succeeds
    const oldLogin = await authService.signinWithPortal('student', '230404006', 'Password123');
    assert.equal(oldLogin.ok, false);
    const newLogin = await authService.signinWithPortal('student', '230404006', 'NewPass123');
    assert.equal(newLogin.ok, true);

    // Reset token cannot be reused
    const replayGrant = await authService.completePasswordReset(
      'pqguide@gmail.com',
      'AnotherPass123',
      'AnotherPass123',
      resetToken
    );
    assert.equal(replayGrant.ok, false);
  } finally {
    await srv.close();
  }
});

// ---------------------------------------------------------------------------
// 9. School Admin activation and approval restrictions
// ---------------------------------------------------------------------------
test('9. School Admin activation requires approved email, blocks unapproved/suspended/unverified admins, and sets password via OTP', async () => {
  const srv = await startTestAppServer();
  activeServerBaseUrl = srv.baseUrl;
  try {
    // Bootstrap dev Super Admin to provision an approved School Admin
    process.env.NODE_ENV = 'test-dev-bootstrap';
    const superRes = await authService.bootstrapFirstSuperAdmin({
      fullName: 'Lead Super',
      email: 'super@pqguide.local',
      password: 'SuperPassword123',
      confirmPassword: 'SuperPassword123',
      confirmationPhrase: 'INITIALIZE SUPER ADMIN',
    });
    assert.equal(superRes.ok, true);
    const superAdmin = superRes.data!.account;

    const createdAdmin = await authService.createSchoolAdminAccount(superAdmin, {
      fullName: 'Dr. Exam Officer',
      email: 'pqguide@gmail.com',
      schoolId: 'sch-aaua',
      grantEmailAccessOnly: true,
    });
    assert.equal(createdAdmin.ok, true);
    const adminId = createdAdmin.data!.account.id;
    authService.clearActiveSession(superAdmin);

    // Unapproved email rejected
    const unapproved = await authService.startSchoolAdminActivation('stranger@aaua.edu.ng');
    assert.equal(unapproved.ok, false);
    assert.match(unapproved.error ?? '', /not been granted/i);
    assert.equal(resendHarness.capturedEmails.length, 0);

    // Invited admin cannot bypass activation via forgot-password or direct signin
    const bypassSignin = await authService.signinWithPortal(
      'school_admin',
      'pqguide@gmail.com',
      'Anything123'
    );
    assert.equal(bypassSignin.ok, false);
    assert.match(bypassSignin.error ?? '', /Activate approved email/i);

    const bypassReset = await authService.requestPasswordReset('pqguide@gmail.com', 'school_admin');
    assert.equal(bypassReset.ok, false);
    assert.match(bypassReset.error ?? '', /Activate approved email/i);

    // Suspended admin cannot activate
    authService.setAccountStatus(superAdmin, adminId, 'suspended');
    const suspendedStart = await authService.startSchoolAdminActivation('pqguide@gmail.com');
    assert.equal(suspendedStart.ok, false);
    assert.match(suspendedStart.error ?? '', /suspended or revoked/i);

    // Reactivate, then unverify -> still blocked
    authService.setAccountStatus(superAdmin, adminId, 'active');
    authService.setAccountVerification(superAdmin, adminId, false);
    const unverifiedAdminStart = await authService.startSchoolAdminActivation('pqguide@gmail.com');
    assert.equal(unverifiedAdminStart.ok, false);
    assert.match(unverifiedAdminStart.error ?? '', /awaiting Super Admin verification/i);

    // Verify and activate cleanly via OTP
    authService.setAccountVerification(superAdmin, adminId, true);
    const actStart = await authService.startSchoolAdminActivation('pqguide@gmail.com');
    assert.equal(actStart.ok, true);
    const actCode = resendHarness.capturedEmails[0].code;

    // Mismatched password fails before consuming OTP
    const badPw = await authService.completeSchoolAdminActivation(
      'pqguide@gmail.com',
      actCode,
      'AdminPass123',
      'Mismatch123'
    );
    assert.equal(badPw.ok, false);

    // Correct OTP + strong matching password activates account
    const activated = await authService.completeSchoolAdminActivation(
      'pqguide@gmail.com',
      actCode,
      'AdminPass123',
      'AdminPass123'
    );
    assert.equal(activated.ok, true);
    assert.equal(activated.data?.account.role, 'school_admin');

    // Cannot cross-login onto student or super_admin portal
    const wrongPortal = await authService.signinWithPortal(
      'super_admin',
      'pqguide@gmail.com',
      'AdminPass123'
    );
    assert.equal(wrongPortal.ok, false);
    const rightPortal = await authService.signinWithPortal(
      'school_admin',
      'pqguide@gmail.com',
      'AdminPass123'
    );
    assert.equal(rightPortal.ok, true);
  } finally {
    await srv.close();
  }
});

// ---------------------------------------------------------------------------
// 10. Super Admin authentication, bootstrap, privilege escalation, & session expiry
// ---------------------------------------------------------------------------
test('10. Super Admin enforces dev-only bootstrap lock, role isolation, privilege restrictions, and 12h session expiry', async () => {
  const srv = await startTestAppServer();
  activeServerBaseUrl = srv.baseUrl;
  try {
    // Outside dev mode, bootstrap MUST be unavailable and rejected
    delete process.env.NODE_ENV;
    assert.equal(authService.isDevBootstrapAvailable(), false);
    const prodBlocked = await authService.bootstrapFirstSuperAdmin({
      fullName: 'Prod Attacker',
      email: 'attacker@pqguide.local',
      password: 'SuperPassword123',
      confirmPassword: 'SuperPassword123',
      confirmationPhrase: 'INITIALIZE SUPER ADMIN',
    });
    assert.equal(prodBlocked.ok, false);
    assert.match(prodBlocked.error ?? '', /disabled outside development mode/i);

    // In dev mode, first bootstrap succeeds once, then locks
    process.env.NODE_ENV = 'test-dev-bootstrap';
    assert.equal(authService.isDevBootstrapAvailable(), true);
    const firstBoot = await authService.bootstrapFirstSuperAdmin({
      fullName: 'Platform Owner',
      email: 'owner@pqguide.local',
      password: 'SuperPassword123',
      confirmPassword: 'SuperPassword123',
      confirmationPhrase: 'INITIALIZE SUPER ADMIN',
    });
    assert.equal(firstBoot.ok, true);
    assert.equal(authService.isDevBootstrapAvailable(), false);

    authService.clearActiveSession(firstBoot.data!.account);
    const secondBoot = await authService.bootstrapFirstSuperAdmin({
      fullName: 'Second Owner',
      email: 'owner2@pqguide.local',
      password: 'SuperPassword123',
      confirmPassword: 'SuperPassword123',
      confirmationPhrase: 'INITIALIZE SUPER ADMIN',
    });
    assert.equal(secondBoot.ok, false);
    assert.match(secondBoot.error ?? '', /already been initialized/i);

    // Register a normal student and verify student cannot elevate self or manage admins
    await authService.startSignup({
      fullName: 'Normal Student',
      matricNumber: '230404077',
      faculty: 'Science',
      department: 'Computer Science',
      email: 'pqguide@gmail.com',
      password: 'Password123',
      confirmPassword: 'Password123',
    });
    const stuRes = await authService.verifySignupCode(
      'pqguide@gmail.com',
      resendHarness.capturedEmails[0].code
    );
    assert.equal(stuRes.ok, true);
    const studentUser = stuRes.data!.account;
    assert.equal(studentUser.role, 'student');

    const elevateAdmin = await authService.createSchoolAdminAccount(studentUser, {
      fullName: 'Self Admin',
      email: 'self@pqguide.local',
      schoolId: 'sch-aaua',
    });
    assert.equal(elevateAdmin.ok, false);

    const studentResetDev = authService.resetLocalDevData('RESET DEV DATA', studentUser);
    assert.equal(studentResetDev.ok, false);

    // Super Admin portal rejects student credentials
    const studentOnSuperPortal = await authService.signinWithPortal(
      'super_admin',
      'pqguide@gmail.com',
      'Password123'
    );
    assert.equal(studentOnSuperPortal.ok, false);

    // Session expiry after 12h + 1ms invalidates session cleanly
    const realDateNow = Date.now;
    try {
      const startTs = realDateNow();
      Date.now = () => startTs + 12 * 60 * 60 * 1000 + 1000;
      assert.equal(authService.getActiveSession(), null);
      assert.equal(authService.consumeExpiredSessionNotice(), true);
    } finally {
      Date.now = realDateNow;
    }
  } finally {
    await srv.close();
  }
});

// ---------------------------------------------------------------------------
// 11. OTP persistence after server restart
// ---------------------------------------------------------------------------
test('11. OTP persists in Upstash Redis after server restart and verifies on restarted server', async () => {
  const srv1 = await startTestAppServer();
  const sendRes = await realFetch(`${srv1.baseUrl}/api/auth/email-otp/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'pqguide@gmail.com', purpose: 'signup' }),
  });
  assert.equal(sendRes.status, 200);
  const code = resendHarness.capturedEmails[0].code;

  // Shut down Server 1 completely
  await srv1.close();

  // Start fresh Server 2
  const srv2 = await startTestAppServer();
  try {
    const verifyRes = await realFetch(`${srv2.baseUrl}/api/auth/email-otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'pqguide@gmail.com', purpose: 'signup', code }),
    });
    assert.equal(verifyRes.status, 200);
    const verifyBody = (await verifyRes.json()) as { ok: boolean };
    assert.equal(verifyBody.ok, true);
  } finally {
    await srv2.close();
  }
});

// ---------------------------------------------------------------------------
// 12. OTP verification & reset-grant consumption across separate server instances
// ---------------------------------------------------------------------------
test('12. OTP issued on Server A verifies on Server B and consumes resetToken back on Server A', async () => {
  const srvA = await startTestAppServer();
  const srvB = await startTestAppServer();
  try {
    const sendRes = await realFetch(`${srvA.baseUrl}/api/auth/email-otp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'pqguide@gmail.com', purpose: 'reset' }),
    });
    assert.equal(sendRes.status, 200);
    const code = resendHarness.capturedEmails[0].code;

    // Cooldown also enforced across separate instances
    const immediateResendOnB = await realFetch(`${srvB.baseUrl}/api/auth/email-otp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'pqguide@gmail.com', purpose: 'reset' }),
    });
    assert.equal(immediateResendOnB.status, 429);

    // Verify on Server B -> returns resetToken
    const verifyOnB = await realFetch(`${srvB.baseUrl}/api/auth/email-otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'pqguide@gmail.com', purpose: 'reset', code }),
    });
    assert.equal(verifyOnB.status, 200);
    const verifyBody = (await verifyOnB.json()) as { ok: boolean; resetToken?: string };
    assert.equal(verifyBody.ok, true);
    assert.ok(verifyBody.resetToken);

    // Consume resetToken on Server A
    const consumeOnA = await realFetch(`${srvA.baseUrl}/api/auth/email-otp/consume-reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'pqguide@gmail.com', resetToken: verifyBody.resetToken }),
    });
    assert.equal(consumeOnA.status, 200);

    // Replay on Server B fails
    const replayOnB = await realFetch(`${srvB.baseUrl}/api/auth/email-otp/consume-reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'pqguide@gmail.com', resetToken: verifyBody.resetToken }),
    });
    assert.equal(replayOnB.status, 403);
  } finally {
    await Promise.all([srvA.close(), srvB.close()]);
  }
});

// ---------------------------------------------------------------------------
// 13. Persistent IP rate limiting across separate server instances
// ---------------------------------------------------------------------------
test('13. Rate limiting persists in Upstash Redis across separate server instances', async () => {
  const srvA = await startTestAppServer();
  const srvB = await startTestAppServer();
  try {
    // Send 15 requests alternating across Server A and Server B from IP 203.0.113.10
    for (let i = 0; i < IP_MAX_SEND_REQUESTS; i += 1) {
      const target = i % 2 === 0 ? srvA.baseUrl : srvB.baseUrl;
      const res = await realFetch(`${target}/api/auth/email-otp/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.10',
        },
        body: JSON.stringify({ email: `user${i}@gmail.com`, purpose: 'signup' }),
      });
      assert.equal(res.status, 200);
    }

    // 16th request from same IP on Server B is rate-limited
    const limitedSend = await realFetch(`${srvB.baseUrl}/api/auth/email-otp/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '203.0.113.10',
      },
      body: JSON.stringify({ email: 'user99@gmail.com', purpose: 'signup' }),
    });
    assert.equal(limitedSend.status, 429);
    const sendLimitBody = (await limitedSend.json()) as { retryAfterSeconds?: number };
    assert.ok((sendLimitBody.retryAfterSeconds ?? 0) > 0);

    // Different IP is unaffected
    const otherIpSend = await realFetch(`${srvB.baseUrl}/api/auth/email-otp/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '203.0.113.99',
      },
      body: JSON.stringify({ email: 'otherip@gmail.com', purpose: 'signup' }),
    });
    assert.equal(otherIpSend.status, 200);

    // Verify IP rate limit (30 requests)
    for (let i = 0; i < IP_MAX_VERIFY_REQUESTS; i += 1) {
      const target = i % 2 === 0 ? srvA.baseUrl : srvB.baseUrl;
      const res = await realFetch(`${target}/api/auth/email-otp/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '198.51.100.7',
        },
        body: JSON.stringify({ email: `v${i}@gmail.com`, purpose: 'signup', code: '000000' }),
      });
      assert.equal(res.status, 400);
    }

    const limitedVerify = await realFetch(`${srvA.baseUrl}/api/auth/email-otp/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '198.51.100.7',
      },
      body: JSON.stringify({ email: 'v99@gmail.com', purpose: 'signup', code: '000000' }),
    });
    assert.equal(limitedVerify.status, 429);
  } finally {
    await Promise.all([srvA.close(), srvB.close()]);
  }
});

// ---------------------------------------------------------------------------
// 14. Missing / invalid environment variables fail safely in production
// ---------------------------------------------------------------------------
test('14. Production and Vercel environments fail safely (503) when required secrets are missing or invalid', async () => {
  const cases: Array<{ name: string; env: Record<string, string | undefined> }> = [
    {
      name: 'missing OTP_HMAC_SECRET',
      env: buildProdEnv({ OTP_HMAC_SECRET: undefined }),
    },
    {
      name: 'short OTP_HMAC_SECRET',
      env: buildProdEnv({ OTP_HMAC_SECRET: 'too-short' }),
    },
    {
      name: 'missing Upstash credentials in Vercel',
      env: buildProdEnv({
        NODE_ENV: undefined,
        VERCEL: '1',
        UPSTASH_REDIS_REST_URL: undefined,
        UPSTASH_REDIS_REST_TOKEN: undefined,
      }),
    },
    {
      name: 'invalid Upstash URL',
      env: buildProdEnv({ UPSTASH_REDIS_REST_URL: 'not-a-valid-url' }),
    },
    {
      name: 'missing RESEND_API_KEY',
      env: buildProdEnv({ RESEND_API_KEY: undefined }),
    },
  ];

  for (const tc of cases) {
    const engine = createOtpEngine({
      env: tc.env,
      fetchImpl: resendHarness.fetchImpl,
      now: () => virtualNow,
    });
    const statusRes = engine.getStatus();
    assert.equal(statusRes.status, 503, `${tc.name}: status should be 503`);
    assert.equal(statusRes.body.ok, false);

    const sendRes = await engine.sendOtp({
      body: { email: 'pqguide@gmail.com', purpose: 'signup' },
      clientIp: '127.0.0.1',
    });
    assert.equal(sendRes.status, 503, `${tc.name}: sendOtp should fail 503`);
    assert.equal(sendRes.body.previewCode, undefined);

    const verifyRes = await engine.verifyOtp({
      body: { email: 'pqguide@gmail.com', purpose: 'signup', code: '123456' },
      clientIp: '127.0.0.1',
    });
    assert.equal(verifyRes.status, 503, `${tc.name}: verifyOtp should fail 503`);

    const resetRes = await engine.consumeResetGrant({
      body: { email: 'pqguide@gmail.com', resetToken: 'a'.repeat(48) },
    });
    assert.equal(resetRes.status, 503, `${tc.name}: consumeResetGrant should fail 503`);
  }

  // Quoted env values copied from provider dashboards (e.g. "https://...") are sanitized cleanly
  const quotedEngine = createOtpEngine({
    env: buildProdEnv({
      UPSTASH_REDIS_REST_URL: `"${redis.url}"`,
      UPSTASH_REDIS_REST_TOKEN: `"${redis.token}"`,
    }),
    fetchImpl: resendHarness.fetchImpl,
    now: () => virtualNow,
  });
  assert.equal(quotedEngine.getStatus().status, 200);
});

// ---------------------------------------------------------------------------
// 15. Vercel serverless handlers, deployment config, and git/env hygiene
// ---------------------------------------------------------------------------
test('15. Vercel API routes, vercel.json, .gitignore, and .env.example satisfy deployment & security rules', async () => {
  function invokeVercelHandler(
    handler: (req: IncomingMessage & { body?: unknown }, res: ServerResponse) => Promise<void>,
    opts: { method: string; body?: unknown; headers?: Record<string, string> }
  ): Promise<{ statusCode: number; headers: Record<string, string>; json: Record<string, unknown> }> {
    return new Promise((resolve, reject) => {
      const req = new EventEmitter() as IncomingMessage & { body?: unknown };
      req.method = opts.method;
      req.headers = opts.headers ?? {};
      req.socket = { remoteAddress: '198.51.100.50' } as IncomingMessage['socket'];
      if (opts.body !== undefined) {
        req.body = opts.body;
      }

      const outHeaders: Record<string, string> = {};
      const res = {
        statusCode: 200,
        setHeader(name: string, value: string | number | readonly string[]) {
          outHeaders[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
        },
        end(chunk?: unknown) {
          const text = chunk ? String(chunk) : '{}';
          resolve({
            statusCode: res.statusCode,
            headers: outHeaders,
            json: JSON.parse(text) as Record<string, unknown>,
          });
        },
      } as unknown as ServerResponse;

      handler(req, res).catch(reject);
      if (opts.body === undefined) {
        queueMicrotask(() => req.emit('end'));
      }
    });
  }

  // Test the exported Vercel handlers directly (verifies import & runtime invocation)
  assert.equal(typeof statusHandler, 'function');
  assert.equal(typeof sendHandler, 'function');
  assert.equal(typeof verifyHandler, 'function');
  assert.equal(typeof consumeResetHandler, 'function');

  const methodNotAllowed = await invokeVercelHandler(sendHandler, { method: 'GET' });
  assert.equal(methodNotAllowed.statusCode, 405);
  assert.equal(methodNotAllowed.headers['allow'], 'POST');

  // Test full handler lifecycle with production engine (simulating Vercel pre-parsed req.body)
  const handlers = createOtpHttpHandlers(
    createOtpEngine({
      env: buildProdEnv({ VERCEL: '1', VERCEL_ENV: 'production' }),
      fetchImpl: resendHarness.fetchImpl,
      now: () => virtualNow,
    })
  );

  const st = await invokeVercelHandler(handlers.handleStatus, { method: 'GET' });
  assert.equal(st.statusCode, 200);
  assert.equal(st.json.configured, true);
  assert.equal(st.json.storage, 'upstash');
  assert.equal(st.json.provider, 'resend');
  assert.equal(st.headers['cache-control'], 'no-store');
  assert.equal(st.headers['x-content-type-options'], 'nosniff');

  const sendOut = await invokeVercelHandler(handlers.handleSend, {
    method: 'POST',
    body: { email: 'pqguide@gmail.com', purpose: 'reset' },
  });
  assert.equal(sendOut.statusCode, 200);
  const otp = resendHarness.capturedEmails[0].code;

  const verifyOut = await invokeVercelHandler(handlers.handleVerify, {
    method: 'POST',
    body: { email: 'pqguide@gmail.com', purpose: 'reset', code: otp },
  });
  assert.equal(verifyOut.statusCode, 200);
  assert.ok(typeof verifyOut.json.resetToken === 'string');

  const consumeOut = await invokeVercelHandler(handlers.handleConsumeReset, {
    method: 'POST',
    body: { email: 'pqguide@gmail.com', resetToken: verifyOut.json.resetToken },
  });
  assert.equal(consumeOut.statusCode, 200);

  // Check vercel.json, .gitignore, and .env.example
  const root = path.resolve(import.meta.dirname, '..');
  const vercelJson = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')) as {
    buildCommand: string;
    outputDirectory: string;
    rewrites: Array<{ source: string; destination: string }>;
  };
  assert.equal(vercelJson.buildCommand, 'npm run build');
  assert.equal(vercelJson.outputDirectory, 'dist');
  assert.ok(
    vercelJson.rewrites.some((r) => r.source === '/((?!api/).*)' && r.destination === '/index.html')
  );

  const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.match(gitignore, /^\.env\*$/m);
  assert.match(gitignore, /^!\.env\.example$/m);
  assert.equal(fs.existsSync(path.join(root, '.env')), false);

  const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  for (const requiredKey of [
    'RESEND_API_KEY=',
    'EMAIL_FROM=PQGuide <onboarding@resend.dev>',
    'OTP_HMAC_SECRET=',
    'UPSTASH_REDIS_REST_URL=',
    'UPSTASH_REDIS_REST_TOKEN=',
  ]) {
    assert.ok(envExample.includes(requiredKey), `.env.example missing ${requiredKey}`);
  }
});
