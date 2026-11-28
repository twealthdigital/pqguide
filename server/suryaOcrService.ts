import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  validateMagicAndSecurity,
  MAX_SCANNER_FILE_BYTES,
} from '../src/services/intelligence/fileSecurity.ts';
import type {
  ExtractedFormula,
  ExtractedTable,
  ReconstructedBlock,
  ReconstructedBlockKind,
  UncertainSpan,
} from '../src/core/types.ts';
import type { OcrLineBox, OcrWordBox } from '../src/services/intelligence/ocrEngine.ts';

const execFileAsync = promisify(execFile);

export type SuryaBackendMode = 'surya_http' | 'datalab_api' | 'surya_cli' | 'unavailable';

export interface SuryaRawBbox {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  x0?: number;
  y0?: number;
  x1?: number;
  y1?: number;
}

export interface SuryaRawBlock {
  order?: number;
  label?: string;
  html?: string;
  text?: string;
  confidence?: number;
  bbox?: SuryaRawBbox | [number, number, number, number];
}

export interface SuryaRawLine {
  text?: string;
  confidence?: number;
  bbox?: SuryaRawBbox | [number, number, number, number];
}

export interface SuryaRawEquation {
  latex?: string;
  text?: string;
  displayMode?: boolean;
  confidence?: number;
  bbox?: SuryaRawBbox | [number, number, number, number];
}

export interface SuryaRawTable {
  caption?: string;
  headers?: string[];
  rows?: string[][];
  html?: string;
  bbox?: SuryaRawBbox | [number, number, number, number];
}

export interface SuryaRawPagePayload {
  pageNumber?: number;
  width?: number;
  height?: number;
  text?: string;
  confidence?: number;
  blocks?: SuryaRawBlock[];
  lines?: SuryaRawLine[];
  equations?: SuryaRawEquation[];
  tables?: SuryaRawTable[];
}

export interface NormalizedSuryaPage {
  pageNumber: number;
  width: number;
  height: number;
  text: string;
  confidence: number;
  blocks: ReconstructedBlock[];
  lineBoxes: OcrLineBox[];
  wordBoxes: OcrWordBox[];
  equations: ExtractedFormula[];
  tables: ExtractedTable[];
  uncertainSpans: UncertainSpan[];
  warnings: string[];
}

export interface ServerSuryaOcrResult {
  status: number;
  body: {
    ok: boolean;
    engine: 'surya';
    backendMode: SuryaBackendMode;
    providerAvailable: boolean;
    modelInfo?: string;
    durationMs?: number;
    page?: NormalizedSuryaPage;
    pages?: NormalizedSuryaPage[];
    error?: string;
  };
}

export interface ServerHandwritingOcrResult {
  status: number;
  body: {
    ok: boolean;
    modelAvailable: boolean;
    engine: 'trocr' | 'vision_htr' | 'none';
    modelUsed?: string;
    text?: string;
    confidence?: number;
    unreadable?: boolean;
    uncertainWords?: string[];
    error?: string;
  };
}

export interface OcrCapabilitiesSnapshot {
  ok: true;
  surya: {
    available: boolean;
    mode: SuryaBackendMode;
    endpointConfigured: boolean;
    datalabConfigured: boolean;
    cliConfigured: boolean;
  };
  vision: {
    available: boolean;
    provider: 'gemini' | 'openai_compatible' | 'disabled' | 'unconfigured';
  };
  handwriting: {
    available: boolean;
    mode: 'trocr_service' | 'vision_htr' | 'detector_only';
  };
  languages: {
    defaultLanguage: 'eng';
    localTesseractInstalled: string[];
    suryaSupportedNigerianLanguages: string[];
    notes: string[];
  };
}

export interface SuryaServiceDeps {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  execCliImpl?: (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
}

const DEFAULT_SURYA_TIMEOUT_MS = 45_000;
const ALLOWED_SURYA_HOST_PORTS = new Set(['http:', 'https:']);

/**
 * Validates server-configured inference URLs against SSRF hazards while allowing
 * trusted HTTPS endpoints and explicit local/Docker sidecar HTTP services.
 */
export function validateConfiguredServiceUrl(rawUrl: string | undefined): {
  valid: boolean;
  normalizedUrl?: string;
  reason?: string;
} {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return { valid: false, reason: 'URL not configured' };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, reason: 'Invalid service URL format' };
  }
  if (!ALLOWED_SURYA_HOST_PORTS.has(parsed.protocol)) {
    return { valid: false, reason: 'Unsupported URL protocol (only http/https permitted)' };
  }
  if (parsed.username || parsed.password) {
    return { valid: false, reason: 'Credentials embedded in URL are not permitted' };
  }
  const host = parsed.hostname.toLowerCase();
  // Block cloud metadata SSRF targets even if misconfigured in env
  if (host === '169.254.169.254' || host === 'metadata.google.internal') {
    return { valid: false, reason: 'Metadata IP/hostname blocked for SSRF protection' };
  }
  if (
    parsed.protocol === 'http:' &&
    host !== 'localhost' &&
    host !== '127.0.0.1' &&
    host !== '::1' &&
    host !== 'surya-service' &&
    !host.endsWith('.internal') &&
    !host.endsWith('.local')
  ) {
    return {
      valid: false,
      reason: 'Plain HTTP service URL is restricted to loopback or internal sidecar hosts; use HTTPS remotely.',
    };
  }
  return { valid: true, normalizedUrl: parsed.toString().replace(/\/+$/, '') };
}

function normalizeBoxCoords(
  raw: SuryaRawBbox | [number, number, number, number] | undefined,
  pageWidth: number,
  pageHeight: number
): { x: number; y: number; width: number; height: number; x0: number; y0: number; x1: number; y1: number } {
  if (Array.isArray(raw) && raw.length >= 4) {
    const x0 = Math.max(0, Math.round(Number(raw[0]) || 0));
    const y0 = Math.max(0, Math.round(Number(raw[1]) || 0));
    const x1 = Math.max(x0 + 1, Math.round(Number(raw[2]) || x0 + 1));
    const y1 = Math.max(y0 + 1, Math.round(Number(raw[3]) || y0 + 1));
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0, x0, y0, x1, y1 };
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const x0 = Math.max(0, Math.round(raw.x0 ?? raw.x ?? 0));
    const y0 = Math.max(0, Math.round(raw.y0 ?? raw.y ?? 0));
    const w =
      typeof raw.width === 'number'
        ? Math.max(1, Math.round(raw.width))
        : typeof raw.x1 === 'number'
          ? Math.max(1, Math.round(raw.x1 - x0))
          : pageWidth;
    const h =
      typeof raw.height === 'number'
        ? Math.max(1, Math.round(raw.height))
        : typeof raw.y1 === 'number'
          ? Math.max(1, Math.round(raw.y1 - y0))
          : Math.max(1, Math.round(pageHeight * 0.05));
    return { x: x0, y: y0, width: w, height: h, x0, y0, x1: x0 + w, y1: y0 + h };
  }
  return {
    x: 0,
    y: 0,
    width: pageWidth,
    height: pageHeight,
    x0: 0,
    y0: 0,
    x1: pageWidth,
    y1: pageHeight,
  };
}

function stripBasicHtmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<(td|th)[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function mapSuryaLabelToBlockKind(label: string, text: string): ReconstructedBlockKind {
  const norm = label.toLowerCase();
  if (norm.includes('pageheader') || norm === 'header') return 'header';
  if (norm.includes('pagefooter') || norm === 'footer') return 'footer';
  if (norm.includes('sectionheader') || norm.includes('title')) return 'heading';
  if (norm.includes('caption') || norm.includes('subheading')) return 'subheading';
  if (norm.includes('table')) return 'table';
  if (norm.includes('equation') || norm.includes('formula')) return 'formula';
  if (norm.includes('picture') || norm.includes('figure')) return 'diagram';
  if (/^\s*(?:Q(?:uestion)?\s*\d+|\d+[.)]\s+)/i.test(text)) return 'question';
  if (/^\s*(?:\([a-z]{1,3}\)|[a-d][.)]\s+)/i.test(text)) return 'subquestion';
  return 'paragraph';
}

function parseSimpleHtmlTable(html: string): { headers: string[]; rows: string[][] } | null {
  const rowMatches = html.match(/<tr[\s\S]*?<\/tr>/gi);
  if (!rowMatches || rowMatches.length === 0) return null;
  const rows: string[][] = [];
  let headers: string[] = [];
  for (let i = 0; i < rowMatches.length; i += 1) {
    const rowHtml = rowMatches[i];
    const ths = Array.from(rowHtml.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)).map((m) =>
      stripBasicHtmlToText(m[1])
    );
    const tds = Array.from(rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((m) =>
      stripBasicHtmlToText(m[1])
    );
    if (ths.length > 0 && headers.length === 0) {
      headers = ths;
      if (tds.length > 0) rows.push(tds);
    } else {
      const cells = [...ths, ...tds];
      if (cells.length > 0) {
        if (i === 0 && headers.length === 0) headers = cells;
        else rows.push(cells);
      }
    }
  }
  if (headers.length === 0 && rows.length === 0) return null;
  return { headers, rows };
}

function formatTableMarkdown(headers: string[], rows: string[][]): string {
  const cols = Math.max(headers.length, ...rows.map((r) => r.length), 1);
  const padRow = (r: string[]) =>
    Array.from({ length: cols }, (_, idx) => (r[idx] ?? '').replace(/\|/g, '\\|').trim() || ' ');
  const h = padRow(headers);
  const sep = Array.from({ length: cols }, () => '---');
  return [
    `| ${h.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...rows.map((r) => `| ${padRow(r).join(' | ')} |`),
  ].join('\n');
}

export function normalizeSuryaPagePayload(
  rawPage: SuryaRawPagePayload,
  fallbackPageNumber = 1
): NormalizedSuryaPage {
  const pageNumber =
    typeof rawPage.pageNumber === 'number' && rawPage.pageNumber >= 1
      ? Math.round(rawPage.pageNumber)
      : fallbackPageNumber;
  const width = Math.max(1, Math.round(rawPage.width ?? 1200));
  const height = Math.max(1, Math.round(rawPage.height ?? 1600));
  const warnings: string[] = [];
  const uncertainSpans: UncertainSpan[] = [];

  const sortedRawBlocks = (rawPage.blocks ?? [])
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const tables: ExtractedTable[] = [];
  const equations: ExtractedFormula[] = [];
  const blocks: ReconstructedBlock[] = [];
  const textParts: string[] = [];
  const blockConfs: number[] = [];

  // Process explicit equations array first if provided
  for (let idx = 0; idx < (rawPage.equations ?? []).length; idx += 1) {
    const eq = rawPage.equations![idx];
    const latex = (eq.latex ?? eq.text ?? '').trim();
    if (!latex) continue;
    const box = normalizeBoxCoords(eq.bbox, width, height);
    const conf =
      typeof eq.confidence === 'number'
        ? Math.max(0, Math.min(100, eq.confidence <= 1 ? Math.round(eq.confidence * 100) : Math.round(eq.confidence)))
        : 88;
    equations.push({
      id: `surya-eq-p${pageNumber}-${idx + 1}`,
      pageNumber,
      rawText: eq.text?.trim() || latex,
      latex,
      displayMode: Boolean(eq.displayMode),
      kind: 'general_equation',
      sourceMethod: 'math_adapter',
      confidence: conf,
      bbox: { x: box.x, y: box.y, width: box.width, height: box.height },
    });
  }

  // Process explicit tables array
  for (let idx = 0; idx < (rawPage.tables ?? []).length; idx += 1) {
    const tbl = rawPage.tables![idx];
    let headers = Array.isArray(tbl.headers) ? tbl.headers.map((h) => String(h).trim()) : [];
    let rows = Array.isArray(tbl.rows)
      ? tbl.rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c).trim()) : []))
      : [];
    if (headers.length === 0 && rows.length === 0 && tbl.html) {
      const parsedHtml = parseSimpleHtmlTable(tbl.html);
      if (parsedHtml) {
        headers = parsedHtml.headers;
        rows = parsedHtml.rows;
      }
    }
    if (headers.length > 0 || rows.length > 0) {
      const box = normalizeBoxCoords(tbl.bbox, width, height);
      tables.push({
        id: `surya-tbl-p${pageNumber}-${idx + 1}`,
        pageNumber,
        caption: tbl.caption,
        headers,
        rows,
        borderStyle: 'mixed',
        markdown: formatTableMarkdown(headers, rows),
        bbox: { x: box.x, y: box.y, width: box.width, height: box.height },
      });
    }
  }

  // Reconstruct ordered blocks
  for (let idx = 0; idx < sortedRawBlocks.length; idx += 1) {
    const blk = sortedRawBlocks[idx];
    const html = blk.html ?? '';
    const plain = (blk.text ?? '').trim() || stripBasicHtmlToText(html);
    const label = blk.label ?? 'Text';
    const box = normalizeBoxCoords(blk.bbox, width, height);
    const rawConf = blk.confidence;
    const confPct =
      typeof rawConf === 'number'
        ? Math.max(0, Math.min(100, rawConf <= 1 ? Math.round(rawConf * 100) : Math.round(rawConf)))
        : 90;
    blockConfs.push(confPct);

    const kind = mapSuryaLabelToBlockKind(label, plain);
    let attachedTable: ExtractedTable | undefined;
    if (kind === 'table') {
      const parsedHtml = html ? parseSimpleHtmlTable(html) : null;
      if (parsedHtml) {
        attachedTable = {
          id: `surya-blk-tbl-p${pageNumber}-${idx + 1}`,
          pageNumber,
          headers: parsedHtml.headers,
          rows: parsedHtml.rows,
          markdown: formatTableMarkdown(parsedHtml.headers, parsedHtml.rows),
          bbox: { x: box.x, y: box.y, width: box.width, height: box.height },
        };
        if (tables.length <= idx) tables.push(attachedTable);
      } else if (tables[0]) {
        attachedTable = tables[0];
      }
    }

    if (kind === 'formula' && plain) {
      const mathTagMatch = html.match(/alttext="([^"]+)"/i);
      const latex = (mathTagMatch?.[1] || plain).trim();
      if (!equations.some((e) => e.latex === latex)) {
        equations.push({
          id: `surya-blk-eq-p${pageNumber}-${idx + 1}`,
          pageNumber,
          rawText: plain,
          latex,
          displayMode: true,
          sourceMethod: 'math_adapter',
          confidence: confPct,
          bbox: { x: box.x, y: box.y, width: box.width, height: box.height },
        });
      }
      blocks.push({
        id: `surya-blk-p${pageNumber}-${idx + 1}`,
        kind: 'formula',
        pageNumber,
        text: `$$${latex}$$`,
        latex,
        displayMode: true,
        bbox: { x: box.x, y: box.y, width: box.width, height: box.height },
      });
      textParts.push(`$$${latex}$$`);
      continue;
    }

    if (confPct < 58 && plain.length >= 2) {
      uncertainSpans.push({
        text: plain.slice(0, 120),
        confidence: confPct,
        reason: `Surya low block confidence (${confPct}%)`,
        bbox: { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 },
      });
    }

    blocks.push({
      id: `surya-blk-p${pageNumber}-${idx + 1}`,
      kind,
      pageNumber,
      text: attachedTable?.markdown || plain,
      headingLevel: kind === 'heading' ? 1 : kind === 'subheading' ? 2 : undefined,
      table: attachedTable,
      uncertain: confPct < 58,
      uncertainReason: confPct < 58 ? `Low Surya recognition confidence (${confPct}%)` : undefined,
      bbox: { x: box.x, y: box.y, width: box.width, height: box.height },
    });

    if (attachedTable?.markdown) {
      textParts.push(attachedTable.markdown);
    } else if (plain) {
      textParts.push(plain);
    }
  }

  const lineBoxes: OcrLineBox[] = (rawPage.lines ?? [])
    .map((ln) => {
      const box = normalizeBoxCoords(ln.bbox, width, height);
      const conf =
        typeof ln.confidence === 'number'
          ? Math.max(0, Math.min(100, ln.confidence <= 1 ? Math.round(ln.confidence * 100) : Math.round(ln.confidence)))
          : 90;
      const t = (ln.text ?? '').trim();
      if (conf < 55 && t.length >= 2 && uncertainSpans.length < 22) {
        uncertainSpans.push({
          text: t.slice(0, 120),
          confidence: conf,
          reason: `Surya low line confidence (${conf}%)`,
          bbox: { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 },
        });
      }
      return {
        text: t,
        confidence: conf,
        x0: box.x0,
        y0: box.y0,
        x1: box.x1,
        y1: box.y1,
      };
    })
    .filter((l) => l.text.length > 0);

  const wordBoxes: OcrWordBox[] = [];
  for (const lb of lineBoxes) {
    const words = lb.text.split(/\s+/).filter(Boolean);
    const totalChars = Math.max(1, words.reduce((s, w) => s + w.length, 0));
    const lineW = Math.max(1, lb.x1 - lb.x0);
    let cursorX = lb.x0;
    for (const w of words) {
      const wWidth = Math.max(2, Math.round((w.length / totalChars) * lineW));
      wordBoxes.push({
        text: w,
        confidence: lb.confidence,
        x0: cursorX,
        y0: lb.y0,
        x1: Math.min(lb.x1, cursorX + wWidth),
        y1: lb.y1,
        lineY0: lb.y0,
        lineY1: lb.y1,
      });
      cursorX = Math.min(lb.x1, cursorX + wWidth + 3);
    }
  }

  const combinedText = (
    (rawPage.text ?? '').trim() ||
    textParts.join('\n\n') ||
    lineBoxes.map((l) => l.text).join('\n')
  ).trim();

  const rawPageConf = rawPage.confidence;
  const computedConf =
    typeof rawPageConf === 'number'
      ? Math.max(0, Math.min(100, rawPageConf <= 1 ? Math.round(rawPageConf * 100) : Math.round(rawPageConf)))
      : blockConfs.length > 0
        ? Math.round(blockConfs.reduce((a, b) => a + b, 0) / blockConfs.length)
        : lineBoxes.length > 0
          ? Math.round(lineBoxes.reduce((a, b) => a + b.confidence, 0) / lineBoxes.length)
          : combinedText.length > 10
            ? 86
            : 0;

  if (computedConf > 0 && computedConf < 65) {
    warnings.push(`Surya confidence is modest (${computedConf}%); review uncertain spans.`);
  }

  return {
    pageNumber,
    width,
    height,
    text: combinedText,
    confidence: computedConf,
    blocks,
    lineBoxes,
    wordBoxes,
    equations,
    tables,
    uncertainSpans,
    warnings,
  };
}

export function createSuryaOcrService(deps?: SuryaServiceDeps) {
  const env = deps?.env ?? process.env;
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const now = deps?.now ?? Date.now;

  function detectCapabilities(localLanguages: string[] = ['eng']): OcrCapabilitiesSnapshot {
    const suryaUrlCheck = validateConfiguredServiceUrl(env.SURYA_OCR_URL);
    const datalabKey = env.DATALAB_API_KEY?.trim();
    const cliBin = env.SURYA_PYTHON_BIN?.trim();

    const suryaMode: SuryaBackendMode = suryaUrlCheck.valid
      ? 'surya_http'
      : datalabKey
        ? 'datalab_api'
        : cliBin
          ? 'surya_cli'
          : 'unavailable';

    const visionPref = (env.VISION_OCR_PROVIDER || 'auto').trim().toLowerCase();
    const hasGemini = Boolean(env.GEMINI_API_KEY?.trim());
    const hasOpenAi = Boolean(env.VISION_OCR_API_KEY?.trim() && env.VISION_OCR_BASE_URL?.trim());
    const visionAvailable =
      visionPref !== 'disabled' && visionPref !== 'off' && visionPref !== 'none' && (hasGemini || hasOpenAi);
    const visionProvider: OcrCapabilitiesSnapshot['vision']['provider'] = !visionAvailable
      ? visionPref === 'disabled' || visionPref === 'off'
        ? 'disabled'
        : 'unconfigured'
      : hasOpenAi && (visionPref === 'openai_compatible' || !hasGemini)
        ? 'openai_compatible'
        : 'gemini';

    const htrUrlCheck = validateConfiguredServiceUrl(
      env.HTR_SERVICE_URL || (suryaUrlCheck.valid ? `${suryaUrlCheck.normalizedUrl}/htr` : undefined)
    );
    const htrMode: OcrCapabilitiesSnapshot['handwriting']['mode'] = htrUrlCheck.valid
      ? 'trocr_service'
      : visionAvailable
        ? 'vision_htr'
        : 'detector_only';

    const notes: string[] = [];
    if (!localLanguages.includes('hau')) {
      notes.push('Hausa (hau) lacks official upstream Tesseract traineddata; routed via Surya/Vision.');
    }
    if (!localLanguages.includes('ibo')) {
      notes.push('Igbo (ibo) lacks official upstream Tesseract traineddata; routed via Surya/Vision.');
    }
    if (!suryaUrlCheck.valid && !datalabKey && !cliBin) {
      notes.push('Surya inference sidecar not configured (set SURYA_OCR_URL or DATALAB_API_KEY); local Tesseract pool active.');
    }

    return {
      ok: true,
      surya: {
        available: suryaMode !== 'unavailable',
        mode: suryaMode,
        endpointConfigured: suryaUrlCheck.valid,
        datalabConfigured: Boolean(datalabKey),
        cliConfigured: Boolean(cliBin),
      },
      vision: {
        available: visionAvailable,
        provider: visionProvider,
      },
      handwriting: {
        available: htrMode !== 'detector_only',
        mode: htrMode,
      },
      languages: {
        defaultLanguage: 'eng',
        localTesseractInstalled: localLanguages,
        suryaSupportedNigerianLanguages: ['hau', 'yor', 'ibo'],
        notes,
      },
    };
  }

  async function analyzeWithSurya(params: { body: unknown }): Promise<ServerSuryaOcrResult> {
    if (!params.body || typeof params.body !== 'object') {
      return {
        status: 400,
        body: {
          ok: false,
          engine: 'surya',
          backendMode: 'unavailable',
          providerAvailable: false,
          error: 'Surya OCR request payload is required.',
        },
      };
    }

    const rec = params.body as Record<string, unknown>;
    const rawBase64 = typeof rec.imageBase64 === 'string' ? rec.imageBase64.trim() : '';
    const mimeMatch = rawBase64.match(/^data:([^;]+);base64,(.+)$/);
    const mimeType =
      (typeof rec.mimeType === 'string' && rec.mimeType.trim()) ||
      mimeMatch?.[1] ||
      'image/png';
    const cleanB64 = mimeMatch ? mimeMatch[2] : rawBase64;
    const pageNumber = typeof rec.pageNumber === 'number' && rec.pageNumber >= 1 ? Math.round(rec.pageNumber) : 1;
    const languages = Array.isArray(rec.languages)
      ? rec.languages.filter((l): l is string => typeof l === 'string').slice(0, 6)
      : ['en'];

    if (!cleanB64) {
      return {
        status: 400,
        body: {
          ok: false,
          engine: 'surya',
          backendMode: 'unavailable',
          providerAvailable: false,
          error: 'imageBase64 is required.',
        },
      };
    }

    const buf = Buffer.from(cleanB64, 'base64');
    if (buf.byteLength === 0 || buf.byteLength > MAX_SCANNER_FILE_BYTES) {
      return {
        status: 413,
        body: {
          ok: false,
          engine: 'surya',
          backendMode: 'unavailable',
          providerAvailable: false,
          error: 'Binary payload is empty or exceeds maximum allowed size.',
        },
      };
    }

    const isPdf = mimeType.toLowerCase().includes('pdf');
    const ext = isPdf ? 'pdf' : mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : mimeType.includes('webp') ? 'webp' : 'png';
    const sec = validateMagicAndSecurity({
      fileName: `surya-input-p${pageNumber}.${ext}`,
      mimeType,
      bytes: new Uint8Array(buf),
    });
    if (!sec.valid || (sec.format !== 'image' && sec.format !== 'pdf')) {
      return {
        status: 422,
        body: {
          ok: false,
          engine: 'surya',
          backendMode: 'unavailable',
          providerAvailable: false,
          error: sec.error ?? 'Input failed server magic-byte security validation.',
        },
      };
    }

    const suryaUrlCheck = validateConfiguredServiceUrl(env.SURYA_OCR_URL);
    const datalabKey = env.DATALAB_API_KEY?.trim();
    const cliBin = env.SURYA_PYTHON_BIN?.trim();
    const startedAt = now();

    // Backend 1: Dedicated FastAPI Surya Microservice (`SURYA_OCR_URL`)
    if (suryaUrlCheck.valid && suryaUrlCheck.normalizedUrl) {
      const timeoutMs = Math.max(
        5000,
        Math.min(120_000, Number(env.SURYA_TIMEOUT_MS || DEFAULT_SURYA_TIMEOUT_MS))
      );
      try {
        const res = await fetchImpl(`${suryaUrlCheck.normalizedUrl}/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
          body: JSON.stringify({
            imageBase64: cleanB64,
            mimeType,
            pageNumber,
            languages,
            extractTables: true,
            extractEquations: true,
          }),
        });
        const payload = (await res.json()) as {
          ok?: boolean;
          pages?: SuryaRawPagePayload[];
          apiMode?: string;
          device?: string;
          error?: string;
        };
        if (!res.ok || !payload.ok || !Array.isArray(payload.pages) || payload.pages.length === 0) {
          return {
            status: 200,
            body: {
              ok: false,
              engine: 'surya',
              backendMode: 'surya_http',
              providerAvailable: true,
              error: payload.error || `Surya HTTP service returned status ${res.status}.`,
            },
          };
        }

        const normalizedPages = payload.pages.map((p, idx) =>
          normalizeSuryaPagePayload(p, pageNumber + idx)
        );
        return {
          status: 200,
          body: {
            ok: true,
            engine: 'surya',
            backendMode: 'surya_http',
            providerAvailable: true,
            modelInfo: `${payload.apiMode || 'surya'} (${payload.device || 'remote'})`,
            durationMs: Math.max(0, now() - startedAt),
            page: normalizedPages[0],
            pages: normalizedPages,
          },
        };
      } catch (err) {
        return {
          status: 200,
          body: {
            ok: false,
            engine: 'surya',
            backendMode: 'surya_http',
            providerAvailable: true,
            error: err instanceof Error ? err.message.slice(0, 180) : 'Surya HTTP request failed.',
          },
        };
      }
    }

    // Backend 2: Datalab Hosted Surya OCR API (`DATALAB_API_KEY`)
    if (datalabKey) {
      const datalabEndpoint =
        validateConfiguredServiceUrl(env.DATALAB_OCR_URL).normalizedUrl ||
        'https://www.datalab.to/api/v1/ocr';
      try {
        const form = new FormData();
        const blob = new Blob([new Uint8Array(buf)], { type: mimeType });
        form.append('file', blob, `page-${pageNumber}.${ext}`);
        form.append('langs', languages.join(','));
        const res = await fetchImpl(datalabEndpoint, {
          method: 'POST',
          headers: { 'X-API-Key': datalabKey },
          signal: AbortSignal.timeout(DEFAULT_SURYA_TIMEOUT_MS),
          body: form,
        });
        const data = (await res.json()) as {
          success?: boolean;
          pages?: Array<{
            text_lines?: Array<{ text?: string; confidence?: number; bbox?: [number, number, number, number] }>;
            image_bbox?: [number, number, number, number];
            page?: number;
          }>;
          error?: string;
        };
        if (!res.ok || !data.success || !Array.isArray(data.pages) || data.pages.length === 0) {
          return {
            status: 200,
            body: {
              ok: false,
              engine: 'surya',
              backendMode: 'datalab_api',
              providerAvailable: true,
              error: data.error || `Datalab OCR returned HTTP ${res.status}.`,
            },
          };
        }
        const normalizedPages = data.pages.map((p, idx) =>
          normalizeSuryaPagePayload(
            {
              pageNumber: p.page ?? pageNumber + idx,
              width: p.image_bbox?.[2] ?? 1200,
              height: p.image_bbox?.[3] ?? 1600,
              lines: (p.text_lines ?? []).map((ln) => ({
                text: ln.text,
                confidence: ln.confidence,
                bbox: ln.bbox,
              })),
            },
            pageNumber + idx
          )
        );
        return {
          status: 200,
          body: {
            ok: true,
            engine: 'surya',
            backendMode: 'datalab_api',
            providerAvailable: true,
            modelInfo: 'datalab-cloud-surya',
            durationMs: Math.max(0, now() - startedAt),
            page: normalizedPages[0],
            pages: normalizedPages,
          },
        };
      } catch (err) {
        return {
          status: 200,
          body: {
            ok: false,
            engine: 'surya',
            backendMode: 'datalab_api',
            providerAvailable: true,
            error: err instanceof Error ? err.message.slice(0, 180) : 'Datalab OCR request failed.',
          },
        };
      }
    }

    // Backend 3: Optional direct Python CLI bridge (`SURYA_PYTHON_BIN` + `SURYA_CLI_SCRIPT`)
    if (cliBin && env.SURYA_CLI_SCRIPT?.trim()) {
      const runner = deps?.execCliImpl ?? ((c, args) => execFileAsync(c, args, { timeout: 60_000 }));
      try {
        const digest = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
        const { stdout } = await runner(cliBin, [
          env.SURYA_CLI_SCRIPT.trim(),
          '--mime',
          mimeType,
          '--page',
          String(pageNumber),
          '--sha',
          digest,
          '--base64-stdin',
        ]);
        const parsed = JSON.parse(stdout) as { pages?: SuryaRawPagePayload[]; ok?: boolean; error?: string };
        if (parsed.ok && Array.isArray(parsed.pages) && parsed.pages.length > 0) {
          const normalizedPages = parsed.pages.map((p, idx) =>
            normalizeSuryaPagePayload(p, pageNumber + idx)
          );
          return {
            status: 200,
            body: {
              ok: true,
              engine: 'surya',
              backendMode: 'surya_cli',
              providerAvailable: true,
              modelInfo: 'local-python-surya-cli',
              durationMs: Math.max(0, now() - startedAt),
              page: normalizedPages[0],
              pages: normalizedPages,
            },
          };
        }
      } catch (err) {
        return {
          status: 200,
          body: {
            ok: false,
            engine: 'surya',
            backendMode: 'surya_cli',
            providerAvailable: true,
            error: err instanceof Error ? err.message.slice(0, 180) : 'Surya CLI execution failed.',
          },
        };
      }
    }

    return {
      status: 200,
      body: {
        ok: false,
        engine: 'surya',
        backendMode: 'unavailable',
        providerAvailable: false,
        error: 'Surya inference backend is not configured (set SURYA_OCR_URL or DATALAB_API_KEY). Local Tesseract fallback active.',
      },
    };
  }

  return {
    detectCapabilities,
    analyzeWithSurya,
  };
}

export const defaultSuryaOcrService = createSuryaOcrService();
