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

  // Natural academic equations per line (e.g., E = mc^2, a^2 + b^2 = c^2, dy/dx = 2x)
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    if (formulas.length >= 32) break;
    const line = rawLine.trim();
    if (line.length < 5 || line.length > 140) continue;
    if (line.includes('$')) continue;
    const looksLikeEquation =
      /^[A-Za-z0-9\\(){}[\]^_+\-*/.,\s]+=[A-Za-z0-9\\(){}[\]^_+\-*/.,\s]+$/.test(line) &&
      /[A-Za-z]/.test(line) &&
      (/[\^_*/\\]/.test(line) || /\b(sin|cos|tan|log|ln|lim|sqrt|int|sum|dx|dy)\b/i.test(line));
    if (looksLikeEquation) {
      pushFormula(line, line, true);
    }
  }

  return formulas;
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

    if (!isPipeRow && !isTabRow) {
      i += 1;
      continue;
    }

    const block: string[][] = [];
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
      } else if (isTabRow && cur.split('\t').length >= 3) {
        block.push(cur.split('\t').map((c) => sanitizeSingleLine(c, 120)));
        i += 1;
      } else {
        break;
      }
    }

    if (block.length >= 2) {
      const colCount = block[0].length;
      const headers = block[0];
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

    const mdMatch = line.match(/^#{1,4}\s+(.+)$/);
    const clean = sanitizeSingleLine(mdMatch ? mdMatch[1] : line, 110);
    if (!clean) continue;

    const isAllCapsHeading =
      clean.length >= 6 &&
      clean.length <= 75 &&
      /[A-Z]{3}/.test(clean) &&
      clean === clean.toUpperCase() &&
      !/^\d+[.)]/.test(clean);

    const isSectionLabel = /^(section\s+[a-z0-9]+|part\s+[a-z0-9]+|chapter\s+\d+|unit\s+\d+|module\s+\d+)\b/i.test(
      clean
    );

    if (mdMatch || isAllCapsHeading || isSectionLabel) {
      const key = clean.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        headings.push(clean);
      }
    }
    if (headings.length >= 16) break;
  }

  return headings;
}

export function parseStructuredDocument(params: {
  fileName: string;
  extractedText: string;
  extraHeadings?: string[];
  extraTables?: ExtractedTable[];
  extraFormulas?: ExtractedFormula[];
}): StructuredDocumentParse {
  const cleanBody = sanitizePlainText(params.extractedText, 40_000);
  const combined = `${params.fileName}\n${cleanBody}`;

  const courseMatch = combined.match(/\b([A-Za-z]{3})\s?[-_]?\s?(\d{3})\b/);
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
  ).slice(0, 20);

  const tables = [...(params.extraTables ?? []), ...extractTablesFromText(cleanBody, 1)];
  const formulas = [...(params.extraFormulas ?? []), ...extractFormulasFromText(cleanBody, 1)];

  const lines = cleanBody
    .split(/\r?\n/)
    .map((l) => sanitizeSingleLine(l, 260))
    .filter((l) => l.length >= 8);

  const questionLines = lines.filter((line) =>
    /^(q\d+|question\s+\d+|\d+[.)]|\([a-z0-9]+\))/i.test(line)
  );

  let category: AcademicDocCategory = 'study_material';
  if (
    lower.includes('past question') ||
    lower.includes('examination') ||
    lower.includes('time allowed') ||
    questionLines.length >= 3
  ) {
    category = 'past_question';
  } else if (lower.includes('lecture note') || lower.includes('week ')) {
    category = 'lecture_note';
  } else if (lower.includes('experiment') || lower.includes('diagram') || lower.includes('apparatus')) {
    category = 'lab_diagram';
  }

  const fileStem = sanitizeSingleLine(
    params.fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '),
    140
  );

  const suggestedTitle =
    headings[0] && headings[0].length <= 90
      ? headings[0]
      : fileStem || `${courseCode} Academic Document`;

  const courseTitle =
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
    questionLines: questionLines.slice(0, 24),
  };
}
