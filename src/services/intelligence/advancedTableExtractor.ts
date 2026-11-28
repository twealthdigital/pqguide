import type { ExtractedTable, MergedTableCellSpan } from '../../core/types';
import type { OcrWordBox } from './ocrEngine';

export function toTableMarkdown(
  headers: string[],
  rows: string[][]
): string {
  const colCount = Math.max(
    headers.length,
    ...rows.map((r) => r.length),
    1
  );
  const normHeaders = Array.from({ length: colCount }, (_, i) =>
    (headers[i] ?? '').replace(/\|/g, '\\|').trim() || `Col ${i + 1}`
  );
  const headerLine = `| ${normHeaders.join(' | ')} |`;
  const sepLine = `| ${normHeaders.map(() => '---').join(' | ')} |`;
  const rowLines = rows.map((row) => {
    const cells = Array.from({ length: colCount }, (_, i) =>
      (row[i] ?? '').replace(/\|/g, '\\|').trim()
    );
    return `| ${cells.join(' | ')} |`;
  });
  return [headerLine, sepLine, ...rowLines].join('\n');
}

export function toTableJsonRows(
  headers: string[],
  rows: string[][]
): Array<Record<string, string>> {
  const cleanHeaders = headers.map((h, i) => h.trim() || `column_${i + 1}`);
  return rows.map((row) => {
    const obj: Record<string, string> = {};
    for (let c = 0; c < cleanHeaders.length; c += 1) {
      obj[cleanHeaders[c]] = (row[c] ?? '').trim();
    }
    return obj;
  });
}

function inferRowHeaders(rows: string[][]): string[] | undefined {
  if (rows.length < 2) return undefined;
  const firstCol = rows.map((r) => (r[0] ?? '').trim());
  const nonEmpty = firstCol.filter(Boolean);
  if (nonEmpty.length < Math.ceil(rows.length * 0.6)) return undefined;

  // Row headers typically contain categorical/text stub labels while data columns contain numbers/values
  const stubTextCount = nonEmpty.filter((v) => /[A-Za-z]/.test(v)).length;
  const numericRestCount = rows
    .flatMap((r) => r.slice(1))
    .filter((v) => /\d/.test(v || '')).length;

  if (stubTextCount >= Math.ceil(nonEmpty.length * 0.7) && numericRestCount >= 2) {
    return firstCol;
  }
  return undefined;
}

export function enrichExtractedTable(
  table: ExtractedTable,
  options?: {
    borderStyle?: ExtractedTable['borderStyle'];
    mergedCells?: MergedTableCellSpan[];
  }
): ExtractedTable {
  const colCount = Math.max(
    table.headers.length,
    ...table.rows.map((r) => r.length),
    1
  );

  // Preserve empty cells cleanly across every row
  const normalizedHeaders = Array.from({ length: colCount }, (_, i) =>
    (table.headers[i] ?? '').trim()
  );
  const normalizedRows = table.rows.map((r) =>
    Array.from({ length: colCount }, (_, i) => (r[i] ?? '').trim())
  );

  const rawWidths = table.rows.map((r) => r.length);
  const jaggedRows = rawWidths.filter((w) => Math.abs(w - colCount) > 1).length;
  const hasMergedCells = Boolean(
    options?.mergedCells && options.mergedCells.length > 0
  ) || Boolean(table.hasMergedCells);

  const uncertainStructure =
    Boolean(table.uncertainStructure) ||
    colCount < 2 ||
    (normalizedRows.length >= 3 && jaggedRows / normalizedRows.length > 0.35);

  const uncertaintyReason =
    table.uncertaintyReason ||
    (uncertainStructure
      ? 'Irregular column alignment across rows; verify column mapping manually.'
      : undefined);

  const rowHeaders = table.rowHeaders ?? inferRowHeaders(normalizedRows);
  const markdown = toTableMarkdown(normalizedHeaders, normalizedRows);
  const jsonRows = toTableJsonRows(normalizedHeaders, normalizedRows);

  return {
    ...table,
    headers: normalizedHeaders,
    rows: normalizedRows,
    rowHeaders,
    columnHeaderCount: table.columnHeaderCount ?? 1,
    borderStyle: options?.borderStyle ?? table.borderStyle ?? 'borderless',
    hasMergedCells,
    mergedCells: options?.mergedCells ?? table.mergedCells,
    uncertainStructure,
    uncertaintyReason,
    markdown,
    jsonRows,
  };
}

function clusterLinePositions(positions: number[], mergeGap: number): number[] {
  if (positions.length === 0) return [];
  const sorted = [...positions].sort((a, b) => a - b);
  const clusters: number[] = [];
  let sum = sorted[0];
  let count = 1;
  let last = sorted[0];

  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] - last <= mergeGap) {
      sum += sorted[i];
      count += 1;
    } else {
      clusters.push(Math.round(sum / count));
      sum = sorted[i];
      count = 1;
    }
    last = sorted[i];
  }
  clusters.push(Math.round(sum / count));
  return clusters;
}

/**
 * Visual bordered-table detector using horizontal and vertical line projections on grayscale ink
 * plus OCR word-box placement into cells (including empty and merged cell detection).
 */
export function extractBorderedTablesFromGrayscale(input: {
  gray: Uint8Array;
  width: number;
  height: number;
  pageNumber: number;
  wordBoxes?: OcrWordBox[];
}): ExtractedTable[] {
  const { gray, width, height, pageNumber, wordBoxes } = input;
  if (width < 140 || height < 140 || gray.length < width * height) {
    return [];
  }

  let sum = 0;
  const step = Math.max(1, Math.floor(gray.length / 6000));
  let sampleCount = 0;
  for (let i = 0; i < gray.length; i += step) {
    sum += gray[i];
    sampleCount += 1;
  }
  const threshold = Math.max(95, Math.min(200, Math.round((sum / Math.max(1, sampleCount)) * 0.78)));

  // Find candidate long horizontal ink runs (continuous >= 30% of page width)
  const hLinesRaw: Array<{ y: number; x0: number; x1: number }> = [];
  const minHRun = Math.max(90, Math.round(width * 0.3));

  for (let y = 4; y < height - 4; y += 1) {
    const off = y * width;
    let run = 0;
    let runStart = 0;
    let gapTolerance = 0;
    for (let x = 0; x < width; x += 1) {
      if (gray[off + x] < threshold) {
        if (run === 0) runStart = x;
        run += 1;
        gapTolerance = 0;
      } else if (run > 0 && gapTolerance < 2) {
        gapTolerance += 1;
        run += 1;
      } else {
        if (run >= minHRun) {
          hLinesRaw.push({ y, x0: runStart, x1: x - 1 });
        }
        run = 0;
        gapTolerance = 0;
      }
    }
    if (run >= minHRun) {
      hLinesRaw.push({ y, x0: runStart, x1: width - 1 });
    }
  }

  if (hLinesRaw.length < 3) return [];

  const hYsAll = clusterLinePositions(
    hLinesRaw.map((l) => l.y),
    5
  );
  if (hYsAll.length < 3) return [];

  // Partition horizontal rule clusters into separate tables if separated by clear blank/prose gaps
  // where vertical borders do not continue across the gap.
  const hIntervals = hYsAll.slice(1).map((y, idx) => y - hYsAll[idx]).sort((a, b) => a - b);
  const medianRowGap = hIntervals[Math.floor(hIntervals.length / 2)] || 36;
  const splitGapThresh = Math.max(70, Math.round(medianRowGap * 2.5));

  const tableBandGroups: number[][] = [];
  let currentGroup: number[] = [hYsAll[0]];
  for (let i = 1; i < hYsAll.length; i += 1) {
    const prevY = hYsAll[i - 1];
    const nextY = hYsAll[i];
    const gap = nextY - prevY;
    let hasBridgeVLine = false;
    if (gap > splitGapThresh) {
      // Check if any vertical column border spans across the gap
      const midSpanCheckX = hLinesRaw
        .filter((l) => Math.abs(l.y - prevY) <= 6)
        .flatMap((l) => [l.x0, Math.round((l.x0 + l.x1) / 2), l.x1]);
      for (const cx of midSpanCheckX) {
        let darkHits = 0;
        for (let yy = prevY + 2; yy < nextY - 2; yy += 2) {
          if (gray[yy * width + Math.min(width - 1, Math.max(0, cx))] < threshold) {
            darkHits += 1;
          }
        }
        if (darkHits >= Math.max(10, (gap / 2) * 0.6)) {
          hasBridgeVLine = true;
          break;
        }
      }
    }
    if (gap > splitGapThresh && !hasBridgeVLine && currentGroup.length >= 3) {
      tableBandGroups.push(currentGroup);
      currentGroup = [nextY];
    } else {
      currentGroup.push(nextY);
    }
  }
  if (currentGroup.length >= 3) {
    tableBandGroups.push(currentGroup);
  }

  const extractedTables: ExtractedTable[] = [];

  for (const hYs of tableBandGroups) {
    const bandMinY = hYs[0];
    const bandMaxY = hYs[hYs.length - 1];
    const bandHeight = bandMaxY - bandMinY;
    if (bandHeight < 40) continue;

    const bandHLines = hLinesRaw.filter((l) => l.y >= bandMinY - 6 && l.y <= bandMaxY + 6);
    if (bandHLines.length < 3) continue;

    const minX = Math.min(...bandHLines.map((l) => l.x0));
    const maxX = Math.max(...bandHLines.map((l) => l.x1));
    const tableWidth = maxX - minX + 1;
    if (tableWidth < 90) continue;

    // Detect vertical column dividers spanning >= 45% of this table's height
    const vXsRaw: number[] = [];
    const minVHits = Math.max(25, Math.round(bandHeight * 0.45));

    for (let x = Math.max(0, minX - 4); x <= Math.min(width - 1, maxX + 4); x += 1) {
      let dark = 0;
      for (let y = bandMinY; y <= bandMaxY; y += 1) {
        if (gray[y * width + x] < threshold) dark += 1;
      }
      if (dark >= minVHits) {
        vXsRaw.push(x);
      }
    }

    const vXs = clusterLinePositions(vXsRaw, 5);
    if (vXs.length < 3) continue;

    const rowCount = hYs.length - 1;
    const colCount = vXs.length - 1;
    if (rowCount < 2 || colCount < 2 || rowCount > 45 || colCount > 15) {
      continue;
    }

    const hasMissingVSegment = (r: number, divColIdx: number): boolean => {
      const yTop = hYs[r];
      const yBot = hYs[r + 1];
      const divX = vXs[divColIdx];
      let vSegDark = 0;
      const segH = Math.max(1, yBot - yTop - 4);
      for (let yy = yTop + 2; yy < yBot - 2; yy += 1) {
        if (
          gray[yy * width + divX] < threshold ||
          gray[yy * width + Math.max(0, divX - 1)] < threshold ||
          gray[yy * width + Math.min(width - 1, divX + 1)] < threshold
        ) {
          vSegDark += 1;
        }
      }
      return vSegDark / segH < 0.25;
    };

    const hasMissingHSegment = (divRowIdx: number, c: number): boolean => {
      const xLeft = vXs[c];
      const xRight = vXs[c + 1];
      const divY = hYs[divRowIdx];
      let hSegDark = 0;
      const segW = Math.max(1, xRight - xLeft - 4);
      for (let xx = xLeft + 2; xx < xRight - 2; xx += 1) {
        if (
          gray[divY * width + xx] < threshold ||
          gray[Math.max(0, divY - 1) * width + xx] < threshold ||
          gray[Math.min(height - 1, divY + 1) * width + xx] < threshold
        ) {
          hSegDark += 1;
        }
      }
      return hSegDark / segW < 0.25;
    };

    // Build cell matrix & detect multi-column / multi-row merged cells
    const grid: string[][] = Array.from({ length: rowCount }, () =>
      Array(colCount).fill('')
    );
    const mergedCells: MergedTableCellSpan[] = [];
    const covered = Array.from({ length: rowCount }, () => Array<boolean>(colCount).fill(false));
    const colOffsets: Array<'left' | 'center' | 'right'>[] = Array.from(
      { length: colCount },
      () => []
    );

    for (let r = 0; r < rowCount; r += 1) {
      for (let c = 0; c < colCount; c += 1) {
        if (covered[r][c]) continue;

        let cSpan = 1;
        while (c + cSpan < colCount && hasMissingVSegment(r, c + cSpan)) {
          cSpan += 1;
        }

        let rSpan = 1;
        while (r + rSpan < rowCount) {
          let allColsMissingH = true;
          for (let cc = c; cc < c + cSpan; cc += 1) {
            if (!hasMissingHSegment(r + rSpan, cc)) {
              allColsMissingH = false;
              break;
            }
          }
          if (!allColsMissingH) break;
          rSpan += 1;
        }

        const yTop = hYs[r];
        const yBot = hYs[r + rSpan];
        const xLeft = vXs[c];
        const xRight = vXs[c + cSpan];

        const cellWordsRaw = (wordBoxes ?? []).filter((w) => {
          const cx = (w.x0 + w.x1) / 2;
          const cy = (w.y0 + w.y1) / 2;
          return cx >= xLeft + 1 && cx <= xRight - 1 && cy >= yTop + 1 && cy <= yBot - 1;
        });
        const cellLines: Array<{ midY: number; words: typeof cellWordsRaw }> = [];
        for (const w of [...cellWordsRaw].sort(
          (a, b) => (a.y0 + a.y1) * 0.5 - (b.y0 + b.y1) * 0.5 || a.x0 - b.x0
        )) {
          const mY = (w.y0 + w.y1) * 0.5;
          const line = cellLines.find(
            (ln) => Math.abs(ln.midY - mY) <= Math.max(8, (w.y1 - w.y0) * 0.65)
          );
          if (line) {
            line.words.push(w);
          } else {
            cellLines.push({ midY: mY, words: [w] });
          }
        }
        const cellWords = cellLines
          .sort((a, b) => a.midY - b.midY)
          .flatMap((ln) => ln.words.sort((a, b) => a.x0 - b.x0));

        const cellText = cellWords.map((w) => w.text).join(' ').trim();
        grid[r][c] = cellText;

        if (cSpan === 1 && r > 0 && cellWords.length > 0) {
          const textMinX = Math.min(...cellWords.map((w) => w.x0));
          const textMaxX = Math.max(...cellWords.map((w) => w.x1));
          const leftSpace = textMinX - xLeft;
          const rightSpace = xRight - textMaxX;
          if (rightSpace > 8 && leftSpace > 8 && Math.abs(leftSpace - rightSpace) <= (xRight - xLeft) * 0.16) {
            colOffsets[c].push('center');
          } else if (leftSpace > rightSpace * 2.2 && leftSpace > 12) {
            colOffsets[c].push('right');
          } else {
            colOffsets[c].push('left');
          }
        }

        if (cSpan > 1 || rSpan > 1) {
          mergedCells.push({
            row: r,
            col: c,
            rowSpan: rSpan,
            colSpan: cSpan,
            value: cellText,
          });
          for (let rr = r; rr < r + rSpan; rr += 1) {
            for (let cc = c; cc < c + cSpan; cc += 1) {
              if (rr !== r || cc !== c) {
                covered[rr][cc] = true;
              }
            }
          }
        }
      }
    }

    const columnAlignments = colOffsets.map<'left' | 'center' | 'right'>((samples, cIdx) => {
      if (samples.length === 0) {
        const numericCells = grid.slice(1).filter((row) => /^[-+]?\d+(?:\.\d+)?%?$/.test((row[cIdx] ?? '').trim()));
        return numericCells.length >= Math.max(2, Math.floor((rowCount - 1) * 0.7)) ? 'right' : 'left';
      }
      const counts = { left: 0, center: 0, right: 0 };
      for (const s of samples) counts[s] += 1;
      if (counts.center >= counts.left && counts.center > counts.right) return 'center';
      if (counts.right > counts.left && counts.right >= counts.center) return 'right';
      return 'left';
    });

    // Check for optional explicit caption directly above the table box (within 46px)
    let caption: string | undefined;
    if (wordBoxes && wordBoxes.length > 0) {
      const aboveWords = wordBoxes
        .filter((w) => w.y1 <= bandMinY && bandMinY - w.y1 <= 46 && w.x1 >= minX - 20 && w.x0 <= maxX + 20)
        .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
      if (aboveWords.length > 0) {
        const lastY = Math.max(...aboveWords.map((w) => w.y0));
        const captionLine = aboveWords
          .filter((w) => Math.abs(w.y0 - lastY) <= 14)
          .sort((a, b) => a.x0 - b.x0)
          .map((w) => w.text)
          .join(' ')
          .trim();
        if (/^(?:table|tab\.?)\s*\d*\s*[:.\-\s]/i.test(captionLine)) {
          caption = captionLine;
        }
      }
    }

    const headers = grid[0].map((h, i) => h || `Column ${i + 1}`);
    const rows = grid.slice(1);

    extractedTables.push(
      enrichExtractedTable(
        {
          id: `p${pageNumber}-bordered-tbl-${extractedTables.length + 1}`,
          pageNumber,
          caption,
          headers,
          rows,
          columnAlignments,
          bbox: {
            x: minX,
            y: bandMinY,
            width: tableWidth,
            height: bandHeight + 1,
          },
        },
        {
          borderStyle: 'bordered',
          mergedCells: mergedCells.length > 0 ? mergedCells : undefined,
        }
      )
    );
  }

  return extractedTables;
}

/**
 * Stitches multi-page tables when page N ends with a table and page N+1 begins
 * with a compatible continuation table (matching column counts and either repeated
 * header row or headerless continuation rows). Preserves page-level provenance.
 */
export function linkMultiPageTables(
  tables: ExtractedTable[]
): ExtractedTable[] {
  if (tables.length < 2) return tables.map((t) => enrichExtractedTable(t));
  const enriched = tables.map((t) => enrichExtractedTable(t));

  for (let i = 0; i + 1 < enriched.length; i += 1) {
    const curr = enriched[i];
    const next = enriched[i + 1];
    if (next.pageNumber !== curr.pageNumber + 1) continue;
    if (curr.headers.length !== next.headers.length || curr.headers.length < 2) continue;

    const sameHeaders =
      curr.headers.join('|').toLowerCase() === next.headers.join('|').toLowerCase();
    const nextHeaderLooksLikeDataRow = next.headers.every(
      (h) => /^\d+(\.\d+)?$/.test(h.trim()) || /^col(umn)?\s+\d+$/i.test(h.trim())
    );

    if (sameHeaders || nextHeaderLooksLikeDataRow) {
      curr.continuesOnPage = next.pageNumber;
      next.continuedFromPage = curr.pageNumber;
    }
  }

  return enriched;
}
