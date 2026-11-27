import { sanitizeFileName } from '../../core/security';
import type { AcademicDocFormat } from '../../core/types';

export const MAX_SCANNER_FILE_BYTES = 15 * 1024 * 1024; // 15 MB per file
export const MAX_SCANNER_BATCH_FILES = 15;
export const MAX_PDF_PAGES = 40;
export const MAX_ZIP_ENTRIES = 35;
export const MAX_ZIP_UNCOMPRESSED_BYTES = 30 * 1024 * 1024; // 30 MB expanded limit
export const MAX_ZIP_COMPRESSION_RATIO = 85;

export const ALLOWED_SCANNER_EXTENSIONS = new Set([
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'docx',
  'zip',
  'txt',
  'md',
  'csv',
]);

export const BLOCKED_SCANNER_EXTENSIONS = new Set([
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
  'docm',
  'xlsm',
  'pptm',
]);

export interface MagicValidationResult {
  valid: boolean;
  safeFileName: string;
  extension: string;
  format: AcademicDocFormat;
  error?: string;
  securityFlags: string[];
}

export function getExtension(fileName: string): string {
  const clean = fileName.trim().toLowerCase();
  const idx = clean.lastIndexOf('.');
  if (idx <= 0 || idx === clean.length - 1) return '';
  return clean.slice(idx + 1);
}

export function isSafeZipEntryPath(entryPath: string): {
  safe: boolean;
  baseName: string;
  extension: string;
  reason?: string;
} {
  if (!entryPath || entryPath.includes('\0')) {
    return { safe: false, baseName: '', extension: '', reason: 'Null byte in archive entry path' };
  }
  const normalized = entryPath.replace(/\\/g, '/');
  if (
    normalized.startsWith('/') ||
    normalized.startsWith('~') ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split('/').some((seg) => seg === '..')
  ) {
    return {
      safe: false,
      baseName: '',
      extension: '',
      reason: `Unsafe path traversal pattern detected ("${entryPath}").`,
    };
  }
  const parts = normalized.split('/').filter(Boolean);
  const rawBase = parts[parts.length - 1] ?? '';
  const baseName = sanitizeFileName(rawBase);
  const extension = getExtension(baseName);
  if (!baseName) {
    return { safe: false, baseName: '', extension: '', reason: 'Invalid archive entry filename.' };
  }
  if (BLOCKED_SCANNER_EXTENSIONS.has(extension)) {
    return {
      safe: false,
      baseName,
      extension,
      reason: `Blocked unsafe file inside archive: "${baseName}".`,
    };
  }
  return { safe: true, baseName, extension };
}

export function validateMagicAndSecurity(params: {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}): MagicValidationResult {
  const securityFlags: string[] = [];
  const safeFileName = sanitizeFileName(params.fileName);

  if (!safeFileName) {
    return {
      valid: false,
      safeFileName: '',
      extension: '',
      format: 'text',
      securityFlags: ['invalid_filename'],
      error: 'Invalid or unsafe filename. Remove slashes or traversal characters.',
    };
  }

  const extension = getExtension(safeFileName);
  if (!extension || BLOCKED_SCANNER_EXTENSIONS.has(extension)) {
    return {
      valid: false,
      safeFileName,
      extension,
      format: 'text',
      securityFlags: ['blocked_extension'],
      error: `Blocked file type ".${extension || 'unknown'}". Scripts, HTML, SVG, macro files, and executables are not permitted.`,
    };
  }

  if (!ALLOWED_SCANNER_EXTENSIONS.has(extension)) {
    return {
      valid: false,
      safeFileName,
      extension,
      format: 'text',
      securityFlags: ['unsupported_extension'],
      error: 'Supported formats: PDF, PNG, JPG, JPEG, WEBP, DOCX, ZIP, TXT, MD, and CSV.',
    };
  }

  const bytes = params.bytes;
  if (bytes.byteLength === 0) {
    return {
      valid: false,
      safeFileName,
      extension,
      format: 'text',
      securityFlags: ['empty_file'],
      error: 'File has 0 bytes and cannot be processed.',
    };
  }

  if (bytes.byteLength > MAX_SCANNER_FILE_BYTES) {
    return {
      valid: false,
      safeFileName,
      extension,
      format: 'text',
      securityFlags: ['size_limit_exceeded'],
      error: 'File exceeds the 15 MB maximum upload limit.',
    };
  }

  // Executable magic byte checks regardless of claimed extension
  if (
    (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) || // PE/EXE
    (bytes.length >= 4 &&
      bytes[0] === 0x7f &&
      bytes[1] === 0x45 &&
      bytes[2] === 0x4c &&
      bytes[3] === 0x46) // ELF
  ) {
    return {
      valid: false,
      safeFileName,
      extension,
      format: 'text',
      securityFlags: ['executable_signature'],
      error: 'Executable binary signature detected and rejected.',
    };
  }

  const mime = (params.mimeType || '').toLowerCase().split(';')[0].trim();
  if (
    mime === 'image/svg+xml' ||
    mime === 'text/html' ||
    mime.includes('javascript') ||
    mime.includes('x-msdownload')
  ) {
    return {
      valid: false,
      safeFileName,
      extension,
      format: 'text',
      securityFlags: ['unsafe_mime'],
      error: `Unsafe MIME type "${mime}" rejected.`,
    };
  }

  // Magic-byte verification by claimed extension
  if (extension === 'pdf') {
    const header = new TextDecoder('ascii', { fatal: false }).decode(bytes.slice(0, 64));
    if (!header.includes('%PDF-')) {
      return {
        valid: false,
        safeFileName,
        extension,
        format: 'pdf',
        securityFlags: ['magic_mismatch_pdf'],
        error: 'Magic-byte check failed: file claims to be PDF but lacks %PDF- header.',
      };
    }
    const sample = new TextDecoder('latin1', { fatal: false }).decode(
      bytes.slice(0, Math.min(bytes.length, 450_000))
    );
    if (/\/JavaScript\b|\/JS\b|\/Launch\b|\/OpenAction\b/i.test(sample)) {
      securityFlags.push('pdf_active_script_action');
    }
    return { valid: true, safeFileName, extension, format: 'pdf', securityFlags };
  }

  if (extension === 'png') {
    const isPng =
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a;
    if (!isPng) {
      return {
        valid: false,
        safeFileName,
        extension,
        format: 'image',
        securityFlags: ['magic_mismatch_png'],
        error: 'Magic-byte check failed: invalid PNG signature.',
      };
    }
    return { valid: true, safeFileName, extension, format: 'image', securityFlags };
  }

  if (extension === 'jpg' || extension === 'jpeg') {
    const isJpg =
      bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (!isJpg) {
      return {
        valid: false,
        safeFileName,
        extension,
        format: 'image',
        securityFlags: ['magic_mismatch_jpeg'],
        error: 'Magic-byte check failed: invalid JPEG signature.',
      };
    }
    return { valid: true, safeFileName, extension, format: 'image', securityFlags };
  }

  if (extension === 'webp') {
    const isWebp =
      bytes.length >= 12 &&
      String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'RIFF' &&
      String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === 'WEBP';
    if (!isWebp) {
      return {
        valid: false,
        safeFileName,
        extension,
        format: 'image',
        securityFlags: ['magic_mismatch_webp'],
        error: 'Magic-byte check failed: invalid WEBP signature.',
      };
    }
    return { valid: true, safeFileName, extension, format: 'image', securityFlags };
  }

  if (extension === 'docx' || extension === 'zip') {
    const isPkZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
    if (!isPkZip) {
      return {
        valid: false,
        safeFileName,
        extension,
        format: extension === 'docx' ? 'docx' : 'zip',
        securityFlags: [`magic_mismatch_${extension}`],
        error: `Magic-byte check failed: invalid ${extension.toUpperCase()} archive signature.`,
      };
    }
    return {
      valid: true,
      safeFileName,
      extension,
      format: extension === 'docx' ? 'docx' : 'zip',
      securityFlags,
    };
  }

  // Plain text / Markdown / CSV checks
  const sample = bytes.slice(0, Math.min(bytes.length, 8192));
  if (sample.includes(0)) {
    return {
      valid: false,
      safeFileName,
      extension,
      format: 'text',
      securityFlags: ['binary_inside_text'],
      error: 'Binary NUL bytes detected inside plain text upload.',
    };
  }
  const headText = new TextDecoder('utf-8', { fatal: false }).decode(sample).toLowerCase();
  if (
    headText.includes('<script') ||
    headText.includes('<!doctype html') ||
    headText.includes('<svg') ||
    headText.startsWith('#!/')
  ) {
    return {
      valid: false,
      safeFileName,
      extension,
      format: 'text',
      securityFlags: ['active_markup_or_shebang'],
      error: 'Active HTML, SVG, or script shebang content is blocked in academic text uploads.',
    };
  }

  return { valid: true, safeFileName, extension, format: 'text', securityFlags };
}

export async function computeSha256Hex(bytes: Uint8Array): Promise<string> {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  const nodeCrypto = await import('node:crypto');
  return nodeCrypto.createHash('sha256').update(bytes).digest('hex');
}
