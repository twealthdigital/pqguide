import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';

type OtpPurpose = 'signup' | 'reset' | 'admin_activate';

interface OtpRecord {
  digestHex: string;
  expiresAt: number;
  lastSentAt: number;
  attempts: number;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 25 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;
const IP_WINDOW_MS = 10 * 60 * 1000;
const IP_MAX_SEND_REQUESTS = 20;

const OTP_HMAC_SECRET =
  process.env.OTP_HMAC_SECRET?.trim() || crypto.randomBytes(32).toString('hex');

const otpStore = new Map<string, OtpRecord>();
const ipSendRateStore = new Map<string, RateLimitBucket>();

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

function hashOtp(email: string, purpose: OtpPurpose, code: string): string {
  return crypto
    .createHmac('sha256', OTP_HMAC_SECRET)
    .update(`${purpose}:${email}:${code}`)
    .digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function pruneExpiredStores(now: number): void {
  if (otpStore.size > 500) {
    for (const [k, rec] of otpStore.entries()) {
      if (now > rec.expiresAt) otpStore.delete(k);
    }
  }
  if (ipSendRateStore.size > 500) {
    for (const [ip, bucket] of ipSendRateStore.entries()) {
      if (now > bucket.resetAt) ipSendRateStore.delete(ip);
    }
  }
}

function checkIpSendLimit(ip: string, now: number): boolean {
  const existing = ipSendRateStore.get(ip);
  if (!existing || now > existing.resetAt) {
    ipSendRateStore.set(ip, { count: 1, resetAt: now + IP_WINDOW_MS });
    return true;
  }
  if (existing.count >= IP_MAX_SEND_REQUESTS) {
    return false;
  }
  existing.count += 1;
  return true;
}

async function sendVerificationEmailViaResend(params: {
  apiKey: string;
  from: string;
  to: string;
  code: string;
  purpose: OtpPurpose;
  matricNumber?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
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
          Enter this 6-digit code in PQGuide to confirm your email address. It expires in 10 minutes.
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

  try {
    const response = await fetch('https://api.resend.com/emails', {
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
    });

    if (!response.ok) {
      let detail = `Email provider returned HTTP ${response.status}.`;
      try {
        const body = (await response.json()) as { message?: string; error?: string };
        if (body?.message) detail = body.message;
        else if (body?.error) detail = body.error;
      } catch {
        // Keep generic message
      }
      return { ok: false, error: `Could not send verification email: ${detail}` };
    }

    return { ok: true };
  } catch {
    return {
      ok: false,
      error: 'Unable to reach email delivery service. Please try again in a moment.',
    };
  }
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  app.use(express.json({ limit: '64kb' }));

  app.get('/api/auth/email-otp/status', (_req: Request, res: Response) => {
    const configured = Boolean(process.env.RESEND_API_KEY?.trim());
    res.json({
      ok: true,
      configured,
      provider: configured ? 'resend' : 'preview',
    });
  });

  app.post('/api/auth/email-otp/send', async (req: Request, res: Response) => {
    const now = Date.now();
    pruneExpiredStores(now);

    const clientIp = req.ip || 'unknown';
    if (!checkIpSendLimit(clientIp, now)) {
      res.status(429).json({
        ok: false,
        error: 'Too many verification requests. Please wait a few minutes and try again.',
      });
      return;
    }

    const email = normalizeEmail(req.body?.email);
    const purpose = req.body?.purpose;
    const matricNumber = sanitizeMatric(req.body?.matricNumber);

    if (!isValidEmail(email)) {
      res.status(400).json({ ok: false, error: 'Enter a valid email address.' });
      return;
    }
    if (!isValidPurpose(purpose)) {
      res.status(400).json({ ok: false, error: 'Invalid verification purpose.' });
      return;
    }

    const key = `${purpose}:${email}`;
    const existing = otpStore.get(key);
    if (existing && now - existing.lastSentAt < RESEND_COOLDOWN_MS) {
      const waitSeconds = Math.ceil(
        (RESEND_COOLDOWN_MS - (now - existing.lastSentAt)) / 1000
      );
      res.status(429).json({
        ok: false,
        error: `Please wait ${waitSeconds}s before requesting another code.`,
      });
      return;
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const record: OtpRecord = {
      digestHex: hashOtp(email, purpose, code),
      expiresAt: now + OTP_TTL_MS,
      lastSentAt: now,
      attempts: 0,
    };
    otpStore.set(key, record);

    const resendApiKey = process.env.RESEND_API_KEY?.trim() || '';
    const emailFrom = process.env.EMAIL_FROM?.trim() || 'PQGuide <onboarding@resend.dev>';

    if (resendApiKey) {
      const sent = await sendVerificationEmailViaResend({
        apiKey: resendApiKey,
        from: emailFrom,
        to: email,
        code,
        purpose,
        matricNumber: matricNumber || undefined,
      });
      if (!sent.ok) {
        otpStore.delete(key);
        res.status(502).json({ ok: false, error: sent.error });
        return;
      }
      res.json({
        ok: true,
        deliveryMode: 'email',
      });
      return;
    }

    if (IS_PRODUCTION) {
      otpStore.delete(key);
      res.status(503).json({
        ok: false,
        error:
          'Email verification service is not configured yet. Set RESEND_API_KEY in server environment secrets.',
      });
      return;
    }

    res.json({
      ok: true,
      deliveryMode: 'preview',
      previewCode: code,
    });
  });

  app.post('/api/auth/email-otp/verify', (req: Request, res: Response) => {
    const now = Date.now();
    const email = normalizeEmail(req.body?.email);
    const purpose = req.body?.purpose;
    const rawCode = typeof req.body?.code === 'string' ? req.body.code : '';
    const code = rawCode.replace(/\s+/g, '').trim();

    if (!isValidEmail(email)) {
      res.status(400).json({ ok: false, error: 'Enter a valid email address.' });
      return;
    }
    if (!isValidPurpose(purpose)) {
      res.status(400).json({ ok: false, error: 'Invalid verification purpose.' });
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      res.status(400).json({ ok: false, error: 'Enter the 6-digit verification code.' });
      return;
    }

    const key = `${purpose}:${email}`;
    const record = otpStore.get(key);
    if (!record || now > record.expiresAt) {
      otpStore.delete(key);
      res.status(400).json({
        ok: false,
        error: 'Verification code expired or not found. Tap Resend code.',
      });
      return;
    }

    if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
      otpStore.delete(key);
      res.status(429).json({
        ok: false,
        error: 'Too many incorrect attempts. Request a fresh verification code.',
      });
      return;
    }

    const candidateDigest = hashOtp(email, purpose, code);
    if (!safeEqualHex(candidateDigest, record.digestHex)) {
      record.attempts += 1;
      if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
        otpStore.delete(key);
        res.status(429).json({
          ok: false,
          error: 'Too many incorrect attempts. Request a fresh verification code.',
        });
        return;
      }
      res.status(400).json({
        ok: false,
        error: 'Incorrect verification code. Check and try again.',
      });
      return;
    }

    otpStore.delete(key);
    res.json({ ok: true });
  });

  if (!IS_PRODUCTION) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(import.meta.dirname, 'dist');
    const indexHtml = path.join(distDir, 'index.html');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`PQGuide server listening on http://${HOST}:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start PQGuide server:', err);
  process.exit(1);
});
