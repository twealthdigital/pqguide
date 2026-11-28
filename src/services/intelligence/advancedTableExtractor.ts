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

  // Find candidate long horizontal ink runs (continuous >= 35% of page width)
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

  const hYs = clusterLinePositions(
    hLinesRaw.map((l) => l.y),
    5
  );
  if (hYs.length < 3) return [];

  // Group horizontal rules into table Y-bands (rows spaced reasonably within a table)
  const bandMinY = hYs[0];
  const bandMaxY = hYs[hYs.length - 1];
  const bandHeight = bandMaxY - bandMinY;
  if (bandHeight < 40) return [];

  const minX = Math.min(...hLinesRaw.map((l) => l.x0));
  const maxX = Math.max(...hLinesRaw.map((l) => l.x1));
  const tableWidth = maxX - minX + 1;
  if (tableWidth < 90) return [];

  // Detect vertical column dividers spanning >= 45% of the table height
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
  if (vXs.length < 3) return [];

  const rowCount = hYs.length - 1;
  const colCount = vXs.length - 1;
  if (rowCount < 2 || colCount < 2 || rowCount > 45 || colCount > 15) {
    return [];
  }

  // Build cell matrix & check interior line breaks for merged cells
  const grid: string[][] = Array.from({ length: rowCount }, () =>
    Array(colCount).fill('')
  );
  const mergedCells: MergedTableCellSpan[] = [];

  for (let r = 0; r < rowCount; r += 1) {
    const yTop = hYs[r];
    const yBot = hYs[r + 1];
    for (let c = 0; c < colCount; c += 1) {
      const xLeft = vXs[c];
      const xRight = vXs[c + 1];

      const cellWords = (wordBoxes ?? [])
        .filter((w) => {
          const cx = (w.x0 + w.x1) / 2;
          const cy = (w.y0 + w.y1) / 2;
          return cx >= xLeft + 1 && cx <= xRight - 1 && cy >= yTop + 1 && cy <= yBot - 1;
        })
        .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);

      grid[r][c] = cellWords.map((w) => w.text).join(' ').trim();

      // Detect horizontal colSpan: right vertical divider missing inside this row band
      if (c + 1 < colCount) {
        const divX = vXs[c + 1];
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
        if (vSegDark / segH < 0.25) {
          mergedCells.push({
            row: r,
            col: c,
            rowSpan: 1,
            colSpan: 2,
            value: grid[r][c],
          });
        }
      }
    }
  }

  const headers = grid[0].map((h, i) => h || `Column ${i + 1}`);
  const rows = grid.slice(1);

  return [
    enrichExtractedTable(
      {
        id: `p${pageNumber}-bordered-tbl-1`,
        pageNumber,
        caption: `Bordered Table (Page ${pageNumber})`,
        headers,
        rows,
      },
      {
        borderStyle: 'bordered',
        mergedCells: mergedCells.length > 0 ? mergedCells : undefined,
      }
    ),
  ];
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
