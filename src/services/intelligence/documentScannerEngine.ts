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
  QrCodeMatch,
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
  extractFormulasFromText,
  extractTablesFromText,
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
  detail?: string;
}

export interface OcrRunnerResult {
  text: string;
  confidence: number; // 0..100
}

export type OcrRunner = (input: {
  imageDataUrl?: string;
  bytes?: Uint8Array;
  mimeType?: string;
  signal?: AbortSignal;
}) => Promise<OcrRunnerResult>;

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
  if (typeof Buffer !== 'undefined') {
    return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...sub);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

async function decodeImageAndOptimizeBrowser(
  bytes: Uint8Array,
  mimeType: string
): Promise<{
  optimizedDataUrl: string;
  qrMatches: string[];
  width: number;
  height: number;
}> {
  if (typeof document === 'undefined' || typeof Blob === 'undefined') {
    return {
      optimizedDataUrl: uint8ToDataUrl(bytes, mimeType),
      qrMatches: [],
      width: 0,
      height: 0,
    };
  }

  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Failed to decode uploaded image.'));
      el.src = objectUrl;
    });

    const maxWidth = 1280;
    const scale = img.width > maxWidth ? maxWidth / img.width : 1;
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return {
        optimizedDataUrl: uint8ToDataUrl(bytes, mimeType),
        qrMatches: [],
        width,
        height,
      };
    }

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const qrMatches: string[] = [];
    try {
      const imgData = ctx.getImageData(0, 0, width, height);
      const qr = jsQR(imgData.data, width, height, { inversionAttempts: 'dontInvert' });
      if (qr?.data) qrMatches.push(qr.data);
    } catch {
      // Ignore QR read errors on unusual pixel layouts
    }

    // Create high-legibility grayscale derivative for scanning & OCR
    const optCanvas = document.createElement('canvas');
    optCanvas.width = width;
    optCanvas.height = height;
    const optCtx = optCanvas.getContext('2d');
    if (optCtx) {
      optCtx.fillStyle = '#FFFFFF';
      optCtx.fillRect(0, 0, width, height);
      optCtx.filter = 'contrast(118%) brightness(104%)';
      optCtx.drawImage(img, 0, 0, width, height);
      return {
        optimizedDataUrl: optCanvas.toDataURL('image/jpeg', 0.85),
        qrMatches,
        width,
        height,
      };
    }

    return {
      optimizedDataUrl: canvas.toDataURL('image/jpeg', 0.85),
      qrMatches,
      width,
      height,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Tesseract reads best when text is roughly 300 DPI. A small or low-resolution image
 * (a cropped screenshot, a thumbnail) comes back with nothing, so it is enlarged first,
 * converted to grayscale and given a little extra contrast. Very large photos are
 * capped so memory stays reasonable. Only the OCR copy changes; the preview is untouched.
 */
async function prepareImageForOcr(dataUrl: string): Promise<string> {
  if (typeof document === 'undefined') return dataUrl;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Failed to decode image for OCR.'));
      el.src = dataUrl;
    });
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return dataUrl;

    const targetWidth = w < 1600 ? Math.min(w * 4, 2000) : Math.min(w, 2400);
    const scale = targetWidth / w;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.filter = 'grayscale(100%) contrast(120%)';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } catch {
    return dataUrl;
  }
}

async function defaultBrowserOcrRunner(input: {
  imageDataUrl?: string;
  bytes?: Uint8Array;
  mimeType?: string;
  signal?: AbortSignal;
}): Promise<OcrRunnerResult> {
  throwIfAborted(input.signal);
  // Prefer the original bytes (full resolution) over the downsized preview copy.
  const source = input.bytes
    ? uint8ToDataUrl(input.bytes, input.mimeType || 'image/png')
    : (input.imageDataUrl ?? '');
  if (!source) {
    throw new Error('No image buffer provided to OCR engine.');
  }
  const target = await prepareImageForOcr(source);
  throwIfAborted(input.signal);

  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng');
  try {
    throwIfAborted(input.signal);
    const result = await worker.recognize(target);
    return {
      text: sanitizePlainText(result.data?.text ?? '', 20_000),
      confidence: Number.isFinite(result.data?.confidence)
        ? Math.max(0, Math.min(100, Math.round(result.data.confidence)))
        : 0,
    };
  } finally {
    await worker.terminate();
  }
}

function isSafeQrUrl(payload: string): boolean {
  const trimmed = payload.trim();
  if (!/^https?:\/\//i.test(trimmed)) return true; // Non-URL text payload
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
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
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
  while ((mathMatch = mathRegex.exec(xml)) !== null && formulas.length < 24) {
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
  while ((tblMatch = tblRegex.exec(xml)) !== null && tables.length < 10) {
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
    if (isHeading && headings.length < 18) {
      headings.push(sanitizeSingleLine(text, 120));
      paragraphLines.push(`## ${text}`);
    } else {
      paragraphLines.push(text);
    }
  }

  // Extract embedded media images (diagrams / figures)
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

  return {
    text: sanitizePlainText(paragraphLines.join('\n'), 35_000),
    headings,
    tables,
    formulas,
    diagrams,
    hasMacros,
  };
}

async function processPdfBuffer(params: {
  bytes: Uint8Array;
  docId: string;
  signal?: AbortSignal;
  ocrRunner: OcrRunner;
  onProgress?: (update: ScanProgressUpdate) => void;
}): Promise<{
  pages: ExtractedPageContent[];
  diagrams: ExtractedDiagramAsset[];
  tables: ExtractedTable[];
  formulas: ExtractedFormula[];
  qrMatches: QrCodeMatch[];
  averageOcrConfidence: number | null;
  optimizedPreviewUrl?: string;
}> {
  throwIfAborted(params.signal);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  if (typeof window !== 'undefined' && pdfjs.GlobalWorkerOptions) {
    // Let pdf.js bundle worker resolve gracefully; disableWorker fallback works cleanly if worker blocked in sandbox
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
  const totalPages = Math.min(pdfDoc.numPages, MAX_PDF_PAGES);
  const pages: ExtractedPageContent[] = [];
  const allDiagrams: ExtractedDiagramAsset[] = [];
  const allTables: ExtractedTable[] = [];
  const allFormulas: ExtractedFormula[] = [];
  const qrMatches: QrCodeMatch[] = [];
  const ocrScores: number[] = [];
  let optimizedPreviewUrl: string | undefined;

  for (let pageNo = 1; pageNo <= totalPages; pageNo += 1) {
    throwIfAborted(params.signal);
    params.onProgress?.({
      stage: 'extracting',
      stageLabel: `Extracting page ${pageNo} of ${totalPages}`,
      currentPage: pageNo,
      totalPages,
    });

    // Yield to UI event loop between pages so scrolling/cancel stay responsive
    await new Promise<void>((r) => setTimeout(r, 0));

    const page = await pdfDoc.getPage(pageNo);
    const textContent = await page.getTextContent();
    const rawItems = textContent.items as Array<{
      str?: string;
      hasEOL?: boolean;
      transform?: number[];
    }>;

    let pageText = '';
    let lastY: number | null = null;
    for (const item of rawItems) {
      const str = typeof item.str === 'string' ? item.str : '';
      const y = Array.isArray(item.transform) ? item.transform[5] : null;
      if (lastY !== null && y !== null && Math.abs(lastY - y) > 4) {
        pageText += '\n';
      } else if (pageText.length > 0 && !pageText.endsWith('\n') && !pageText.endsWith(' ')) {
        pageText += ' ';
      }
      pageText += str;
      if (item.hasEOL) pageText += '\n';
      if (y !== null) lastY = y;
    }

    let cleanedPageText = sanitizePlainText(pageText, 12_000);
    let renderedPreviewUrl: string | undefined;
    let ocrApplied = false;
    let ocrConfidence: number | null = null;
    const warnings: string[] = [];
    const pageDiagrams: ExtractedDiagramAsset[] = [];

    // Check embedded images/diagrams via operator list when canvas is available
    let hasEmbeddedGraphics = false;
    try {
      const opList = await page.getOperatorList();
      const imageOps = new Set<number>([
        pdfjs.OPS.paintImageXObject,
        pdfjs.OPS.paintInlineImageXObject,
      ]);
      hasEmbeddedGraphics = opList.fnArray.some((fn: number) => imageOps.has(fn));
    } catch {
      // Ignore op list errors
    }

    if (typeof document !== 'undefined') {
      try {
        const viewport = page.getViewport({ scale: 1.35 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport, canvas }).promise;
          renderedPreviewUrl = canvas.toDataURL('image/jpeg', 0.8);
          if (!optimizedPreviewUrl) optimizedPreviewUrl = renderedPreviewUrl;

          try {
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const qr = jsQR(imgData.data, canvas.width, canvas.height, {
              inversionAttempts: 'dontInvert',
            });
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

          if (hasEmbeddedGraphics && pageDiagrams.length < 4) {
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
    }

    // OCR fallback for scanned / image-heavy PDF pages with sparse embedded text
    if (cleanedPageText.replace(/\s+/g, '').length < 28 && renderedPreviewUrl) {
      params.onProgress?.({
        stage: 'ocr',
        stageLabel: `Running OCR on scanned page ${pageNo} of ${totalPages}`,
        currentPage: pageNo,
        totalPages,
      });
      try {
        const ocrRes = await params.ocrRunner({
          imageDataUrl: renderedPreviewUrl,
          signal: params.signal,
        });
        ocrApplied = true;
        ocrConfidence = ocrRes.confidence;
        ocrScores.push(ocrRes.confidence);
        if (ocrRes.text.trim().length > cleanedPageText.trim().length) {
          cleanedPageText = ocrRes.text;
        }
        if (ocrRes.confidence < 65) {
          warnings.push(`Low OCR confidence (${ocrRes.confidence}%) on page ${pageNo}.`);
        }
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') throw err;
        warnings.push(`OCR could not complete on page ${pageNo}.`);
      }
    }

    const pageTables = extractTablesFromText(cleanedPageText, pageNo);
    const pageFormulas = extractFormulasFromText(cleanedPageText, pageNo);
    allDiagrams.push(...pageDiagrams);
    allTables.push(...pageTables);
    allFormulas.push(...pageFormulas);

    pages.push({
      pageNumber: pageNo,
      text: cleanedPageText,
      wordCount: cleanedPageText.split(/\s+/).filter(Boolean).length,
      ocrApplied,
      ocrConfidence,
      renderedPreviewUrl,
      diagrams: pageDiagrams,
      tables: pageTables,
      formulas: pageFormulas,
      warnings,
    });
  }

  if (pdfDoc.numPages > MAX_PDF_PAGES) {
    pages[pages.length - 1]?.warnings.push(
      `PDF exceeds ${MAX_PDF_PAGES} pages; inspected first ${MAX_PDF_PAGES} pages.`
    );
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

    // Ignore nested zip archives and macOS metadata forks
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

export async function scanSingleAcademicInput(
  input: ScanInputFile,
  options?: {
    docId?: string;
    signal?: AbortSignal;
    ocrRunner?: OcrRunner;
    onProgress?: (update: ScanProgressUpdate) => void;
    bypassCache?: boolean;
  }
): Promise<ScannedArtifactOutput> {
  const startedAt = Date.now();
  const docId = options?.docId ?? `adoc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const ocrRunner = options?.ocrRunner ?? defaultBrowserOcrRunner;

  throwIfAborted(options?.signal);
  options?.onProgress?.({
    stage: 'validating',
    stageLabel: 'Validating signature & security constraints',
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
  });

  const sha256 = await computeSha256Hex(input.bytes);
  const mimeType = input.type || guessMimeFromExtension(magicCheck.extension);

  // Store untouched original reference cleanly outside localStorage
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

  if (magicCheck.format === 'image') {
    throwIfAborted(options?.signal);
    options?.onProgress?.({
      stage: 'optimizing',
      stageLabel: 'Optimizing scan contrast & stripping metadata',
    });

    const opt = await decodeImageAndOptimizeBrowser(input.bytes, mimeType);
    optimizedPreviewUrl = opt.optimizedDataUrl;

    await documentStorageAdapter.putBinary({
      folder: 'optimized',
      docId,
      fileName: `opt-${magicCheck.safeFileName}.jpg`,
      mimeType: 'image/jpeg',
      dataUrl: opt.optimizedDataUrl,
    });

    qrCodesFound = opt.qrMatches.map((payload) => ({
      pageNumber: 1,
      payload: sanitizeSingleLine(payload, 240),
      isSafeUrl: isSafeQrUrl(payload),
    }));

    throwIfAborted(options?.signal);
    options?.onProgress?.({
      stage: 'ocr',
      stageLabel: 'Running OCR text recognition on scanned image',
      currentPage: 1,
      totalPages: 1,
    });

    let ocrText = '';
    const pageWarnings: string[] = [];
    try {
      const ocrRes = await ocrRunner({
        imageDataUrl: opt.optimizedDataUrl,
        bytes: input.bytes,
        mimeType,
        signal: options?.signal,
      });
      ocrText = ocrRes.text;
      averageOcrConfidence = ocrRes.confidence;
      if (ocrRes.confidence < 65) {
        pageWarnings.push(`Low OCR confidence (${ocrRes.confidence}%). Image may be blurry or skewed.`);
      }
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') throw err;
      averageOcrConfidence = 0;
      pageWarnings.push(
        err instanceof Error ? `OCR error: ${err.message}` : 'OCR recognition failed.'
      );
    }

    tables = extractTablesFromText(ocrText, 1);
    formulas = extractFormulasFromText(ocrText, 1);

    const imgDiagramRef = await documentStorageAdapter.putBinary({
      folder: 'diagrams',
      docId,
      fileName: `page-1-${magicCheck.safeFileName}`,
      mimeType: 'image/jpeg',
      dataUrl: opt.optimizedDataUrl,
    });
    const pageDiagrams: ExtractedDiagramAsset[] = [
      {
        id: 'scan-sheet-1',
        pageNumber: 1,
        caption: `Scanned sheet (${magicCheck.safeFileName})`,
        kind: 'illustration',
        mimeType: 'image/jpeg',
        dataUrl: opt.optimizedDataUrl,
        storageRef: imgDiagramRef,
        width: opt.width || undefined,
        height: opt.height || undefined,
      },
    ];
    diagrams = pageDiagrams;

    pages = [
      {
        pageNumber: 1,
        text: ocrText,
        wordCount: ocrText.split(/\s+/).filter(Boolean).length,
        ocrApplied: true,
        ocrConfidence: averageOcrConfidence,
        renderedPreviewUrl: opt.optimizedDataUrl,
        diagrams: pageDiagrams,
        tables,
        formulas,
        warnings: pageWarnings,
      },
    ];
  } else if (magicCheck.format === 'pdf') {
    throwIfAborted(options?.signal);
    options?.onProgress?.({
      stage: 'extracting',
      stageLabel: 'Inspecting PDF text & embedded graphics',
    });

    const pdfOut = await processPdfBuffer({
      bytes: input.bytes,
      docId,
      signal: options?.signal,
      ocrRunner,
      onProgress: options?.onProgress,
    });

    pages = pdfOut.pages;
    diagrams = pdfOut.diagrams;
    tables = pdfOut.tables;
    formulas = pdfOut.formulas;
    qrCodesFound = pdfOut.qrMatches;
    averageOcrConfidence = pdfOut.averageOcrConfidence;
    optimizedPreviewUrl = pdfOut.optimizedPreviewUrl;
  } else if (magicCheck.format === 'docx') {
    throwIfAborted(options?.signal);
    options?.onProgress?.({
      stage: 'extracting',
      stageLabel: 'Unpacking DOCX paragraphs, tables, formulas & media',
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

    pages = [
      {
        pageNumber: 1,
        text: docxOut.text,
        wordCount: docxOut.text.split(/\s+/).filter(Boolean).length,
        ocrApplied: false,
        ocrConfidence: null,
        diagrams: docxOut.diagrams,
        tables: docxOut.tables,
        formulas: docxOut.formulas,
        warnings: [],
      },
    ];
  } else {
    throwIfAborted(options?.signal);
    options?.onProgress?.({
      stage: 'extracting',
      stageLabel: 'Reading text & tabular structure',
    });

    const decoded = sanitizePlainText(
      new TextDecoder('utf-8', { fatal: false }).decode(input.bytes),
      40_000
    );
    tables = extractTablesFromText(decoded, 1);
    formulas = extractFormulasFromText(decoded, 1);
    pages = [
      {
        pageNumber: 1,
        text: decoded,
        wordCount: decoded.split(/\s+/).filter(Boolean).length,
        ocrApplied: false,
        ocrConfidence: null,
        diagrams: [],
        tables,
        formulas,
        warnings: [],
      },
    ];
  }

  const combinedText = sanitizePlainText(
    pages.map((p) => p.text).filter(Boolean).join('\n\n'),
    45_000
  );

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
    securityFlags: magicCheck.securityFlags,
    earlyChecks,
    parentZipName: input.parentZipName,
    processingDurationMs: Date.now() - startedAt,
  };
}
