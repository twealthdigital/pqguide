import { sanitizePlainText, sanitizeSingleLine } from '../../core/security';
import type {
  ExtractedDiagramAsset,
  ExtractedFormula,
  ExtractedPageContent,
  ExtractedTable,
  ReconstructedBlock,
  UncertainSpan,
} from '../../core/types';
import { enrichExtractedTable } from './advancedTableExtractor';
import { convertRawEquationToLatex, injectInlineLatexIntoText } from './mathFormulaEngine';
import type { OcrLineBox, OcrWordBox } from './ocrEngine';
import { extractTablesFromText } from './structuredParser';

export interface PdfPlacedTokenInput {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ReconstructPageBlocksInput {
  pageNumber: number;
  text: string;
  tables: ExtractedTable[];
  formulas: ExtractedFormula[];
  diagrams: ExtractedDiagramAsset[];
  lineBoxes?: OcrLineBox[];
  wordBoxes?: OcrWordBox[];
  pdfPlacedTokens?: PdfPlacedTokenInput[];
  pdfPageWidth?: number;
  pdfPageHeight?: number;
  pageWidth?: number;
  pageHeight?: number;
  headerLines?: string[];
  footerLines?: string[];
  uncertainSpans?: UncertainSpan[];
}

interface SpatialTextLine {
  text: string;
  topY: number;
  bottomY: number;
  x0: number;
  x1: number;
  avgH: number;
  confidence?: number;
  cells?: Array<{ text: string; x0: number; x1: number }>;
  columnBand: 'full' | 'left' | 'right';
}

function isInlineFigure(d: ExtractedDiagramAsset): boolean {
  return !d.id.startsWith('scan-sheet') && !d.id.startsWith('pdf-diag-');
}

function normalizeCmp(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function pointInsideBbox(
  cx: number,
  cy: number,
  bbox: { x: number; y: number; width: number; height: number },
  pad = 6
): boolean {
  return (
    cx >= bbox.x - pad &&
    cx <= bbox.x + bbox.width + pad &&
    cy >= bbox.y - pad &&
    cy <= bbox.y + bbox.height + pad
  );
}

function bboxOverlapRatio(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): number {
  const ix0 = Math.max(a.x, b.x);
  const iy0 = Math.max(a.y, b.y);
  const ix1 = Math.min(a.x + a.width, b.x + b.width);
  const iy1 = Math.min(a.y + a.height, b.y + b.height);
  if (ix1 <= ix0 || iy1 <= iy0) return 0;
  const inter = (ix1 - ix0) * (iy1 - iy0);
  const minArea = Math.max(1, Math.min(a.width * a.height, b.width * b.height));
  return inter / minArea;
}

function detectHeadingLevel(
  line: string,
  avgH?: number,
  medianH?: number,
  isCentered?: boolean
): 1 | 2 | 3 | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 105) return null;
  if (/^---\s*Page\s+\d+/i.test(trimmed)) return null;

  const mdMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
  if (mdMatch) {
    return mdMatch[1].length === 1 ? 1 : mdMatch[1].length === 2 ? 2 : 3;
  }

  // Question / subquestion stems are never headings
  if (
    /^((?:Q(?:uestion)?\s*)?\d+[.)])\s+/i.test(trimmed) ||
    /^(\([a-z0-9]{1,4}\)|[A-Ea-e][.)])\s+/.test(trimmed)
  ) {
    return null;
  }

  if (/^(?:UNIVERSITY|COLLEGE|POLYTECHNIC|INSTITUTE|EXAMINATION)\b/i.test(trimmed) && trimmed.length <= 85) {
    return 1;
  }
  if (/^(?:SECTION|PART|CHAPTER|MODULE|UNIT)\s+[A-Z0-9IVX]+\b/i.test(trimmed)) {
    return 2;
  }
  if (/^(?:FIRST|SECOND|THIRD)\s+SEMESTER\b/i.test(trimmed) || /^(?:FACULTY|DEPARTMENT)\s+OF\b/i.test(trimmed)) {
    return 2;
  }
  if (/^(?:INSTRUCTIONS?|NOTE|TIME ALLOWED|DATE|DURATION)\s*:/i.test(trimmed) && trimmed.length <= 95) {
    return 3;
  }

  if (avgH && medianH && medianH > 0) {
    if (avgH >= medianH * 1.32 && trimmed.length <= 85 && !/[.?!]$/.test(trimmed)) {
      return 1;
    }
    if (avgH >= medianH * 1.15 && trimmed.length <= 85 && !/[.?!]$/.test(trimmed)) {
      return 2;
    }
  }

  if (
    trimmed.length >= 4 &&
    trimmed.length <= 75 &&
    trimmed === trimmed.toUpperCase() &&
    /[A-Z]{3,}/.test(trimmed) &&
    !/[=.]$/.test(trimmed) &&
    !/\|/.test(trimmed)
  ) {
    return isCentered ? 1 : 2;
  }

  return null;
}

function isStandaloneEquationLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 140) return false;
  if (/^\$\$[\s\S]+\$\$$/.test(trimmed)) return true;
  if (/^\$[^$\n]+\$$/.test(trimmed)) return true;
  if (/^\[\[.+,.+\]\]$/.test(trimmed)) return true;
  if (
    /^(?:Q(?:uestion)?\s*\d+[.)]|\([a-z0-9]+\)|[A-Ea-e][.)])/i.test(trimmed) ||
    /^(?:table|figure|fig\.?|section|part|question)\b/i.test(trimmed)
  ) {
    return false;
  }
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length > 9) return false;
  const hasMathOp = /[=<>≤≥≠≈∑∫√∂∇]/.test(trimmed) || /\b(?:sqrt|sin|cos|tan|log|ln|lim)\s*\(/i.test(trimmed);
  if (!hasMathOp) return false;
  // Reject prose labels like "Course Code: CSC 201" or "Time: 2 hours"
  if (/^[A-Za-z\s]+:\s*/.test(trimmed)) return false;
  // Require mostly compact symbolic tokens rather than long English words
  const longAlphaWords = words.filter((w) => /^[A-Za-z]{5,}$/.test(w) && !/^(?:where|given|hence|prove|solve|sqrt|limit|theta|alpha|gamma|delta|omega)$/i.test(w));
  return longAlphaWords.length <= 2;
}

function matchExistingTable(
  candidateHeaders: string[],
  candidateRowCount: number,
  pool: ExtractedTable[],
  usedIds: Set<string>
): ExtractedTable | undefined {
  const normCandidate = candidateHeaders.map(normalizeCmp).join('|');
  for (const tbl of pool) {
    if (usedIds.has(tbl.id)) continue;
    const normTbl = tbl.headers.map(normalizeCmp).join('|');
    if (normTbl === normCandidate && Math.abs(tbl.rows.length - candidateRowCount) <= 1) {
      usedIds.add(tbl.id);
      return tbl;
    }
  }
  return undefined;
}

function parsePipeOrTabRow(rawLine: string): { kind: 'pipe' | 'tab' | null; cells: string[] } {
  const trimmed = rawLine.trim();
  if (!trimmed) return { kind: null, cells: [] };
  if (/^[+|┌┐└┘├┤┬┴┼─═\-_=.\s]+$/.test(trimmed) && /[-─═_|+]/.test(trimmed)) {
    return { kind: null, cells: [] };
  }
  const normalizedPipes = trimmed.replace(/[│┃]/g, '|');
  if (normalizedPipes.includes('|')) {
    const rawCells = normalizedPipes
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
    if (
      (normalizedPipes.startsWith('|') && normalizedPipes.includes('|', 1) && rawCells.length >= 2) ||
      rawCells.length >= 3
    ) {
      return { kind: 'pipe', cells: rawCells };
    }
  }
  if (trimmed.includes('\t')) {
    const tabCells = trimmed.split('\t').map((c) => c.trim());
    if (tabCells.length >= 2) {
      return { kind: 'tab', cells: tabCells };
    }
  }
  return { kind: null, cells: [] };
}

function isDividerCells(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.trim()));
}

function buildLinesFromPdfTokens(
  tokens: PdfPlacedTokenInput[],
  pageWidth: number,
  pageHeight: number
): { lines: SpatialTextLine[]; isTwoColumn: boolean } {
  if (tokens.length === 0) return { lines: [], isTwoColumn: false };

  const midX = pageWidth * 0.5;
  const gutterHalf = Math.max(12, pageWidth * 0.035);
  const leftTokensOnly: PdfPlacedTokenInput[] = [];
  const rightTokensOnly: PdfPlacedTokenInput[] = [];
  const crossingTokens: PdfPlacedTokenInput[] = [];
  let leftWords = 0;
  let rightWords = 0;
  let leftQuestionOrProse = 0;
  let rightQuestionOrProse = 0;
  const qPrefixRe = /^((?:Q(?:uestion)?\s*)?\d+[.)]|\([a-z0-9]{1,3}\))\s+[A-Za-z]/i;

  for (const t of tokens) {
    const endX = t.x + t.w;
    const words = t.str.trim().split(/\s+/).filter(Boolean).length;
    if (endX <= midX - gutterHalf) {
      leftTokensOnly.push(t);
      leftWords += words;
      if (words >= 4 || qPrefixRe.test(t.str.trim())) leftQuestionOrProse += 1;
    } else if (t.x >= midX + gutterHalf) {
      rightTokensOnly.push(t);
      rightWords += words;
      if (words >= 4 || qPrefixRe.test(t.str.trim())) rightQuestionOrProse += 1;
    } else if (t.w > gutterHalf * 2.5) {
      crossingTokens.push(t);
    }
  }

  const leftOnly = leftTokensOnly.length;
  const rightOnly = rightTokensOnly.length;
  const colYMax = Math.min(
    leftOnly > 0 ? Math.max(...leftTokensOnly.map((t) => t.y + t.h)) : -Infinity,
    rightOnly > 0 ? Math.max(...rightTokensOnly.map((t) => t.y + t.h)) : -Infinity
  );
  const colYMin = Math.max(
    leftOnly > 0 ? Math.min(...leftTokensOnly.map((t) => t.y)) : Infinity,
    rightOnly > 0 ? Math.min(...rightTokensOnly.map((t) => t.y)) : Infinity
  );
  const innerCrossingMid =
    leftOnly > 0 && rightOnly > 0
      ? crossingTokens.filter((t) => t.y <= colYMax + 6 && t.y + t.h >= colYMin - 6).length
      : crossingTokens.length;

  const avgLeftW = leftWords / Math.max(1, leftOnly);
  const avgRightW = rightWords / Math.max(1, rightOnly);
  const isDenseTwoCol =
    leftOnly >= 8 &&
    rightOnly >= 8 &&
    innerCrossingMid <= Math.min(leftOnly, rightOnly) * 0.25 &&
    (avgLeftW >= 2.2 || avgRightW >= 2.2 || leftOnly + rightOnly >= 24);
  const isCompactProseTwoCol =
    leftOnly >= 2 &&
    rightOnly >= 2 &&
    colYMax >= colYMin - 12 &&
    innerCrossingMid <= Math.floor(Math.min(leftOnly, rightOnly) * 0.25) &&
    ((avgLeftW >= 3.2 && avgRightW >= 3.2) ||
      (leftQuestionOrProse >= 2 && rightQuestionOrProse >= 2));

  const isTwoColumn = isDenseTwoCol || isCompactProseTwoCol;

  const assembleStream = (
    streamTokens: PdfPlacedTokenInput[],
    columnBand: 'full' | 'left' | 'right'
  ): SpatialTextLine[] => {
    if (streamTokens.length === 0) return [];
    const sorted = streamTokens.slice().sort((a, b) => {
      if (Math.abs(a.y - b.y) > 4.2) return b.y - a.y;
      return a.x - b.x;
    });

    const rawLines: PdfPlacedTokenInput[][] = [];
    for (const tok of sorted) {
      const cur = rawLines[rawLines.length - 1];
      if (!cur || Math.abs(cur[0].y - tok.y) > 4.2) {
        rawLines.push([tok]);
      } else {
        cur.push(tok);
      }
    }

    const out: SpatialTextLine[] = [];
    for (const line of rawLines) {
      line.sort((a, b) => a.x - b.x);
      const avgH = line.reduce((s, t) => s + t.h, 0) / line.length || 10;
      const baseBottomY = pageHeight - line[0].y;
      const topY = Math.max(0, baseBottomY - avgH);
      const x0 = line[0].x;
      const x1 = Math.max(...line.map((t) => t.x + t.w));

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
        out.push({
          text: assembled.trimEnd(),
          topY,
          bottomY: baseBottomY,
          x0,
          x1,
          avgH,
          cells,
          columnBand,
        });
      }
    }
    return out;
  };

  if (!isTwoColumn) {
    return { lines: assembleStream(tokens, 'full'), isTwoColumn: false };
  }

  const fullTokens: PdfPlacedTokenInput[] = [];
  const leftTokens: PdfPlacedTokenInput[] = [];
  const rightTokens: PdfPlacedTokenInput[] = [];
  for (const t of tokens) {
    const endX = t.x + t.w;
    if (t.x < midX - gutterHalf && endX > midX + gutterHalf) {
      fullTokens.push(t);
    } else if (endX <= midX + gutterHalf * 0.5) {
      leftTokens.push(t);
    } else {
      rightTokens.push(t);
    }
  }

  const fullLines = assembleStream(fullTokens, 'full');
  const leftLines = assembleStream(leftTokens, 'left');
  const rightLines = assembleStream(rightTokens, 'right');

  const colTop = Math.min(
    ...leftLines.map((l) => l.topY),
    ...rightLines.map((l) => l.topY),
    Infinity
  );
  const colBottom = Math.max(
    ...leftLines.map((l) => l.bottomY),
    ...rightLines.map((l) => l.bottomY),
    0
  );
  const topFull = fullLines.filter((l) => l.bottomY <= colTop + 8);
  const bottomFull = fullLines.filter((l) => l.topY >= colBottom - 8);
  const midFull = fullLines.filter((l) => !topFull.includes(l) && !bottomFull.includes(l));

  return {
    lines: [...topFull, ...leftLines, ...midFull, ...rightLines, ...bottomFull],
    isTwoColumn: true,
  };
}

function buildLinesFromOcrBoxes(
  lineBoxes: OcrLineBox[],
  wordBoxes: OcrWordBox[] | undefined,
  pageWidth: number
): { lines: SpatialTextLine[]; isTwoColumn: boolean } {
  if (lineBoxes.length === 0) return { lines: [], isTwoColumn: false };

  const heights = lineBoxes.map((l) => Math.max(8, l.y1 - l.y0)).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length * 0.5)] || 16;
  const maxX = Math.max(pageWidth || 0, ...lineBoxes.map((l) => l.x1), 1);

  const midX = maxX * 0.5;
  const gutter = Math.max(14, maxX * 0.03);
  const leftRaw: OcrLineBox[] = [];
  const rightRaw: OcrLineBox[] = [];
  const fullRaw: OcrLineBox[] = [];

  for (const ln of lineBoxes) {
    if (ln.x1 <= midX + gutter * 0.5 && ln.x1 - ln.x0 < maxX * 0.56) {
      leftRaw.push(ln);
    } else if (ln.x0 >= midX - gutter * 0.5 && ln.x1 - ln.x0 < maxX * 0.56) {
      rightRaw.push(ln);
    } else {
      fullRaw.push(ln);
    }
  }

  const colMinY = Math.max(
    leftRaw.length > 0 ? Math.min(...leftRaw.map((l) => l.y0)) : Infinity,
    rightRaw.length > 0 ? Math.min(...rightRaw.map((l) => l.y0)) : Infinity
  );
  const colMaxY = Math.min(
    leftRaw.length > 0 ? Math.max(...leftRaw.map((l) => l.y1)) : -Infinity,
    rightRaw.length > 0 ? Math.max(...rightRaw.map((l) => l.y1)) : -Infinity
  );
  const innerFull =
    leftRaw.length > 0 && rightRaw.length > 0
      ? fullRaw.filter((l) => l.y1 >= colMinY - 6 && l.y0 <= colMaxY + 6).length
      : fullRaw.length;
  const avgLeftW =
    leftRaw.reduce((s, l) => s + l.text.trim().split(/\s+/).length, 0) / Math.max(1, leftRaw.length);
  const avgRightW =
    rightRaw.reduce((s, l) => s + l.text.trim().split(/\s+/).length, 0) / Math.max(1, rightRaw.length);
  const isTwoColumn =
    maxX > 300 &&
    leftRaw.length >= 2 &&
    rightRaw.length >= 2 &&
    colMaxY >= colMinY - 12 &&
    innerFull <= Math.floor(Math.min(leftRaw.length, rightRaw.length) * 0.35) &&
    ((lineBoxes.length >= 8 && (avgLeftW >= 3.8 || avgRightW >= 3.8) && leftRaw.length >= 4 && rightRaw.length >= 4) ||
      (avgLeftW >= 3.5 && avgRightW >= 3.5 && leftRaw.length + rightRaw.length >= 4));

  const toSpatialLine = (
    ln: OcrLineBox,
    columnBand: 'full' | 'left' | 'right'
  ): SpatialTextLine => {
    const midY = (ln.y0 + ln.y1) * 0.5;
    const lineWords = (wordBoxes ?? [])
      .filter((w) => {
        const wMidY = (w.y0 + w.y1) * 0.5;
        return Math.abs(wMidY - midY) <= Math.max(8, medianH * 0.6) && w.x1 >= ln.x0 - 6 && w.x0 <= ln.x1 + 6;
      })
      .sort((a, b) => a.x0 - b.x0);

    const cells: Array<{ text: string; x0: number; x1: number }> = [];
    if (lineWords.length > 0) {
      let curWords: string[] = [];
      let cx0 = lineWords[0].x0;
      let cx1 = lineWords[0].x1;
      let prevEnd = -Infinity;
      const gapThresh = Math.max(18, medianH * 1.15);
      for (const w of lineWords) {
        if (/^[|│┃┌┐└┘├┤┬┴┼+\-_=~]{1,8}$/.test(w.text.trim())) continue;
        if (curWords.length > 0 && w.x0 - prevEnd > gapThresh) {
          cells.push({ text: curWords.join(' '), x0: cx0, x1: cx1 });
          curWords = [w.text];
          cx0 = w.x0;
          cx1 = w.x1;
        } else {
          curWords.push(w.text);
          cx1 = Math.max(cx1, w.x1);
        }
        prevEnd = w.x1;
      }
      if (curWords.length > 0) {
        cells.push({ text: curWords.join(' '), x0: cx0, x1: cx1 });
      }
    }

    return {
      text: ln.text,
      topY: ln.y0,
      bottomY: ln.y1,
      x0: ln.x0,
      x1: ln.x1,
      avgH: Math.max(8, ln.y1 - ln.y0),
      confidence: ln.confidence,
      cells: cells.length > 0 ? cells : undefined,
      columnBand,
    };
  };

  if (!isTwoColumn) {
    return {
      lines: lineBoxes
        .slice()
        .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
        .map((ln) => toSpatialLine(ln, 'full')),
      isTwoColumn: false,
    };
  }

  const colTop = Math.min(
    ...leftRaw.map((l) => l.y0),
    ...rightRaw.map((l) => l.y0),
    Infinity
  );
  const colBottom = Math.max(
    ...leftRaw.map((l) => l.y1),
    ...rightRaw.map((l) => l.y1),
    0
  );
  const topFull = fullRaw.filter((l) => l.y1 <= colTop + 8).sort((a, b) => a.y0 - b.y0);
  const bottomFull = fullRaw.filter((l) => l.y0 >= colBottom - 8).sort((a, b) => a.y0 - b.y0);
  const midFull = fullRaw
    .filter((l) => !topFull.includes(l) && !bottomFull.includes(l))
    .sort((a, b) => a.y0 - b.y0);

  return {
    lines: [
      ...topFull.map((l) => toSpatialLine(l, 'full')),
      ...leftRaw.slice().sort((a, b) => a.y0 - b.y0).map((l) => toSpatialLine(l, 'left')),
      ...midFull.map((l) => toSpatialLine(l, 'full')),
      ...rightRaw.slice().sort((a, b) => a.y0 - b.y0).map((l) => toSpatialLine(l, 'right')),
      ...bottomFull.map((l) => toSpatialLine(l, 'full')),
    ],
    isTwoColumn: true,
  };
}

/**
 * Reconstructs an ordered array of ReconstructedBlock items for a single page,
 * preserving exact reading order and keeping headings, paragraphs, questions,
 * inline tables, mathematical formulas, diagrams with captions, headers/footers,
 * indentation, and alignment in place.
 */
export function reconstructPageBlocks(
  input: ReconstructPageBlocksInput
): ReconstructedBlock[] {
  const {
    pageNumber,
    text,
    tables,
    formulas,
    diagrams,
    lineBoxes,
    wordBoxes,
    pdfPlacedTokens,
    pdfPageWidth,
    pdfPageHeight,
    pageWidth,
    headerLines = [],
    footerLines = [],
    uncertainSpans = [],
  } = input;

  const inlineDiagrams = diagrams.filter(isInlineFigure);
  const hasPdfTokens = Boolean(pdfPlacedTokens && pdfPlacedTokens.length > 0 && pdfPageHeight);
  const hasOcrLines = Boolean(lineBoxes && lineBoxes.length > 0);

  if (!hasPdfTokens && !hasOcrLines) {
    return buildBlocksFromStructuredText({
      pageNumber,
      text,
      tables,
      formulas,
      diagrams: inlineDiagrams,
      headerLines,
      footerLines,
      uncertainSpans,
    });
  }

  const effectiveWidth =
    (hasPdfTokens ? pdfPageWidth : pageWidth) ||
    Math.max(
      ...(lineBoxes ?? []).map((l) => l.x1),
      ...(pdfPlacedTokens ?? []).map((t) => t.x + t.w),
      612
    );

  const spatialSource = hasPdfTokens
    ? buildLinesFromPdfTokens(pdfPlacedTokens!, effectiveWidth, pdfPageHeight!)
    : buildLinesFromOcrBoxes(lineBoxes!, wordBoxes, effectiveWidth);

  const spatialLines = spatialSource.lines;
  if (spatialLines.length === 0) {
    return buildBlocksFromStructuredText({
      pageNumber,
      text,
      tables,
      formulas,
      diagrams: inlineDiagrams,
      headerLines,
      footerLines,
      uncertainSpans,
    });
  }

  const heights = spatialLines.map((l) => l.avgH).sort((a, b) => a - b);
  const medianH = Math.max(8, heights[Math.floor(heights.length * 0.5)] || 12);

  // Estimate left body margin for relative indentation
  const leftMargins = spatialLines
    .filter((l) => l.columnBand !== 'right')
    .map((l) => l.x0)
    .sort((a, b) => a - b);
  const baseLeftX = leftMargins[Math.min(leftMargins.length - 1, Math.floor(leftMargins.length * 0.12))] ?? 0;

  // Identify positioned visual assets (visual tables with bbox, non-table inline diagrams with bbox, 2D stacked fractions with bbox)
  const visualTables = tables.filter((t) => Boolean(t.bbox));
  const filteredInlineDiagrams = inlineDiagrams.filter((d) => {
    if (!d.bbox) return true;
    return !visualTables.some((vt) => vt.bbox && bboxOverlapRatio(d.bbox!, vt.bbox) >= 0.4);
  });
  const positionedDiagrams = filteredInlineDiagrams.filter((d) => Boolean(d.bbox));
  const stacked2DFormulas = formulas.filter(
    (f) => f.sourceMethod === '2d_layout_ocr' && f.displayMode && Boolean(f.bbox)
  );

  // Filter out spatial lines that are already captured inside visual tables, diagram interiors/captions, or 2D stacked fractions
  const headerNorms = new Set(headerLines.map(normalizeCmp).filter(Boolean));
  const footerNorms = new Set(footerLines.map(normalizeCmp).filter(Boolean));
  const absorbedCaptionNorms = new Set(
    positionedDiagrams
      .map((d) => d.caption)
      .filter((c) => /^(?:figure|fig\.?|diagram|chart|graph|illustration)\b/i.test(c))
      .map(normalizeCmp)
  );
  const absorbedTableCaptionNorms = new Set(
    visualTables
      .map((t) => t.caption ?? '')
      .filter(Boolean)
      .map(normalizeCmp)
  );

  const filteredLines = spatialLines.filter((ln) => {
    const norm = normalizeCmp(ln.text);
    if (!norm) return false;
    if (headerNorms.has(norm) || footerNorms.has(norm)) return false;
    if (absorbedCaptionNorms.has(norm) || absorbedTableCaptionNorms.has(norm)) return false;

    const midX = (ln.x0 + ln.x1) * 0.5;
    const midY = (ln.topY + ln.bottomY) * 0.5;

    // Suppress scattered OCR lines inside visual bordered table boxes
    for (const vt of visualTables) {
      if (vt.bbox && pointInsideBbox(midX, midY, vt.bbox, 6)) {
        return false;
      }
    }

    // Suppress short interior vertex/axis labels inside diagram bboxes (keep long prose outside)
    for (const diag of positionedDiagrams) {
      if (diag.bbox && pointInsideBbox(midX, midY, diag.bbox, 4)) {
        const wordCount = ln.text.trim().split(/\s+/).length;
        if (wordCount <= 5 || (diag.extractedLabels ?? []).some((lbl) => normalizeCmp(ln.text).includes(normalizeCmp(lbl)))) {
          return false;
        }
      }
    }

    // Suppress fragmented numerator/denominator lines already reconstructed into a 2D stacked fraction block
    for (const sf of stacked2DFormulas) {
      if (sf.bbox && pointInsideBbox(midX, midY, sf.bbox, 4)) {
        return false;
      }
    }

    return true;
  });

  // Build ordered page tokens (lines + positioned tables/diagrams/2D formulas) sorted into reading stream
  type StreamEvent =
    | { kind: 'line'; topY: number; columnBand: 'full' | 'left' | 'right'; line: SpatialTextLine }
    | { kind: 'table'; topY: number; columnBand: 'full' | 'left' | 'right'; table: ExtractedTable }
    | { kind: 'diagram'; topY: number; columnBand: 'full' | 'left' | 'right'; diagram: ExtractedDiagramAsset }
    | { kind: 'formula'; topY: number; columnBand: 'full' | 'left' | 'right'; formula: ExtractedFormula };

  const resolveColumnBand = (x: number, w: number): 'full' | 'left' | 'right' => {
    if (!spatialSource.isTwoColumn) return 'full';
    const mid = effectiveWidth * 0.5;
    if (x + w <= mid + 18) return 'left';
    if (x >= mid - 18) return 'right';
    return 'full';
  };

  const events: StreamEvent[] = filteredLines.map((ln) => ({
    kind: 'line',
    topY: ln.topY,
    columnBand: ln.columnBand,
    line: ln,
  }));

  const usedTableIds = new Set<string>();
  for (const vt of visualTables) {
    if (!vt.bbox) continue;
    usedTableIds.add(vt.id);
    events.push({
      kind: 'table',
      topY: vt.bbox.y,
      columnBand: resolveColumnBand(vt.bbox.x, vt.bbox.width),
      table: vt,
    });
  }

  const placedDiagramIds = new Set<string>();
  for (const diag of positionedDiagrams) {
    if (!diag.bbox) continue;
    placedDiagramIds.add(diag.id);
    events.push({
      kind: 'diagram',
      topY: diag.bbox.y,
      columnBand: resolveColumnBand(diag.bbox.x, diag.bbox.width),
      diagram: diag,
    });
  }

  for (const sf of stacked2DFormulas) {
    if (!sf.bbox) continue;
    events.push({
      kind: 'formula',
      topY: sf.bbox.y,
      columnBand: resolveColumnBand(sf.bbox.x, sf.bbox.width),
      formula: sf,
    });
  }

  // Sort events respecting 2-column segmentation (topFull -> leftCol -> rightCol -> bottomFull) or single-column Y order
  if (spatialSource.isTwoColumn) {
    const colTop = Math.min(
      ...events.filter((e) => e.columnBand !== 'full').map((e) => e.topY),
      Infinity
    );
    const bandRank = (ev: StreamEvent): number => {
      if (ev.columnBand === 'full') return ev.topY <= colTop + 8 ? 0 : 3;
      if (ev.columnBand === 'left') return 1;
      return 2;
    };
    events.sort((a, b) => bandRank(a) - bandRank(b) || a.topY - b.topY);
  } else {
    events.sort((a, b) => a.topY - b.topY);
  }

  const blocks: ReconstructedBlock[] = [];
  let seq = 1;
  const nextId = (prefix: string) => `p${pageNumber}-${prefix}-${seq++}`;

  // Running headers at top of page
  for (const h of headerLines) {
    const clean = sanitizeSingleLine(h, 140);
    if (clean) {
      blocks.push({
        id: nextId('hdr'),
        kind: 'header',
        pageNumber,
        text: clean,
        alignment: 'center',
      });
    }
  }

  const isEligibleInlineTableCandidate = (ln: SpatialTextLine): boolean => {
    const parsedPT = parsePipeOrTabRow(ln.text);
    if (parsedPT.kind === 'pipe') return true;
    const cells =
      parsedPT.kind === 'tab'
        ? parsedPT.cells.map((t, ci) => ({ text: t, x0: ci * 100, x1: ci * 100 + 80 }))
        : ln.cells ?? [];
    if (cells.length < 2 || cells.length > 8) return false;
    if (ln.text.length > 165) return false;
    const avgWords =
      cells.reduce((s, c) => s + c.text.split(/\s+/).filter(Boolean).length, 0) / cells.length;
    if (avgWords > 6.5) return false;
    if (
      cells.length === 2 &&
      (/^((?:Q(?:uestion)?\s*)?\d+[.)])\s+[A-Za-z]/i.test(cells[0].text) ||
        /^((?:Q(?:uestion)?\s*)?\d+[.)])\s+[A-Za-z]/i.test(cells[1].text))
    ) {
      return false;
    }
    if (
      cells.length === 2 &&
      /^[A-D][.)]\s/i.test(cells[0].text) &&
      /^[A-D][.)]\s/i.test(cells[1].text)
    ) {
      return false;
    }
    if (/^(?:course\s*(?:code|title)|time\s*allowed|date|session|semester|instructions?)\s*:/i.test(cells[0].text)) {
      return false;
    }
    return true;
  };

  let idx = 0;
  while (idx < events.length) {
    const ev = events[idx];

    if (ev.kind === 'table') {
      blocks.push({
        id: nextId('tbl'),
        kind: 'table',
        pageNumber,
        table: ev.table,
        bbox: ev.table.bbox,
      });
      idx += 1;
      continue;
    }

    if (ev.kind === 'diagram') {
      blocks.push({
        id: nextId('fig'),
        kind: 'diagram',
        pageNumber,
        diagram: ev.diagram,
        text: ev.diagram.caption,
        bbox: ev.diagram.bbox,
      });
      idx += 1;
      continue;
    }

    if (ev.kind === 'formula') {
      blocks.push({
        id: nextId('math'),
        kind: 'formula',
        pageNumber,
        latex: ev.formula.latex,
        text: ev.formula.rawText,
        displayMode: ev.formula.displayMode,
        uncertain: ev.formula.uncertain,
        uncertainReason: ev.formula.uncertaintyReason,
        bbox: ev.formula.bbox,
      });
      idx += 1;
      continue;
    }

    const ln = ev.line;
    const trimmed = ln.text.trim();
    const lineCenter = (ln.x0 + ln.x1) * 0.5;
    const lineWidth = ln.x1 - ln.x0;
    const isCentered =
      lineWidth < effectiveWidth * 0.72 &&
      Math.abs(lineCenter - effectiveWidth * 0.5) <= effectiveWidth * 0.085;
    const indentPx = Math.max(0, ln.x0 - baseLeftX);
    const indentLevel = indentPx >= medianH * 3 ? 2 : indentPx >= medianH * 1.25 ? 1 : 0;

    // Skip box rule lines
    if (/^[+|┌┐└┘├┤┬┴┼─═\-_=.\s]+$/.test(trimmed) && /[-─═_|+]/.test(trimmed)) {
      idx += 1;
      continue;
    }

    // 1) Coordinate / pipe / tab inline tables
    if (isEligibleInlineTableCandidate(ln)) {
      let end = idx + 1;
      const runLines: SpatialTextLine[] = [ln];
      while (end < events.length && events[end].kind === 'line') {
        const nextEv = events[end] as Extract<StreamEvent, { kind: 'line' }>;
        if (nextEv.columnBand !== ev.columnBand) break;
        const nLine = nextEv.line;
        if (/^[+|┌┐└┘├┤┬┴┼─═\-_=.\s]+$/.test(nLine.text.trim())) {
          end += 1;
          continue;
        }
        if (!isEligibleInlineTableCandidate(nLine)) break;
        if (nLine.topY - runLines[runLines.length - 1].bottomY > medianH * 4.5) break;
        runLines.push(nLine);
        end += 1;
      }

      if (runLines.length >= 2) {
        const pipeFirst = parsePipeOrTabRow(runLines[0].text);
        let headers: string[] = [];
        let rows: string[][] = [];

        if (pipeFirst.kind) {
          const parsedRows = runLines
            .map((rl) => parsePipeOrTabRow(rl.text).cells)
            .filter((cells) => cells.length >= 2 && !isDividerCells(cells));
          if (parsedRows.length >= 2) {
            const colCount = Math.max(...parsedRows.map((r) => r.length));
            headers = Array.from({ length: colCount }, (_, ci) => parsedRows[0][ci] ?? '');
            rows = parsedRows.slice(1).map((r) => Array.from({ length: colCount }, (_, ci) => r[ci] ?? ''));
          }
        } else {
          const runCells = runLines.flatMap((rl) => rl.cells ?? []).sort((a, b) => a.x0 - b.x0);
          const bands: Array<{ minX: number; maxX: number; center: number }> = [];
          for (const cell of runCells) {
            const match = bands.find(
              (b) => cell.x0 <= b.maxX + medianH * 0.75 && cell.x1 >= b.minX - medianH * 0.75
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
            const grid = runLines.map((rl) => {
              const slots = Array.from({ length: bands.length }, () => '');
              for (const cell of rl.cells ?? []) {
                let bestIdx = 0;
                let bestDist = Infinity;
                const cMid = (cell.x0 + cell.x1) * 0.5;
                for (let bi = 0; bi < bands.length; bi += 1) {
                  const overlap = Math.min(cell.x1, bands[bi].maxX) - Math.max(cell.x0, bands[bi].minX);
                  const d = overlap > 0 ? -overlap : Math.abs(cMid - bands[bi].center);
                  if (d < bestDist) {
                    bestDist = d;
                    bestIdx = bi;
                  }
                }
                slots[bestIdx] = slots[bestIdx] ? `${slots[bestIdx]} ${cell.text}` : cell.text;
              }
              return slots;
            });
            headers = grid[0].map((c, ci) => c || `Col ${ci + 1}`);
            rows = grid.slice(1);
          }
        }

        if (headers.length >= 2 && rows.length >= 1) {
          let caption: string | undefined;
          const prevBlk = blocks[blocks.length - 1];
          if (
            prevBlk &&
            (prevBlk.kind === 'paragraph' || prevBlk.kind === 'heading' || prevBlk.kind === 'subheading') &&
            prevBlk.text &&
            /^(?:table|tab\.?)\s*\d*\s*[:.\-\s]/i.test(prevBlk.text)
          ) {
            caption = prevBlk.text;
            blocks.pop();
          }

          const matched = matchExistingTable(headers, rows.length, tables, usedTableIds);
          const tableObj =
            matched ??
            enrichExtractedTable(
              {
                id: `p${pageNumber}-inline-tbl-${seq}`,
                pageNumber,
                caption,
                headers,
                rows,
              },
              { borderStyle: pipeFirst.kind === 'pipe' ? 'bordered' : 'borderless' }
            );
          if (caption && !tableObj.caption) tableObj.caption = caption;

          blocks.push({
            id: nextId('tbl'),
            kind: 'table',
            pageNumber,
            table: tableObj,
            bbox: {
              x: Math.min(...runLines.map((rl) => rl.x0)),
              y: runLines[0].topY,
              width:
                Math.max(...runLines.map((rl) => rl.x1)) -
                Math.min(...runLines.map((rl) => rl.x0)),
              height: runLines[runLines.length - 1].bottomY - runLines[0].topY,
            },
          });
          idx = end;
          continue;
        }
      }
    }

    // 2) Headings & subheadings
    const headingLvl = detectHeadingLevel(trimmed, ln.avgH, medianH, isCentered);
    if (headingLvl !== null) {
      blocks.push({
        id: nextId('hdg'),
        kind: headingLvl === 3 ? 'subheading' : 'heading',
        headingLevel: headingLvl,
        pageNumber,
        text: trimmed.replace(/^#{1,3}\s+/, ''),
        alignment: isCentered ? 'center' : 'left',
      });
      idx += 1;
      continue;
    }

    // 3) Standalone display equations
    if (isStandaloneEquationLine(trimmed)) {
      const stripped = trimmed.replace(/^\$\$?|\$\$?$/g, '').trim();
      const latex = convertRawEquationToLatex(stripped);
      const matchedFormula = formulas.find(
        (f) =>
          normalizeCmp(f.rawText) === normalizeCmp(stripped) ||
          f.latex.replace(/\s+/g, '') === latex.replace(/\s+/g, '')
      );
      blocks.push({
        id: nextId('math'),
        kind: 'formula',
        pageNumber,
        latex: matchedFormula?.latex ?? latex,
        text: stripped,
        displayMode: true,
        alignment: isCentered ? 'center' : 'left',
        uncertain: matchedFormula?.uncertain,
        uncertainReason: matchedFormula?.uncertaintyReason,
      });
      idx += 1;
      continue;
    }

    // 4) Numbered questions ("1. ...", "Q1. ...", "Question 1: ...")
    const qMatch = trimmed.match(/^((?:Q(?:uestion)?\s*)?\d+[.)]|Question\s+(?:One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|\d+)[:.)]?)\s+(.+)$/i);
    if (qMatch) {
      const bodyParts = [qMatch[2]];
      let qEnd = idx + 1;
      while (qEnd < events.length && events[qEnd].kind === 'line') {
        const nextEv = events[qEnd] as Extract<StreamEvent, { kind: 'line' }>;
        if (nextEv.columnBand !== ev.columnBand) break;
        const nLn = nextEv.line;
        const nTrim = nLn.text.trim();
        const gap = nLn.topY - (events[qEnd - 1] as Extract<StreamEvent, { kind: 'line' }>).line.bottomY;
        if (!nTrim || gap > medianH * 1.45) break;
        if (isEligibleInlineTableCandidate(nLn)) break;
        if (detectHeadingLevel(nTrim, nLn.avgH, medianH, false) !== null) break;
        if (isStandaloneEquationLine(nTrim)) break;
        if (/^((?:Q(?:uestion)?\s*)?\d+[.)]|Question\s+\d+[:.)]?)\s+/i.test(nTrim)) break;
        if (/^(\([a-z0-9]{1,4}\)|[A-Ea-e][.)])\s+/.test(nTrim)) break;
        bodyParts.push(nTrim);
        qEnd += 1;
      }

      const rawQ = bodyParts.join(' ');
      const matchingUncertain = findMatchingUncertain(rawQ, uncertainSpans, ln.confidence);
      blocks.push({
        id: nextId('q'),
        kind: 'question',
        pageNumber,
        label: qMatch[1],
        text: injectInlineLatexIntoText(rawQ),
        indentLevel,
        uncertain: Boolean(matchingUncertain),
        uncertainReason: matchingUncertain,
      });
      idx = qEnd;
      continue;
    }

    // 5) Sub-questions & options ("(a) ...", "a) ...", "A. ...", "(ii) ...")
    const subMatch = trimmed.match(/^(\([a-z0-9]{1,4}\)|[A-Ea-e][.)]|[ivxlcdm]{1,4}[.)])\s+(.+)$/);
    if (subMatch) {
      const bodyParts = [subMatch[2]];
      let sEnd = idx + 1;
      while (sEnd < events.length && events[sEnd].kind === 'line') {
        const nextEv = events[sEnd] as Extract<StreamEvent, { kind: 'line' }>;
        if (nextEv.columnBand !== ev.columnBand) break;
        const nLn = nextEv.line;
        const nTrim = nLn.text.trim();
        const gap = nLn.topY - (events[sEnd - 1] as Extract<StreamEvent, { kind: 'line' }>).line.bottomY;
        if (!nTrim || gap > medianH * 1.4) break;
        if (isEligibleInlineTableCandidate(nLn)) break;
        if (detectHeadingLevel(nTrim, nLn.avgH, medianH, false) !== null) break;
        if (isStandaloneEquationLine(nTrim)) break;
        if (/^((?:Q(?:uestion)?\s*)?\d+[.)]|Question\s+\d+[:.)]?)\s+/i.test(nTrim)) break;
        if (/^(\([a-z0-9]{1,4}\)|[A-Ea-e][.)]|[ivxlcdm]{1,4}[.)])\s+/.test(nTrim)) break;
        bodyParts.push(nTrim);
        sEnd += 1;
      }

      const rawSub = bodyParts.join(' ');
      const matchingUncertain = findMatchingUncertain(rawSub, uncertainSpans, ln.confidence);
      blocks.push({
        id: nextId('subq'),
        kind: 'subquestion',
        pageNumber,
        label: subMatch[1],
        text: injectInlineLatexIntoText(rawSub),
        indentLevel: Math.max(1, indentLevel),
        uncertain: Boolean(matchingUncertain),
        uncertainReason: matchingUncertain,
      });
      idx = sEnd;
      continue;
    }

    // 6) Paragraph lines grouped by continuous vertical spacing & matching column/indent
    const paraParts = [trimmed];
    let pEnd = idx + 1;
    let minConf = ln.confidence ?? 100;
    while (pEnd < events.length && events[pEnd].kind === 'line') {
      const nextEv = events[pEnd] as Extract<StreamEvent, { kind: 'line' }>;
      if (nextEv.columnBand !== ev.columnBand) break;
      const nLn = nextEv.line;
      const nTrim = nLn.text.trim();
      const gap = nLn.topY - (events[pEnd - 1] as Extract<StreamEvent, { kind: 'line' }>).line.bottomY;
      if (!nTrim || gap > medianH * 1.55) break;
      if (isEligibleInlineTableCandidate(nLn)) break;
      if (detectHeadingLevel(nTrim, nLn.avgH, medianH, false) !== null) break;
      if (isStandaloneEquationLine(nTrim)) break;
      if (/^((?:Q(?:uestion)?\s*)?\d+[.)]|Question\s+\d+[:.)]?)\s+/i.test(nTrim)) break;
      if (/^(\([a-z0-9]{1,4}\)|[A-Ea-e][.)])\s+/.test(nTrim)) break;
      paraParts.push(nTrim);
      if (typeof nLn.confidence === 'number' && nLn.confidence < minConf) {
        minConf = nLn.confidence;
      }
      pEnd += 1;
    }

    const joinedPara = paraParts.join(' ');
    const matchingUncertain = findMatchingUncertain(joinedPara, uncertainSpans, minConf);
    blocks.push({
      id: nextId('p'),
      kind: 'paragraph',
      pageNumber,
      text: injectInlineLatexIntoText(joinedPara),
      alignment: isCentered && paraParts.length === 1 ? 'center' : 'left',
      indentLevel,
      uncertain: Boolean(matchingUncertain),
      uncertainReason: matchingUncertain,
    });
    idx = pEnd;
  }

  // Attach any inline diagrams that lacked spatial bbox (or weren't placed above) near matching figure references or in sequence
  for (const diag of filteredInlineDiagrams) {
    if (placedDiagramIds.has(diag.id)) continue;
    placedDiagramIds.add(diag.id);
    const figNumMatch = diag.caption.match(/\b(?:figure|fig\.?|diagram)\s*(\d+)/i);
    const figNeedle = figNumMatch ? new RegExp(`\\b(?:figure|fig\\.?|diagram)\\s*${figNumMatch[1]}\\b`, 'i') : null;
    const insertIdx = figNeedle
      ? blocks.findIndex((b) => b.text && figNeedle.test(b.text))
      : -1;
    const figBlock: ReconstructedBlock = {
      id: nextId('fig'),
      kind: 'diagram',
      pageNumber,
      diagram: diag,
      text: diag.caption,
      bbox: diag.bbox,
    };
    if (insertIdx >= 0) {
      blocks.splice(insertIdx + 1, 0, figBlock);
    } else {
      blocks.push(figBlock);
    }
  }

  // Running footers at bottom of page
  for (const f of footerLines) {
    const clean = sanitizeSingleLine(f, 140);
    if (clean) {
      blocks.push({
        id: nextId('ftr'),
        kind: 'footer',
        pageNumber,
        text: clean,
        alignment: 'center',
      });
    }
  }

  // Handle genuinely empty/unreadable scans honestly
  if (blocks.length === 0 && uncertainSpans.length > 0) {
    blocks.push({
      id: nextId('unc'),
      kind: 'uncertain',
      pageNumber,
      text: uncertainSpans[0].text,
      uncertain: true,
      uncertainReason: uncertainSpans[0].reason,
    });
  }

  return blocks;
}

function findMatchingUncertain(
  text: string,
  uncertainSpans: UncertainSpan[],
  confidence?: number
): string | undefined {
  if (typeof confidence === 'number' && confidence > 0 && confidence < 52) {
    return `Low OCR line confidence (${Math.round(confidence)}%) — verify against original scan.`;
  }
  const lower = text.toLowerCase();
  const match = uncertainSpans.find(
    (u) => u.text.length >= 2 && lower.includes(u.text.toLowerCase())
  );
  return match?.reason;
}

/**
 * Text-based sequential layout reconstruction fallback (used for plain-text uploads,
 * edited text, or legacy pages lacking OCR/PDF coordinates).
 */
export function buildBlocksFromStructuredText(params: {
  pageNumber: number;
  text: string;
  tables?: ExtractedTable[];
  formulas?: ExtractedFormula[];
  diagrams?: ExtractedDiagramAsset[];
  headerLines?: string[];
  footerLines?: string[];
  uncertainSpans?: UncertainSpan[];
}): ReconstructedBlock[] {
  const {
    pageNumber,
    text,
    tables = [],
    formulas = [],
    diagrams = [],
    headerLines = [],
    footerLines = [],
    uncertainSpans = [],
  } = params;

  const inlineDiagrams = diagrams.filter(isInlineFigure);
  const blocks: ReconstructedBlock[] = [];
  let seq = 1;
  const nextId = (prefix: string) => `p${pageNumber}-${prefix}-${seq++}`;

  for (const h of headerLines) {
    const clean = sanitizeSingleLine(h, 140);
    if (clean) {
      blocks.push({
        id: nextId('hdr'),
        kind: 'header',
        pageNumber,
        text: clean,
        alignment: 'center',
      });
    }
  }

  const lines = text.split(/\r?\n/);
  const usedTableIds = new Set<string>();
  const textExtractedTables = extractTablesFromText(text, pageNumber);

  // Also keep track of captions consumed by visual tables
  const headerNorms = new Set(headerLines.map(normalizeCmp).filter(Boolean));
  const footerNorms = new Set(footerLines.map(normalizeCmp).filter(Boolean));

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed) {
      i += 1;
      continue;
    }

    const norm = normalizeCmp(trimmed);
    if (headerNorms.has(norm) || footerNorms.has(norm)) {
      i += 1;
      continue;
    }
    if (/^[+|┌┐└┘├┤┬┴┼─═\-_=.\s]+$/.test(trimmed) && /[-─═_|+]/.test(trimmed)) {
      i += 1;
      continue;
    }

    // Compute rough text indentation
    const leadingSpaces = raw.length - raw.trimStart().length;
    const indentLevel = leadingSpaces >= 6 ? 2 : leadingSpaces >= 2 ? 1 : 0;

    // 1. Inline pipe or tab table
    const parsedRow = parsePipeOrTabRow(trimmed);
    if (parsedRow.kind) {
      const collected: string[][] = [];
      let look = i;
      while (look < lines.length) {
        const lt = lines[look].trim();
        if (!lt) break;
        if (/^[+|┌┐└┘├┤┬┴┼─═\-_=.\s]+$/.test(lt) && /[-─═_|+]/.test(lt)) {
          look += 1;
          continue;
        }
        const nr = parsePipeOrTabRow(lt);
        if (nr.kind !== parsedRow.kind) break;
        if (isDividerCells(nr.cells)) {
          look += 1;
          continue;
        }
        collected.push(nr.cells);
        look += 1;
      }

      if (collected.length >= 2) {
        const colCount = Math.max(...collected.map((r) => r.length));
        const headers = Array.from({ length: colCount }, (_, ci) => collected[0][ci] ?? '');
        const rows = collected.slice(1).map((r) => Array.from({ length: colCount }, (_, ci) => r[ci] ?? ''));
        let caption: string | undefined;
        const prev = blocks[blocks.length - 1];
        if (
          prev &&
          (prev.kind === 'paragraph' || prev.kind === 'heading' || prev.kind === 'subheading') &&
          prev.text &&
          /^(?:table|tab\.?)\s*\d*\s*[:.\-\s]/i.test(prev.text)
        ) {
          caption = prev.text;
          blocks.pop();
        }
        const matched =
          matchExistingTable(headers, rows.length, tables, usedTableIds) ??
          matchExistingTable(headers, rows.length, textExtractedTables, usedTableIds);
        const tableObj =
          matched ??
          enrichExtractedTable(
            {
              id: `p${pageNumber}-tbl-${seq}`,
              pageNumber,
              caption,
              headers,
              rows,
            },
            { borderStyle: parsedRow.kind === 'pipe' ? 'bordered' : 'borderless' }
          );
        if (caption && !tableObj.caption) tableObj.caption = caption;
        blocks.push({
          id: nextId('tbl'),
          kind: 'table',
          pageNumber,
          table: tableObj,
        });
        i = look;
        continue;
      }
    }

    // 2. Spaced-column inline table matching one already detected by extractTablesFromText
    const spacedMatch = textExtractedTables.find(
      (tt) =>
        !usedTableIds.has(tt.id) &&
        tt.headers.length >= 2 &&
        tt.headers.every((h) => !h || trimmed.toLowerCase().includes(h.toLowerCase()))
    );
    if (spacedMatch && trimmed.split(/\s{2,}/).length >= 2) {
      usedTableIds.add(spacedMatch.id);
      let end = i + 1;
      const expectedRows = spacedMatch.rows.length;
      let consumed = 0;
      while (end < lines.length && consumed < expectedRows) {
        const lt = lines[end].trim();
        if (!lt) break;
        if (lt.split(/\s{2,}/).length >= 2) {
          consumed += 1;
          end += 1;
        } else {
          break;
        }
      }
      if (consumed > 0) {
        const richMatch = matchExistingTable(spacedMatch.headers, spacedMatch.rows.length, tables, usedTableIds) ?? spacedMatch;
        blocks.push({
          id: nextId('tbl'),
          kind: 'table',
          pageNumber,
          table: richMatch,
        });
        i = end;
        continue;
      }
    }

    // 3. Heading
    const headingLvl = detectHeadingLevel(trimmed);
    if (headingLvl !== null) {
      blocks.push({
        id: nextId('hdg'),
        kind: headingLvl === 3 ? 'subheading' : 'heading',
        headingLevel: headingLvl,
        pageNumber,
        text: trimmed.replace(/^#{1,3}\s+/, ''),
        alignment: headingLvl === 1 ? 'center' : 'left',
      });
      i += 1;
      continue;
    }

    // 4. Display equation
    if (isStandaloneEquationLine(trimmed)) {
      const stripped = trimmed.replace(/^\$\$?|\$\$?$/g, '').trim();
      const latex = convertRawEquationToLatex(stripped);
      const matchedF = formulas.find(
        (f) => f.latex.replace(/\s+/g, '') === latex.replace(/\s+/g, '')
      );
      blocks.push({
        id: nextId('math'),
        kind: 'formula',
        pageNumber,
        latex: matchedF?.latex ?? latex,
        text: stripped,
        displayMode: true,
        uncertain: matchedF?.uncertain,
        uncertainReason: matchedF?.uncertaintyReason,
      });
      i += 1;
      continue;
    }

    // 5. Question
    const qMatch = trimmed.match(/^((?:Q(?:uestion)?\s*)?\d+[.)]|Question\s+(?:One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|\d+)[:.)]?)\s+(.+)$/i);
    if (qMatch) {
      const parts = [qMatch[2]];
      let look = i + 1;
      while (look < lines.length) {
        const nt = lines[look].trim();
        if (!nt) break;
        if (parsePipeOrTabRow(nt).kind) break;
        if (detectHeadingLevel(nt) !== null) break;
        if (isStandaloneEquationLine(nt)) break;
        if (/^((?:Q(?:uestion)?\s*)?\d+[.)]|Question\s+\d+[:.)]?)\s+/i.test(nt)) break;
        if (/^(\([a-z0-9]{1,4}\)|[A-Ea-e][.)])\s+/.test(nt)) break;
        parts.push(nt);
        look += 1;
      }
      const qBody = parts.join(' ');
      blocks.push({
        id: nextId('q'),
        kind: 'question',
        pageNumber,
        label: qMatch[1],
        text: injectInlineLatexIntoText(qBody),
        indentLevel,
        uncertain: Boolean(findMatchingUncertain(qBody, uncertainSpans)),
        uncertainReason: findMatchingUncertain(qBody, uncertainSpans),
      });
      i = look;
      continue;
    }

    // 6. Sub-question / option
    const subMatch = trimmed.match(/^(\([a-z0-9]{1,4}\)|[A-Ea-e][.)]|[ivxlcdm]{1,4}[.)])\s+(.+)$/);
    if (subMatch) {
      blocks.push({
        id: nextId('subq'),
        kind: 'subquestion',
        pageNumber,
        label: subMatch[1],
        text: injectInlineLatexIntoText(subMatch[2]),
        indentLevel: Math.max(1, indentLevel),
        uncertain: Boolean(findMatchingUncertain(subMatch[2], uncertainSpans)),
        uncertainReason: findMatchingUncertain(subMatch[2], uncertainSpans),
      });
      i += 1;
      continue;
    }

    // 7. Paragraph block
    const paraParts = [trimmed];
    let pLook = i + 1;
    while (pLook < lines.length) {
      const nt = lines[pLook].trim();
      if (!nt) break;
      if (parsePipeOrTabRow(nt).kind) break;
      if (detectHeadingLevel(nt) !== null) break;
      if (isStandaloneEquationLine(nt)) break;
      if (/^((?:Q(?:uestion)?\s*)?\d+[.)]|Question\s+\d+[:.)]?)\s+/i.test(nt)) break;
      if (/^(\([a-z0-9]{1,4}\)|[A-Ea-e][.)])\s+/.test(nt)) break;
      paraParts.push(nt);
      pLook += 1;
    }
    const body = paraParts.join(' ');
    blocks.push({
      id: nextId('p'),
      kind: 'paragraph',
      pageNumber,
      text: injectInlineLatexIntoText(body),
      indentLevel,
      uncertain: Boolean(findMatchingUncertain(body, uncertainSpans)),
      uncertainReason: findMatchingUncertain(body, uncertainSpans),
    });
    i = pLook;
  }

  // Place any inline diagrams cleanly near their matching caption reference or appended
  for (const diag of inlineDiagrams) {
    const figNumMatch = diag.caption.match(/\b(?:figure|fig\.?|diagram)\s*(\d+)/i);
    const figNeedle = figNumMatch ? new RegExp(`\\b(?:figure|fig\\.?|diagram)\\s*${figNumMatch[1]}\\b`, 'i') : null;
    const insertIdx = figNeedle
      ? blocks.findIndex((b) => b.text && figNeedle.test(b.text))
      : -1;
    const figBlock: ReconstructedBlock = {
      id: nextId('fig'),
      kind: 'diagram',
      pageNumber,
      diagram: diag,
      text: diag.caption,
      bbox: diag.bbox,
    };
    if (insertIdx >= 0) {
      blocks.splice(insertIdx + 1, 0, figBlock);
    } else {
      blocks.push(figBlock);
    }
  }

  for (const f of footerLines) {
    const clean = sanitizeSingleLine(f, 140);
    if (clean) {
      blocks.push({
        id: nextId('ftr'),
        kind: 'footer',
        pageNumber,
        text: clean,
        alignment: 'center',
      });
    }
  }

  return blocks;
}

/**
 * Rebuilds page text and ReconstructedBlock arrays when an admin edits extractedText
 * so the rendered preview and student catalog stay faithful to edits.
 */
export function rebuildPagesFromEditedText(
  existingPages: ExtractedPageContent[],
  editedText: string
): ExtractedPageContent[] {
  const sanitized = sanitizePlainText(editedText, 120_000);
  if (existingPages.length <= 1) {
    const basePage: ExtractedPageContent = existingPages[0] ?? {
      pageNumber: 1,
      text: sanitized,
      wordCount: 0,
      ocrApplied: false,
      ocrConfidence: null,
      diagrams: [],
      tables: [],
      formulas: [],
      warnings: [],
    };
    const nextText = sanitizePlainText(sanitized, 40_000);
    const rebuiltBlocks = buildBlocksFromStructuredText({
      pageNumber: basePage.pageNumber,
      text: nextText,
      tables: basePage.tables,
      formulas: basePage.formulas,
      diagrams: basePage.diagrams,
      headerLines: basePage.headerLines,
      footerLines: basePage.footerLines,
      uncertainSpans: basePage.uncertainSpans,
    });
    const rebuiltTables = rebuiltBlocks
      .filter((b) => b.kind === 'table' && b.table)
      .map((b) => b.table!);
    return [
      {
        ...basePage,
        text: nextText,
        wordCount: nextText.split(/\s+/).filter(Boolean).length,
        charCount: nextText.replace(/\s+/g, '').length,
        tables: rebuiltTables,
        blocks: rebuiltBlocks,
      },
    ];
  }

  // Multi-page split on "--- Page N ---"
  const markerRegex = /^---\s*Page\s+(\d+)\s*---\s*$/gim;
  const sections = new Map<number, string>();
  const matches = Array.from(sanitized.matchAll(markerRegex));
  if (matches.length >= 2) {
    for (let i = 0; i < matches.length; i += 1) {
      const pageNum = Number(matches[i][1]);
      const start = (matches[i].index ?? 0) + matches[i][0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index ?? sanitized.length : sanitized.length;
      sections.set(pageNum, sanitized.slice(start, end).trim());
    }
    return existingPages.map((pg) => {
      const nextText = sections.get(pg.pageNumber) ?? pg.text;
      const rebuiltBlocks = buildBlocksFromStructuredText({
        pageNumber: pg.pageNumber,
        text: nextText,
        tables: pg.tables,
        formulas: pg.formulas,
        diagrams: pg.diagrams,
        headerLines: pg.headerLines,
        footerLines: pg.footerLines,
        uncertainSpans: pg.uncertainSpans,
      });
      const rebuiltTables = rebuiltBlocks
        .filter((b) => b.kind === 'table' && b.table)
        .map((b) => b.table!);
      return {
        ...pg,
        text: nextText,
        wordCount: nextText.split(/\s+/).filter(Boolean).length,
        charCount: nextText.replace(/\s+/g, '').length,
        tables: rebuiltTables,
        blocks: rebuiltBlocks,
      };
    });
  }

  return existingPages;
}
