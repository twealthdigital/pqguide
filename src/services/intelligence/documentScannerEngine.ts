import JSZip from 'jszip';
import jsQR from 'jsqr';
import { sanitizePlainText, sanitizeSingleLine } from '../../core/security';
import type {
  AcademicDocFormat,
  DeterministicCheckResult,
  ExtractedDiagramAsset,
  ExtractedFormula,
  ExtractedPageContent,
  ExtractedTable,
  ExtractionQualityStatus,
  PageExtractionMethod,
  QrCodeMatch,
  UncertainSpan,
} from '../../core/types';
import {
  computeSha256Hex,
  isSafeZipEntryPath,
  MAX_PDF_PAGES,
  MAX_ZIP_COMPRESSION_RATIO,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_UNCOMPRESSED_BYTES,
  validateMagicAndSecurity,
} from './fileSecurity';
import {
  decodeBytesToGrayscale,
  preprocessImageForOcr,
  uint8ToBase64DataUrl,
  type PreprocessedImageResult,
} from './imagePreprocessor';
import {
  extractPdfVectorDiagrams,
  extractRasterDiagramsFromGrayscale,
  type PdfTextTokenLike,
} from './diagramExtractor';
import {
  recognizeWithTesseractPool,
  type VisionFallbackMode,
  type VisionOcrRunner,
} from './ocrEngine';
import {
  detectRepeatedHeadersFooters,
  extractFormulasFromText,
  extractTablesFromText,
  formatMultiPageStructuredText,
  parseStructuredDocument,
} from './structuredParser';
import {
  documentStorageAdapter,
  getCachedExtractionByHash,
  setCachedExtractionByHash,
} from './storageAdapter';

export type ScanStageId =
  | 'queued'
  | 'validating'
  | 'hashing'
  | 'optimizing'
  | 'extracting'
  | 'ocr'
  | 'deterministic_checks'
  | 'ai_cross_check'
  | 'decision'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface ScanProgressUpdate {
  stage: ScanStageId;
  stageLabel: string;
  currentPage?: number;
  totalPages?: number;
  progressPercent?: number;
  ocrProgress?: number;
  preprocessingStatus?: string;
  detail?: string;
}

export interface OcrRunnerResult {
  text: string;
  confidence: number; // 0..100
  warnings?: string[];
  preprocessed?: PreprocessedImageResult;
  orientationCorrectedDeg?: 0 | 90 | 180 | 270;
  ocrEngineUsed?: 'tesseract' | 'vision' | 'hybrid_tesseract_vision';
  visionFallbackUsed?: boolean;
  visionFallbackError?: string;
  uncertainSpans?: UncertainSpan[];
  perspectiveCorrected?: boolean;
}

export type OcrRunner = (input: {
  imageDataUrl?: string;
  bytes?: Uint8Array;
  mimeType?: string;
  pageNumber?: number;
  signal?: AbortSignal;
  skipPreprocessing?: boolean;
  visionFallback?: VisionFallbackMode;
  visionOcrRunner?: VisionOcrRunner;
  onOcrProgress?: (pct: number, statusText: string) => void;
}) => Promise<OcrRunnerResult>;

export type PdfPageRenderer = (params: {
  pageNumber: number;
  totalPages: number;
}) => Promise<{
  imageDataUrl?: string;
  bytes?: Uint8Array;
  mimeType?: string;
  width?: number;
  height?: number;
} | null>;

export interface ScannedArtifactOutput {
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  detectedFormat: AcademicDocFormat;
  sha256: string;
  originalFileRefKey?: string;
  originalStorageRef?: Awaited<ReturnType<typeof documentStorageAdapter.putBinary>>;
  optimizedPreviewUrl?: string;
  pageCount: number;
  extractedText: string;
  pages: ExtractedPageContent[];
  diagrams: ExtractedDiagramAsset[];
  tables: ExtractedTable[];
  formulas: ExtractedFormula[];
  headings: string[];
  summary: string;
  suggestedTitle: string;
  courseCode: string;
  courseTitle: string;
  level: ReturnType<typeof parseStructuredDocument>['level'];
  session: string;
  semester: ReturnType<typeof parseStructuredDocument>['semester'];
  category: ReturnType<typeof parseStructuredDocument>['category'];
  qrCodesFound: QrCodeMatch[];
  averageOcrConfidence: number | null;
  extractionQualityStatus: ExtractionQualityStatus;
  processedPages: number[];
  unprocessedPages: number[];
  extractionWarnings: string[];
  securityFlags: string[];
  earlyChecks: DeterministicCheckResult[];
  parentZipName?: string;
  processingDurationMs: number;
}

export interface ScanInputFile {
  name: string;
  type: string;
  size: number;
  bytes: Uint8Array;
  parentZipName?: string;
}

const MAX_PAGE_TEXT_CHARS = 60_000;
const MAX_DOC_TEXT_CHARS = 240_000;

export async function fileToScanInput(file: File): Promise<ScanInputFile> {
  const buf = await file.arrayBuffer();
  return {
    name: file.name,
    type: file.type,
    size: file.size,
    bytes: new Uint8Array(buf),
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Document scan cancelled by user.', 'AbortError');
  }
}

function guessMimeFromExtension(ext: string, fallback = 'application/octet-stream'): string {
  switch (ext.toLowerCase()) {
    case 'pdf':
      return 'application/pdf';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'zip':
      return 'application/zip';
    case 'txt':
      return 'text/plain';
    case 'md':
      return 'text/markdown';
    case 'csv':
      return 'text/csv';
    default:
      return fallback;
  }
}

function uint8ToDataUrl(bytes: Uint8Array, mimeType: string): string {
  return uint8ToBase64DataUrl(bytes, mimeType);
}

/** Unified adaptive OCR runner working seamlessly in Browser and Node.js. */
export async function defaultBrowserOcrRunner(input: {
  imageDataUrl?: string;
  bytes?: Uint8Array;
  mimeType?: string;
  pageNumber?: number;
  signal?: AbortSignal;
  skipPreprocessing?: boolean;
  visionFallback?: VisionFallbackMode;
  visionOcrRunner?: VisionOcrRunner;
  onOcrProgress?: (pct: number, statusText: string) => void;
}): Promise<OcrRunnerResult> {
  throwIfAborted(input.signal);
  const res = await recognizeWithTesseractPool({
    imageDataUrl: input.imageDataUrl,
    bytes: input.bytes,
    mimeType: input.mimeType,
    pageNumber: input.pageNumber,
    signal: input.signal,
    skipPreprocessing: input.skipPreprocessing,
    visionFallback: input.visionFallback,
    visionOcrRunner: input.visionOcrRunner,
    onOcrProgress: input.onOcrProgress,
  });
  return {
    text: res.text,
    confidence: res.confidence,
    warnings: res.warnings,
    preprocessed: res.preprocessed,
    orientationCorrectedDeg: res.orientationCorrectedDeg,
    ocrEngineUsed: res.ocrEngineUsed,
    visionFallbackUsed: res.visionFallbackUsed,
    visionFallbackError: res.visionFallbackError,
    uncertainSpans: res.uncertainSpans,
    perspectiveCorrected: res.perspectiveCorrected,
  };
}

function isSafeQrUrl(payload: string): boolean {
  const trimmed = payload.trim();
  if (!/^https?:\/\//i.test(trimmed)) return true;
  try {
    const parsed = new URL(trimmed);
    const h = parsed.hostname.toLowerCase();
    if (
      h === 'localhost' ||
      h.startsWith('127.') ||
      h.startsWith('10.') ||
      h.startsWith('192.168.')
    ) {
      return false;
    }
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function extractXmlTagsText(xmlSnippet: string): string {
  return decodeXmlEntities(
    xmlSnippet
      .replace(/<w:tab\b[^>]*\/>/g, '\t')
      .replace(/<w:br\b[^>]*\/>/g, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim()
  );
}

async function parseDocxArchive(
  bytes: Uint8Array,
  docId: string,
  signal?: AbortSignal
): Promise<{
  text: string;
  headings: string[];
  tables: ExtractedTable[];
  formulas: ExtractedFormula[];
  diagrams: ExtractedDiagramAsset[];
  hasMacros: boolean;
  wasTruncated: boolean;
}> {
  throwIfAborted(signal);
  const zip = await JSZip.loadAsync(bytes);
  const entryNames = Object.keys(zip.files);
  const hasMacros = entryNames.some((n) => /vbaProject\.bin$/i.test(n));
  const documentEntry = zip.file('word/document.xml');
  if (!documentEntry) {
    throw new Error('Corrupt or unsupported DOCX: missing word/document.xml.');
  }
  const xml = await documentEntry.async('string');

  const headings: string[] = [];
  const tables: ExtractedTable[] = [];
  const formulas: ExtractedFormula[] = [];
  const paragraphLines: string[] = [];

  // Parse OMML math (<m:oMath>...</m:oMath>)
  const mathRegex = /<m:oMath[^>]*>([\s\S]*?)<\/m:oMath>/g;
  let mathMatch: RegExpExecArray | null;
  while ((mathMatch = mathRegex.exec(xml)) !== null && formulas.length < 32) {
    const mathText = extractXmlTagsText(mathMatch[1]).replace(/\s+/g, ' ').trim();
    if (mathText) {
      formulas.push({
        id: `omml-${formulas.length + 1}`,
        pageNumber: 1,
        rawText: mathText,
        latex: mathText,
        displayMode: true,
      });
    }
  }

  // Parse tables (<w:tbl>...</w:tbl>)
  const tblRegex = /<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/g;
  let tblMatch: RegExpExecArray | null;
  while ((tblMatch = tblRegex.exec(xml)) !== null && tables.length < 12) {
    const rows: string[][] = [];
    const trRegex = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g;
    let trMatch: RegExpExecArray | null;
    while ((trMatch = trRegex.exec(tblMatch[1])) !== null) {
      const rowCells: string[] = [];
      const tcRegex = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g;
      let tcMatch: RegExpExecArray | null;
      while ((tcMatch = tcRegex.exec(trMatch[1])) !== null) {
        rowCells.push(sanitizeSingleLine(extractXmlTagsText(tcMatch[1]), 140));
      }
      if (rowCells.length > 0) rows.push(rowCells);
    }
    if (rows.length >= 2 && rows[0].length >= 2) {
      const colCount = rows[0].length;
      tables.push({
        id: `docx-tbl-${tables.length + 1}`,
        pageNumber: 1,
        headers: rows[0],
        rows: rows.slice(1).map((r) => Array.from({ length: colCount }, (_, i) => r[i] ?? '')),
      });
    }
  }

  // Parse paragraphs & styled headings
  const pRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let pMatch: RegExpExecArray | null;
  while ((pMatch = pRegex.exec(xml)) !== null) {
    const pXml = pMatch[1];
    const isHeading = /<w:pStyle\b[^>]*w:val="(Heading\d|Title|Subtitle)"/i.test(pXml);
    const text = extractXmlTagsText(pXml);
    if (!text) continue;
    if (isHeading && headings.length < 24) {
      headings.push(sanitizeSingleLine(text, 120));
      paragraphLines.push(`## ${text}`);
    } else {
      paragraphLines.push(text);
    }
  }

  const diagrams: ExtractedDiagramAsset[] = [];
  const mediaEntries = entryNames.filter(
    (name) => /^word\/media\/.+\.(png|jpg|jpeg|webp)$/i.test(name) && !zip.files[name].dir
  );
  for (let i = 0; i < Math.min(mediaEntries.length, 10); i += 1) {
    throwIfAborted(signal);
    const entryName = mediaEntries[i];
    const mediaBytes = await zip.files[entryName].async('uint8array');
    const ext = entryName.split('.').pop()?.toLowerCase() ?? 'png';
    const mimeType = guessMimeFromExtension(ext, 'image/png');
    const dataUrl =
      mediaBytes.byteLength <= 450_000 ? uint8ToDataUrl(mediaBytes, mimeType) : undefined;
    const ref = await documentStorageAdapter.putBinary({
      folder: 'diagrams',
      docId,
      fileName: entryName.split('/').pop() ?? `figure-${i + 1}.${ext}`,
      mimeType,
      bytes: mediaBytes,
      dataUrl,
    });
    diagrams.push({
      id: `docx-fig-${i + 1}`,
      pageNumber: 1,
      caption: `Embedded figure ${i + 1} (${entryName.split('/').pop() ?? 'diagram'})`,
      kind: 'diagram',
      mimeType,
      dataUrl,
      storageRef: ref,
    });
  }

  const joined = paragraphLines.join('\n');
  const sanitized = sanitizePlainText(joined, MAX_PAGE_TEXT_CHARS);
  return {
    text: sanitized,
    headings,
    tables,
    formulas,
    diagrams,
    hasMacros,
    wasTruncated: joined.trim().length > MAX_PAGE_TEXT_CHARS,
  };
}

interface PdfTextItemLike {
  str?: string;
  width?: number;
  height?: number;
  hasEOL?: boolean;
  transform?: number[];
}

interface NativePdfTextInspection {
  text: string;
  alnumCount: number;
  wordCount: number;
  garbleRatio: number;
  isMultiColumn: boolean;
  wasTruncated: boolean;
  placedTokens?: PdfTextTokenLike[];
}

/**
 * Reconstructs reading order from PDF text items by grouping Y baselines, reconstructing
 * coordinate-aligned 2+ column tables inline as clean Markdown tables, and detecting
 * true 2-column vertical prose gutters.
 */
export function extractPdfPageStructuredText(
  rawItems: PdfTextItemLike[],
  pageWidth = 612
): NativePdfTextInspection {
  interface PlacedToken {
    str: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }

  const tokens: PlacedToken[] = [];
  for (const item of rawItems) {
    const str = typeof item.str === 'string' ? item.str : '';
    if (!str.trim()) continue;
    const x = Array.isArray(item.transform) ? Number(item.transform[4] ?? 0) : 0;
    const y = Array.isArray(item.transform) ? Number(item.transform[5] ?? 0) : 0;
    const h = Math.abs(
      typeof item.height === 'number' && item.height > 0
        ? item.height
        : Array.isArray(item.transform)
          ? Number(item.transform[3] ?? 10)
          : 10
    );
    const w =
      typeof item.width === 'number' && item.width >= 0 ? item.width : str.length * h * 0.45;
    tokens.push({ str: str.trimEnd(), x, y, w, h });
  }

  if (tokens.length === 0) {
    return {
      text: '',
      alnumCount: 0,
      wordCount: 0,
      garbleRatio: 0,
      isMultiColumn: false,
      wasTruncated: false,
      placedTokens: [],
    };
  }

  // Detect 2-column reading layout: significant prose tokens strictly left/right of central gutter
  const midX = pageWidth * 0.5;
  const gutterHalf = Math.max(12, pageWidth * 0.035);
  let leftOnly = 0;
  let rightOnly = 0;
  let crossingMid = 0;
  let leftWordSum = 0;
  let rightWordSum = 0;
  for (const t of tokens) {
    const endX = t.x + t.w;
    const words = t.str.trim().split(/\s+/).filter(Boolean).length;
    if (endX <= midX - gutterHalf) {
      leftOnly += 1;
      leftWordSum += words;
    } else if (t.x >= midX + gutterHalf) {
      rightOnly += 1;
      rightWordSum += words;
    } else if (t.w > gutterHalf * 2.5) {
      crossingMid += 1;
    }
  }
  const avgLeftTokWords = leftWordSum / Math.max(1, leftOnly);
  const avgRightTokWords = rightWordSum / Math.max(1, rightOnly);
  const isMultiColumn =
    leftOnly >= 8 &&
    rightOnly >= 8 &&
    crossingMid <= Math.min(leftOnly, rightOnly) * 0.25 &&
    (avgLeftTokWords >= 2.2 || avgRightTokWords >= 2.2 || leftOnly + rightOnly >= 24);

  const rebuildStream = (stream: PlacedToken[], allowInlineTables: boolean): string => {
    if (stream.length === 0) return '';
    // Sort top-to-bottom (higher PDF Y first), then left-to-right (smaller X first)
    const sorted = stream.slice().sort((a, b) => {
      if (Math.abs(a.y - b.y) > 4.2) return b.y - a.y;
      return a.x - b.x;
    });

    // Cluster into horizontal baseline lines
    const lines: PlacedToken[][] = [];
    for (const tok of sorted) {
      const curLine = lines[lines.length - 1];
      if (!curLine || Math.abs(curLine[0].y - tok.y) > 4.2) {
        lines.push([tok]);
      } else {
        curLine.push(tok);
      }
    }

    interface LineRowInfo {
      y: number;
      avgH: number;
      text: string;
      cells: Array<{ text: string; x0: number; x1: number }>;
    }

    const rowInfos: LineRowInfo[] = [];
    for (const line of lines) {
      line.sort((a, b) => a.x - b.x);
      const baselineY = line[0].y;
      const avgH = line.reduce((acc, t) => acc + t.h, 0) / line.length || 10;

      // Split into coordinate cell spans for table detection + normal assembled text
      const cells: Array<{ text: string; x0: number; x1: number }> = [];
      let curCellText = '';
      let cellX0 = line[0].x;
      let cellX1 = line[0].x + line[0].w;
      let assembled = '';
      let prevEndX: number | null = null;
      const cellGapThresh = Math.max(11, avgH * 1.15);

      for (const tok of line) {
        const cleanedTok = tok.str.trim();
        if (!cleanedTok) continue;
        if (prevEndX !== null) {
          const gap = tok.x - prevEndX;
          if (gap > Math.max(18, avgH * 1.9)) {
            assembled += '\t';
          } else if (gap > Math.max(1.5, avgH * 0.14) && !assembled.endsWith(' ')) {
            assembled += ' ';
          }
          if (gap > cellGapThresh && curCellText.trim()) {
            cells.push({ text: curCellText.trim(), x0: cellX0, x1: cellX1 });
            curCellText = cleanedTok;
            cellX0 = tok.x;
            cellX1 = tok.x + tok.w;
          } else {
            curCellText = curCellText ? `${curCellText} ${cleanedTok}` : cleanedTok;
            cellX1 = Math.max(cellX1, tok.x + tok.w);
          }
        } else {
          curCellText = cleanedTok;
          cellX0 = tok.x;
          cellX1 = tok.x + tok.w;
        }
        assembled += tok.str;
        prevEndX = tok.x + tok.w;
      }
      if (curCellText.trim()) {
        cells.push({ text: curCellText.trim(), x0: cellX0, x1: cellX1 });
      }
      if (assembled.trim()) {
        rowInfos.push({ y: baselineY, avgH, text: assembled.trimEnd(), cells });
      }
    }

    const isTableCandidateRow = (r: LineRowInfo): boolean => {
      if (!allowInlineTables) return false;
      if (r.cells.length < 2 || r.cells.length > 8) return false;
      if (r.text.length > 165) return false;
      const avgWords =
        r.cells.reduce((s, c) => s + c.text.split(/\s+/).filter(Boolean).length, 0) / r.cells.length;
      if (avgWords > 6) return false;
      if (
        r.cells.length === 2 &&
        /^[A-D][.)]\s/i.test(r.cells[0].text) &&
        /^[A-D][.)]\s/i.test(r.cells[1].text)
      ) {
        return false;
      }
      return true;
    };

    const outBlocks: string[] = [];
    let prevBaselineY: number | null = null;
    let idx = 0;

    while (idx < rowInfos.length) {
      const row = rowInfos[idx];
      if (isTableCandidateRow(row)) {
        let end = idx + 1;
        while (end < rowInfos.length && isTableCandidateRow(rowInfos[end])) {
          const vGap = rowInfos[end - 1].y - rowInfos[end].y;
          if (vGap > row.avgH * 4.2) break;
          end += 1;
        }
        const run = rowInfos.slice(idx, end);
        if (run.length >= 2) {
          const bands: Array<{ minX: number; maxX: number; center: number }> = [];
          const runCells = run.flatMap((r) => r.cells).sort((a, b) => a.x0 - b.x0);
          for (const cell of runCells) {
            const match = bands.find(
              (b) => cell.x0 <= b.maxX + row.avgH * 0.85 && cell.x1 >= b.minX - row.avgH * 0.85
            );
            if (match) {
              match.minX = Math.min(match.minX, cell.x0);
              match.maxX = Math.max(match.maxX, cell.x1);
              match.center = (match.minX + match.maxX) * 0.5;
            } else {
              bands.push({ minX: cell.x0, maxX: cell.x1, center: (cell.x0 + cell.x1) * 0.5 });
            }
          }
          bands.sort((a, b) => a.center - b.center);
          const avgCellWords =
            runCells.reduce((s, c) => s + c.text.split(/\s+/).filter(Boolean).length, 0) /
            Math.max(1, runCells.length);

          if (bands.length >= 2 && bands.length <= 8 && (bands.length >= 3 || avgCellWords <= 4.2)) {
            const grid = run.map((r) => {
              const slots = Array.from({ length: bands.length }, () => '');
              for (const cell of r.cells) {
                let bestIdx = 0;
                let bestDist = Infinity;
                const center = (cell.x0 + cell.x1) * 0.5;
                for (let bi = 0; bi < bands.length; bi += 1) {
                  const overlap = Math.min(cell.x1, bands[bi].maxX) - Math.max(cell.x0, bands[bi].minX);
                  const d = overlap > 0 ? -overlap : Math.abs(center - bands[bi].center);
                  if (d < bestDist) {
                    bestDist = d;
                    bestIdx = bi;
                  }
                }
                slots[bestIdx] = slots[bestIdx] ? `${slots[bestIdx]} ${cell.text}` : cell.text;
              }
              return slots;
            });
            if (prevBaselineY !== null && prevBaselineY - row.y > row.avgH * 1.5) {
              outBlocks.push('');
            }
            outBlocks.push(
              [
                `| ${grid[0].map((c) => c || ' ').join(' | ')} |`,
                `| ${bands.map(() => '---').join(' | ')} |`,
                ...grid.slice(1).map((r) => `| ${r.map((c) => c || ' ').join(' | ')} |`),
              ].join('\n')
            );
            prevBaselineY = run[run.length - 1].y;
            idx = end;
            continue;
          }
        }
      }

      if (prevBaselineY !== null && prevBaselineY - row.y > row.avgH * 1.65) {
        outBlocks.push('');
      }
      outBlocks.push(row.text);
      prevBaselineY = row.y;
      idx += 1;
    }

    return outBlocks.join('\n');
  };

  let rawText = '';
  if (isMultiColumn) {
    const headerOrFull: PlacedToken[] = [];
    const leftCol: PlacedToken[] = [];
    const rightCol: PlacedToken[] = [];
    for (const t of tokens) {
      const endX = t.x + t.w;
      if (t.x < midX - gutterHalf && endX > midX + gutterHalf) {
        headerOrFull.push(t);
      } else if (endX <= midX + gutterHalf * 0.5) {
        leftCol.push(t);
      } else {
        rightCol.push(t);
      }
    }
    rawText = [
      rebuildStream(headerOrFull, true),
      rebuildStream(leftCol, false),
      rebuildStream(rightCol, false),
    ]
      .filter((s) => s.trim().length > 0)
      .join('\n\n');
  } else {
    rawText = rebuildStream(tokens, true);
  }

  const cleanText = sanitizePlainText(rawText, MAX_PAGE_TEXT_CHARS);
  const nonWs = cleanText.replace(/\s+/g, '');
  const alnumCount = (cleanText.match(/[A-Za-z0-9]/g) ?? []).length;
  const wordCount = cleanText.split(/\s+/).filter((w) => /[A-Za-z0-9]{2,}/.test(w)).length;
  const weirdChars = (
    rawText.match(/[\uFFFD\uE000-\uF8FF]|[^\x20-\x7E\n\r\t\u00A0-\u024F\u2000-\u22FF]/g) ?? []
  ).length;
  const garbleRatio = nonWs.length > 0 ? weirdChars / nonWs.length : 0;

  return {
    text: cleanText,
    alnumCount,
    wordCount,
    garbleRatio,
    isMultiColumn,
    wasTruncated: rawText.trim().length > MAX_PAGE_TEXT_CHARS,
    placedTokens: tokens,
  };
}

/** Merges OCR lines from embedded graphics/scans into native PDF text without duplicating native lines. */
function mergeNativeAndOcrText(nativeText: string, ocrText: string): {
  merged: string;
  addedLines: number;
} {
  const nativeLines = nativeText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const nativeTokenSets = nativeLines.map(
    (l) =>
      new Set(
        l
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          .filter((w) => w.length >= 2)
      )
  );

  const ocrLines = ocrText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => (l.match(/[A-Za-z0-9]/g) ?? []).length >= 5);

  const uniqueOcrLines: string[] = [];
  for (const line of ocrLines) {
    const norm = line.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (norm.length < 4) continue;
    const words = line
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2);
    const isDuplicate = nativeTokenSets.some((set) => {
      if (set.size === 0 || words.length === 0) return false;
      let overlap = 0;
      for (const w of words) {
        if (set.has(w)) overlap += 1;
      }
      return overlap / Math.max(words.length, set.size) >= 0.55 || overlap / words.length >= 0.72;
    });
    if (!isDuplicate) {
      uniqueOcrLines.push(line);
    }
  }

  if (uniqueOcrLines.length === 0) {
    return { merged: nativeText, addedLines: 0 };
  }

  return {
    merged: `${nativeText.trim()}\n\n[Extracted Embedded Graphic Text]\n${uniqueOcrLines.join('\n')}`,
    addedLines: uniqueOcrLines.length,
  };
}

/** Extracts raw raster image bytes embedded inside a PDF page in headless Node environments. */
async function extractNodePdfPageRasterFallback(
  page: {
    getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
    objs: { has: (id: string) => boolean; get: (id: string) => unknown };
    commonObjs?: { has: (id: string) => boolean; get: (id: string) => unknown };
  },
  imageOpIds: Set<number>
): Promise<{ bytes: Uint8Array; mimeType: string; width: number; height: number } | null> {
  if (typeof window !== 'undefined' && typeof document !== 'undefined') return null;
  try {
    const dynamicImport = new Function('mod', 'return import(mod)') as (
      mod: string
    ) => Promise<{
      default?: (
        buf: Uint8Array,
        opts: { raw: { width: number; height: number; channels: 1 | 3 | 4 } }
      ) => { png: () => { toBuffer: () => Promise<Buffer> } };
    }>;
    const sharpMod = await dynamicImport('sharp');
    const sharpFn = sharpMod.default;
    if (!sharpFn) return null;

    const opList = await page.getOperatorList();
    for (let idx = 0; idx < opList.fnArray.length; idx += 1) {
      if (!imageOpIds.has(opList.fnArray[idx])) continue;
      const objId = opList.argsArray[idx]?.[0];
      if (typeof objId !== 'string') continue;
      const imgObj = (
        page.objs.has(objId)
          ? page.objs.get(objId)
          : page.commonObjs?.has(objId)
            ? page.commonObjs.get(objId)
            : null
      ) as {
        width?: number;
        height?: number;
        kind?: number;
        data?: Uint8Array | Uint8ClampedArray;
      } | null;
      if (!imgObj || !imgObj.data || !imgObj.width || !imgObj.height) continue;
      const pixelCount = imgObj.width * imgObj.height;
      if (pixelCount < 400) continue;
      const channels =
        imgObj.data.length === pixelCount * 4
          ? 4
          : imgObj.data.length === pixelCount * 3
            ? 3
            : imgObj.data.length === pixelCount
              ? 1
              : 0;
      if (channels === 0) continue;
      const pngBuf = await sharpFn(new Uint8Array(imgObj.data), {
        raw: { width: imgObj.width, height: imgObj.height, channels },
      })
        .png()
        .toBuffer();
      return {
        bytes: new Uint8Array(pngBuf),
        mimeType: 'image/png',
        width: imgObj.width,
        height: imgObj.height,
      };
    }
  } catch {
    // Non-fatal fallback; browser canvas or pdfPageRenderer handles rendering
  }
  return null;
}

function classifyPageStatus(params: {
  text: string;
  ocrApplied: boolean;
  ocrConfidence: number | null;
  warnings: string[];
  errors: string[];
}): { status: ExtractionQualityStatus; isIncomplete: boolean } {
  const alnum = (params.text.match(/[A-Za-z0-9]/g) ?? []).length;
  if (params.errors.length > 0 && alnum < 15) {
    return { status: 'failed', isIncomplete: true };
  }
  if (alnum < 15) {
    return { status: 'needs_review', isIncomplete: true };
  }
  if (params.ocrApplied && (params.ocrConfidence ?? 0) < 42) {
    return { status: 'needs_review', isIncomplete: alnum < 60 };
  }
  if (
    params.errors.length > 0 ||
    params.warnings.length > 0 ||
    (params.ocrApplied && (params.ocrConfidence ?? 100) < 65)
  ) {
    return { status: 'completed_with_warnings', isIncomplete: false };
  }
  return { status: 'completed', isIncomplete: false };
}

async function processPdfBuffer(params: {
  bytes: Uint8Array;
  docId: string;
  signal?: AbortSignal;
  ocrRunner: OcrRunner;
  pdfPageRenderer?: PdfPageRenderer;
  visionFallback?: VisionFallbackMode;
  visionOcrRunner?: VisionOcrRunner;
  onProgress?: (update: ScanProgressUpdate) => void;
}): Promise<{
  pages: ExtractedPageContent[];
  diagrams: ExtractedDiagramAsset[];
  tables: ExtractedTable[];
  formulas: ExtractedFormula[];
  qrMatches: QrCodeMatch[];
  averageOcrConfidence: number | null;
  optimizedPreviewUrl?: string;
  processedPages: number[];
  unprocessedPages: number[];
  pdfWarnings: string[];
}> {
  throwIfAborted(params.signal);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (typeof window !== 'undefined' && pdfjs.GlobalWorkerOptions) {
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/legacy/build/pdf.worker.mjs',
        import.meta.url
      ).toString();
    }
  }

  const loadingTask = pdfjs.getDocument({
    data: params.bytes.slice(),
    disableWorker: typeof window === 'undefined',
    isEvalSupported: false,
    useSystemFonts: true,
  } as Parameters<typeof pdfjs.getDocument>[0]);

  if (params.signal) {
    params.signal.addEventListener(
      'abort',
      () => {
        void loadingTask.destroy().catch(() => {});
      },
      { once: true }
    );
  }

  const pdfDoc = await loadingTask.promise;
  const totalPagesInPdf = pdfDoc.numPages;
  const totalPages = Math.min(totalPagesInPdf, MAX_PDF_PAGES);
  const processedPages: number[] = [];
  const unprocessedPages: number[] = [];
  for (let p = MAX_PDF_PAGES + 1; p <= totalPagesInPdf; p += 1) {
    unprocessedPages.push(p);
  }

  const pages: ExtractedPageContent[] = [];
  const allDiagrams: ExtractedDiagramAsset[] = [];
  const allTables: ExtractedTable[] = [];
  const allFormulas: ExtractedFormula[] = [];
  const qrMatches: QrCodeMatch[] = [];
  const ocrScores: number[] = [];
  const pdfWarnings: string[] = [];
  let optimizedPreviewUrl: string | undefined;

  const imageOpIds = new Set<number>([
    pdfjs.OPS.paintImageXObject,
    pdfjs.OPS.paintInlineImageXObject,
  ]);

  for (let pageNo = 1; pageNo <= totalPages; pageNo += 1) {
    throwIfAborted(params.signal);
    processedPages.push(pageNo);

    const basePercent = Math.round(((pageNo - 1) / Math.max(1, totalPages)) * 70) + 15;
    params.onProgress?.({
      stage: 'extracting',
      stageLabel: `Inspecting PDF page ${pageNo} of ${totalPages}`,
      currentPage: pageNo,
      totalPages,
      progressPercent: basePercent,
    });
    await new Promise<void>((r) => setTimeout(r, 0));

    const page = await pdfDoc.getPage(pageNo);
    const baseViewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const nativeInspection = extractPdfPageStructuredText(
      textContent.items as PdfTextItemLike[],
      baseViewport.width || 612
    );

    let cleanedPageText = nativeInspection.text;
    let renderedPreviewUrl: string | undefined;
    let highResOcrDataUrl: string | undefined;
    let highResOcrBytes: Uint8Array | undefined;
    let highResMime: string | undefined;
    let ocrApplied = false;
    let ocrConfidence: number | null = null;
    let extractionMethod: PageExtractionMethod = 'native_text';
    let wasTruncated = nativeInspection.wasTruncated;
    const warnings: string[] = [];
    const errors: string[] = [];
    const preprocessingApplied: string[] = [];
    const pageDiagrams: ExtractedDiagramAsset[] = [];

    let hasEmbeddedGraphics = false;
    let hasVectorDrawings = false;
    try {
      const opList = await page.getOperatorList();
      hasEmbeddedGraphics = opList.fnArray.some((fn: number) => imageOpIds.has(fn));
      const vectorDiagrams = extractPdfVectorDiagrams({
        opList: opList as { fnArray: number[]; argsArray: unknown[][] },
        OPS: pdfjs.OPS as unknown as Record<string, number>,
        pageWidth: baseViewport.width || 612,
        pageHeight: baseViewport.height || 792,
        textTokens: nativeInspection.placedTokens,
        pageNumber: pageNo,
      });
      if (vectorDiagrams.length > 0) {
        hasVectorDrawings = true;
        pageDiagrams.push(...vectorDiagrams);
      }
    } catch {
      // Non-fatal
    }

    const nativeGarbled = nativeInspection.garbleRatio > 0.16;
    const nativeTooSparse =
      nativeInspection.alnumCount < 60 ||
      (nativeInspection.wordCount < 14 && hasEmbeddedGraphics);
    const needsFullOcr = nativeGarbled || nativeTooSparse;
    const isMixedPage = !needsFullOcr && hasEmbeddedGraphics;

    if (nativeGarbled) {
      warnings.push(
        `Native text encoding on page ${pageNo} appears garbled; triggering OCR recovery.`
      );
    }
    if (nativeInspection.wasTruncated) {
      warnings.push(`Page ${pageNo} exceeded ${MAX_PAGE_TEXT_CHARS} characters and was capped.`);
    }

    // Obtain high-resolution visual render for OCR, QR scanning, and embedded diagram inspection
    if (params.pdfPageRenderer) {
      try {
        const custom = await params.pdfPageRenderer({ pageNumber: pageNo, totalPages });
        if (custom) {
          highResOcrBytes = custom.bytes;
          highResMime = custom.mimeType || 'image/png';
          highResOcrDataUrl =
            custom.imageDataUrl ??
            (custom.bytes ? uint8ToDataUrl(custom.bytes, highResMime) : undefined);
          renderedPreviewUrl = highResOcrDataUrl;
          if (!optimizedPreviewUrl && renderedPreviewUrl) {
            optimizedPreviewUrl = renderedPreviewUrl;
          }
        }
      } catch (err) {
        warnings.push(
          `Custom renderer failed on page ${pageNo}: ${err instanceof Error ? err.message : 'unknown error'}`
        );
      }
    } else if (typeof document !== 'undefined') {
      try {
        // High-DPI scale (~250-300 DPI equivalent), safely capped at 2500px width
        const targetScale = Math.min(3.0, Math.max(2.4, 2100 / Math.max(300, baseViewport.width)));
        const ocrViewport = page.getViewport({ scale: targetScale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(ocrViewport.width));
        canvas.height = Math.max(1, Math.round(ocrViewport.height));
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport: ocrViewport, canvas }).promise;
          highResOcrDataUrl = canvas.toDataURL('image/png');
          highResMime = 'image/png';

          // Compact JPEG preview (max 1280px wide) for storage/UI
          const prevW = Math.min(1280, canvas.width);
          const prevH = Math.max(1, Math.round((canvas.height * prevW) / canvas.width));
          const prevCanvas = document.createElement('canvas');
          prevCanvas.width = prevW;
          prevCanvas.height = prevH;
          const prevCtx = prevCanvas.getContext('2d');
          if (prevCtx) {
            prevCtx.fillStyle = '#FFFFFF';
            prevCtx.fillRect(0, 0, prevW, prevH);
            prevCtx.drawImage(canvas, 0, 0, prevW, prevH);
            renderedPreviewUrl = prevCanvas.toDataURL('image/jpeg', 0.85);
            try {
              const imgData = prevCtx.getImageData(0, 0, prevW, prevH);
              const qr = jsQR(imgData.data, prevW, prevH, { inversionAttempts: 'dontInvert' });
              if (qr?.data) {
                qrMatches.push({
                  pageNumber: pageNo,
                  payload: sanitizeSingleLine(qr.data, 240),
                  isSafeUrl: isSafeQrUrl(qr.data),
                });
              }
            } catch {
              // Ignore QR scan issues
            }
          } else {
            renderedPreviewUrl = highResOcrDataUrl;
          }

          if (!optimizedPreviewUrl) optimizedPreviewUrl = renderedPreviewUrl;

          if (
            (hasEmbeddedGraphics || hasVectorDrawings) &&
            pageDiagrams.length === 0 &&
            renderedPreviewUrl
          ) {
            const ref = await documentStorageAdapter.putBinary({
              folder: 'diagrams',
              docId: params.docId,
              fileName: `pdf-page-${pageNo}-diagram.jpg`,
              mimeType: 'image/jpeg',
              dataUrl: renderedPreviewUrl,
            });
            pageDiagrams.push({
              id: `pdf-diag-${pageNo}`,
              pageNumber: pageNo,
              caption: `Embedded figure / page graphic (Page ${pageNo})`,
              kind: 'diagram',
              mimeType: 'image/jpeg',
              dataUrl: renderedPreviewUrl,
              storageRef: ref,
              width: canvas.width,
              height: canvas.height,
            });
          }
        }
      } catch {
        warnings.push(`Visual preview render unavailable for page ${pageNo}.`);
      }
    } else if (hasEmbeddedGraphics && (needsFullOcr || isMixedPage)) {
      const nodeRaster = await extractNodePdfPageRasterFallback(
        page as unknown as Parameters<typeof extractNodePdfPageRasterFallback>[0],
        imageOpIds
      );
      if (nodeRaster) {
        highResOcrBytes = nodeRaster.bytes;
        highResMime = nodeRaster.mimeType;
        highResOcrDataUrl = uint8ToDataUrl(nodeRaster.bytes, nodeRaster.mimeType);
        renderedPreviewUrl = highResOcrDataUrl;
        if (!optimizedPreviewUrl) optimizedPreviewUrl = renderedPreviewUrl;
      }
    }

    let ocrEngineUsed: ExtractedPageContent['ocrEngineUsed'];
    let visionFallbackUsed = false;
    let visionFallbackError: string | undefined;
    let uncertainSpans: UncertainSpan[] = [];
    let perspectiveCorrected = false;

    const canRunOcr = Boolean(highResOcrBytes || highResOcrDataUrl);
    if ((needsFullOcr || isMixedPage) && canRunOcr) {
      params.onProgress?.({
        stage: 'ocr',
        stageLabel: needsFullOcr
          ? `Running OCR on scanned PDF page ${pageNo} of ${totalPages}`
          : `Inspecting embedded graphics on mixed page ${pageNo} of ${totalPages}`,
        currentPage: pageNo,
        totalPages,
        progressPercent: basePercent + 5,
        preprocessingStatus: 'Adaptive contrast & deskew active',
      });
      try {
        const ocrRes = await params.ocrRunner({
          imageDataUrl: highResOcrDataUrl,
          bytes: highResOcrBytes,
          mimeType: highResMime || 'image/png',
          pageNumber: pageNo,
          signal: params.signal,
          visionFallback: params.visionFallback,
          visionOcrRunner: params.visionOcrRunner,
          onOcrProgress: (pct, statusText) => {
            params.onProgress?.({
              stage: 'ocr',
              stageLabel: `OCR page ${pageNo}/${totalPages} (${pct}%)`,
              currentPage: pageNo,
              totalPages,
              ocrProgress: pct,
              progressPercent: Math.min(88, basePercent + Math.round((pct / 100) * 15)),
              detail: statusText,
            });
          },
        });
        ocrApplied = true;
        ocrConfidence = ocrRes.confidence;
        ocrScores.push(ocrRes.confidence);
        ocrEngineUsed = ocrRes.ocrEngineUsed ?? 'tesseract';
        visionFallbackUsed = Boolean(ocrRes.visionFallbackUsed);
        visionFallbackError = ocrRes.visionFallbackError;
        uncertainSpans = ocrRes.uncertainSpans ?? [];
        perspectiveCorrected = Boolean(ocrRes.perspectiveCorrected);
        if (ocrRes.preprocessed?.appliedSteps) {
          preprocessingApplied.push(...ocrRes.preprocessed.appliedSteps);
        }
        if (ocrRes.preprocessed?.previewDataUrl && needsFullOcr) {
          renderedPreviewUrl = ocrRes.preprocessed.previewDataUrl;
        }
        if (ocrRes.warnings) warnings.push(...ocrRes.warnings);

        if (needsFullOcr) {
          extractionMethod = 'ocr';
          const ocrAlnum = (ocrRes.text.match(/[A-Za-z0-9]/g) ?? []).length;
          if (nativeGarbled || ocrAlnum >= nativeInspection.alnumCount) {
            cleanedPageText = ocrRes.text;
          } else if (ocrAlnum > 0) {
            const merged = mergeNativeAndOcrText(cleanedPageText, ocrRes.text);
            cleanedPageText = merged.merged;
            extractionMethod = 'hybrid_native_plus_ocr';
          }
        } else {
          // Mixed digital + graphic page: merge only unique non-duplicate OCR lines
          const merged = mergeNativeAndOcrText(cleanedPageText, ocrRes.text);
          if (merged.addedLines > 0) {
            cleanedPageText = sanitizePlainText(merged.merged, MAX_PAGE_TEXT_CHARS);
            extractionMethod = 'hybrid_native_plus_ocr';
            if (merged.merged.length > MAX_PAGE_TEXT_CHARS) wasTruncated = true;
          }
        }
        if (ocrRes.preprocessed?.ocrGray && !hasVectorDrawings) {
          try {
            const rasterFigs = await extractRasterDiagramsFromGrayscale({
              gray: ocrRes.preprocessed.ocrGray,
              width: ocrRes.preprocessed.width,
              height: ocrRes.preprocessed.height,
              pageNumber: pageNo,
            });
            if (rasterFigs.length > 0) {
              // Replace coarse full-page fallback snapshot with cleanly cropped & stroke-completed figures
              const nonFullPage = pageDiagrams.filter((d) => !d.id.startsWith('pdf-diag-'));
              pageDiagrams.length = 0;
              pageDiagrams.push(...nonFullPage, ...rasterFigs);
            }
          } catch {
            // Non-fatal figure isolation failure
          }
        }
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') throw err;
        errors.push(
          `OCR failed on page ${pageNo}: ${err instanceof Error ? err.message : 'unknown error'}`
        );
      }
    } else if (needsFullOcr && !canRunOcr) {
      warnings.push(
        `Page ${pageNo} appears scanned or image-based (${nativeInspection.alnumCount} native alphanumeric chars), but no visual rasterizer was available to run OCR.`
      );
    }

    if (pageDiagrams.length === 0 && !hasVectorDrawings && highResOcrBytes) {
      try {
        const decoded = await decodeBytesToGrayscale(highResOcrBytes, highResMime || 'image/png');
        const rasterFigs = await extractRasterDiagramsFromGrayscale({
          gray: decoded.gray,
          width: decoded.width,
          height: decoded.height,
          pageNumber: pageNo,
        });
        if (rasterFigs.length > 0) pageDiagrams.push(...rasterFigs);
      } catch {
        // Non-fatal
      }
    }

    const pageTables = extractTablesFromText(cleanedPageText, pageNo);
    const pageFormulas = extractFormulasFromText(cleanedPageText, pageNo);
    allDiagrams.push(...pageDiagrams);
    allTables.push(...pageTables);
    allFormulas.push(...pageFormulas);

    const charCount = cleanedPageText.replace(/\s+/g, '').length;
    const wordCount = cleanedPageText.split(/\s+/).filter(Boolean).length;
    const pageStatus = classifyPageStatus({
      text: cleanedPageText,
      ocrApplied,
      ocrConfidence,
      warnings,
      errors,
    });

    pages.push({
      pageNumber: pageNo,
      text: cleanedPageText,
      wordCount,
      charCount,
      extractionMethod,
      ocrApplied,
      ocrConfidence,
      ocrEngineUsed,
      visionFallbackUsed,
      visionFallbackError,
      uncertainSpans: uncertainSpans.length > 0 ? uncertainSpans : undefined,
      perspectiveCorrected,
      processingStatus: pageStatus.status,
      isIncomplete: pageStatus.isIncomplete,
      wasTruncated,
      preprocessingApplied: preprocessingApplied.length > 0 ? preprocessingApplied : undefined,
      errors: errors.length > 0 ? errors : undefined,
      renderedPreviewUrl,
      diagrams: pageDiagrams,
      tables: pageTables,
      formulas: pageFormulas,
      warnings: Array.from(new Set(warnings)),
    });
  }

  if (unprocessedPages.length > 0) {
    const notice = `PDF has ${totalPagesInPdf} pages; processed pages 1–${totalPages}. Unprocessed pages beyond the ${MAX_PDF_PAGES}-page safety limit: ${unprocessedPages[0]}–${unprocessedPages[unprocessedPages.length - 1]}.`;
    pdfWarnings.push(notice);
    pages[pages.length - 1]?.warnings.push(notice);
  }

  await (pdfDoc as unknown as { destroy?: () => Promise<void> }).destroy?.();
  const averageOcrConfidence =
    ocrScores.length > 0
      ? Math.round(ocrScores.reduce((acc, s) => acc + s, 0) / ocrScores.length)
      : null;

  return {
    pages,
    diagrams: allDiagrams,
    tables: allTables,
    formulas: allFormulas,
    qrMatches,
    averageOcrConfidence,
    optimizedPreviewUrl,
    processedPages,
    unprocessedPages,
    pdfWarnings,
  };
}

export async function inspectAndExtractZipEntries(
  zipBytes: Uint8Array,
  zipFileName: string,
  signal?: AbortSignal
): Promise<ScanInputFile[]> {
  throwIfAborted(signal);
  const zip = await JSZip.loadAsync(zipBytes);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  if (names.length === 0) {
    throw new Error(`Archive "${zipFileName}" contains no files.`);
  }
  if (names.length > MAX_ZIP_ENTRIES) {
    throw new Error(
      `Archive "${zipFileName}" contains ${names.length} files, exceeding the ${MAX_ZIP_ENTRIES}-file safety limit.`
    );
  }

  let totalUncompressedBytes = 0;
  const extractedFiles: ScanInputFile[] = [];

  for (const name of Object.keys(zip.files)) {
    throwIfAborted(signal);
    const entryObj = zip.files[name];
    const unsafeName =
      (entryObj as unknown as { unsafeOriginalName?: string }).unsafeOriginalName || name;
    const safetyRaw = isSafeZipEntryPath(unsafeName);
    if (!safetyRaw.safe) {
      throw new Error(safetyRaw.reason ?? `Unsafe archive entry "${unsafeName}".`);
    }
  }

  for (const name of names) {
    throwIfAborted(signal);
    const entry = zip.files[name];
    const rawEntryName =
      (entry as unknown as { unsafeOriginalName?: string }).unsafeOriginalName || name;
    const safety = isSafeZipEntryPath(rawEntryName);
    if (!safety.safe) {
      throw new Error(safety.reason ?? `Unsafe archive entry "${rawEntryName}".`);
    }
    if (name.startsWith('__MACOSX/') || safety.baseName.startsWith('._')) {
      continue;
    }
    if (safety.extension === 'zip') {
      throw new Error(`Nested ZIP archive "${safety.baseName}" is rejected for archive safety.`);
    }
    const data = await entry.async('uint8array');
    totalUncompressedBytes += data.byteLength;
    if (totalUncompressedBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
      throw new Error(
        `Archive "${zipFileName}" exceeds ${Math.round(MAX_ZIP_UNCOMPRESSED_BYTES / (1024 * 1024))} MB uncompressed safety limit.`
      );
    }
    const internalData = (entry as unknown as { _data?: { compressedSize?: number } })._data;
    const compressedSize = internalData?.compressedSize ?? 0;
    if (
      data.byteLength > 200_000 &&
      compressedSize > 0 &&
      data.byteLength / compressedSize > MAX_ZIP_COMPRESSION_RATIO
    ) {
      throw new Error(
        `Archive "${zipFileName}" rejected due to suspicious compression ratio in "${safety.baseName}".`
      );
    }

    extractedFiles.push({
      name: safety.baseName,
      type: guessMimeFromExtension(safety.extension),
      size: data.byteLength,
      bytes: data,
      parentZipName: zipFileName,
    });
  }

  if (extractedFiles.length === 0) {
    throw new Error(`Archive "${zipFileName}" contained no valid academic files.`);
  }
  return extractedFiles;
}

function summarizeExtractionQuality(params: {
  pages: ExtractedPageContent[];
  unprocessedPages: number[];
  docWarnings: string[];
  averageOcrConfidence: number | null;
  totalAlnumChars: number;
}): ExtractionQualityStatus {
  if (params.pages.length === 0) return 'failed';
  const failedPages = params.pages.filter((p) => p.processingStatus === 'failed').length;
  const reviewPages = params.pages.filter(
    (p) => p.processingStatus === 'needs_review' || p.isIncomplete
  ).length;
  if (failedPages === params.pages.length || (params.totalAlnumChars < 12 && failedPages > 0)) {
    return 'failed';
  }
  if (
    failedPages > 0 ||
    reviewPages > 0 ||
    params.unprocessedPages.length > 0 ||
    params.totalAlnumChars < 25 ||
    (params.averageOcrConfidence !== null && params.averageOcrConfidence < 45)
  ) {
    return 'needs_review';
  }
  const hasWarnings =
    params.docWarnings.length > 0 ||
    params.pages.some(
      (p) =>
        p.processingStatus === 'completed_with_warnings' ||
        p.warnings.length > 0 ||
        Boolean(p.wasTruncated)
    ) ||
    (params.averageOcrConfidence !== null && params.averageOcrConfidence < 65);
  return hasWarnings ? 'completed_with_warnings' : 'completed';
}

export async function scanSingleAcademicInput(
  input: ScanInputFile,
  options?: {
    docId?: string;
    signal?: AbortSignal;
    ocrRunner?: OcrRunner;
    pdfPageRenderer?: PdfPageRenderer;
    onProgress?: (update: ScanProgressUpdate) => void;
    bypassCache?: boolean;
    visionFallback?: VisionFallbackMode;
    visionOcrRunner?: VisionOcrRunner;
  }
): Promise<ScannedArtifactOutput> {
  const startedAt = Date.now();
  const docId = options?.docId ?? `adoc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const ocrRunner = options?.ocrRunner ?? defaultBrowserOcrRunner;

  throwIfAborted(options?.signal);
  options?.onProgress?.({
    stage: 'validating',
    stageLabel: 'Validating file signature & format security',
    progressPercent: 5,
  });

  const magicCheck = validateMagicAndSecurity({
    fileName: input.name,
    mimeType: input.type,
    bytes: input.bytes,
  });
  if (!magicCheck.valid) {
    throw new Error(magicCheck.error ?? 'File failed magic-byte or security validation.');
  }
  if (magicCheck.format === 'zip') {
    throw new Error('ZIP archives must be unpacked via inspectAndExtractZipEntries before scanning.');
  }

  throwIfAborted(options?.signal);
  options?.onProgress?.({
    stage: 'hashing',
    stageLabel: 'Computing SHA-256 fingerprint',
    progressPercent: 10,
  });

  const sha256 = await computeSha256Hex(input.bytes);
  const mimeType = input.type || guessMimeFromExtension(magicCheck.extension);

  const originalStorageRef = await documentStorageAdapter.putBinary({
    folder: 'originals',
    docId,
    fileName: magicCheck.safeFileName,
    mimeType,
    bytes: input.bytes,
  });

  const cached = !options?.bypassCache ? getCachedExtractionByHash(sha256) : null;

  const earlyChecks: DeterministicCheckResult[] = [
    {
      id: 'chk-magic',
      label: 'File signature & magic bytes',
      category: 'integrity',
      passed: true,
      severity: 'info',
      detail: `Verified ${magicCheck.format.toUpperCase()} signature for ${magicCheck.safeFileName}.`,
    },
  ];
  if (magicCheck.securityFlags.includes('pdf_active_script_action')) {
    earlyChecks.push({
      id: 'chk-pdf-js',
      label: 'Active script / action detection',
      category: 'security',
      passed: false,
      severity: 'blocker',
      detail: 'PDF contains /JavaScript, /JS, /Launch, or /OpenAction triggers.',
    });
  }

  let pages: ExtractedPageContent[] = [];
  let diagrams: ExtractedDiagramAsset[] = [];
  let tables: ExtractedTable[] = [];
  let formulas: ExtractedFormula[] = [];
  let qrCodesFound: QrCodeMatch[] = [];
  let optimizedPreviewUrl: string | undefined;
  let averageOcrConfidence: number | null = null;
  let extraHeadings: string[] = [];
  let processedPages: number[] = [1];
  let unprocessedPages: number[] = [];
  const docWarnings: string[] = [];

  if (magicCheck.format === 'image') {
    throwIfAborted(options?.signal);
    options?.onProgress?.({
      stage: 'optimizing',
      stageLabel: 'Analyzing scan quality & preprocessing image',
      currentPage: 1,
      totalPages: 1,
      progressPercent: 22,
      preprocessingStatus: 'Detecting borders, skew & lighting profile',
    });

    let prep: PreprocessedImageResult | undefined;
    try {
      prep = await preprocessImageForOcr({
        bytes: input.bytes,
        mimeType,
      });
      optimizedPreviewUrl = prep.previewDataUrl;
      qrCodesFound = prep.qrMatches.map((payload) => ({
        pageNumber: 1,
        payload: sanitizeSingleLine(payload, 240),
        isSafeUrl: isSafeQrUrl(payload),
      }));
      await documentStorageAdapter.putBinary({
        folder: 'optimized',
        docId,
        fileName: `opt-${magicCheck.safeFileName}.jpg`,
        mimeType: 'image/jpeg',
        dataUrl: prep.previewDataUrl,
      });
    } catch {
      optimizedPreviewUrl = uint8ToDataUrl(input.bytes, mimeType);
    }

    throwIfAborted(options?.signal);
    options?.onProgress?.({
      stage: 'ocr',
      stageLabel: 'Running adaptive multi-pass OCR',
      currentPage: 1,
      totalPages: 1,
      progressPercent: 35,
      ocrProgress: 0,
      preprocessingStatus: prep
        ? `${prep.strategy} (${prep.appliedSteps.join(', ') || 'clean'})`
        : 'Raw fallback',
    });

    let ocrText = '';
    const pageWarnings: string[] = [];
    const pageErrors: string[] = [];
    let finalPrep = prep;
    let ocrEngineUsed: ExtractedPageContent['ocrEngineUsed'] = 'tesseract';
    let visionFallbackUsed = false;
    let visionFallbackError: string | undefined;
    let uncertainSpans: UncertainSpan[] = [];
    let perspectiveCorrected = Boolean(prep?.perspectiveCorrected);

    try {
      // Pass preprocessed high-res image when default runner is used; also pass raw bytes
      // so custom runners or orientation recovery can access full original pixels cleanly.
      const ocrRes = await ocrRunner({
        imageDataUrl: prep?.ocrDataUrl ?? optimizedPreviewUrl,
        bytes: input.bytes,
        mimeType,
        pageNumber: 1,
        signal: options?.signal,
        visionFallback: options?.visionFallback,
        visionOcrRunner: options?.visionOcrRunner,
        onOcrProgress: (pct, statusText) => {
          options?.onProgress?.({
            stage: 'ocr',
            stageLabel: `Recognizing scanned text (${pct}%)`,
            currentPage: 1,
            totalPages: 1,
            ocrProgress: pct,
            progressPercent: 35 + Math.round((pct / 100) * 50),
            detail: statusText,
          });
        },
      });
      ocrText = ocrRes.text;
      averageOcrConfidence = ocrRes.confidence;
      ocrEngineUsed = ocrRes.ocrEngineUsed ?? 'tesseract';
      visionFallbackUsed = Boolean(ocrRes.visionFallbackUsed);
      visionFallbackError = ocrRes.visionFallbackError;
      uncertainSpans = ocrRes.uncertainSpans ?? [];
      if (ocrRes.preprocessed) {
        finalPrep = ocrRes.preprocessed;
        optimizedPreviewUrl = ocrRes.preprocessed.previewDataUrl || optimizedPreviewUrl;
        perspectiveCorrected = Boolean(ocrRes.preprocessed.perspectiveCorrected);
      } else if (ocrRes.perspectiveCorrected !== undefined) {
        perspectiveCorrected = ocrRes.perspectiveCorrected;
      }
      if (ocrRes.warnings) pageWarnings.push(...ocrRes.warnings);
      if (ocrRes.orientationCorrectedDeg && ocrRes.orientationCorrectedDeg > 0) {
        pageWarnings.push(`Auto-rotated scan by ${ocrRes.orientationCorrectedDeg}° for upright text.`);
      }
      if (ocrRes.confidence < 65 && !pageWarnings.some((w) => /confidence/i.test(w))) {
        pageWarnings.push(`Low OCR confidence (${ocrRes.confidence}%). Image may be blurry or skewed.`);
      }
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') throw err;
      averageOcrConfidence = 0;
      const msg = err instanceof Error ? err.message : 'OCR recognition failed.';
      pageErrors.push(msg);
      pageWarnings.push(`OCR error: ${msg}`);
    }

    tables = extractTablesFromText(ocrText, 1);
    formulas = extractFormulasFromText(ocrText, 1);

    const extractedShapeDiagrams: ExtractedDiagramAsset[] = [];
    if (finalPrep?.ocrGray && finalPrep.width > 0 && finalPrep.height > 0) {
      try {
        const isolated = await extractRasterDiagramsFromGrayscale({
          gray: finalPrep.ocrGray,
          width: finalPrep.width,
          height: finalPrep.height,
          pageNumber: 1,
        });
        for (const fig of isolated) {
          const ref = await documentStorageAdapter.putBinary({
            folder: 'diagrams',
            docId,
            fileName: `${fig.id}-${magicCheck.safeFileName}.png`,
            mimeType: 'image/png',
            dataUrl: fig.dataUrl,
          });
          extractedShapeDiagrams.push({ ...fig, storageRef: ref });
        }
      } catch {
        // Non-fatal; scan-sheet-1 remains available
      }
    }

    const imgDiagramRef = await documentStorageAdapter.putBinary({
      folder: 'diagrams',
      docId,
      fileName: `page-1-${magicCheck.safeFileName}`,
      mimeType: optimizedPreviewUrl?.startsWith('data:image/png') ? 'image/png' : 'image/jpeg',
      dataUrl: optimizedPreviewUrl,
    });
    const pageDiagrams: ExtractedDiagramAsset[] = [
      ...extractedShapeDiagrams,
      {
        id: 'scan-sheet-1',
        pageNumber: 1,
        caption: `Scanned sheet (${magicCheck.safeFileName})`,
        kind: 'illustration',
        mimeType: optimizedPreviewUrl?.startsWith('data:image/png') ? 'image/png' : 'image/jpeg',
        dataUrl: optimizedPreviewUrl,
        storageRef: imgDiagramRef,
        width: finalPrep?.width || undefined,
        height: finalPrep?.height || undefined,
      },
    ];
    diagrams = pageDiagrams;

    const dedupWarnings = Array.from(new Set(pageWarnings));
    const pageStatus = classifyPageStatus({
      text: ocrText,
      ocrApplied: true,
      ocrConfidence: averageOcrConfidence,
      warnings: dedupWarnings,
      errors: pageErrors,
    });

    pages = [
      {
        pageNumber: 1,
        text: ocrText,
        wordCount: ocrText.split(/\s+/).filter(Boolean).length,
        charCount: ocrText.replace(/\s+/g, '').length,
        extractionMethod: 'ocr',
        ocrApplied: true,
        ocrConfidence: averageOcrConfidence,
        ocrEngineUsed,
        visionFallbackUsed,
        visionFallbackError,
        uncertainSpans: uncertainSpans.length > 0 ? uncertainSpans : undefined,
        perspectiveCorrected,
        processingStatus: pageStatus.status,
        isIncomplete: pageStatus.isIncomplete,
        wasTruncated: ocrText.length >= MAX_PAGE_TEXT_CHARS,
        qualityMetrics: finalPrep?.qualityMetrics,
        preprocessingApplied: finalPrep?.appliedSteps,
        errors: pageErrors.length > 0 ? pageErrors : undefined,
        renderedPreviewUrl: optimizedPreviewUrl,
        diagrams: pageDiagrams,
        tables,
        formulas,
        warnings: dedupWarnings,
      },
    ];
  } else if (magicCheck.format === 'pdf') {
    throwIfAborted(options?.signal);
    options?.onProgress?.({
      stage: 'extracting',
      stageLabel: 'Inspecting PDF pages & embedded graphics',
      progressPercent: 15,
    });
    const pdfOut = await processPdfBuffer({
      bytes: input.bytes,
      docId,
      signal: options?.signal,
      ocrRunner,
      pdfPageRenderer: options?.pdfPageRenderer,
      visionFallback: options?.visionFallback,
      visionOcrRunner: options?.visionOcrRunner,
      onProgress: options?.onProgress,
    });
    pages = pdfOut.pages;
    diagrams = pdfOut.diagrams;
    tables = pdfOut.tables;
    formulas = pdfOut.formulas;
    qrCodesFound = pdfOut.qrMatches;
    averageOcrConfidence = pdfOut.averageOcrConfidence;
    optimizedPreviewUrl = pdfOut.optimizedPreviewUrl;
    processedPages = pdfOut.processedPages;
    unprocessedPages = pdfOut.unprocessedPages;
    docWarnings.push(...pdfOut.pdfWarnings);
  } else if (magicCheck.format === 'docx') {
    throwIfAborted(options?.signal);
    options?.onProgress?.({
      stage: 'extracting',
      stageLabel: 'Unpacking DOCX paragraphs, tables, formulas & media',
      currentPage: 1,
      totalPages: 1,
      progressPercent: 45,
    });
    const docxOut = await parseDocxArchive(input.bytes, docId, options?.signal);
    extraHeadings = docxOut.headings;
    tables = docxOut.tables;
    formulas = docxOut.formulas;
    diagrams = docxOut.diagrams;
    optimizedPreviewUrl = docxOut.diagrams[0]?.dataUrl;
    if (docxOut.hasMacros) {
      magicCheck.securityFlags.push('docx_vba_macros');
      earlyChecks.push({
        id: 'chk-docx-macro',
        label: 'DOCX macro security scan',
        category: 'security',
        passed: false,
        severity: 'blocker',
        detail: 'Embedded VBA macro archive (vbaProject.bin) detected inside DOCX.',
      });
    }
    const pageWarnings: string[] = [];
    if (docxOut.wasTruncated) {
      pageWarnings.push(`DOCX text exceeded ${MAX_PAGE_TEXT_CHARS} character page limit.`);
    }
    const pageStatus = classifyPageStatus({
      text: docxOut.text,
      ocrApplied: false,
      ocrConfidence: null,
      warnings: pageWarnings,
      errors: [],
    });
    pages = [
      {
        pageNumber: 1,
        text: docxOut.text,
        wordCount: docxOut.text.split(/\s+/).filter(Boolean).length,
        charCount: docxOut.text.replace(/\s+/g, '').length,
        extractionMethod: 'docx_xml',
        ocrApplied: false,
        ocrConfidence: null,
        processingStatus: pageStatus.status,
        isIncomplete: pageStatus.isIncomplete,
        wasTruncated: docxOut.wasTruncated,
        diagrams: docxOut.diagrams,
        tables: docxOut.tables,
        formulas: docxOut.formulas,
        warnings: pageWarnings,
      },
    ];
  } else {
    throwIfAborted(options?.signal);
    options?.onProgress?.({
      stage: 'extracting',
      stageLabel: 'Reading text & tabular structure',
      currentPage: 1,
      totalPages: 1,
      progressPercent: 45,
    });
    const rawDecoded = new TextDecoder('utf-8', { fatal: false }).decode(input.bytes);
    const decoded = sanitizePlainText(rawDecoded, MAX_PAGE_TEXT_CHARS);
    const wasTruncated = rawDecoded.trim().length > MAX_PAGE_TEXT_CHARS;
    const pageWarnings = wasTruncated
      ? [`Text file exceeded ${MAX_PAGE_TEXT_CHARS} characters and was safely capped.`]
      : [];
    tables = extractTablesFromText(decoded, 1);
    formulas = extractFormulasFromText(decoded, 1);
    const pageStatus = classifyPageStatus({
      text: decoded,
      ocrApplied: false,
      ocrConfidence: null,
      warnings: pageWarnings,
      errors: [],
    });
    pages = [
      {
        pageNumber: 1,
        text: decoded,
        wordCount: decoded.split(/\s+/).filter(Boolean).length,
        charCount: decoded.replace(/\s+/g, '').length,
        extractionMethod: 'plain_text',
        ocrApplied: false,
        ocrConfidence: null,
        processingStatus: pageStatus.status,
        isIncomplete: pageStatus.isIncomplete,
        wasTruncated,
        diagrams: [],
        tables,
        formulas,
        warnings: pageWarnings,
      },
    ];
  }

  // Strip/normalize repeated multi-page running headers/footers before final structure assembly
  const headerClean = detectRepeatedHeadersFooters(pages.map((p) => p.text));
  if (headerClean.cleanedPages.length === pages.length && pages.length > 1) {
    pages = pages.map((pg, idx) => ({
      ...pg,
      text: headerClean.cleanedPages[idx],
      charCount: headerClean.cleanedPages[idx].replace(/\s+/g, '').length,
      wordCount: headerClean.cleanedPages[idx].split(/\s+/).filter(Boolean).length,
    }));
  }

  const formattedText = formatMultiPageStructuredText(
    pages.map((p) => ({ pageNumber: p.pageNumber, text: p.text }))
  );
  const combinedText = sanitizePlainText(formattedText, MAX_DOC_TEXT_CHARS);
  if (formattedText.length > MAX_DOC_TEXT_CHARS) {
    docWarnings.push(`Combined extracted text exceeded ${MAX_DOC_TEXT_CHARS} characters and was capped.`);
  }

  for (const pg of pages) {
    if (pg.warnings.length > 0) docWarnings.push(...pg.warnings);
    if (pg.errors && pg.errors.length > 0) docWarnings.push(...pg.errors);
  }
  const uniqueDocWarnings = Array.from(new Set(docWarnings));
  const totalAlnumChars = (combinedText.match(/[A-Za-z0-9]/g) ?? []).length;

  const extractionQualityStatus = summarizeExtractionQuality({
    pages,
    unprocessedPages,
    docWarnings: uniqueDocWarnings,
    averageOcrConfidence,
    totalAlnumChars,
  });

  if (!cached && combinedText) {
    setCachedExtractionByHash({
      sha256,
      detectedFormat: magicCheck.format,
      pageCount: pages.length,
      extractedText: combinedText,
      cachedAt: new Date().toISOString(),
    });
  }

  const structured = parseStructuredDocument({
    fileName: magicCheck.safeFileName,
    extractedText: combinedText,
    extraHeadings,
    extraTables: tables,
    extraFormulas: formulas,
    detectedHeadersFooters: headerClean.detected,
  });

  return {
    fileName: magicCheck.safeFileName,
    mimeType,
    fileSizeBytes: input.size || input.bytes.byteLength,
    detectedFormat: magicCheck.format,
    sha256,
    originalFileRefKey: originalStorageRef.key,
    originalStorageRef,
    optimizedPreviewUrl,
    pageCount: Math.max(1, pages.length),
    extractedText: combinedText,
    pages,
    diagrams,
    tables: structured.tables,
    formulas: structured.formulas,
    headings: structured.headings,
    summary: structured.summary,
    suggestedTitle: structured.suggestedTitle,
    courseCode: structured.courseCode,
    courseTitle: structured.courseTitle,
    level: structured.level,
    session: structured.session,
    semester: structured.semester,
    category: structured.category,
    qrCodesFound,
    averageOcrConfidence,
    extractionQualityStatus,
    processedPages,
    unprocessedPages,
    extractionWarnings: uniqueDocWarnings,
    securityFlags: magicCheck.securityFlags,
    earlyChecks,
    parentZipName: input.parentZipName,
    processingDurationMs: Date.now() - startedAt,
  };
}
