import { sanitizePlainText, sanitizeSingleLine } from '../../core/security';
import type {
  AcademicDocCategory,
  ExtractedFormula,
  ExtractedTable,
  SemesterType,
  StudentLevel,
} from '../../core/types';

export interface StructuredDocumentParse {
  headings: string[];
  tables: ExtractedTable[];
  formulas: ExtractedFormula[];
  summary: string;
  suggestedTitle: string;
  courseCode: string;
  courseTitle: string;
  level: StudentLevel;
  session: string;
  semester: SemesterType;
  category: AcademicDocCategory;
  questionLines: string[];
  detectedHeadersFooters?: string[];
}

export function extractFormulasFromText(
  text: string,
  pageNumber = 1
): ExtractedFormula[] {
  const formulas: ExtractedFormula[] = [];
  const seen = new Set<string>();

  const pushFormula = (rawText: string, latex: string, displayMode: boolean) => {
    const cleanLatex = sanitizeSingleLine(latex, 320);
    if (!cleanLatex || cleanLatex.length < 2) return;
    const key = `${pageNumber}:${displayMode ? 'D' : 'I'}:${cleanLatex}`;
    if (seen.has(key)) return;
    seen.add(key);
    formulas.push({
      id: `fml-${pageNumber}-${formulas.length + 1}`,
      pageNumber,
      rawText: sanitizeSingleLine(rawText, 320),
      latex: cleanLatex,
      displayMode,
    });
  };

  // Explicit block LaTeX: $$...$$ or \[...\]
  const blockRegex = /\$\$([\s\S]{2,320}?)\$\$|\\\[([\s\S]{2,320}?)\\\]/g;
  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(text)) !== null && formulas.length < 24) {
    const inner = (match[1] ?? match[2] ?? '').trim();
    pushFormula(match[0], inner, true);
  }

  // Explicit inline LaTeX: $...$ (avoid matching currency like $500)
  const inlineRegex = /(^|[^\\$])\$([^$\n]{2,180}?)\$/g;
  while ((match = inlineRegex.exec(text)) !== null && formulas.length < 28) {
    const inner = (match[2] ?? '').trim();
    if (/^\d[\d,.]*$/.test(inner)) continue;
    if (/[=+*/^_\\]|\\[a-zA-Z]+|[a-zA-Z]\s*-\s*[a-zA-Z]/.test(inner)) {
      pushFormula(`$${inner}$`, inner, false);
    }
  }

  // Natural academic equations and Unicode/ASCII mathematical expressions per line
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    if (formulas.length >= 36) break;
    const line = rawLine.trim();
    if (line.length < 4 || line.length > 160) continue;
    if (line.includes('$')) continue;
    const hasUnicodeMath = /[∑∫√≤≥≠≈×÷Δπθλσμ±∞∂∇]/.test(line);
    const looksLikeAsciiEquation =
      /^[A-Za-z0-9\\(){}[\]^_+\-*/.,\s=<>]+=[A-Za-z0-9\\(){}[\]^_+\-*/.,\s=<>]+$/.test(line) &&
      /[A-Za-z]/.test(line) &&
      (/[\^_*/\\]/.test(line) ||
        /\b(sin|cos|tan|log|ln|lim|sqrt|int|sum|dx|dy|dt|det|matrix)\b/i.test(line));
    const looksLikeMathSymbolExpr =
      hasUnicodeMath && /[=<>≤≥≠≈]/.test(line) && /[A-Za-z0-9]/.test(line);
    if (looksLikeAsciiEquation || looksLikeMathSymbolExpr) {
      pushFormula(line, line, true);
    }
  }

  return formulas;
}

function splitWhitespaceAlignedColumns(line: string): string[] {
  return line
    .trim()
    .split(/\s{3,}|\t+/)
    .map((c) => sanitizeSingleLine(c, 120))
    .filter(Boolean);
}

export function extractTablesFromText(
  text: string,
  pageNumber = 1
): ExtractedTable[] {
  const tables: ExtractedTable[] = [];
  const lines = text.split(/\r?\n/);
  let i = 0;

  while (i < lines.length && tables.length < 12) {
    const rawLine = lines[i].trim();
    const isPipeRow = rawLine.startsWith('|') && rawLine.endsWith('|') && rawLine.includes('|');
    const isTabRow = rawLine.split('\t').length >= 3;
    const spacedCols = splitWhitespaceAlignedColumns(rawLine);
    // Avoid false table matches on 2-column exam metadata header rows like "COURSE CODE: SEN 202   UNIT: 3"
    const isSpacedTableRow =
      !isPipeRow &&
      !isTabRow &&
      spacedCols.length >= 3 &&
      rawLine.length <= 150 &&
      !/^[-=_.\s]+$/.test(rawLine);

    if (!isPipeRow && !isTabRow && !isSpacedTableRow) {
      i += 1;
      continue;
    }

    const block: string[][] = [];
    const expectedCols = isSpacedTableRow ? spacedCols.length : 0;

    while (i < lines.length) {
      const cur = lines[i].trim();
      if (isPipeRow && cur.startsWith('|') && cur.includes('|')) {
        if (/^\|[\s:-]+\|/.test(cur) && !/[a-zA-Z0-9]/.test(cur)) {
          i += 1;
          continue;
        }
        const cells = cur
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => sanitizeSingleLine(c, 120));
        if (cells.length >= 2) block.push(cells);
        i += 1;
      } else if (isTabRow && cur.split('\t').length >= 2) {
        block.push(cur.split('\t').map((c) => sanitizeSingleLine(c, 120)));
        i += 1;
      } else if (isSpacedTableRow) {
        if (/^[-=_+\s]{3,}$/.test(cur)) {
          i += 1;
          continue;
        }
        const cols = splitWhitespaceAlignedColumns(cur);
        if (cols.length >= 3 && Math.abs(cols.length - expectedCols) <= 1) {
          block.push(cols);
          i += 1;
        } else {
          break;
        }
      } else {
        break;
      }
    }

    const minRows = isSpacedTableRow ? 3 : 2;
    if (block.length >= minRows) {
      const colCount = Math.max(...block.map((r) => r.length));
      const headers = Array.from({ length: colCount }, (_, idx) => block[0][idx] ?? '');
      const rows = block.slice(1).map((r) =>
        Array.from({ length: colCount }, (_, idx) => r[idx] ?? '')
      );
      tables.push({
        id: `tbl-${pageNumber}-${tables.length + 1}`,
        pageNumber,
        headers,
        rows,
      });
    }
  }

  return tables;
}

export function extractHeadingsFromText(text: string): string[] {
  const headings: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.length < 3 || line.length > 110) continue;
    if (/^---\s*Page\s+\d+/i.test(line)) continue;
    const mdMatch = line.match(/^#{1,4}\s+(.+)$/);
    const clean = sanitizeSingleLine(mdMatch ? mdMatch[1] : line, 110);
    if (!clean) continue;
    const isAllCapsHeading =
      clean.length >= 6 &&
      clean.length <= 80 &&
      /[A-Z]{3}/.test(clean) &&
      clean === clean.toUpperCase() &&
      !/^\d+[.)]/.test(clean) &&
      !/^[-_=]{3,}$/.test(clean);
    const isSectionLabel =
      /^(section\s+[a-z0-9]+|part\s+[a-z0-9]+|chapter\s+\d+|unit\s+\d+|module\s+\d+|question\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+))\b/i.test(
        clean
      );
    if (mdMatch || isAllCapsHeading || isSectionLabel) {
      const key = clean.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        headings.push(clean);
      }
    }
    if (headings.length >= 20) break;
  }
  return headings;
}

/**
 * Detects repeated short running headers/footers across >= 2 pages of a multi-page
 * document (e.g. "Page 2 of 6", repeating confidential/watermark headers) while
 * leaving unique Page 1 titles intact.
 */
export function detectRepeatedHeadersFooters(pageTexts: string[]): {
  cleanedPages: string[];
  detected: string[];
} {
  if (pageTexts.length < 2) {
    return { cleanedPages: pageTexts, detected: [] };
  }

  const edgeCounts = new Map<string, { raw: string; count: number }>();
  const normalizeEdge = (line: string) =>
    line
      .toLowerCase()
      .replace(/\bpage\s*\d+(\s*(of|\/)\s*\d+)?\b/g, 'page #')
      .replace(/\d+/g, '#')
      .replace(/\s+/g, ' ')
      .trim();

  for (const page of pageTexts) {
    const lines = page
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 4) continue;
    const candidates = [lines[0], lines[1], lines[lines.length - 1], lines[lines.length - 2]].filter(
      (l): l is string => Boolean(l) && l.length <= 85
    );
    const seenOnPage = new Set<string>();
    for (const c of candidates) {
      const norm = normalizeEdge(c);
      if (!norm || norm.length < 4 || seenOnPage.has(norm)) continue;
      seenOnPage.add(norm);
      const cur = edgeCounts.get(norm);
      edgeCounts.set(norm, { raw: cur?.raw ?? c, count: (cur?.count ?? 0) + 1 });
    }
  }

  const repeatedNorms = new Set<string>();
  const detected: string[] = [];
  const minThreshold = Math.max(2, Math.ceil(pageTexts.length * 0.5));
  for (const [norm, entry] of edgeCounts.entries()) {
    const isExplicitPageNumber = /^page\s*#/i.test(norm) || /^#\s*$/.test(norm);
    if (entry.count >= minThreshold || (isExplicitPageNumber && entry.count >= 2)) {
      repeatedNorms.add(norm);
      detected.push(entry.raw);
    }
  }

  const cleanedPages = pageTexts.map((page, pageIdx) => {
    const lines = page.split(/\r?\n/);
    if (lines.length < 4) return page.trim();
    const out: string[] = [];
    for (let idx = 0; idx < lines.length; idx += 1) {
      const t = lines[idx].trim();
      const isEdge = idx <= 1 || idx >= lines.length - 2;
      if (isEdge && t) {
        const norm = normalizeEdge(t);
        // Keep institutional title on Page 1 top, strip trailing page markers and later repeating boilerplate
        const isPageNum = /^page\s*\d+(\s*(of|\/)\s*\d+)?$/i.test(t) || /^\d{1,3}$/.test(t);
        if (repeatedNorms.has(norm) && (pageIdx > 0 || isPageNum || idx >= lines.length - 2)) {
          continue;
        }
      }
      out.push(lines[idx]);
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  });

  return { cleanedPages, detected: detected.slice(0, 8) };
}

/**
 * Formats multi-page document content with clean paragraph structure and explicit page
 * boundaries when multiple pages exist.
 */
export function formatMultiPageStructuredText(pages: Array<{ pageNumber: number; text: string }>): string {
  if (pages.length === 0) return '';
  if (pages.length === 1) return pages[0].text.trim();
  return pages
    .map((p) => {
      const body = p.text.trim();
      return `--- Page ${p.pageNumber} ---\n${body || '[No readable text extracted on this page]'}`;
    })
    .join('\n\n');
}

export function parseStructuredDocument(params: {
  fileName: string;
  extractedText: string;
  extraHeadings?: string[];
  extraTables?: ExtractedTable[];
  extraFormulas?: ExtractedFormula[];
  detectedHeadersFooters?: string[];
}): StructuredDocumentParse {
  const cleanBody = sanitizePlainText(params.extractedText, 120_000);
  const combined = `${params.fileName}\n${cleanBody}`;
  const courseMatch = combined.match(/\b([A-Za-z]{3})\s?[-_:]?\s?(\d{3})\b/);
  const courseCode = courseMatch
    ? `${courseMatch[1].toUpperCase()} ${courseMatch[2]}`
    : 'GEN 101';
  const levelDigit = courseMatch?.[2]?.[0];
  const level: StudentLevel =
    levelDigit === '2'
      ? '200L'
      : levelDigit === '3'
        ? '300L'
        : levelDigit === '4'
          ? '400L'
          : levelDigit === '5'
            ? '500L'
            : '100L';

  const sessionMatch = combined.match(/\b(20\d{2})\s?[\/_-]\s?(20\d{2})\b/);
  const session = sessionMatch ? `${sessionMatch[1]}/${sessionMatch[2]}` : '2024/2025';
  const lower = combined.toLowerCase();
  const semester: SemesterType =
    lower.includes('second semester') || lower.includes('rain semester')
      ? 'Second Semester'
      : 'First Semester';

  const headings = Array.from(
    new Set([
      ...(params.extraHeadings ?? []),
      ...extractHeadingsFromText(cleanBody),
    ])
  ).slice(0, 24);

  const tables = [...(params.extraTables ?? []), ...extractTablesFromText(cleanBody, 1)];
  const formulas = [...(params.extraFormulas ?? []), ...extractFormulasFromText(cleanBody, 1)];

  const lines = cleanBody
    .split(/\r?\n/)
    .map((l) => sanitizeSingleLine(l, 260))
    .filter((l) => l.length >= 6 && !/^---\s*Page\s+\d+/i.test(l));

  const questionLines = lines.filter((line) =>
    /^(q\s?\d+|question\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)|\d+[.)]|\([a-z0-9]+\))/i.test(
      line
    )
  );

  let category: AcademicDocCategory = 'study_material';
  if (
    lower.includes('past question') ||
    lower.includes('examination') ||
    lower.includes('time allowed') ||
    lower.includes('marks)') ||
    questionLines.length >= 2
  ) {
    category = 'past_question';
  } else if (lower.includes('lecture note') || lower.includes('week ')) {
    category = 'lecture_note';
  } else if (
    lower.includes('experiment') ||
    lower.includes('diagram') ||
    lower.includes('apparatus')
  ) {
    category = 'lab_diagram';
  }

  const fileStem = sanitizeSingleLine(
    params.fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '),
    140
  );
  const courseTitleLine = cleanBody.match(/course\s*title\s*[:\-]\s*([^\n|]+)/i)?.[1]?.trim();
  const suggestedTitle =
    headings[0] && headings[0].length <= 95
      ? headings[0]
      : fileStem || `${courseCode} Academic Document`;
  const courseTitle =
    (courseTitleLine ? sanitizeSingleLine(courseTitleLine, 120) : '') ||
    headings.find((h) => h.length > 4 && !/^\d/.test(h)) ||
    fileStem ||
    `${courseCode} Course Document`;

  const summarySource = lines.filter((l) => l.length >= 24).slice(0, 3).join(' ');
  const summary =
    sanitizeSingleLine(summarySource, 280) ||
    `Processed academic document (${courseCode}) extracted from ${params.fileName}.`;

  return {
    headings,
    tables,
    formulas,
    summary,
    suggestedTitle,
    courseCode,
    courseTitle,
    level,
    session,
    semester,
    category,
    questionLines: questionLines.slice(0, 30),
    detectedHeadersFooters: params.detectedHeadersFooters,
  };
}

/**
 * Pulls typed exam questions out of extracted document text. Only lines that look
 * like numbered questions are used, so nothing is invented from unrelated text.
 */
export function extractQuestionsFromText(text: string, max = 40): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 10);
  return lines
    .filter((l) =>
      /^(q\s?\d+|question\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)|\d{1,2}\s?[.)])/i.test(
        l
      )
    )
    .slice(0, max);
}
