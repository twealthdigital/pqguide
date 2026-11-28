import type {
  HandwritingAnalysisResult,
  HandwritingRegion,
} from '../../core/types';
import type { OcrWordBox } from './ocrEngine';

export interface HandwritingAdapterResult {
  text: string;
  confidence: number;
  uncertainWords: string[];
  unreadable: boolean;
}

export interface HandwritingEngineAdapter {
  name: string;
  recognizeRegion(input: {
    gray: Uint8Array;
    width: number;
    height: number;
    bbox: { x: number; y: number; width: number; height: number };
  }): Promise<HandwritingAdapterResult>;
}

export interface HandwritingAnalysisInput {
  gray: Uint8Array;
  width: number;
  height: number;
  pageNumber: number;
  ocrText: string;
  ocrConfidence: number | null;
  wordBoxes?: OcrWordBox[];
  adapter?: HandwritingEngineAdapter;
  isScannedOrRaster?: boolean;
}

interface TextLineBand {
  y0: number;
  y1: number;
  x0: number;
  x1: number;
  inkRatio: number;
  strokeWidthVariance: number;
  baselineJitter: number;
  componentAspectMean: number;
  longLigatureFraction: number;
  wordCountInOcr: number;
  lowConfidenceFraction: number;
  ocrLineText: string;
  meanWordConfidence: number;
  uncertainWords: string[];
}

function estimateAdaptiveThreshold(gray: Uint8Array): number {
  let sum = 0;
  const step = Math.max(1, Math.floor(gray.length / 8000));
  let count = 0;
  for (let i = 0; i < gray.length; i += step) {
    sum += gray[i];
    count += 1;
  }
  const mean = count > 0 ? sum / count : 225;
  return Math.max(95, Math.min(205, Math.round(mean * 0.78)));
}

function analyzeLineBands(
  gray: Uint8Array,
  width: number,
  height: number,
  wordBoxes: OcrWordBox[] | undefined
): TextLineBand[] {
  if (width < 80 || height < 80 || gray.length < width * height) {
    return [];
  }

  const threshold = estimateAdaptiveThreshold(gray);
  const rowCounts = new Uint16Array(height);

  for (let y = 0; y < height; y += 1) {
    const off = y * width;
    let dark = 0;
    for (let x = 0; x < width; x += 2) {
      if (gray[off + x] < threshold) dark += 1;
    }
    rowCounts[y] = dark * 2;
  }

  // Group active horizontal bands
  const minActivePx = Math.max(8, Math.round(width * 0.015));
  const rawBands: Array<{ y0: number; y1: number }> = [];
  let inBand = false;
  let bandStart = 0;

  for (let y = 0; y < height; y += 1) {
    if (rowCounts[y] >= minActivePx && !inBand) {
      inBand = true;
      bandStart = y;
    } else if ((rowCounts[y] < minActivePx || y === height - 1) && inBand) {
      inBand = false;
      const bandEnd = y;
      const bandH = bandEnd - bandStart + 1;
      if (bandH >= 10 && bandH <= Math.round(height * 0.14)) {
        rawBands.push({ y0: bandStart, y1: bandEnd });
      }
    }
  }

  // Merge adjacent bands separated by tiny diacritic/descender gap
  const mergedBands: Array<{ y0: number; y1: number }> = [];
  for (const band of rawBands) {
    const prev = mergedBands[mergedBands.length - 1];
    if (prev && band.y0 - prev.y1 <= 4) {
      prev.y1 = band.y1;
    } else {
      mergedBands.push({ ...band });
    }
  }

  const results: TextLineBand[] = [];

  for (const band of mergedBands) {
    const bh = band.y1 - band.y0 + 1;
    let minX = width;
    let maxX = 0;
    let darkTotal = 0;

    // Column run analysis for connected stroke segments & baseline jitter
    const colActive = new Uint8Array(width);
    const colBottom = new Int16Array(width).fill(-1);
    const runLengths: number[] = [];

    for (let x = 0; x < width; x += 1) {
      let colRun = 0;
      let colDark = 0;
      for (let y = band.y0; y <= band.y1; y += 1) {
        const isDark = gray[y * width + x] < threshold;
        if (isDark) {
          colDark += 1;
          colRun += 1;
          colBottom[x] = y;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        } else if (colRun > 0) {
          runLengths.push(colRun);
          colRun = 0;
        }
      }
      if (colRun > 0) runLengths.push(colRun);
      if (colDark > 0) {
        colActive[x] = 1;
        darkTotal += colDark;
      }
    }

    const bw = maxX - minX + 1;
    if (bw < 35 || darkTotal < 40) continue;

    // Measure horizontal glyph runs inside this band
    const glyphWidths: number[] = [];
    let currentRun = 0;
    for (let x = minX; x <= maxX; x += 1) {
      if (colActive[x]) {
        currentRun += 1;
      } else if (currentRun > 0) {
        glyphWidths.push(currentRun);
        currentRun = 0;
      }
    }
    if (currentRun > 0) glyphWidths.push(currentRun);

    const longLigatures = glyphWidths.filter((w) => w > bh * 1.45).length;
    const longLigatureFraction =
      glyphWidths.length > 0 ? longLigatures / glyphWidths.length : 0;

    const componentAspectMean =
      glyphWidths.length > 0
        ? glyphWidths.reduce((a, b) => a + b, 0) / (glyphWidths.length * Math.max(1, bh))
        : 0;

    // Stroke run length coefficient of variation
    const meanRun =
      runLengths.length > 0
        ? runLengths.reduce((a, b) => a + b, 0) / runLengths.length
        : 1;
    const varRun =
      runLengths.length > 0
        ? runLengths.reduce((acc, r) => acc + Math.pow(r - meanRun, 2), 0) /
          runLengths.length
        : 0;
    const strokeWidthVariance = meanRun > 0 ? Math.sqrt(varRun) / meanRun : 0;

    // Baseline jitter across active columns
    const bottoms: number[] = [];
    for (let x = minX; x <= maxX; x += 2) {
      if (colBottom[x] >= 0) bottoms.push(colBottom[x]);
    }
    const meanBottom =
      bottoms.length > 0
        ? bottoms.reduce((a, b) => a + b, 0) / bottoms.length
        : band.y1;
    const jitter =
      bottoms.length > 0
        ? Math.sqrt(
            bottoms.reduce((acc, v) => acc + Math.pow(v - meanBottom, 2), 0) /
              bottoms.length
          ) / Math.max(1, bh)
        : 0;

    // Match overlapping OCR words
    const lineWords = (wordBoxes ?? []).filter((wb) => {
      const cy = (wb.y0 + wb.y1) / 2;
      return cy >= band.y0 - 4 && cy <= band.y1 + 4;
    });

    const wordCountInOcr = lineWords.length;
    const lowConfWords = lineWords.filter((w) => w.confidence < 62);
    const lowConfidenceFraction =
      wordCountInOcr > 0 ? lowConfWords.length / wordCountInOcr : 0;
    const meanWordConfidence =
      wordCountInOcr > 0
        ? lineWords.reduce((a, w) => a + w.confidence, 0) / wordCountInOcr
        : 0;

    results.push({
      y0: band.y0,
      y1: band.y1,
      x0: minX,
      x1: maxX,
      inkRatio: darkTotal / (bw * bh),
      strokeWidthVariance,
      baselineJitter: jitter,
      componentAspectMean,
      longLigatureFraction,
      wordCountInOcr,
      lowConfidenceFraction,
      ocrLineText: lineWords.map((w) => w.text).join(' ').trim(),
      meanWordConfidence,
      uncertainWords: lowConfWords.map((w) => w.text),
    });
  }

  return results;
}

export async function analyzeHandwritingRegions(
  input: HandwritingAnalysisInput
): Promise<HandwritingAnalysisResult> {
  const {
    gray,
    width,
    height,
    pageNumber,
    ocrText,
    wordBoxes,
    adapter,
    isScannedOrRaster = true,
  } = input;

  // Digital text documents without raster ink don't contain handwriting strokes
  if (!isScannedOrRaster || gray.length === 0) {
    return {
      detected: false,
      engineUsed: 'none',
      engineStatus: 'skipped_not_applicable',
      regions: [],
      uncertainCount: 0,
      unreadableCount: 0,
    };
  }

  const configuredExternalDir =
    typeof process !== 'undefined' && process.env
      ? process.env.HTR_MODEL_DIR
      : undefined;

  const bands = analyzeLineBands(gray, width, height, wordBoxes);
  const regions: HandwritingRegion[] = [];

  for (let i = 0; i < bands.length; i += 1) {
    const b = bands[i];

    // Handwriting heuristic: cursive ligatures + variable stroke width + baseline wobble + low printed OCR confidence
    const hasCursiveLigatures = b.longLigatureFraction >= 0.22;
    const hasIrregularBaseline = b.baselineJitter >= 0.23;
    const hasOrganicStrokeVar = b.strokeWidthVariance >= 0.72;
    const ocrStruggled =
      b.wordCountInOcr === 0 ||
      b.lowConfidenceFraction >= 0.45 ||
      (b.wordCountInOcr > 0 && b.meanWordConfidence < 64);

    const handwritingScore =
      (hasCursiveLigatures ? 0.34 : 0) +
      (hasIrregularBaseline ? 0.26 : 0) +
      (hasOrganicStrokeVar ? 0.2 : 0) +
      (ocrStruggled ? 0.25 : 0);

    // Exclude solid horizontal rules or sparse noise
    if (b.inkRatio > 0.65 || b.inkRatio < 0.03) continue;
    if (handwritingScore < 0.56) continue;

    const classification: HandwritingRegion['classification'] =
      handwritingScore >= 0.78
        ? 'handwritten'
        : b.wordCountInOcr > 0 && b.lowConfidenceFraction < 0.7
        ? 'mixed'
        : 'uncertain_stroke';

    const bbox = {
      x: b.x0,
      y: b.y0,
      width: b.x1 - b.x0 + 1,
      height: b.y1 - b.y0 + 1,
    };

    if (adapter) {
      const adapterResult = await adapter.recognizeRegion({
        gray,
        width,
        height,
        bbox,
      });
      regions.push({
        id: `p${pageNumber}-htr-${i + 1}`,
        pageNumber,
        bbox,
        classification,
        extractedText: adapterResult.unreadable
          ? '[unreadable handwriting]'
          : adapterResult.text || '[unreadable handwriting]',
        confidence: adapterResult.confidence,
        uncertainWords: adapterResult.uncertainWords,
        unreadable: adapterResult.unreadable || !adapterResult.text.trim(),
        note: `Processed via external HTR adapter (${adapter.name}).`,
      });
      continue;
    }

    // Without a dedicated local HTR neural model (e.g., TrOCR / CRNN), never fabricate cursive text.
    const cleanAssistWords = (wordBoxes ?? [])
      .filter((w) => {
        const cy = (w.y0 + w.y1) / 2;
        return cy >= b.y0 - 4 && cy <= b.y1 + 4 && w.confidence >= 62;
      })
      .map((w) => w.text);

    const unreadable = cleanAssistWords.length === 0 || b.meanWordConfidence < 48;
    const assistText = unreadable
      ? '[unreadable handwriting]'
      : `${cleanAssistWords.join(' ')}${b.uncertainWords.length > 0 ? ' [uncertain handwriting]' : ''}`;

    regions.push({
      id: `p${pageNumber}-htr-${i + 1}`,
      pageNumber,
      bbox,
      classification,
      extractedText: assistText,
      confidence:
        b.wordCountInOcr > 0
          ? Number(Math.max(0, Math.min(1, b.meanWordConfidence / 100)).toFixed(2))
          : null,
      uncertainWords: b.uncertainWords,
      unreadable,
      note:
        'Printed-assist OCR is unreliable for cursive handwriting; dedicated local HTR weights are required for high-accuracy cursive transcription.',
    });
  }

  // Also check explicit handwritten cue lines from OCR when stroke bands merged into large blocks
  if (
    regions.length === 0 &&
    /\b(handwritten|lecture\s+notes|written\s+solution)\b/i.test(ocrText) &&
    bands.some((b) => b.baselineJitter >= 0.24 && b.meanWordConfidence < 68)
  ) {
    const cand = bands.find((b) => b.baselineJitter >= 0.24 && b.meanWordConfidence < 68);
    if (cand) {
      regions.push({
        id: `p${pageNumber}-htr-fallback`,
        pageNumber,
        bbox: {
          x: cand.x0,
          y: cand.y0,
          width: cand.x1 - cand.x0 + 1,
          height: cand.y1 - cand.y0 + 1,
        },
        classification: 'uncertain_stroke',
        extractedText: '[unreadable handwriting]',
        confidence: cand.wordCountInOcr > 0 ? Number((cand.meanWordConfidence / 100).toFixed(2)) : null,
        uncertainWords: cand.uncertainWords,
        unreadable: true,
        note: 'Suspected handwritten strokes flagged for manual verification.',
      });
    }
  }

  const detected = regions.length > 0;
  const uncertainCount = regions.filter((r) => r.uncertainWords.length > 0 || r.classification !== 'handwritten').length;
  const unreadableCount = regions.filter((r) => r.unreadable).length;

  return {
    detected,
    engineUsed: adapter
      ? 'external_htr_adapter'
      : detected
      ? 'morphological_detector_plus_tesseract_assist'
      : 'none',
    engineStatus: !detected
      ? 'skipped_not_applicable'
      : adapter
      ? 'executed'
      : 'model_unavailable_partial',
    missingModelNote:
      detected && !adapter
        ? configuredExternalDir
          ? `HTR_MODEL_DIR (${configuredExternalDir}) is set, but no active runtime HTR adapter was attached; ordinary Tesseract cannot reliably read cursive handwriting.`
          : 'Dedicated local handwriting neural model (e.g., TrOCR / HTR_MODEL_DIR) is not bundled. Morphological handwritten stroke regions and low-confidence marks are flagged honestly without guessing unreadable text.'
        : undefined,
    regions,
    uncertainCount,
    unreadableCount,
  };
}
