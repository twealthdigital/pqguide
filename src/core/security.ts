const DANGEROUS_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const BLOCKED_EXTENSIONS = new Set([
  'svg',
  'svgz',
  'html',
  'htm',
  'xhtml',
  'js',
  'mjs',
  'cjs',
  'ts',
  'jsx',
  'tsx',
  'exe',
  'dll',
  'bat',
  'cmd',
  'sh',
  'bash',
  'ps1',
  'php',
  'phtml',
  'py',
  'rb',
  'pl',
  'cgi',
  'jar',
  'war',
  'vbs',
  'scr',
  'msi',
  'com',
  'asp',
  'aspx',
  'jsp',
]);

export const ALLOWED_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);
export const ALLOWED_DOC_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'txt', 'md', 'csv']);
export const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  ...ALLOWED_IMAGE_EXTENSIONS,
  ...ALLOWED_DOC_EXTENSIONS,
]);

const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

const ALLOWED_DOC_MIMES = new Set([
  '',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/csv',
  'application/octet-stream',
]);

export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Strips NUL bytes and control characters while optionally preserving newlines/tabs.
 */
export function sanitizePlainText(
  value: unknown,
  maxLength = 6000,
  preserveNewlines = true
): string {
  const raw = typeof value === 'string' ? value : String(value ?? '');
  let cleaned = '';
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    if (code === 0) continue;
    if (preserveNewlines && (code === 10 || code === 13 || code === 9)) {
      cleaned += raw[i];
      continue;
    }
    if (code < 32 || code === 127) {
      cleaned += ' ';
      continue;
    }
    cleaned += raw[i];
  }
  return cleaned.trim().slice(0, maxLength);
}

export function sanitizeSingleLine(value: unknown, maxLength = 240): string {
  return sanitizePlainText(value, maxLength, false).replace(/\s+/g, ' ').trim();
}

export function sanitizeIdentifier(value: unknown, maxLength = 64): string {
  return sanitizeSingleLine(value, maxLength).replace(/[^\w@.:+\-/ ]+/g, '').trim();
}

/**
 * Deeply removes prototype-pollution keys (__proto__, constructor, prototype)
 * from parsed JSON or untrusted plain objects.
 */
export function stripDangerousKeys<T>(input: T): T {
  if (Array.isArray(input)) {
    return input.map((item) => stripDangerousKeys(item)) as unknown as T;
  }
  if (input !== null && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
      if (DANGEROUS_OBJECT_KEYS.has(key)) continue;
      out[key] = stripDangerousKeys(val);
    }
    return out as T;
  }
  return input;
}

export function safeParseJson<T>(raw: string | null): T | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as T;
    return stripDangerousKeys(parsed);
  } catch {
    return null;
  }
}

/**
 * Only allows safe local assets, http(s) URLs, or strict raster image data URIs.
 * Blocks javascript:, vbscript:, data:text/html, and data:image/svg+xml.
 */
export function isSafeDisplayUrl(url: string | undefined | null): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;

  if (trimmed.startsWith('/assets/') || trimmed.startsWith('/')) {
    return !trimmed.startsWith('//');
  }

  if (/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) {
    return true;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function sanitizeSafeUrl(url: string | undefined | null): string | undefined {
  return isSafeDisplayUrl(url) ? url!.trim() : undefined;
}

export interface FileValidationResult {
  valid: boolean;
  extension: string;
  kind: 'image' | 'document';
  safeFileName: string;
  error?: string;
}

export function sanitizeFileName(rawName: string): string {
  const base = rawName.replace(/\0/g, '').trim();
  if (!base) return '';
  if (base.includes('..') || base.includes('/') || base.includes('\\')) {
    return '';
  }
  return base.replace(/[^\w.\- ()]+/g, '_').slice(0, 180);
}

/**
 * Validates filename, traversal safety, extension allowlist, size limit, and MIME type.
 */
export function validateUploadFile(file: {
  name: string;
  type: string;
  size: number;
}): FileValidationResult {
  const safeFileName = sanitizeFileName(file.name);
  if (!safeFileName) {
    return {
      valid: false,
      extension: '',
      kind: 'document',
      safeFileName: '',
      error: 'Invalid filename. Remove path characters like "/", "\\", or ".." and try again.',
    };
  }

  const parts = safeFileName.toLowerCase().split('.');
  const extension = parts.length > 1 ? parts[parts.length - 1] : '';

  if (!extension || BLOCKED_EXTENSIONS.has(extension)) {
    return {
      valid: false,
      extension,
      kind: 'document',
      safeFileName,
      error: `Blocked file type ".${extension || 'unknown'}". Scripts, HTML, SVG, and executable files are rejected.`,
    };
  }

  if (!ALLOWED_UPLOAD_EXTENSIONS.has(extension)) {
    return {
      valid: false,
      extension,
      kind: 'document',
      safeFileName,
      error: 'Unsupported file type. Upload PDF, DOCX, DOC, TXT, MD, CSV, JPG, PNG, or WEBP.',
    };
  }

  if (file.size <= 0) {
    return {
      valid: false,
      extension,
      kind: ALLOWED_IMAGE_EXTENSIONS.has(extension) ? 'image' : 'document',
      safeFileName,
      error: 'Uploaded file is empty.',
    };
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return {
      valid: false,
      extension,
      kind: ALLOWED_IMAGE_EXTENSIONS.has(extension) ? 'image' : 'document',
      safeFileName,
      error: 'File exceeds the 10 MB upload size limit.',
    };
  }

  const mime = (file.type || '').toLowerCase().split(';')[0].trim();
  if (
    mime === 'image/svg+xml' ||
    mime === 'text/html' ||
    mime.includes('javascript') ||
    mime.includes('ecmascript') ||
    mime.includes('x-msdownload') ||
    mime.includes('x-sh')
  ) {
    return {
      valid: false,
      extension,
      kind: 'document',
      safeFileName,
      error: `Rejected unsafe MIME type "${mime}".`,
    };
  }

  const isImage = ALLOWED_IMAGE_EXTENSIONS.has(extension);
  if (isImage) {
    if (mime && !ALLOWED_IMAGE_MIMES.has(mime)) {
      return {
        valid: false,
        extension,
        kind: 'image',
        safeFileName,
        error: `Image MIME type "${mime}" does not match extension ".${extension}".`,
      };
    }
    return { valid: true, extension, kind: 'image', safeFileName };
  }

  if (mime && mime.startsWith('image/')) {
    return {
      valid: false,
      extension,
      kind: 'document',
      safeFileName,
      error: 'File extension and image MIME type mismatch.',
    };
  }

  if (mime && !ALLOWED_DOC_MIMES.has(mime)) {
    return {
      valid: false,
      extension,
      kind: 'document',
      safeFileName,
      error: `Document MIME type "${mime}" is not permitted for ".${extension}".`,
    };
  }

  return { valid: true, extension, kind: 'document', safeFileName };
}

/**
 * Inspects file magic bytes / header signature before accepting content.
 */
export function validateUploadedBuffer(
  extension: string,
  buffer: ArrayBuffer
): { valid: boolean; error?: string } {
  const bytes = new Uint8Array(buffer);
  if (bytes.length === 0) {
    return { valid: false, error: 'File has zero readable bytes.' };
  }

  const ext = extension.toLowerCase();

  if (ext === 'pdf') {
    const head = new TextDecoder('ascii', { fatal: false }).decode(bytes.slice(0, 16));
    if (!head.includes('%PDF-')) {
      return {
        valid: false,
        error: 'Invalid PDF header signature (%PDF- missing).',
      };
    }
    return { valid: true };
  }

  if (ext === 'png') {
    if (
      bytes.length < 8 ||
      bytes[0] !== 0x89 ||
      bytes[1] !== 0x50 ||
      bytes[2] !== 0x4e ||
      bytes[3] !== 0x47
    ) {
      return { valid: false, error: 'Invalid PNG signature.' };
    }
    return { valid: true };
  }

  if (ext === 'jpg' || ext === 'jpeg') {
    if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      return { valid: false, error: 'Invalid JPEG signature.' };
    }
    return { valid: true };
  }

  if (ext === 'webp') {
    if (bytes.length < 12) {
      return { valid: false, error: 'Invalid WEBP file.' };
    }
    const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    const webp = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (riff !== 'RIFF' || webp !== 'WEBP') {
      return { valid: false, error: 'Invalid WEBP signature.' };
    }
    return { valid: true };
  }

  if (ext === 'docx') {
    if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      return { valid: false, error: 'Invalid DOCX archive header.' };
    }
    return { valid: true };
  }

  if (ext === 'txt' || ext === 'md' || ext === 'csv') {
    const sample = bytes.slice(0, Math.min(bytes.length, 4096));
    if (sample.includes(0)) {
      return { valid: false, error: 'Binary NUL bytes detected inside plain text upload.' };
    }
    const headText = new TextDecoder('utf-8', { fatal: false })
      .decode(sample)
      .toLowerCase();
    if (
      headText.includes('<script') ||
      headText.includes('<!doctype html') ||
      headText.includes('<svg')
    ) {
      return {
        valid: false,
        error: 'Active HTML/SVG markup is not permitted inside text uploads.',
      };
    }
  }

  return { valid: true };
}
