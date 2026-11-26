import type { IncomingMessage, ServerResponse } from 'node:http';
import { defaultOtpEngine } from './otpService.ts';

export type NodeHttpRequest = IncomingMessage & {
  body?: unknown;
  ip?: string;
};

export type NodeHttpResponse = ServerResponse & {
  status?: (code: number) => NodeHttpResponse;
  json?: (data: unknown) => void;
};

const MAX_BODY_BYTES = 64 * 1024;

function sendJson(res: NodeHttpResponse, statusCode: number, data: unknown): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = statusCode;
  res.end(JSON.stringify(data));
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

async function readJsonBody(req: NodeHttpRequest): Promise<unknown> {
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
      if (total > MAX_BODY_BYTES) {
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
