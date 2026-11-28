/**
 * PQGuide Multi-Engine OCR Router, Surya Bridge & Conservative Post-OCR Repair
 *
 * Selects cleanly between:
 *  - Surya OCR microservice / Datalab API (complex layouts, 2-col, tables, math, Nigerian Latin)
 *  - Enhanced Local Tesseract.js Pool (`eng` default + `yor` auto-selected when detected)
 *  - Multimodal Vision OCR fallback (low-confidence / degraded / occluded fallback)
 *  - Cropped-line Handwriting HTR (`/api/documents/handwriting-ocr`)
 */

import type {
  ExtractedFormula,
  ExtractedTable,
  ReconstructedBlock,
  UncertainSpan,
} from '../../core/types';
import type { HandwritingEngineAdapter } from './handwritingRecognizer';
import type { ImageQualityAnalysis } from './imagePreprocessor';
import {
  getInstalledOcrLanguages,
  normalizeNigerianDiacriticsNfc,
  selectTesseractLanguageParam,
} from './languageDetector';
import type { OcrLineBox, OcrWordBox } from './ocrEngine';

export type OcrEngineMode = 'auto' | 'surya' | 'tesseract' | 'hybrid';

export interface ClientOcrCapabilities {
  ok: boolean;
  surya: {
    available: boolean;
    mode: 'surya_http' | 'datalab_api' | 'surya_cli' | 'unavailable';
  };
  vision: {
    available: boolean;
    provider: string;
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

export interface SuryaNormalizedPageResult {
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

export interface SuryaOcrRunnerInput {
  imageBase64: string;
  mimeType: string;
  pageNumber?: number;
  languages?: string[];
  signal?: AbortSignal;
}

export interface SuryaOcrRunnerResult {
  ok: boolean;
  engine: 'surya';
  backendMode: string;
  providerAvailable: boolean;
  modelInfo?: string;
  durationMs?: number;
  page?: SuryaNormalizedPageResult;
  pages?: SuryaNormalizedPageResult[];
  error?: string;
}

export type SuryaOcrRunner = (
  input: SuryaOcrRunnerInput
) => Promise<SuryaOcrRunnerResult>;

export interface OcrRoutingPlan {
  primaryEngine: 'surya' | 'tesseract';
  fallbackOrder: Array<'surya' | 'tesseract' | 'vision'>;
  tesseractLang: string;
  reason: string;
  trySuryaFirst: boolean;
}

let cachedCapabilities: ClientOcrCapabilities | null = null;
let cachedCapabilitiesAt = 0;
const CAPABILITIES_TTL_MS = 60_000;

export async function queryServerOcrCapabilities(
  forceRefresh = false
): Promise<ClientOcrCapabilities | null> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    return null;
  }
  const now = Date.now();
  if (!forceRefresh && cachedCapabilities && now - cachedCapabilitiesAt < CAPABILITIES_TTL_MS) {
    return cachedCapabilities;
  }
  try {
    const res = await fetch('/api/documents/ocr-capabilities', { method: 'GET' });
    if (!res.ok) return null;
    const data = (await res.json()) as ClientOcrCapabilities;
    if (data && data.ok) {
      cachedCapabilities = data;
      cachedCapabilitiesAt = now;
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

export function resetCachedOcrCapabilities(): void {
  cachedCapabilities = null;
  cachedCapabilitiesAt = 0;
}

export function selectOptimalOcrPlan(params: {
  engineMode?: OcrEngineMode;
  capabilities?: ClientOcrCapabilities | null;
  hasCustomSuryaRunner?: boolean;
  quality?: Partial<ImageQualityAnalysis>;
  languageHintText?: string;
  denseLayoutExpected?: boolean;
  allowVisionFallback?: boolean;
}): OcrRoutingPlan {
  const installedLangs =
    params.capabilities?.languages?.localTesseractInstalled ?? getInstalledOcrLanguages();
  const tesseractLang = selectTesseractLanguageParam(params.languageHintText, installedLangs);
  const suryaAvailable = Boolean(
    params.hasCustomSuryaRunner || params.capabilities?.surya?.available
  );
  const visionAvailable = Boolean(
    params.allowVisionFallback !== false && params.capabilities?.vision?.available
  );
  const qScore = params.quality?.qualityScore ?? 80;
  const degraded =
    qScore < 72 ||
    Boolean(params.quality?.isBlurry) ||
    Boolean(params.quality?.hasStrongShadows) ||
    Boolean(params.quality?.isLowResolution);

  const mode = params.engineMode ?? 'auto';

  if (mode === 'tesseract') {
    const fallbacks: Array<'surya' | 'tesseract' | 'vision'> = [];
    if (suryaAvailable) fallbacks.push('surya');
    if (visionAvailable) fallbacks.push('vision');
    return {
      primaryEngine: 'tesseract',
      fallbackOrder: fallbacks,
      tesseractLang,
      reason: 'Explicit local Tesseract mode requested.',
      trySuryaFirst: false,
    };
  }

  if (mode === 'surya' || mode === 'hybrid') {
    if (suryaAvailable) {
      return {
        primaryEngine: 'surya',
        fallbackOrder: visionAvailable ? ['tesseract', 'vision'] : ['tesseract'],
        tesseractLang,
        reason:
          mode === 'surya'
            ? 'Explicit Surya OCR + layout mode selected.'
            : 'Hybrid Surya + Tesseract cross-verification mode selected.',
        trySuryaFirst: true,
      };
    }
    return {
      primaryEngine: 'tesseract',
      fallbackOrder: visionAvailable ? ['vision'] : [],
      tesseractLang,
      reason: 'Surya service unavailable; falling back automatically to enhanced Tesseract pool.',
      trySuryaFirst: false,
    };
  }

  // Automatic routing (`auto`)
  if (suryaAvailable) {
    return {
      primaryEngine: 'surya',
      fallbackOrder: visionAvailable ? ['tesseract', 'vision'] : ['tesseract'],
      tesseractLang,
      reason: degraded
        ? 'Degraded/complex academic scan routed automatically to Surya OCR + LayoutPredictor.'
        : params.denseLayoutExpected
          ? 'Academic layout/equation scan routed automatically to Surya OCR.'
          : 'Surya inference backend active; selected for full layout, equation & table capture.',
      trySuryaFirst: true,
    };
  }

  return {
    primaryEngine: 'tesseract',
    fallbackOrder: visionAvailable ? ['vision'] : [],
    tesseractLang,
    reason: `Local Tesseract (${tesseractLang}) selected; quality=${qScore}/100.`,
    trySuryaFirst: false,
  };
}

/**
 * Deterministic, zero-hallucination post-OCR repair:
 *  - Expands typographic ligatures (`ﬁ -> fi`, `ﬂ -> fl`)
 *  - Normalizes decomposed Nigerian diacritics to Unicode NFC (`e + \u0323 -> ẹ`)
 *  - Repairs split caret / subscript glyph misreads (`mc”~2 -> mc^2`, `m/s"~2 -> m/s^2`, `a_ n -> a_n`)
 *  - Rejoins clean soft-hyphenated prose wraps across line breaks without altering words
 */
export function applyConservativeOcrRepairs(rawText: string): {
  text: string;
  repairsApplied: string[];
} {
  if (!rawText) return { text: '', repairsApplied: [] };
  let out = rawText;
  const repairs: string[] = [];

  const beforeLig = out;
  out = out
    .replace(/\uFB00/g, 'ff')
    .replace(/\uFB01/g, 'fi')
    .replace(/\uFB02/g, 'fl')
    .replace(/\uFB03/g, 'ffi')
    .replace(/\uFB04/g, 'ffl')
    .replace(/\uFB05/g, 'ft');
  if (out !== beforeLig) repairs.push('ligature_normalization');

  const beforeNfc = out;
  out = normalizeNigerianDiacriticsNfc(out);
  if (out !== beforeNfc) repairs.push('diacritic_nfc_normalization');

  // Fix split caret misreads produced by Tesseract on tight sans-serif exponents (e.g., mc”~2 -> mc^2, m/s"~2 -> m/s^2)
  const beforeCaret = out;
  out = out.replace(
    /([A-Za-z0-9)])[”"“'`´]{1,2}~(\d{1,3}|[a-zA-Z])\b/g,
    '$1^$2'
  );
  // Fix accidental whitespace immediately after algebraic subscript underscore (`a_ n` -> `a_n`)
  out = out.replace(/\b([A-Za-z])_\s+([A-Za-z0-9]{1,3})\b/g, '$1_$2');
  if (out !== beforeCaret) repairs.push('math_caret_subscript_artifact_repair');

  // Rejoin soft-hyphenated lowercase English/Latin prose words across line breaks
  const beforeHyphen = out;
  out = out.replace(/([a-z]{3,})-\n([a-z]{3,})/g, '$1$2');
  if (out !== beforeHyphen) repairs.push('prose_linewrap_dehyphenation');

  return { text: out, repairsApplied: repairs };
}

export async function defaultBrowserSuryaRunner(
  input: SuryaOcrRunnerInput
): Promise<SuryaOcrRunnerResult> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    return {
      ok: false,
      engine: 'surya',
      backendMode: 'unavailable',
      providerAvailable: false,
      error: 'Surya HTTP runner requires browser runtime or custom suryaRunner in tests.',
    };
  }
  try {
    const res = await fetch('/api/documents/surya-ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: input.signal,
      body: JSON.stringify({
        imageBase64: input.imageBase64,
        mimeType: input.mimeType,
        pageNumber: input.pageNumber ?? 1,
        languages: input.languages ?? ['en'],
      }),
    });
    return (await res.json()) as SuryaOcrRunnerResult;
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') throw err;
    return {
      ok: false,
      engine: 'surya',
      backendMode: 'unavailable',
      providerAvailable: false,
      error: err instanceof Error ? err.message : 'Surya OCR request failed.',
    };
  }
}

function encodeGrayCropPngBrowser(
  gray: Uint8Array,
  width: number,
  height: number
): string | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const imgData = ctx.createImageData(width, height);
  for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
    const v = gray[i];
    imgData.data[p] = v;
    imgData.data[p + 1] = v;
    imgData.data[p + 2] = v;
    imgData.data[p + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * Default backend Handwriting Transcription (HTR) adapter that crops ONLY the detected
 * handwriting region and calls `/api/documents/handwriting-ocr` (TrOCR or Vision HTR).
 */
export function createBackendHandwritingAdapter(): HandwritingEngineAdapter | undefined {
  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    return undefined;
  }
  return {
    name: 'PQGuideBackendHTR',
    async recognizeRegion(input) {
      const dataUrl = encodeGrayCropPngBrowser(input.gray, input.width, input.height);
      if (!dataUrl) {
        return {
          text: '[unreadable handwriting]',
          confidence: 0,
          uncertainWords: [],
          unreadable: true,
        };
      }
      const res = await fetch('/api/documents/handwriting-ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: dataUrl,
          mimeType: 'image/png',
          promptHint: `Cropped handwritten answer block (${input.width}x${input.height})`,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        modelAvailable?: boolean;
        text?: string;
        confidence?: number;
        unreadable?: boolean;
        uncertainWords?: string[];
      };
      if (!data.modelAvailable || !data.ok) {
        throw new Error('Backend handwriting model unavailable');
      }
      return {
        text: data.text || '[unreadable handwriting]',
        confidence: typeof data.confidence === 'number' ? data.confidence : 0,
        uncertainWords: data.uncertainWords ?? [],
        unreadable: Boolean(data.unreadable),
      };
    },
  };
}
