/**
 * PQGuide OCR Recognition Engine
 *
 * Engine Audit (Tesseract.js vs PaddleOCR):
 * - PaddleOCR (PP-OCRv4) offers strong scene-text accuracy, but requires a Python
 *   runtime + PaddlePaddle/ONNX native weights (~300MB+) hosted on dedicated server
 *   infrastructure. That would introduce mandatory backend hosting costs or fail in
 *   PQGuide's React SPA + stateless Node/Vercel runtime.
 * - Upgraded Multi-Pass Tesseract.js v7 runs 100% locally in Browser (WASM) and Node.js
 *   with zero paid external APIs or recurring cloud dependencies. Paired with PQGuide's
 *   adaptive imagePreprocessor (border crop, skew correction, 300-DPI upscaling,
 *   Soft Sauvola lighting normalization, unsharp deblurring), multi-pass PSM selection,
 *   and 90/180/270 orientation recovery, it recovers dense exam sheets and mixed scans cleanly.
 */

import { PSM, createWorker } from 'tesseract.js';
import { sanitizePlainText } from '../../core/security';
import {
  preprocessImageForOcr,
  type PreprocessedImageResult,
  type PreprocessingStrategy,
} from './imagePreprocessor';

export interface OcrExecutionInput {
  imageDataUrl?: string;
  bytes?: Uint8Array;
  mimeType?: string;
  signal?: AbortSignal;
  /** Skip imagePreprocessor if caller already passed an enhanced OCR-ready image. */
  skipPreprocessing?: boolean;
  /** Optional incremental progress callback (0..100 for active OCR pass). */
  onOcrProgress?: (pct: number, statusText: string) => void;
  /** Per-pass recognition timeout in milliseconds (default 45_000). */
  timeoutMs?: number;
}

export interface OcrExecutionResult {
  text: string;
  confidence: number; // 0..100
  warnings: string[];
  preprocessed?: PreprocessedImageResult;
  orientationCorrectedDeg: 0 | 90 | 180 | 270;
  psmUsed: string;
  passesRun: number;
}

type TesseractWorker = Awaited<ReturnType<typeof createWorker>>;

let sharedWorker: TesseractWorker | null = null;
let sharedWorkerInit: Promise<TesseractWorker> | null = null;
let workerQueueTail: Promise<unknown> = Promise.resolve();
let activeProgressSink: ((pct: number, statusText: string) => void) | undefined;

async function getReusableWorker(): Promise<TesseractWorker> {
  if (sharedWorker) return sharedWorker;
  if (!sharedWorkerInit) {
    sharedWorkerInit = createWorker('eng', undefined, {
      logger: (msg: { status?: string; progress?: number }) => {
        if (!activeProgressSink) return;
        if (msg.status === 'recognizing text' && typeof msg.progress === 'number') {
          activeProgressSink(
            Math.max(0, Math.min(100, Math.round(msg.progress * 100))),
            'Recognizing characters'
          );
        } else if (msg.status && typeof msg.progress === 'number') {
          activeProgressSink(
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
        sharedWorker = worker;
        sharedWorkerInit = null;
        return worker;
      })
      .catch((err) => {
        sharedWorker = null;
        sharedWorkerInit = null;
        throw err;
      });
  }
  return sharedWorkerInit;
}

export async function shutdownOcrWorkerPool(): Promise<void> {
  const existing = sharedWorker;
  sharedWorker = null;
  sharedWorkerInit = null;
  if (existing) {
    try {
      await existing.terminate();
    } catch {
      // Best-effort cleanup
    }
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
} {
  const trimmed = text.trim();
  if (!trimmed) return { score: 0, validWords: 0, alnumChars: 0 };
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
  const noiseChars = (trimmed.match(/[^A-Za-z0-9\s.,;:?!()[\]{}\-+*/=<>%$#@&'"°∑∫√≤≥≠≈π]/g) ?? [])
    .length;
  const noiseRatio = noiseChars / Math.max(1, trimmed.length);
  const wordDensity = validWords / Math.max(1, tokens.length);

  if (alnumChars < 8 || validWords < 2) {
    return {
      score: Math.min(12, Math.round(alnumChars * 0.5)),
      validWords: Math.floor(validWords),
      alnumChars,
    };
  }

  const lengthBonus = Math.min(35, Math.log10(alnumChars + 1) * 10);
  const wordBonus = Math.min(35, validWords * 0.6);
  // Count high-signal 3+ letter words that do not mix digits inside letters (like "ISYNO0")
  const cleanDictionaryLikeWords = tokens.filter((raw) => {
    const c = raw.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
    return /^[A-Za-z]{3,}$/.test(c) && /[aeiouyAEIOUY]/.test(c) && !/[A-Z]{2}\d|\d[A-Z]{2}/.test(raw);
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

async function runSerializedRecognition(params: {
  source: Buffer | string;
  psm: PSM;
  signal?: AbortSignal;
  timeoutMs: number;
  onProgress?: (pct: number, statusText: string) => void;
}): Promise<{ text: string; confidence: number }> {
  const exec = async () => {
    throwIfAborted(params.signal);
    const worker = await getReusableWorker();
    throwIfAborted(params.signal);
    await worker.setParameters({
      tessedit_pageseg_mode: params.psm,
      user_defined_dpi: '300',
      preserve_interword_spaces: '1',
    });

    activeProgressSink = params.onProgress;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`OCR recognition timed out after ${Math.round(params.timeoutMs / 1000)}s.`));
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
        worker.recognize(params.source),
        timeoutPromise,
      ];
      if (abortPromise) racers.push(abortPromise);

      const res = await Promise.race(racers);
      const rawText = res.data?.text ?? '';
      const rawConf = Number.isFinite(res.data?.confidence)
        ? Math.max(0, Math.min(100, Math.round(res.data.confidence)))
        : 0;
      const cleaned = cleanOcrOutputText(rawText);
      const metrics = scoreOcrCandidate(cleaned, rawConf);
      // Do not report 95% confidence for empty/near-empty outputs
      const effectiveConf = metrics.alnumChars < 6 ? 0 : rawConf;
      return { text: cleaned, confidence: effectiveConf };
    } catch (err) {
      // Terminate potentially wedged worker on timeout or fatal WASM error so next call recovers
      if ((err as { name?: string })?.name !== 'AbortError') {
        await shutdownOcrWorkerPool();
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
      activeProgressSink = undefined;
    }
  };

  const next = workerQueueTail.then(exec, exec);
  workerQueueTail = next.catch(() => {});
  return next;
}

function toWorkerSource(preprocessed?: PreprocessedImageResult, rawDataUrl?: string): Buffer | string {
  if (preprocessed?.ocrBytes && typeof Buffer !== 'undefined') {
    return Buffer.from(preprocessed.ocrBytes);
  }
  return preprocessed?.ocrDataUrl ?? rawDataUrl ?? '';
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
    };
  }

  throwIfAborted(input.signal);
  let passesRun = 1;
  let best = await runSerializedRecognition({
    source: primarySource,
    psm: PSM.AUTO,
    signal: input.signal,
    timeoutMs,
    onProgress: input.onOcrProgress,
  });
  let bestScore = scoreOcrCandidate(best.text, best.confidence);
  let bestPsm = 'PSM.AUTO';
  let bestOrientation: 0 | 90 | 180 | 270 = 0;

  // Pass 2: Try PSM.SINGLE_BLOCK and/or alternate strategy when Pass 1 confidence or density is low
  const needsSecondPass =
    bestScore.validWords < 22 || best.confidence < 58 || bestScore.score < 56;

  if (needsSecondPass && !input.signal?.aborted) {
    passesRun += 1;
    const pass2 = await runSerializedRecognition({
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

  // Pass 3: Alternate preprocessing strategy if still weak (e.g., Soft Sauvola vs Clean Contrast)
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
      const pass3 = await runSerializedRecognition({
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
        const rotRes = await runSerializedRecognition({
          source: toWorkerSource(rotPrep),
          psm: PSM.AUTO,
          signal: input.signal,
          timeoutMs,
        });
        const rotScore = scoreOcrCandidate(rotRes.text, rotRes.confidence);
        if (rotScore.score > bestScore.score + 12 || (rotScore.validWords >= bestScore.validWords + 5 && rotScore.score > bestScore.score + 6)) {
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

  if (best.confidence > 0 && best.confidence < 65) {
    warnings.push(
      `Low OCR confidence (${best.confidence}%). Image may be blurry, creased, or skewed.`
    );
  }
  if (bestScore.alnumChars < 15) {
    warnings.push('OCR extracted minimal readable text from this page.');
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
  };
}
