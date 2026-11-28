import type { IncomingMessage, ServerResponse } from 'node:http';
import { defaultOtpEngine } from './otpService.ts';
import { defaultSuperAdminEngine } from './superAdminService.ts';
import { defaultDocumentEngine } from './documentService.ts';
import { defaultSuryaOcrService } from './suryaOcrService.ts';
import { getInstalledOcrLanguages } from '../src/services/intelligence/languageDetector.ts';

export type NodeHttpRequest = IncomingMessage & {
  body?: unknown;
  ip?: string;
};

export type NodeHttpResponse = ServerResponse & {
  status?: (code: number) => NodeHttpResponse;
  json?: (data: unknown) => void;
};

const MAX_BODY_BYTES = 64 * 1024;
const MAX_DOC_BODY_BYTES = 8 * 1024 * 1024;

function sendJson(
  res: NodeHttpResponse,
  statusCode: number,
  data: unknown,
  setCookie?: string
): void {
  if (setCookie) {
    res.setHeader('Set-Cookie', setCookie);
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = statusCode;
  res.end(JSON.stringify(data));
}

function getHeaderSingle(
  req: NodeHttpRequest,
  name: string
): string | undefined {
  const val = req.headers[name];
  if (typeof val === 'string') return val.trim();
  if (Array.isArray(val) && val.length > 0) return val[0]?.trim();
  return undefined;
}

function isRequestHttps(req: NodeHttpRequest): boolean {
  const proto = getHeaderSingle(req, 'x-forwarded-proto');
  if (proto) {
    return proto.split(',')[0].trim().toLowerCase() === 'https';
  }
  const sock = req.socket as { encrypted?: boolean } | undefined;
  return Boolean(sock?.encrypted);
}

function checkSameOriginRequest(req: NodeHttpRequest): { ok: true } | { ok: false; error: string } {
  const fetchSite = getHeaderSingle(req, 'sec-fetch-site')?.toLowerCase();
  if (fetchSite === 'cross-site') {
    return { ok: false, error: 'Cross-site requests are not permitted.' };
  }
  const expectedHost = (
    getHeaderSingle(req, 'x-forwarded-host') ||
    getHeaderSingle(req, 'host') ||
    ''
  )
    .split(',')[0]
    .trim()
    .toLowerCase();

  const origin = getHeaderSingle(req, 'origin');
  if (origin) {
    try {
      const parsedOriginHost = new URL(origin).host.toLowerCase();
      if (!expectedHost || parsedOriginHost !== expectedHost) {
        return { ok: false, error: 'Origin mismatch rejected.' };
      }
    } catch {
      return { ok: false, error: 'Malformed request origin rejected.' };
    }
    return { ok: true };
  }

  const referer = getHeaderSingle(req, 'referer');
  if (referer) {
    try {
      const parsedRefHost = new URL(referer).host.toLowerCase();
      if (!expectedHost || parsedRefHost !== expectedHost) {
        return { ok: false, error: 'Referer mismatch rejected.' };
      }
    } catch {
      return { ok: false, error: 'Malformed request referer rejected.' };
    }
  }

  return { ok: true };
}

function getClientIp(req: NodeHttpRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0].split(',')[0].trim();
  }
  if (typeof req.ip === 'string' && req.ip.trim()) {
    return req.ip.trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

async function readJsonBody(
  req: NodeHttpRequest,
  maxBytes = MAX_BODY_BYTES
): Promise<unknown> {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      return req.body.trim() ? JSON.parse(req.body) : {};
    }
    if (Buffer.isBuffer(req.body)) {
      const text = req.body.toString('utf8').trim();
      return text ? JSON.parse(text) : {};
    }
    return req.body;
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('BODY_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });
    req.on('error', () => reject(new Error('READ_ERROR')));
  });
}

export function createOtpHttpHandlers(engine = defaultOtpEngine) {
  async function handleStatus(req: NodeHttpRequest, res: NodeHttpResponse): Promise<void> {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }
    const result = engine.getStatus();
    sendJson(res, result.status, result.body);
  }

  async function handleSend(req: NodeHttpRequest, res: NodeHttpResponse): Promise<void> {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      const code = err instanceof Error && err.message === 'BODY_TOO_LARGE' ? 413 : 400;
      sendJson(res, code, { ok: false, error: 'Invalid request payload.' });
      return;
    }
    const result = await engine.sendOtp({ body, clientIp: getClientIp(req) });
    sendJson(res, result.status, result.body);
  }

  async function handleVerify(req: NodeHttpRequest, res: NodeHttpResponse): Promise<void> {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      const code = err instanceof Error && err.message === 'BODY_TOO_LARGE' ? 413 : 400;
      sendJson(res, code, { ok: false, error: 'Invalid request payload.' });
      return;
    }
    const result = await engine.verifyOtp({ body, clientIp: getClientIp(req) });
    sendJson(res, result.status, result.body);
  }

  async function handleConsumeReset(
    req: NodeHttpRequest,
    res: NodeHttpResponse
  ): Promise<void> {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      const code = err instanceof Error && err.message === 'BODY_TOO_LARGE' ? 413 : 400;
      sendJson(res, code, { ok: false, error: 'Invalid request payload.' });
      return;
    }
    const result = await engine.consumeResetGrant({ body, clientIp: getClientIp(req) });
    sendJson(res, result.status, result.body);
  }

  return {
    handleStatus,
    handleSend,
    handleVerify,
    handleConsumeReset,
  };
}

export const defaultOtpHttpHandlers = createOtpHttpHandlers();

export function createSuperAdminHttpHandlers(engine = defaultSuperAdminEngine) {
  async function handleStatus(req: NodeHttpRequest, res: NodeHttpResponse): Promise<void> {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }
    const result = await engine.getStatus();
    sendJson(res, result.status, result.body);
  }

  async function handleInitOtp(req: NodeHttpRequest, res: NodeHttpResponse): Promise<void> {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }
    const originCheck = checkSameOriginRequest(req);
    if (!originCheck.ok) {
      sendJson(res, 403, { ok: false, error: originCheck.error });
      return;
    }
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      const code = err instanceof Error && err.message === 'BODY_TOO_LARGE' ? 413 : 400;
      sendJson(res, code, { ok: false, error: 'Invalid request payload.' });
      return;
    }
    const result = await engine.sendInitOtp({ body, clientIp: getClientIp(req) });
    sendJson(res, result.status, result.body);
  }

  async function handleInitVerifyOtp(
    req: NodeHttpRequest,
    res: NodeHttpResponse
  ): Promise<void> {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }
    const originCheck = checkSameOriginRequest(req);
    if (!originCheck.ok) {
      sendJson(res, 403, { ok: false, error: originCheck.error });
      return;
    }
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      const code = err instanceof Error && err.message === 'BODY_TOO_LARGE' ? 413 : 400;
      sendJson(res, code, { ok: false, error: 'Invalid request payload.' });
      return;
    }
    const result = await engine.verifyInitOtp({ body, clientIp: getClientIp(req) });
    sendJson(res, result.status, result.body);
  }

  async function handleInit(req: NodeHttpRequest, res: NodeHttpResponse): Promise<void> {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }
    const originCheck = checkSameOriginRequest(req);
    if (!originCheck.ok) {
      sendJson(res, 403, { ok: false, error: originCheck.error });
      return;
    }
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      const code = err instanceof Error && err.message === 'BODY_TOO_LARGE' ? 413 : 400;
      sendJson(res, code, { ok: false, error: 'Invalid request payload.' });
      return;
    }
    const result = await engine.initializeFirstSuperAdmin({
      body,
      clientIp: getClientIp(req),
      isHttps: isRequestHttps(req),
    });
    sendJson(res, result.status, result.body, result.setCookie);
  }

  async function handleLogin(req: NodeHttpRequest, res: NodeHttpResponse): Promise<void> {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }
    const originCheck = checkSameOriginRequest(req);
    if (!originCheck.ok) {
      sendJson(res, 403, { ok: false, error: originCheck.error });
      return;
    }
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      const code = err instanceof Error && err.message === 'BODY_TOO_LARGE' ? 413 : 400;
      sendJson(res, code, { ok: false, error: 'Invalid request payload.' });
      return;
    }
    const result = await engine.loginSuperAdmin({
      body,
      clientIp: getClientIp(req),
    });
    sendJson(res, result.status, result.body);
  }

  async function handleVerifyTotp(req: NodeHttpRequest, res: NodeHttpResponse): Promise<void> {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }
    const originCheck = checkSameOriginRequest(req);
    if (!originCheck.ok) {
      sendJson(res, 403, { ok: false, error: originCheck.error });
      return;
    }
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      const code = err instanceof Error && err.message === 'BODY_TOO_LARGE' ? 413 : 400;
      sendJson(res, code, { ok: false, error: 'Invalid request payload.' });
      return;
    }
    const result = await engine.verifyTotp({
      body,
      clientIp: getClientIp(req),
      isHttps: isRequestHttps(req),
    });
    sendJson(res, result.status, result.body, result.setCookie);
  }

  async function handleVerifySession(
    req: NodeHttpRequest,
    res: NodeHttpResponse
  ): Promise<void> {
    if (req.method !== 'POST' && req.method !== 'GET') {
      res.setHeader('Allow', 'GET, POST');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }
    const result = await engine.verifySession({
      cookieHeader: getHeaderSingle(req, 'cookie'),
      isHttps: isRequestHttps(req),
    });
    sendJson(res, result.status, result.body, result.setCookie);
  }

  async function handleLogout(req: NodeHttpRequest, res: NodeHttpResponse): Promise<void> {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }
    const originCheck = checkSameOriginRequest(req);
    if (!originCheck.ok) {
      sendJson(res, 403, { ok: false, error: originCheck.error });
      return;
    }
    const result = await engine.logoutSession({
      cookieHeader: getHeaderSingle(req, 'cookie'),
      csrfTokenHeader: getHeaderSingle(req, 'x-csrf-token'),
      isHttps: isRequestHttps(req),
    });
    sendJson(res, result.status, result.body, result.setCookie);
  }

  async function handleLogoutAll(req: NodeHttpRequest, res: NodeHttpResponse): Promise<void> {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }
    const originCheck = checkSameOriginRequest(req);
    if (!originCheck.ok) {
      sendJson(res, 403, { ok: false, error: originCheck.error });
      return;
    }
    const result = await engine.logoutAllDevices({
      cookieHeader: getHeaderSingle(req, 'cookie'),
      csrfTokenHeader: getHeaderSingle(req, 'x-csrf-token'),
      isHttps: isRequestHttps(req),
    });
    sendJson(res, result.status, result.body, result.setCookie);
  }

  async function handleForgot(req: NodeHttpRequest, res: NodeHttpResponse): Promise<void> {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }
    const originCheck = checkSameOriginRequest(req);
    if (!originCheck.ok) {
      sendJson(res, 403, { ok: false, error: originCheck.error });
      return;
    }
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      const code = err instanceof Error && err.message === 'BODY_TOO_LARGE' ? 413 : 400;
      sendJson(res, code, { ok: false, error: 'Invalid request payload.' });
      return;
    }
    const result = await engine.requestPasswordReset({
      body,
      clientIp: getClientIp(req),
    });
    sendJson(res, result.status, result.body);
  }

  async function handleResetPassword(
    req: NodeHttpRequest,
    res: NodeHttpResponse
  ): Promise<void> {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }
    const originCheck = checkSameOriginRequest(req);
    if (!originCheck.ok) {
      sendJson(res, 403, { ok: false, error: originCheck.error });
      return;
    }
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      const code = err instanceof Error && err.message === 'BODY_TOO_LARGE' ? 413 : 400;
      sendJson(res, code, { ok: false, error: 'Invalid request payload.' });
      return;
    }
    const result = await engine.resetPassword({
      body,
      clientIp: getClientIp(req),
    });
    sendJson(res, result.status, result.body);
  }

  return {
    handleStatus,
    handleInitOtp,
    handleInitVerifyOtp,
    handleInit,
    handleLogin,
    handleVerifyTotp,
    handleVerifySession,
    handleLogout,
    handleLogoutAll,
    handleForgot,
    handleResetPassword,
  };
}

export const defaultSuperAdminHttpHandlers = createSuperAdminHttpHandlers();

export function createDocumentHttpHandlers(
  engine = defaultDocumentEngine,
  suryaService = defaultSuryaOcrService
) {
  async function handleOcrCapabilities(
    req: NodeHttpRequest,
    res: NodeHttpResponse
  ): Promise<void> {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }
    const localLangs = getInstalledOcrLanguages();
    const caps = suryaService.detectCapabilities(localLangs);
    sendJson(res, 200, caps);
  }

  async function handleSuryaOcr(
    req: NodeHttpRequest,
    res: NodeHttpResponse
  ): Promise<void> {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }
    const originCheck = checkSameOriginRequest(req);
    if (!originCheck.ok) {
      sendJson(res, 403, { ok: false, error: originCheck.error });
      return;
    }
    let body: unknown;
    try {
      body = await readJsonBody(req, MAX_DOC_BODY_BYTES);
    } catch (err) {
      const code = err instanceof Error && err.message === 'BODY_TOO_LARGE' ? 413 : 400;
      sendJson(res, code, { ok: false, error: 'Invalid Surya OCR request payload.' });
      return;
    }
    const result = await suryaService.analyzeWithSurya({ body });
    sendJson(res, result.status, result.body);
  }

  async function handleHandwritingOcr(
    req: NodeHttpRequest,
    res: NodeHttpResponse
  ): Promise<void> {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }
    const originCheck = checkSameOriginRequest(req);
    if (!originCheck.ok) {
      sendJson(res, 403, { ok: false, error: originCheck.error });
      return;
    }
    let body: unknown;
    try {
      body = await readJsonBody(req, MAX_DOC_BODY_BYTES);
    } catch (err) {
      const code = err instanceof Error && err.message === 'BODY_TOO_LARGE' ? 413 : 400;
      sendJson(res, code, { ok: false, error: 'Invalid handwriting OCR payload.' });
      return;
    }
    const result = await engine.performHandwritingOcr({ body });
    sendJson(res, result.status, result.body);
  }

  async function handleValidate(
    req: NodeHttpRequest,
    res: NodeHttpResponse
  ): Promise<void> {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }
    const originCheck = checkSameOriginRequest(req);
    if (!originCheck.ok) {
      sendJson(res, 403, { ok: false, error: originCheck.error });
      return;
    }
    let body: unknown;
    try {
      body = await readJsonBody(req, MAX_DOC_BODY_BYTES);
    } catch (err) {
      const code = err instanceof Error && err.message === 'BODY_TOO_LARGE' ? 413 : 400;
      sendJson(res, code, { ok: false, error: 'Invalid document validation payload.' });
      return;
    }
    const result = await engine.validateAndOptimizeBinary({ body });
    sendJson(res, result.status, result.body);
  }

  async function handleCrossCheck(
    req: NodeHttpRequest,
    res: NodeHttpResponse
  ): Promise<void> {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }
    const originCheck = checkSameOriginRequest(req);
    if (!originCheck.ok) {
      sendJson(res, 403, { ok: false, error: originCheck.error });
      return;
    }
    let body: unknown;
    try {
      body = await readJsonBody(req, MAX_DOC_BODY_BYTES);
    } catch (err) {
      const code = err instanceof Error && err.message === 'BODY_TOO_LARGE' ? 413 : 400;
      sendJson(res, code, { ok: false, error: 'Invalid cross-check request payload.' });
      return;
    }
    const result = await engine.crossCheckWithAi({ body });
    sendJson(res, result.status, result.body);
  }

  // Vision calls can cost money, so each client gets a modest rolling allowance.
  const visionHits = new Map<string, number[]>();
  const VISION_WINDOW_MS = 10 * 60 * 1000;
  const VISION_MAX_PER_WINDOW = 60;

  async function handleVisionOcr(
    req: NodeHttpRequest,
    res: NodeHttpResponse
  ): Promise<void> {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
      return;
    }
    const clientKey = getClientIp(req);
    const nowMs = Date.now();
    const recent = (visionHits.get(clientKey) ?? []).filter((t) => nowMs - t < VISION_WINDOW_MS);
    if (recent.length >= VISION_MAX_PER_WINDOW) {
      sendJson(res, 429, {
        ok: false,
        providerAvailable: true,
        error: 'Too many Vision OCR requests. Try again in a few minutes.',
      });
      return;
    }
    recent.push(nowMs);
    visionHits.set(clientKey, recent);
    const originCheck = checkSameOriginRequest(req);
    if (!originCheck.ok) {
      sendJson(res, 403, { ok: false, error: originCheck.error });
      return;
    }
    let body: unknown;
    try {
      body = await readJsonBody(req, MAX_DOC_BODY_BYTES);
    } catch (err) {
      const code = err instanceof Error && err.message === 'BODY_TOO_LARGE' ? 413 : 400;
      sendJson(res, code, { ok: false, error: 'Invalid Vision OCR request payload.' });
      return;
    }
    const result = await engine.performVisionOcr({ body });
    sendJson(res, result.status, result.body);
  }

  return {
    handleOcrCapabilities,
    handleSuryaOcr,
    handleHandwritingOcr,
    handleVisionOcr,
    handleValidate,
    handleCrossCheck,
  };
}

export const defaultDocumentHttpHandlers = createDocumentHttpHandlers();
