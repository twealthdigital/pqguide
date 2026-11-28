/**
 * PQGuide Hybrid OCR Recognition Engine
 *
 * Architecture:
 * - Bounded 2-worker Tesseract.js v7 pool (WASM/Node) with block/line/word bounding boxes,
 *   multi-pass PSM selection, 2-column reading-order reconstruction, and 90/180/270 orientation recovery.
 * - Paired with adaptive imagePreprocessor (4-corner perspective warp, border crop, ±14° deskew,
 *   300-DPI Lanczos upscaling, coarse illumination division, Soft Sauvola shadow cleanup, unsharp deblur).
 * - Optional multimodal Vision OCR fallback (`/api/documents/vision-ocr` or custom runner) triggered
 *   when local OCR confidence is low, text is sparse/noisy, or multiple uncertain spans appear.
 *   Uncertain regions are explicitly flagged for Super Admin review — never invented or silently altered.
 */

import { PSM, createWorker } from 'tesseract.js';
import { sanitizePlainText } from '../../core/security';
import type { UncertainSpan } from '../../core/types';
import {
  preprocessImageForOcr,
  uint8ToBase64DataUrl,
  type PreprocessedImageResult,
  type PreprocessingStrategy,
} from './imagePreprocessor';

export type VisionFallbackMode = 'auto' | 'always' | 'off';

export interface VisionOcrRunnerInput {
  imageBase64: string;
  mimeType: string;
  pageNumber?: number;
  reason?: string;
  signal?: AbortSignal;
}

export interface VisionOcrRunnerResult {
  ok: boolean;
  providerAvailable: boolean;
  provider?: string;
  modelUsed?: string;
  text?: string;
  confidenceEstimate?: number;
  uncertainSpans?: UncertainSpan[];
  error?: string;
}

export type VisionOcrRunner = (
  input: VisionOcrRunnerInput
) => Promise<VisionOcrRunnerResult>;

export interface OcrExecutionInput {
  imageDataUrl?: string;
  bytes?: Uint8Array;
  mimeType?: string;
  pageNumber?: number;
  signal?: AbortSignal;
  /** Skip imagePreprocessor if caller already passed an enhanced OCR-ready image. */
  skipPreprocessing?: boolean;
  /** Optional incremental progress callback (0..100 for active OCR pass). */
  onOcrProgress?: (pct: number, statusText: string) => void;
  /** Per-pass recognition timeout in milliseconds (default 45_000). */
  timeoutMs?: number;
  /** Multimodal Vision OCR fallback policy (default 'auto'). */
  visionFallback?: VisionFallbackMode;
  /** Optional custom Vision OCR runner (defaults to browser `/api/documents/vision-ocr`). */
  visionOcrRunner?: VisionOcrRunner;
}

export interface OcrExecutionResult {
  text: string;
  confidence: number; // 0..100
  warnings: string[];
  preprocessed?: PreprocessedImageResult;
  orientationCorrectedDeg: 0 | 90 | 180 | 270;
  psmUsed: string;
  passesRun: number;
  ocrEngineUsed: 'tesseract' | 'vision' | 'hybrid_tesseract_vision';
  visionFallbackUsed: boolean;
  visionFallbackError?: string;
  uncertainSpans: UncertainSpan[];
  perspectiveCorrected?: boolean;
}

type TesseractWorker = Awaited<ReturnType<typeof createWorker>>;

interface PooledWorkerSlot {
  id: number;
  worker: TesseractWorker | null;
  initPromise: Promise<TesseractWorker> | null;
  busy: boolean;
  onProgress?: (pct: number, statusText: string) => void;
}

const OCR_POOL_SIZE = 2;
const workerPool: PooledWorkerSlot[] = Array.from({ length: OCR_POOL_SIZE }, (_, idx) => ({
  id: idx,
  worker: null,
  initPromise: null,
  busy: false,
}));
const waiterQueue: Array<(slot: PooledWorkerSlot) => void> = [];

async function initSlotWorker(slot: PooledWorkerSlot): Promise<TesseractWorker> {
  if (slot.worker) return slot.worker;
  if (!slot.initPromise) {
    slot.initPromise = createWorker('eng', undefined, {
      logger: (msg: { status?: string; progress?: number }) => {
        if (!slot.onProgress) return;
        if (msg.status === 'recognizing text' && typeof msg.progress === 'number') {
          slot.onProgress(
            Math.max(0, Math.min(100, Math.round(msg.progress * 100))),
            'Recognizing characters'
          );
        } else if (msg.status && typeof msg.progress === 'number') {
          slot.onProgress(
            Math.max(0, Math.min(25, Math.round(msg.progress * 25))),
            msg.status
          );
        }
      },
    })
      .then(async (worker) => {
        await worker.setParameters({
          user_defined_dpi: '300',
          preserve_interword_spaces: '1',
        });
        slot.worker = worker;
        slot.initPromise = null;
        return worker;
      })
      .catch((err) => {
        slot.worker = null;
        slot.initPromise = null;
        throw err;
      });
  }
  return slot.initPromise;
}

async function acquireWorkerSlot(): Promise<PooledWorkerSlot> {
  const idle = workerPool.find((s) => !s.busy);
  if (idle) {
    idle.busy = true;
    return idle;
  }
  return new Promise<PooledWorkerSlot>((resolve) => {
    waiterQueue.push((slot) => {
      slot.busy = true;
      resolve(slot);
    });
  });
}

function releaseWorkerSlot(slot: PooledWorkerSlot): void {
  slot.onProgress = undefined;
  const next = waiterQueue.shift();
  if (next) {
    next(slot);
  } else {
    slot.busy = false;
  }
}

async function terminateSlotWorker(slot: PooledWorkerSlot): Promise<void> {
  const existing = slot.worker;
  slot.worker = null;
  slot.initPromise = null;
  if (existing) {
    try {
      await existing.terminate();
    } catch {
      // Best-effort cleanup
    }
  }
}

export async function shutdownOcrWorkerPool(): Promise<void> {
  for (const slot of workerPool) {
    await terminateSlotWorker(slot);
    slot.busy = false;
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('OCR recognition cancelled.', 'AbortError');
  }
}

/** Measures real readable signal so empty 95%-confidence hallucinations never beat actual text. */
export function scoreOcrCandidate(text: string, confidence: number): {
  score: number;
  validWords: number;
  alnumChars: number;
  noiseRatio: number;
} {
  const trimmed = text.trim();
  if (!trimmed) return { score: 0, validWords: 0, alnumChars: 0, noiseRatio: 0 };
  const alnumChars = (trimmed.match(/[A-Za-z0-9]/g) ?? []).length;
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  let validWords = 0;
  for (const raw of tokens) {
    const clean = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
    if (clean.length >= 2 && /[A-Za-z]{2,}/.test(clean)) {
      if (clean.length === 2 || /[aeiouyAEIOUY]/.test(clean) || /\d/.test(clean)) {
        validWords += 1;
      }
    } else if (/^\d{1,6}$/.test(clean)) {
      validWords += 0.5;
    }
  }
  const noiseChars = (
    trimmed.match(/[^A-Za-z0-9\s.,;:?!()[\]{}\-+*/=<>%$#@&'"°∑∫√≤≥≠≈π]/g) ?? []
  ).length;
  const noiseRatio = noiseChars / Math.max(1, trimmed.length);
  const wordDensity = validWords / Math.max(1, tokens.length);

  if (alnumChars < 8 || validWords < 2) {
    return {
      score: Math.min(12, Math.round(alnumChars * 0.5)),
      validWords: Math.floor(validWords),
      alnumChars,
      noiseRatio,
    };
  }

  const lengthBonus = Math.min(35, Math.log10(alnumChars + 1) * 10);
  const cleanDictionaryLikeWords = tokens.filter((raw) => {
    const c = raw.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
    return (
      /^[A-Za-z]{3,}$/.test(c) &&
      /[aeiouyAEIOUY]/.test(c) &&
      !/[A-Z]{2}\d|\d[A-Z]{2}/.test(raw)
    );
  }).length;
  const qualityScore =
    confidence * 0.7 +
    wordDensity * 20 +
    Math.min(20, cleanDictionaryLikeWords * 0.5) +
    lengthBonus * 0.6 -
    noiseRatio * 45;

  return {
    score: Math.max(0, Math.min(120, Number(qualityScore.toFixed(2)))),
    validWords: Math.floor(validWords),
    alnumChars,
    noiseRatio: Number(noiseRatio.toFixed(4)),
  };
}

function cleanOcrOutputText(raw: string): string {
  const normalized = raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
    // Drop pure noise lines containing only stray single punctuation marks
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      if (t.length === 1 && !/[A-Za-z0-9]/.test(t)) return false;
      if (/^[|—_=~`^.,;:'"\\/-]{2,8}$/.test(t)) return false;
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return sanitizePlainText(normalized, 60_000);
}

interface TesseractLineNode {
  text?: string;
  confidence?: number;
  bbox?: { x0: number; y0: number; x1: number; y1: number };
  words?: Array<{
    text?: string;
    confidence?: number;
    bbox?: { x0: number; y0: number; x1: number; y1: number };
  }>;
}

interface TesseractBlockNode {
  bbox?: { x0: number; y0: number; x1: number; y1: number };
  paragraphs?: Array<{
    lines?: TesseractLineNode[];
  }>;
}

interface BboxWordNode {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface TableCellSpan {
  text: string;
  x0: number;
  x1: number;
}

function cleanBorderArtifact(text: string): string {
  return text
    .replace(/^[\s|│┃┌┐└┘├┤┬┴┼_—\-]+(?=[A-Za-z0-9(∑∫√])/, '')
    .replace(/(?<=[A-Za-z0-9).%°])[\s|│┃┌┐└┘├┤┬┴┼_—\-]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function isPureBorderToken(tok: string): boolean {
  return /^[|│┃┌┐└┘├┤┬┴┼+\-_=~]{1,8}$/.test(tok.trim());
}

/**
 * Inspects Tesseract hierarchical blocks/lines/words to:
 * 1) Reconstruct Y-aligned 2+ column tables (including simple/borderless or cross-block tables)
 *    as clean Markdown pipe tables right at their original vertical reading position.
 * 2) Reorder genuine 2-column image layouts left-column-first without scrambling wide headers/tables.
 * 3) Collect low-confidence uncertain word/line spans with coordinates for Super Admin review.
 */
function analyzeBlocksAndOrder(
  blocks: TesseractBlockNode[] | null | undefined,
  fallbackText: string
): { orderedText: string; uncertainSpans: UncertainSpan[] } {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return { orderedText: fallbackText, uncertainSpans: [] };
  }

  const lines: TesseractLineNode[] = [];
  const allWords: BboxWordNode[] = [];
  let maxX = 0;

  for (const blk of blocks) {
    if (blk.bbox?.x1 && blk.bbox.x1 > maxX) maxX = blk.bbox.x1;
    for (const para of blk.paragraphs ?? []) {
      for (const ln of para.lines ?? []) {
        if ((ln.text ?? '').trim()) {
          lines.push(ln);
          if (ln.bbox?.x1 && ln.bbox.x1 > maxX) maxX = ln.bbox.x1;
        }
        for (const w of ln.words ?? []) {
          const wt = (w.text ?? '').trim();
          if (!wt || !w.bbox) continue;
          const { x0, y0, x1, y1 } = w.bbox;
          if (x1 > x0 && y1 > y0) {
            allWords.push({ text: wt, x0, y0, x1, y1 });
            if (x1 > maxX) maxX = x1;
          }
        }
      }
    }
  }

  const uncertainSpans: UncertainSpan[] = [];
  const seenSpanKeys = new Set<string>();

  for (const ln of lines) {
    const lnText = (ln.text ?? '').trim();
    const lnConf = Number.isFinite(ln.confidence) ? Math.round(ln.confidence!) : 100;
    const words = ln.words ?? [];

    for (const w of words) {
      const wt = (w.text ?? '').trim();
      const wc = Number.isFinite(w.confidence) ? Math.round(w.confidence!) : 100;
      if (wt.length >= 2 && /[A-Za-z0-9]/.test(wt) && wc < 58 && uncertainSpans.length < 18) {
        const key = `${wt.toLowerCase()}@${Math.round((w.bbox?.y0 ?? 0) / 15)}`;
        if (!seenSpanKeys.has(key)) {
          seenSpanKeys.add(key);
          uncertainSpans.push({
            text: wt.slice(0, 80),
            confidence: wc,
            reason: `Low character confidence (${wc}%)`,
            bbox: w.bbox,
          });
        }
      }
    }

    if (
      lnText.length >= 4 &&
      lnConf < 55 &&
      uncertainSpans.length < 22 &&
      !seenSpanKeys.has(lnText.toLowerCase().slice(0, 32))
    ) {
      seenSpanKeys.add(lnText.toLowerCase().slice(0, 32));
      uncertainSpans.push({
        text: lnText.slice(0, 120),
        confidence: lnConf,
        reason: `Low line recognition confidence (${lnConf}%)`,
        bbox: ln.bbox,
      });
    }
  }

  // Reorder 2-column dense scanned prose layouts when a clean central vertical split exists
  let orderedText = fallbackText;
  let detectedTwoColumnProse = false;

  if (lines.length >= 8 && maxX > 300) {
    const midX = maxX * 0.5;
    const gutter = Math.max(14, maxX * 0.03);
    const leftLines: TesseractLineNode[] = [];
    const rightLines: TesseractLineNode[] = [];
    const fullLines: TesseractLineNode[] = [];

    for (const ln of lines) {
      const x0 = ln.bbox?.x0 ?? 0;
      const x1 = ln.bbox?.x1 ?? maxX;
      if (x1 <= midX + gutter * 0.5 && x1 - x0 < maxX * 0.56) {
        leftLines.push(ln);
      } else if (x0 >= midX - gutter * 0.5 && x1 - x0 < maxX * 0.56) {
        rightLines.push(ln);
      } else {
        fullLines.push(ln);
      }
    }

    const avgWordsLeft =
      leftLines.reduce((s, l) => s + (l.text ?? '').trim().split(/\s+/).length, 0) /
      Math.max(1, leftLines.length);
    const avgWordsRight =
      rightLines.reduce((s, l) => s + (l.text ?? '').trim().split(/\s+/).length, 0) /
      Math.max(1, rightLines.length);
    // Only treat as 2-column prose layout if columns contain multi-word prose lines (not short table cells)
    const looksLikeProseColumns = avgWordsLeft >= 3.8 || avgWordsRight >= 3.8;

    if (
      looksLikeProseColumns &&
      leftLines.length >= 4 &&
      rightLines.length >= 4 &&
      fullLines.length <= Math.min(leftLines.length, rightLines.length) * 0.5
    ) {
      const sortByY = (arr: TesseractLineNode[]) =>
        arr
          .slice()
          .sort((a, b) => (a.bbox?.y0 ?? 0) - (b.bbox?.y0 ?? 0))
          .map((l) => (l.text ?? '').trim())
          .filter(Boolean)
          .join('\n');

      const rebuilt = [sortByY(fullLines), sortByY(leftLines), sortByY(rightLines)]
        .filter(Boolean)
        .join('\n\n');
      if (rebuilt.trim().length > fallbackText.trim().length * 0.8) {
        orderedText = rebuilt;
        detectedTwoColumnProse = true;
      }
    }
  }

  // Coordinate-based table reconstruction across all word bboxes (handles 2+ column & simple tables)
  if (!detectedTwoColumnProse && allWords.length >= 4) {
    const heights = allWords.map((w) => w.y1 - w.y0).sort((a, b) => a - b);
    const medianH = Math.max(10, heights[Math.floor(heights.length * 0.5)] || 18);
    const rowTol = Math.max(7, medianH * 0.55);

    const wordsByY = allWords
      .slice()
      .sort((a, b) => (a.y0 + a.y1) * 0.5 - (b.y0 + b.y1) * 0.5 || a.x0 - b.x0);

    interface RowGroup {
      midY: number;
      words: BboxWordNode[];
      cells: TableCellSpan[];
      rawLine: string;
    }

    const rowGroups: RowGroup[] = [];
    for (const w of wordsByY) {
      const wy = (w.y0 + w.y1) * 0.5;
      const cur = rowGroups[rowGroups.length - 1];
      if (!cur || Math.abs(wy - cur.midY) > rowTol) {
        rowGroups.push({ midY: wy, words: [w], cells: [], rawLine: '' });
      } else {
        cur.words.push(w);
        cur.midY = cur.words.reduce((s, item) => s + (item.y0 + item.y1) * 0.5, 0) / cur.words.length;
      }
    }

    const cellGapMin = Math.max(18, medianH * 1.15);
    for (const rg of rowGroups) {
      rg.words.sort((a, b) => a.x0 - b.x0);
      const cells: TableCellSpan[] = [];
      let curText: string[] = [];
      let curX0 = 0;
      let curX1 = 0;
      let prevEnd = -Infinity;

      for (const w of rg.words) {
        if (isPureBorderToken(w.text)) {
          if (curText.length > 0) {
            const cleaned = cleanBorderArtifact(curText.join(' '));
            if (cleaned) cells.push({ text: cleaned, x0: curX0, x1: curX1 });
            curText = [];
          }
          prevEnd = -Infinity;
          continue;
        }
        const cleanedWord = cleanBorderArtifact(w.text);
        if (!cleanedWord) continue;

        if (curText.length === 0) {
          curText = [cleanedWord];
          curX0 = w.x0;
          curX1 = w.x1;
        } else if (w.x0 - prevEnd > cellGapMin) {
          const cleaned = cleanBorderArtifact(curText.join(' '));
          if (cleaned) cells.push({ text: cleaned, x0: curX0, x1: curX1 });
          curText = [cleanedWord];
          curX0 = w.x0;
          curX1 = w.x1;
        } else {
          curText.push(cleanedWord);
          curX1 = Math.max(curX1, w.x1);
        }
        prevEnd = w.x1;
      }
      if (curText.length > 0) {
        const cleaned = cleanBorderArtifact(curText.join(' '));
        if (cleaned) cells.push({ text: cleaned, x0: curX0, x1: curX1 });
      }
      rg.cells = cells;
      rg.rawLine = cells.map((c) => c.text).join(' ');
    }

    const isEligibleTableRow = (rg: RowGroup): boolean => {
      if (rg.cells.length < 2 || rg.cells.length > 8) return false;
      const avgWords =
        rg.cells.reduce((s, c) => s + c.text.split(/\s+/).filter(Boolean).length, 0) /
        rg.cells.length;
      if (avgWords > 6.5) return false;
      if (rg.rawLine.length > 165) return false;
      // Avoid merging numbered MCQ option rows like "A. Alpha   B. Beta" unless >2 aligned rows exist
      const looksLikeMcqPair =
        rg.cells.length === 2 &&
        /^[A-D][.)]\s/.test(rg.cells[0].text) &&
        /^[A-D][.)]\s/.test(rg.cells[1].text);
      if (looksLikeMcqPair) return false;
      return true;
    };

    const outputSegments: string[] = [];
    let r = 0;
    let rebuiltTableCount = 0;

    while (r < rowGroups.length) {
      if (!isEligibleTableRow(rowGroups[r])) {
        if (rowGroups[r].rawLine) outputSegments.push(rowGroups[r].rawLine);
        r += 1;
        continue;
      }

      // Collect contiguous candidate table rows whose vertical spacing stays regular
      let end = r + 1;
      while (end < rowGroups.length && isEligibleTableRow(rowGroups[end])) {
        const vGap = rowGroups[end].midY - rowGroups[end - 1].midY;
        if (vGap > medianH * 4.5) break;
        end += 1;
      }

      const run = rowGroups.slice(r, end);
      if (run.length >= 2) {
        // Build shared column X-bands across the contiguous rows
        const bands: Array<{ minX: number; maxX: number; center: number }> = [];
        const allRunCells = run.flatMap((rg) => rg.cells).sort((a, b) => a.x0 - b.x0);
        for (const cell of allRunCells) {
          const matched = bands.find(
            (b) => cell.x0 <= b.maxX + medianH * 0.7 && cell.x1 >= b.minX - medianH * 0.7
          );
          if (matched) {
            matched.minX = Math.min(matched.minX, cell.x0);
            matched.maxX = Math.max(matched.maxX, cell.x1);
            matched.center = (matched.minX + matched.maxX) * 0.5;
          } else {
            bands.push({ minX: cell.x0, maxX: cell.x1, center: (cell.x0 + cell.x1) * 0.5 });
          }
        }
        bands.sort((a, b) => a.center - b.center);

        const avgCellWordsAll =
          allRunCells.reduce((s, c) => s + c.text.split(/\s+/).filter(Boolean).length, 0) /
          Math.max(1, allRunCells.length);

        const validTable =
          bands.length >= 2 &&
          bands.length <= 8 &&
          (bands.length >= 3 || avgCellWordsAll <= 4.2);

        if (validTable) {
          const gridRows: string[][] = run.map((rg) => {
            const slots = Array.from({ length: bands.length }, () => '');
            for (const cell of rg.cells) {
              let bestBand = 0;
              let bestDist = Infinity;
              const cellCenter = (cell.x0 + cell.x1) * 0.5;
              for (let bi = 0; bi < bands.length; bi += 1) {
                const overlap = Math.min(cell.x1, bands[bi].maxX) - Math.max(cell.x0, bands[bi].minX);
                const dist = overlap > 0 ? -overlap : Math.abs(cellCenter - bands[bi].center);
                if (dist < bestDist) {
                  bestDist = dist;
                  bestBand = bi;
                }
              }
              slots[bestBand] = slots[bestBand] ? `${slots[bestBand]} ${cell.text}` : cell.text;
            }
            return slots;
          });

          const headerLine = `| ${gridRows[0].map((c) => c || ' ').join(' | ')} |`;
          const sepLine = `| ${bands.map(() => '---').join(' | ')} |`;
          const bodyLines = gridRows.slice(1).map((row) => `| ${row.map((c) => c || ' ').join(' | ')} |`);
          outputSegments.push([headerLine, sepLine, ...bodyLines].join('\n'));
          rebuiltTableCount += 1;
          r = end;
          continue;
        }
      }

      for (let k = r; k < end; k += 1) {
        if (rowGroups[k].rawLine) outputSegments.push(rowGroups[k].rawLine);
      }
      r = end;
    }

    if (rebuiltTableCount > 0 && outputSegments.length > 0) {
      orderedText = outputSegments.join('\n');
    }
  }

  return { orderedText, uncertainSpans };
}

async function runPooledRecognition(params: {
  source: Buffer | string;
  psm: PSM;
  signal?: AbortSignal;
  timeoutMs: number;
  onProgress?: (pct: number, statusText: string) => void;
}): Promise<{ text: string; confidence: number; uncertainSpans: UncertainSpan[] }> {
  throwIfAborted(params.signal);
  const slot = await acquireWorkerSlot();
  try {
    throwIfAborted(params.signal);
    const worker = await initSlotWorker(slot);
    throwIfAborted(params.signal);
    await worker.setParameters({
      tessedit_pageseg_mode: params.psm,
      user_defined_dpi: '300',
      preserve_interword_spaces: '1',
    });

    slot.onProgress = params.onProgress;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `OCR recognition timed out after ${Math.round(params.timeoutMs / 1000)}s.`
            )
          );
        }, params.timeoutMs);
      });
      const abortPromise = params.signal
        ? new Promise<never>((_, reject) => {
            if (params.signal?.aborted) {
              reject(new DOMException('OCR recognition cancelled.', 'AbortError'));
              return;
            }
            params.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('OCR recognition cancelled.', 'AbortError')),
              { once: true }
            );
          })
        : null;

      const racers: Array<Promise<Awaited<ReturnType<TesseractWorker['recognize']>>>> = [
        worker.recognize(params.source, undefined, { text: true, blocks: true }),
        timeoutPromise,
      ];
      if (abortPromise) racers.push(abortPromise);

      const res = await Promise.race(racers);
      const rawText = res.data?.text ?? '';
      const rawConf = Number.isFinite(res.data?.confidence)
        ? Math.max(0, Math.min(100, Math.round(res.data.confidence)))
        : 0;
      const { orderedText, uncertainSpans } = analyzeBlocksAndOrder(
        res.data?.blocks as unknown as TesseractBlockNode[] | null | undefined,
        rawText
      );
      const cleaned = cleanOcrOutputText(orderedText);
      const metrics = scoreOcrCandidate(cleaned, rawConf);
      const effectiveConf = metrics.alnumChars < 6 ? 0 : rawConf;
      return { text: cleaned, confidence: effectiveConf, uncertainSpans };
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        await terminateSlotWorker(slot);
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  } finally {
    releaseWorkerSlot(slot);
  }
}

function toWorkerSource(
  preprocessed?: PreprocessedImageResult,
  rawDataUrl?: string
): Buffer | string {
  if (preprocessed?.ocrBytes && typeof Buffer !== 'undefined') {
    return Buffer.from(preprocessed.ocrBytes);
  }
  return preprocessed?.ocrDataUrl ?? rawDataUrl ?? '';
}

/**
 * OCR engines routinely drop superscripts and subscripts (x^2 comes back as "x2"), which
 * silently changes the maths. This cannot be fixed reliably, so lines that look like they
 * lost one are flagged for a human. The text itself is never altered. The 50 here is a
 * placeholder for "unverified", not a measured confidence.
 */
export function detectMathUncertainty(text: string): UncertainSpan[] {
  const spans: UncertainSpan[] = [];
  for (const rawLine of text.split('\n')) {
    if (spans.length >= 8) break;
    const line = rawLine.trim();
    // Maths-looking line: has an operator/equation and a lowercase variable glued to a digit.
    if (!/[=+\-*/<>]|\bintegral\b|\bdifferentiate\b|\bsolve\b/i.test(line)) continue;
    const m = line.match(/(?:^|[\s(+\-*/=])([a-z]\d{1,2})(?=$|[\s).,;+\-*/=])/);
    if (m) {
      spans.push({
        text: m[1],
        confidence: 50,
        reason: 'Possible lost superscript/subscript (for example x\u00B2 read as x2). Check against the original.',
      });
    }
  }
  return spans;
}

/** A Vision model's self-reported confidence is capped here; it is never treated as measured accuracy. */
const VISION_CONFIDENCE_CEILING = 70;

async function defaultBrowserVisionOcrRunner(
  input: VisionOcrRunnerInput
): Promise<VisionOcrRunnerResult> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    return {
      ok: false,
      providerAvailable: false,
      error: 'No Vision OCR runner configured in non-browser context.',
    };
  }
  try {
    const res = await fetch('/api/documents/vision-ocr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: input.signal,
      body: JSON.stringify({
        imageBase64: input.imageBase64,
        mimeType: input.mimeType,
        pageNumber: input.pageNumber,
        reason: input.reason,
      }),
    });
    const payload = (await res.json()) as VisionOcrRunnerResult;
    return payload;
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') throw err;
    return {
      ok: false,
      providerAvailable: false,
      error: err instanceof Error ? err.message : 'Vision OCR request failed.',
    };
  }
}

export async function recognizeWithTesseractPool(
  input: OcrExecutionInput
): Promise<OcrExecutionResult> {
  throwIfAborted(input.signal);
  const timeoutMs = input.timeoutMs ?? 45_000;
  const warnings: string[] = [];

  if (!input.bytes && !input.imageDataUrl) {
    throw new Error('No image buffer or data URL provided to OCR engine.');
  }

  let basePrep: PreprocessedImageResult | undefined;
  let primarySource: Buffer | string;

  if (!input.skipPreprocessing) {
    try {
      basePrep = await preprocessImageForOcr({
        bytes: input.bytes,
        imageDataUrl: input.imageDataUrl,
        mimeType: input.mimeType,
      });
      primarySource = toWorkerSource(basePrep);
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') throw err;
      primarySource =
        input.bytes && typeof Buffer !== 'undefined'
          ? Buffer.from(input.bytes)
          : input.imageDataUrl!;
      warnings.push('Adaptive preprocessing skipped; using raw image input.');
    }
  } else {
    primarySource =
      input.bytes && typeof Buffer !== 'undefined'
        ? Buffer.from(input.bytes)
        : input.imageDataUrl!;
  }

  if (basePrep?.isLikelyBlank) {
    warnings.push('Page appears blank or lacks readable foreground text.');
    return {
      text: '',
      confidence: 0,
      warnings,
      preprocessed: basePrep,
      orientationCorrectedDeg: 0,
      psmUsed: 'PSM.AUTO',
      passesRun: 0,
      ocrEngineUsed: 'tesseract',
      visionFallbackUsed: false,
      uncertainSpans: [],
      perspectiveCorrected: basePrep.perspectiveCorrected,
    };
  }

  throwIfAborted(input.signal);
  let passesRun = 1;
  let best = await runPooledRecognition({
    source: primarySource,
    psm: PSM.AUTO,
    signal: input.signal,
    timeoutMs,
    onProgress: input.onOcrProgress,
  });
  let bestScore = scoreOcrCandidate(best.text, best.confidence);
  let bestPsm = 'PSM.AUTO';
  let bestOrientation: 0 | 90 | 180 | 270 = 0;

  // Pass 2: Try PSM.SINGLE_BLOCK when Pass 1 confidence or density is low
  const needsSecondPass =
    bestScore.validWords < 22 || best.confidence < 58 || bestScore.score < 56;

  if (needsSecondPass && !input.signal?.aborted) {
    passesRun += 1;
    const pass2 = await runPooledRecognition({
      source: primarySource,
      psm: PSM.SINGLE_BLOCK,
      signal: input.signal,
      timeoutMs,
    });
    const pass2Score = scoreOcrCandidate(pass2.text, pass2.confidence);
    if (pass2Score.score > bestScore.score + 2) {
      best = pass2;
      bestScore = pass2Score;
      bestPsm = 'PSM.SINGLE_BLOCK';
    }
  }

  // Pass 3: Alternate preprocessing strategy if still weak (Soft Sauvola vs Clean Contrast)
  if (
    !input.skipPreprocessing &&
    basePrep &&
    (bestScore.validWords < 16 || (bestScore.validWords < 45 && bestScore.score < 48)) &&
    !input.signal?.aborted
  ) {
    const altStrategy: PreprocessingStrategy =
      basePrep.strategy === 'soft_sauvola_enhanced' ? 'clean_digital' : 'soft_sauvola_enhanced';
    try {
      const altPrep = await preprocessImageForOcr({
        bytes: input.bytes,
        imageDataUrl: input.imageDataUrl,
        mimeType: input.mimeType,
        strategyOverride: altStrategy,
      });
      passesRun += 1;
      const pass3 = await runPooledRecognition({
        source: toWorkerSource(altPrep),
        psm: PSM.AUTO,
        signal: input.signal,
        timeoutMs,
      });
      const pass3Score = scoreOcrCandidate(pass3.text, pass3.confidence);
      if (pass3Score.score > bestScore.score + 4) {
        best = pass3;
        bestScore = pass3Score;
        basePrep = altPrep;
        bestPsm = `PSM.AUTO(${altStrategy})`;
      }
    } catch {
      // Keep earlier candidate if alternate pass errors
    }
  }

  // Pass 4: Orientation recovery (180 / 90 / 270 deg) when OCR confidence/legibility indicates rotated page
  if (
    !input.skipPreprocessing &&
    (bestScore.validWords < 10 ||
      bestScore.score < 38 ||
      (best.confidence > 0 && best.confidence < 45 && bestScore.validWords < 45)) &&
    !input.signal?.aborted
  ) {
    for (const turns of [2, 1, 3] as const) {
      if (input.signal?.aborted) break;
      try {
        const rotPrep = await preprocessImageForOcr({
          bytes: input.bytes,
          imageDataUrl: input.imageDataUrl,
          mimeType: input.mimeType,
          quarterTurns: turns,
        });
        passesRun += 1;
        const rotRes = await runPooledRecognition({
          source: toWorkerSource(rotPrep),
          psm: PSM.AUTO,
          signal: input.signal,
          timeoutMs,
        });
        const rotScore = scoreOcrCandidate(rotRes.text, rotRes.confidence);
        if (
          rotScore.score > bestScore.score + 12 ||
          (rotScore.validWords >= bestScore.validWords + 5 && rotScore.score > bestScore.score + 6)
        ) {
          best = rotRes;
          bestScore = rotScore;
          basePrep = rotPrep;
          bestOrientation = (turns * 90) as 90 | 180 | 270;
          bestPsm = `PSM.AUTO(rot${bestOrientation})`;
          if (rotScore.validWords >= 18) break;
        }
      } catch {
        // Continue testing remaining orientations
      }
    }
  }

  // Pass 5: Optional Hybrid Vision OCR Fallback for difficult / low-confidence / uncertain pages
  let ocrEngineUsed: OcrExecutionResult['ocrEngineUsed'] = 'tesseract';
  let visionFallbackUsed = false;
  let visionFallbackError: string | undefined;
  let uncertainSpans = best.uncertainSpans.slice();

  const visionMode = input.visionFallback ?? 'auto';
  const lowConfidence = best.confidence > 0 && best.confidence < 68;
  const sparseRecovery = bestScore.validWords < 12;
  const highNoise = bestScore.noiseRatio > 0.14;
  const multiUncertain = uncertainSpans.length >= 3;

  const shouldTryVision =
    !input.signal?.aborted &&
    visionMode !== 'off' &&
    (visionMode === 'always' || lowConfidence || sparseRecovery || highNoise || multiUncertain);

  if (shouldTryVision) {
    const fallbackReason =
      visionMode === 'always'
        ? 'explicit_vision_mode'
        : sparseRecovery
          ? 'sparse_local_ocr'
          : highNoise
            ? 'high_symbol_noise'
            : multiUncertain
              ? 'multiple_uncertain_spans'
              : `low_confidence_${best.confidence}`;

    const visionImageDataUrl =
      basePrep?.ocrDataUrl ??
      input.imageDataUrl ??
      (input.bytes ? uint8ToBase64DataUrl(input.bytes, input.mimeType || 'image/png') : '');
    const visionMime = visionImageDataUrl.startsWith('data:image/jpeg')
      ? 'image/jpeg'
      : visionImageDataUrl.startsWith('data:image/webp')
        ? 'image/webp'
        : 'image/png';

    const runner = input.visionOcrRunner ?? defaultBrowserVisionOcrRunner;
    if (visionImageDataUrl) {
      const vRes = await runner({
        imageBase64: visionImageDataUrl,
        mimeType: visionMime,
        pageNumber: input.pageNumber,
        reason: fallbackReason,
        signal: input.signal,
      });

      if (vRes.ok && vRes.text && vRes.text.trim().length > 0) {
        const cleanedVision = cleanOcrOutputText(vRes.text);
        // The model's own confidence is a self-report, not a measured accuracy, and it may be
        // missing. Never invent one: fall back to the local engine's measured value, and cap
        // the result so a Vision read can never look more trustworthy than it is.
        const reportedConf =
          typeof vRes.confidenceEstimate === 'number' ? vRes.confidenceEstimate : best.confidence;
        const visionConf = Math.max(0, Math.min(VISION_CONFIDENCE_CEILING, reportedConf));
        const visionScore = scoreOcrCandidate(cleanedVision, visionConf);
        visionFallbackUsed = true;

        if (visionMode === 'always' || visionScore.score >= bestScore.score - 2) {
          best = {
            text: cleanedVision,
            confidence: visionConf,
            uncertainSpans: vRes.uncertainSpans ?? [],
          };
          bestScore = visionScore;
          uncertainSpans = vRes.uncertainSpans ?? [];
          ocrEngineUsed = bestScore.alnumChars > 0 ? 'hybrid_tesseract_vision' : 'vision';
          warnings.push(
            `Text for this page was read by Vision OCR (${vRes.modelUsed || vRes.provider || 'vision'}). It is not independently verified; check it against the original.`
          );
        }
      } else if (vRes.providerAvailable && vRes.error) {
        visionFallbackError = vRes.error;
        warnings.push(`Vision OCR fallback could not improve this page: ${vRes.error}`);
      } else if (visionMode === 'always' && vRes.error) {
        visionFallbackError = vRes.error;
      }
    }
  }

  {
    const known = new Set(uncertainSpans.map((u) => u.text));
    for (const span of detectMathUncertainty(best.text)) {
      if (!known.has(span.text)) uncertainSpans.push(span);
    }
  }

  if (best.confidence > 0 && best.confidence < 65) {
    warnings.push(
      `Low OCR confidence (${best.confidence}%). Image may be blurry, creased, or skewed.`
    );
  }
  if (bestScore.alnumChars < 15) {
    warnings.push('OCR extracted minimal readable text from this page.');
  }
  if (uncertainSpans.length > 0) {
    warnings.push(
      `${uncertainSpans.length} uncertain word/line span(s) flagged for reviewer verification.`
    );
  }
  if (basePrep?.qualityMetrics.isBlurry) {
    warnings.push('Low sharpness / blur detected in source image.');
  }
  if (basePrep?.qualityMetrics.isLowResolution) {
    warnings.push(
      `Low source resolution (${basePrep.originalWidth}x${basePrep.originalHeight}); upscaled for OCR.`
    );
  }

  return {
    text: best.text,
    confidence: best.confidence,
    warnings,
    preprocessed: basePrep,
    orientationCorrectedDeg: bestOrientation,
    psmUsed: bestPsm,
    passesRun,
    ocrEngineUsed,
    visionFallbackUsed,
    visionFallbackError,
    uncertainSpans,
    perspectiveCorrected: basePrep?.perspectiveCorrected,
  };
}
