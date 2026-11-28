import type {
  OmrBubbleCell,
  OmrQuestionResult,
  OmrScanResult,
  OmrTemplateConfig,
} from '../../core/types';

export const DEFAULT_OMR_TEMPLATES: OmrTemplateConfig[] = [
  {
    templateId: 'auto_detect',
    name: 'Auto-Detect 4/5-Option Academic OMR',
    options: ['A', 'B', 'C', 'D', 'E'],
  },
  {
    templateId: 'standard_4opt_abcd',
    name: 'Standard 4-Option Sheet (A–D)',
    options: ['A', 'B', 'C', 'D'],
  },
  {
    templateId: 'standard_5opt_abcde',
    name: 'Standard 5-Option Sheet (A–E)',
    options: ['A', 'B', 'C', 'D', 'E'],
  },
];

export interface OmrScanInput {
  gray: Uint8Array;
  width: number;
  height: number;
  pageNumber: number;
  ocrText?: string;
  template?: OmrTemplateConfig;
}

interface CandidateBubble {
  cx: number;
  cy: number;
  x: number;
  y: number;
  w: number;
  h: number;
  fillRatio: number;
  perimeterRatio: number;
}

function estimateLocalThreshold(gray: Uint8Array): number {
  let sum = 0;
  const step = Math.max(1, Math.floor(gray.length / 8000));
  let count = 0;
  for (let i = 0; i < gray.length; i += step) {
    sum += gray[i];
    count += 1;
  }
  const mean = count > 0 ? sum / count : 220;
  return Math.max(95, Math.min(200, Math.round(mean * 0.78)));
}

function extractCandidateBubbles(
  gray: Uint8Array,
  width: number,
  height: number
): CandidateBubble[] {
  if (width < 120 || height < 120 || gray.length < width * height) {
    return [];
  }

  const threshold = estimateLocalThreshold(gray);
  const visited = new Uint8Array(width * height);
  const minBubbleDim = Math.max(7, Math.round(width * 0.008));
  const maxBubbleDim = Math.max(22, Math.round(width * 0.07));

  const candidates: CandidateBubble[] = [];
  // The flood fill aborts once its bounding box exceeds maxBubbleDim * 1.4, so a connected
  // component can never hold more pixels than that box. Size the queue from that bound so a
  // large filled bubble on a high-resolution scan is never discarded by a fixed-size queue.
  const maxComponentSpan = Math.ceil(maxBubbleDim * 1.4) + 4;
  const queueCapacity = maxComponentSpan * maxComponentSpan + 64;
  const queueX = new Int32Array(queueCapacity);
  const queueY = new Int32Array(queueCapacity);

  for (let y = 4; y < height - 4; y += 2) {
    const rowOff = y * width;
    for (let x = 4; x < width - 4; x += 2) {
      const idx = rowOff + x;
      if (visited[idx] || gray[idx] >= threshold) continue;

      let head = 0;
      let tail = 0;
      queueX[tail] = x;
      queueY[tail] = y;
      tail += 1;
      visited[idx] = 1;

      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let darkPixels = 0;
      let aborted = false;

      while (head < tail) {
        const px = queueX[head];
        const py = queueY[head];
        head += 1;
        darkPixels += 1;

        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;

        if (
          maxX - minX > maxBubbleDim * 1.4 ||
          maxY - minY > maxBubbleDim * 1.4 ||
          tail >= queueX.length - 8
        ) {
          aborted = true;
          break;
        }

        const neighbors: Array<[number, number]> = [
          [px - 1, py],
          [px + 1, py],
          [px, py - 1],
          [px, py + 1],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx <= 0 || nx >= width - 1 || ny <= 0 || ny >= height - 1) continue;
          const nIdx = ny * width + nx;
          if (!visited[nIdx] && gray[nIdx] < threshold) {
            visited[nIdx] = 1;
            queueX[tail] = nx;
            queueY[tail] = ny;
            tail += 1;
          }
        }
      }

      if (aborted) continue;

      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      if (
        bw < minBubbleDim ||
        bh < minBubbleDim ||
        bw > maxBubbleDim ||
        bh > maxBubbleDim
      ) {
        continue;
      }

      const aspect = bw / bh;
      if (aspect < 0.65 || aspect > 1.55) continue;

      // Measure interior fill ratio inside the central 64% ellipse/circle of the bbox
      const cx = minX + bw / 2;
      const cy = minY + bh / 2;
      const rx = Math.max(2, bw * 0.36);
      const ry = Math.max(2, bh * 0.36);
      let interiorSamples = 0;
      let interiorDark = 0;
      let borderSamples = 0;
      let borderDark = 0;

      for (let yy = minY; yy <= maxY; yy += 1) {
        for (let xx = minX; xx <= maxX; xx += 1) {
          const normDistSq =
            Math.pow((xx + 0.5 - cx) / (bw / 2), 2) +
            Math.pow((yy + 0.5 - cy) / (bh / 2), 2);
          const isDark = gray[yy * width + xx] < threshold;
          if (Math.pow((xx + 0.5 - cx) / rx, 2) + Math.pow((yy + 0.5 - cy) / ry, 2) <= 1) {
            interiorSamples += 1;
            if (isDark) interiorDark += 1;
          } else if (normDistSq >= 0.52 && normDistSq <= 1.25) {
            borderSamples += 1;
            if (isDark) borderDark += 1;
          }
        }
      }

      const fillRatio = interiorSamples > 0 ? interiorDark / interiorSamples : 0;
      const perimeterRatio = borderSamples > 0 ? borderDark / borderSamples : 0;

      // Require either a clear ring perimeter (empty or filled bubble) or solid filled disc
      const boxCoverage = darkPixels / (bw * bh);
      if (perimeterRatio < 0.22 && fillRatio < 0.45) continue;
      if (boxCoverage < 0.14) continue;

      candidates.push({
        cx,
        cy,
        x: minX,
        y: minY,
        w: bw,
        h: bh,
        fillRatio: Number(fillRatio.toFixed(3)),
        perimeterRatio: Number(perimeterRatio.toFixed(3)),
      });
    }
  }

  return suppressEnclosedGlyphs(candidates);
}

/**
 * Printed option letters ("A", "B" ...) sit inside the bubble ring and are detected as their own
 * small components at the same centre. A letter can look darker than an empty ring, so it must never
 * compete with (or replace) the bubble that encloses it.
 */
function suppressEnclosedGlyphs(candidates: CandidateBubble[]): CandidateBubble[] {
  return candidates.filter(
    (inner, i) =>
      !candidates.some(
        (outer, j) =>
          j !== i &&
          outer.w >= inner.w * 1.3 &&
          outer.h >= inner.h * 1.3 &&
          inner.cx > outer.x &&
          inner.cx < outer.x + outer.w &&
          inner.cy > outer.y &&
          inner.cy < outer.y + outer.h
      )
  );
}

/**
 * Splits candidates into groups of similar size. Answer bubbles share one printed size, while
 * question numbers, stray glyphs and noise do not, so grouping by size keeps a stray "12." beside a
 * row from breaking that row. Each group is analysed independently, so a page full of body text can
 * never outvote the bubble grid.
 */
function clusterBySize(candidates: CandidateBubble[]): CandidateBubble[][] {
  const dimOf = (b: CandidateBubble) => (b.w + b.h) / 2;
  const tolerance = 0.12;
  let remaining = [...candidates].sort((a, b) => dimOf(a) - dimOf(b));
  const clusters: CandidateBubble[][] = [];

  // Peak picking: repeatedly take the densest tight size window. Bubbles printed at one size sit
  // inside a narrow window, while glyphs of body text are spread over many sizes.
  while (remaining.length >= 4 && clusters.length < 8) {
    let bestStart = 0;
    let bestEnd = 0;
    let lo = 0;
    for (let hi = 0; hi < remaining.length; hi += 1) {
      const centre = dimOf(remaining[hi]);
      while (dimOf(remaining[lo]) < centre * (1 - tolerance) - 1) lo += 1;
      // Count members within +/- tolerance of this size (window may extend above centre)
      let end = hi;
      while (
        end + 1 < remaining.length &&
        dimOf(remaining[end + 1]) <= centre * (1 + tolerance) + 1
      ) {
        end += 1;
      }
      if (end - lo > bestEnd - bestStart) {
        bestStart = lo;
        bestEnd = end;
      }
    }
    const members = remaining.slice(bestStart, bestEnd + 1);
    if (members.length < 4) break;
    clusters.push(members);
    remaining = [...remaining.slice(0, bestStart), ...remaining.slice(bestEnd + 1)];
  }
  return clusters;
}

function groupIntoBubbleRows(
  bubbles: CandidateBubble[]
): CandidateBubble[][] {
  if (bubbles.length < 4) return [];

  const medianH =
    [...bubbles].sort((a, b) => a.h - b.h)[Math.floor(bubbles.length / 2)]?.h ||
    14;
  const yTol = Math.max(5, Math.round(medianH * 0.55));
  const sorted = [...bubbles].sort((a, b) => a.cy - b.cy || a.cx - b.cx);

  const rawRows: CandidateBubble[][] = [];
  for (const b of sorted) {
    const existing = rawRows.find(
      (r) => Math.abs(r[0].cy - b.cy) <= yTol
    );
    if (existing) {
      existing.push(b);
    } else {
      rawRows.push([b]);
    }
  }

  // Split multi-column blocks on the same Y row if horizontal spacing has a wide jump
  const logicalRows: CandidateBubble[][] = [];
  for (const row of rawRows) {
    row.sort((a, b) => a.cx - b.cx);
    // Deduplicate overlapping detections
    const deduped: CandidateBubble[] = [];
    for (const item of row) {
      const prev = deduped[deduped.length - 1];
      if (prev && Math.abs(prev.cx - item.cx) < Math.max(prev.w, item.w) * 0.65) {
        if (item.fillRatio > prev.fillRatio) {
          deduped[deduped.length - 1] = item;
        }
      } else {
        deduped.push(item);
      }
    }

    if (deduped.length < 4) continue;

    // Break into sub-rows if horizontal gap > 3.2x median step
    const gaps: number[] = [];
    for (let i = 1; i < deduped.length; i += 1) {
      gaps.push(deduped[i].cx - deduped[i - 1].cx);
    }
    const sortedGaps = [...gaps].sort((a, b) => a - b);
    const baseGap = sortedGaps[Math.floor(sortedGaps.length * 0.35)] || medianH * 2;

    let chunk: CandidateBubble[] = [deduped[0]];
    for (let i = 1; i < deduped.length; i += 1) {
      const gap = deduped[i].cx - deduped[i - 1].cx;
      if (gap > Math.max(baseGap * 2.4, medianH * 4.5)) {
        if (chunk.length >= 4 && chunk.length <= 6) {
          logicalRows.push(chunk);
        }
        chunk = [deduped[i]];
      } else {
        chunk.push(deduped[i]);
      }
    }
    if (chunk.length >= 4 && chunk.length <= 6) {
      logicalRows.push(chunk);
    }
  }

  // Filter out isolated false positives by ensuring row sizes & horizontal spacing regularity
  return logicalRows.filter((row) => {
    if (row.length < 4 || row.length > 5) return false;
    const steps: number[] = [];
    for (let i = 1; i < row.length; i += 1) {
      steps.push(row[i].cx - row[i - 1].cx);
    }
    const avgStep = steps.reduce((a, b) => a + b, 0) / steps.length;
    if (avgStep <= 4) return false;
    return steps.every((s) => Math.abs(s - avgStep) <= avgStep * 0.45);
  });
}

function detectStudentIdGrid(
  bubbles: CandidateBubble[],
  expectedDigits?: number
): OmrScanResult['studentIdDigits'] {
  if (bubbles.length < 20) return undefined;

  const medianW =
    [...bubbles].sort((a, b) => a.w - b.w)[Math.floor(bubbles.length / 2)]?.w ||
    14;
  const xTol = Math.max(5, Math.round(medianW * 0.55));
  const sortedByX = [...bubbles].sort((a, b) => a.cx - b.cx || a.cy - b.cy);

  const columns: CandidateBubble[][] = [];
  for (const b of sortedByX) {
    const col = columns.find((c) => Math.abs(c[0].cx - b.cx) <= xTol);
    if (col) col.push(b);
    else columns.push([b]);
  }

  // A digit column typically has exactly 10 vertically aligned bubbles (0..9)
  const digitCols = columns
    .map((c) => c.sort((a, b) => a.cy - b.cy))
    .filter((c) => c.length === 10);

  if (digitCols.length < 4) return undefined;
  const targetCols =
    expectedDigits && digitCols.length >= expectedDigits
      ? digitCols.slice(0, expectedDigits)
      : digitCols;

  return targetCols.map((col, idx) => {
    const filledIndices: number[] = [];
    const ambiguousIndices: number[] = [];
    col.forEach((cell, dIdx) => {
      if (cell.fillRatio >= 0.45) filledIndices.push(dIdx);
      else if (cell.fillRatio >= 0.25) ambiguousIndices.push(dIdx);
    });

    if (filledIndices.length === 1 && ambiguousIndices.length === 0) {
      return {
        column: idx + 1,
        digit: String(filledIndices[0]),
        status: 'detected',
        confidence: Number(Math.min(0.98, 0.7 + col[filledIndices[0]].fillRatio * 0.3).toFixed(2)),
      };
    }
    if (filledIndices.length === 0 && ambiguousIndices.length === 0) {
      return { column: idx + 1, digit: null, status: 'blank', confidence: 0.85 };
    }
    return {
      column: idx + 1,
      digit: filledIndices.length === 1 ? String(filledIndices[0]) : null,
      status: 'ambiguous',
      confidence: 0.45,
    };
  });
}

export function scanOmrSheet(input: OmrScanInput): OmrScanResult {
  const { gray, width, height, pageNumber, ocrText, template } = input;
  const activeTemplate = template ?? DEFAULT_OMR_TEMPLATES[0];
  const candidates = extractCandidateBubbles(gray, width, height);
  const sizeClusters = clusterBySize(candidates);
  const rows = sizeClusters.flatMap((cluster) => groupIntoBubbleRows(cluster));

  // Order multi-column answer blocks left-to-right (column major by X cluster) then top-to-bottom
  const sortedRows = [...rows].sort((a, b) => {
    const colBucketA = Math.round(a[0].cx / Math.max(80, width * 0.28));
    const colBucketB = Math.round(b[0].cx / Math.max(80, width * 0.28));
    if (colBucketA !== colBucketB) return colBucketA - colBucketB;
    return a[0].cy - b[0].cy;
  });

  const questions: OmrQuestionResult[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < sortedRows.length; i += 1) {
    const row = sortedRows[i];
    const optionLetters =
      activeTemplate.templateId === 'auto_detect'
        ? ['A', 'B', 'C', 'D', 'E'].slice(0, row.length)
        : activeTemplate.options.slice(0, row.length);

    if (row.length !== optionLetters.length) continue;

    // Printed option letters inside the bubbles add a constant amount of ink to every cell of a
    // row. Measure shading as the ink above that row's printed baseline so an empty "B" bubble is
    // not mistaken for a pencil mark. The baseline is capped so a row where every bubble is shaded
    // is still reported as shaded.
    const printedInkBaseline = Math.min(
      0.35,
      Math.min(...row.map((b) => b.fillRatio))
    );
    const shadingOf = (fillRatio: number) =>
      Number(
        Math.max(0, (fillRatio - printedInkBaseline) / (1 - printedInkBaseline)).toFixed(3)
      );

    const bubbles: OmrBubbleCell[] = row.map((b, idx) => {
      const shading = shadingOf(b.fillRatio);
      return {
        option: optionLetters[idx] || String(idx + 1),
        fillRatio: shading,
        filled: shading >= 0.44,
        bbox: { x: b.x, y: b.y, width: b.w, height: b.h },
      };
    });

    const filled = bubbles.filter((b) => b.filled);
    const partial = bubbles.filter((b) => !b.filled && b.fillRatio >= 0.25);

    let status: OmrQuestionResult['status'] = 'unanswered';
    let confidence = 0.9;

    if (filled.length === 1 && partial.length === 0) {
      status = 'answered';
      confidence = Math.min(0.99, 0.72 + filled[0].fillRatio * 0.28);
    } else if (filled.length > 1) {
      status = 'multiple_selected';
      confidence = 0.6;
    } else if (partial.length > 0) {
      status = 'ambiguous';
      confidence = 0.42;
    } else {
      status = 'unanswered';
      const maxFill = Math.max(...bubbles.map((b) => b.fillRatio));
      confidence = maxFill < 0.16 ? 0.94 : 0.75;
    }

    questions.push({
      questionNumber: i + 1,
      pageNumber,
      selectedOptions: filled.map((f) => f.option),
      status,
      confidence: Number(confidence.toFixed(2)),
      bubbles,
    });
  }

  // Bubbles already read as answer rows must not be re-read as digit columns: a block of ten
  // questions has ten bubbles in every option column, which would otherwise be reported as a
  // student ID.
  const answerRowBubbles = new Set(rows.flat());
  let studentIdDigits: OmrScanResult['studentIdDigits'];
  for (const cluster of sizeClusters) {
    studentIdDigits = detectStudentIdGrid(
      cluster.filter((b) => !answerRowBubbles.has(b)),
      activeTemplate.studentIdDigits
    );
    if (studentIdDigits) break;
  }
  const studentIdDetected = Boolean(studentIdDigits && studentIdDigits.length >= 4);
  const studentIdValue = studentIdDetected
    ? studentIdDigits!.map((d) => d.digit ?? '?').join('')
    : undefined;

  const answered = questions.filter((q) => q.status === 'answered').length;
  const unanswered = questions.filter((q) => q.status === 'unanswered').length;
  const multipleSelected = questions.filter(
    (q) => q.status === 'multiple_selected'
  ).length;
  const ambiguous = questions.filter((q) => q.status === 'ambiguous').length;

  const hasOmrCuesInText =
    typeof ocrText === 'string' &&
    /\b(omr|shade\s+(?:the|one|correctly)|answer\s+sheet|student\s+id\s+grid|multiple\s+choice)\b/i.test(
      ocrText
    );

  const detected = questions.length >= 2 || studentIdDetected;

  if (detected) {
    if (multipleSelected > 0) {
      warnings.push(
        `Page ${pageNumber}: ${multipleSelected} OMR question(s) have multiple shaded bubbles.`
      );
    }
    if (ambiguous > 0) {
      warnings.push(
        `Page ${pageNumber}: ${ambiguous} OMR question(s) have partial/ambiguous shading or erasure marks.`
      );
    }
    if (
      studentIdDigits &&
      studentIdDigits.some((d) => d.status === 'ambiguous')
    ) {
      warnings.push(
        `Page ${pageNumber}: Student ID bubble grid contains ambiguous column marks.`
      );
    }
  } else if (hasOmrCuesInText) {
    warnings.push(
      `Page ${pageNumber}: Text suggests an OMR answer sheet, but clear bubble grids could not be isolated cleanly.`
    );
  }

  return {
    detected,
    pageNumbers: detected ? [pageNumber] : [],
    templateUsed: activeTemplate.name,
    studentIdGridDetected: studentIdDetected,
    studentIdDigits,
    studentIdValue,
    questions,
    summary: {
      totalQuestions: questions.length,
      answered,
      unanswered,
      multipleSelected,
      ambiguous,
    },
    needsAdminReview: detected,
    warnings,
  };
}
