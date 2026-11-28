/**
 * PQGuide Academic Document Intelligence & Multi-Page Question Parser
 *
 * Transforms extracted/ordered page content into structured exam entities:
 *  - Exam headings, sections, and global candidate instructions
 *  - Numbered questions (`1.`, `Q1`, `Question One`) & marks (`[15 marks]`)
 *  - Attached subquestions (`(a)`, `(b)`, `(i)`, `(ii)`) linked to parent question
 *  - MCQ options (`A`–`E`), including two-column option lines (`A. Alpha   B. Beta`)
 *  - Associated equation IDs, table IDs, and figure/diagram IDs per page span
 *  - Cross-page continuation stitching (e.g. Q3 stem on Page 1 + (b)/(c) on Page 2)
 *  - Near-duplicate question detection (token trigram Jaccard >= 0.85)
 *  - Incomplete question / missing MCQ option / missing question sequence checks
 *  - Cross-page conflicting course-code checks
 */

import { sanitizeSingleLine } from '../../core/security';
import type {
  AcademicExamStructureReport,
  ExamConsistencyIssue,
  ExtractedPageContent,
  ParsedExamQuestion,
  ParsedMcqOption,
  ParsedSubquestion,
} from '../../core/types';

const WORD_NUMBERS: Record<string, string> = {
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
};

function normalizeQuestionNum(raw: string): string {
  const lower = raw.trim().toLowerCase();
  if (WORD_NUMBERS[lower]) return WORD_NUMBERS[lower];
  return raw.replace(/\D+/g, '') || lower;
}

function tokenizeForSimilarity(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  if (words.length < 3) return new Set(words);
  const trigrams = new Set<string>();
  for (let i = 0; i <= words.length - 3; i += 1) {
    trigrams.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  }
  return trigrams;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) {
    if (b.has(t)) inter += 1;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function extractInlineMcqOptions(
  line: string,
  pageNumber: number
): ParsedMcqOption[] | null {
  // Check two-column or multi-option lines: "(A) foo   (B) bar" or "A. foo  B. bar"
  const optionRegex =
    /(?:^|\s{2,}|\t)(?:\(?([A-E])\)|([A-E])[.)])\s+([\s\S]*?)(?=(?:\s{2,}|\t)(?:\(?[A-E]\)|[A-E][.)])\s+|$)/g;
  const matches: ParsedMcqOption[] = [];
  let m: RegExpExecArray | null;
  while ((m = optionRegex.exec(line)) !== null) {
    const label = (m[1] || m[2] || '').toUpperCase();
    const text = sanitizeSingleLine(m[3] || '', 260);
    if (label && text) {
      matches.push({ label, text, pageNumber });
    }
  }
  if (matches.length >= 2) {
    return matches;
  }

  // Single standalone option line at start of line
  const single = line.match(/^\s*(?:\(([A-E])\)|([A-E])[.)])\s+(.+)$/);
  if (single) {
    const label = (single[1] || single[2] || '').toUpperCase();
    const text = sanitizeSingleLine(single[3] || '', 260);
    // Avoid mistaking "a. ..." prose when uppercase/lowercase ambiguity exists — MCQ labels must be uppercase A-E
    if (label && text && /^[A-E]/.test(line.trim().replace(/^\(/, ''))) {
      return [{ label, text, pageNumber }];
    }
  }
  return null;
}

function extractMarksBadge(line: string): string | undefined {
  const m = line.match(/[[(](\d{1,3}\s*marks?)[\])]/i) ?? line.match(/\b(\d{1,3}\s*marks?)\b/i);
  return m ? sanitizeSingleLine(m[1], 32) : undefined;
}

function isHeadingLine(line: string): boolean {
  if (/^#{1,3}\s+/.test(line)) return true;
  if (line.length >= 6 && line.length <= 105 && /^[A-Z0-9\s\-:&/.,()]+$/.test(line) && /[A-Z]{3,}/.test(line)) {
    return true;
  }
  if (/^(university|faculty|department|school|examination|first|second|harmattan|rain)\b/i.test(line) && line.length <= 110) {
    return true;
  }
  return false;
}

function isInstructionLine(line: string): boolean {
  return /^(?:instructions?|directions?|note\s*to\s*candidates|answer\s+(?:all|any)\s+(?:questions?|\w+)|attempt\s+(?:all|any)|time\s+allowed|candidates?\s+are\s+advised)/i.test(
    line.trim()
  );
}

function isSectionHeader(line: string): boolean {
  return /^(?:SECTION|PART)\s+[A-Z0-9]+(?:\s*[:\-–].*)?$/i.test(line.trim());
}

export function parseAcademicExamStructure(params: {
  pages: ExtractedPageContent[];
  fileName?: string;
}): AcademicExamStructureReport {
  const sortedPages = [...params.pages].sort((a, b) => a.pageNumber - b.pageNumber);

  const examHeadings: string[] = [];
  const instructions: string[] = [];
  const sections: string[] = [];
  const questions: ParsedExamQuestion[] = [];
  const issues: ExamConsistencyIssue[] = [];

  let activeSection: string | undefined;
  let activeQuestion: ParsedExamQuestion | null = null;
  let activeSubquestion: ParsedSubquestion | null = null;
  let crossedPageBoundary = false;

  const pushQuestion = (q: ParsedExamQuestion) => {
    questions.push(q);
  };

  const attachAssetsForPage = (q: ParsedExamQuestion, pg: ExtractedPageContent) => {
    const qTextLower = `${q.stem} ${q.subquestions.map((s) => s.text).join(' ')}`.toLowerCase();
    for (const f of pg.formulas ?? []) {
      if (!q.formulaIds.includes(f.id)) {
        const snippet = f.rawText.slice(0, 12).toLowerCase();
        if (
          qTextLower.includes(snippet) ||
          pg.formulas.length <= 2 ||
          qTextLower.includes('calculate') ||
          qTextLower.includes('evaluate') ||
          qTextLower.includes('solve')
        ) {
          q.formulaIds.push(f.id);
        }
      }
    }
    for (const t of pg.tables ?? []) {
      if (!q.tableIds.includes(t.id)) {
        if (
          qTextLower.includes('table') ||
          (t.caption && qTextLower.includes(t.caption.toLowerCase().slice(0, 8))) ||
          pg.tables.length === 1
        ) {
          q.tableIds.push(t.id);
        }
      }
    }
    for (const d of pg.diagrams ?? []) {
      if (d.id.startsWith('scan-sheet')) continue;
      if (!q.diagramIds.includes(d.id)) {
        if (
          qTextLower.includes('figure') ||
          qTextLower.includes('diagram') ||
          qTextLower.includes('graph') ||
          qTextLower.includes('circuit') ||
          pg.diagrams.length === 1
        ) {
          q.diagramIds.push(d.id);
        }
      }
    }
  };

  for (let pIdx = 0; pIdx < sortedPages.length; pIdx += 1) {
    const pg = sortedPages[pIdx];
    const pageNo = pg.pageNumber;
    if (pIdx > 0) crossedPageBoundary = true;

    const lines = pg.text
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter((l) => l.trim().length > 0);

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (/^---\s*Page\s+\d+\s*---$/i.test(trimmed)) continue;
      if (/^Page\s+\d+(?:\s+of\s+\d+)?$/i.test(trimmed)) continue;
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        // Markdown table row belongs cleanly to table assets
        if (activeQuestion) attachAssetsForPage(activeQuestion, pg);
        continue;
      }

      if (isSectionHeader(trimmed)) {
        const cleanSec = sanitizeSingleLine(trimmed, 120);
        if (!sections.includes(cleanSec)) sections.push(cleanSec);
        activeSection = cleanSec;
        continue;
      }

      if (isInstructionLine(trimmed)) {
        const cleanInst = sanitizeSingleLine(trimmed, 240);
        if (!instructions.includes(cleanInst)) instructions.push(cleanInst);
        continue;
      }

      // Main question matcher:
      // 1. Define ... | Q1. ... | Q1: ... | Question 1: ... | Question One: ...
      const mainQMatch = trimmed.match(
        /^(?:(?:Q(?:uestion)?\s*#?\s*(one|two|three|four|five|six|seven|eight|nine|ten|\d+))|(\d{1,3}))(?:\s*[.):\-–]\s*|\s+(?=[A-Z($]))(.*)$/i
      );

      // Guard against year numbers ("2024/2025 Academic Session") or measurement prefixes ("2.5 cm")
      const looksLikeYearOrDecimal =
        mainQMatch &&
        (/^\d{1,3}\.\d/.test(trimmed) ||
          /^(19|20)\d{2}\b/.test(trimmed) ||
          /^\d{1,3}\s*(?:cm|mm|m|km|kg|g|mol|hrs?|hours?|mins?|marks?|%)\b/i.test(trimmed));

      if (mainQMatch && !looksLikeYearOrDecimal) {
        const rawNum = mainQMatch[1] || mainQMatch[2] || String(questions.length + 1);
        const normNum = normalizeQuestionNum(rawNum);
        const rawRest = (mainQMatch[3] || '').trim();
        const marks = extractMarksBadge(rawRest);
        const stemClean = sanitizeSingleLine(
          rawRest.replace(/[[(]\d{1,3}\s*marks?[\])]/gi, '').trim(),
          600
        );

        activeSubquestion = null;
        crossedPageBoundary = false;

        const qObj: ParsedExamQuestion = {
          id: `pq-${pageNo}-${normNum}-${questions.length + 1}`,
          questionNumber: normNum,
          rawLabel: sanitizeSingleLine(trimmed.slice(0, Math.max(4, trimmed.length - rawRest.length)), 32),
          section: activeSection,
          stem: stemClean,
          marks,
          options: [],
          subquestions: [],
          formulaIds: [],
          tableIds: [],
          diagramIds: [],
          pageNumbers: [pageNo],
          isContinuedAcrossPages: false,
          isIncomplete: false,
          incompleteReasons: [],
          isUncertain: /\[uncertain:/i.test(trimmed),
        };
        attachAssetsForPage(qObj, pg);
        pushQuestion(qObj);
        activeQuestion = qObj;
        continue;
      }

      // If not a new question heading, check Headings before subquestions/options when no active question yet or obvious heading
      if (!activeQuestion && isHeadingLine(trimmed)) {
        const hClean = sanitizeSingleLine(trimmed.replace(/^#{1,3}\s+/, ''), 160);
        if (!examHeadings.includes(hClean)) examHeadings.push(hClean);
        continue;
      }

      if (activeQuestion) {
        // Subquestion matcher: (a), (b), (i), (ii), (iii), or a) / b) (when NOT uppercase A-E MCQ option)
        const subMatch = trimmed.match(
          /^(?:\(([a-h]|i{1,3}|iv|v|vi{0,3})\)|([a-h])\))\s+(.+)$/
        );
        const isMcqLetterUpper = /^\(?[A-E][.)\]]/.test(trimmed);

        if (subMatch && !isMcqLetterUpper) {
          const subLabel = subMatch[1] ? `(${subMatch[1]})` : `${subMatch[2]})`;
          const subRest = subMatch[3].trim();
          const marks = extractMarksBadge(subRest);
          const cleanSub = sanitizeSingleLine(
            subRest.replace(/[[(]\d{1,3}\s*marks?[\])]/gi, '').trim(),
            500
          );

          if (!activeQuestion.pageNumbers.includes(pageNo)) {
            activeQuestion.pageNumbers.push(pageNo);
            activeQuestion.isContinuedAcrossPages = true;
            if (crossedPageBoundary) {
              issues.push({
                kind: 'page_continuation_stitched',
                severity: 'info',
                questionNumber: activeQuestion.questionNumber,
                pageNumbers: [...activeQuestion.pageNumbers],
                message: `Question ${activeQuestion.questionNumber} continued smoothly across pages ${activeQuestion.pageNumbers.join('–')} via subquestion ${subLabel}.`,
              });
              crossedPageBoundary = false;
            }
          }

          const subObj: ParsedSubquestion = {
            id: `${activeQuestion.id}-sub-${activeQuestion.subquestions.length + 1}`,
            label: subLabel,
            parentQuestionNumber: activeQuestion.questionNumber,
            text: cleanSub,
            marks,
            options: [],
            pageNumber: pageNo,
          };
          activeQuestion.subquestions.push(subObj);
          activeSubquestion = subObj;
          if (/\[uncertain:/i.test(trimmed)) activeQuestion.isUncertain = true;
          attachAssetsForPage(activeQuestion, pg);
          continue;
        }

        // MCQ Option line matcher (supports "A. Opt1   B. Opt2" or single "C. Opt3")
        const mcqOpts = extractInlineMcqOptions(rawLine, pageNo);
        if (mcqOpts && mcqOpts.length > 0) {
          if (!activeQuestion.pageNumbers.includes(pageNo)) {
            activeQuestion.pageNumbers.push(pageNo);
            activeQuestion.isContinuedAcrossPages = true;
            if (crossedPageBoundary) {
              issues.push({
                kind: 'page_continuation_stitched',
                severity: 'info',
                questionNumber: activeQuestion.questionNumber,
                pageNumbers: [...activeQuestion.pageNumbers],
                message: `Question ${activeQuestion.questionNumber} options continued across pages ${activeQuestion.pageNumbers.join('–')}.`,
              });
              crossedPageBoundary = false;
            }
          }
          const targetOpts = activeSubquestion ? activeSubquestion.options : activeQuestion.options;
          for (const opt of mcqOpts) {
            if (!targetOpts.some((o) => o.label === opt.label)) {
              targetOpts.push(opt);
            }
          }
          continue;
        }

        // Stop treating structural page headings as continuation prose of previous question
        if (isHeadingLine(trimmed) && trimmed.length < 85 && !/[?.;]$/.test(trimmed)) {
          const hClean = sanitizeSingleLine(trimmed.replace(/^#{1,3}\s+/, ''), 160);
          if (!examHeadings.includes(hClean)) examHeadings.push(hClean);
          continue;
        }

        // Continuation prose for the active subquestion or question stem
        if (!activeQuestion.pageNumbers.includes(pageNo)) {
          activeQuestion.pageNumbers.push(pageNo);
          activeQuestion.isContinuedAcrossPages = true;
          if (crossedPageBoundary) {
            issues.push({
              kind: 'page_continuation_stitched',
              severity: 'info',
              questionNumber: activeQuestion.questionNumber,
              pageNumbers: [...activeQuestion.pageNumbers],
              message: `Question ${activeQuestion.questionNumber} prose stitched cleanly across pages ${activeQuestion.pageNumbers.join('–')}.`,
            });
            crossedPageBoundary = false;
          }
        }
        const appended = sanitizeSingleLine(trimmed, 420);
        if (activeSubquestion) {
          activeSubquestion.text = sanitizeSingleLine(`${activeSubquestion.text} ${appended}`, 800);
        } else {
          activeQuestion.stem = sanitizeSingleLine(`${activeQuestion.stem} ${appended}`, 1000);
        }
        if (/\[uncertain:/i.test(trimmed)) activeQuestion.isUncertain = true;
        attachAssetsForPage(activeQuestion, pg);
      }
    }
  }

  // Consistency check 1: Missing sequential question numbers (e.g., 1, 2, 4 -> 3 missing)
  const numericNums = Array.from(
    new Set(
      questions
        .map((q) => parseInt(q.questionNumber, 10))
        .filter((n) => Number.isFinite(n) && n >= 1 && n <= 120)
    )
  ).sort((a, b) => a - b);

  const missingQuestionNumbers: number[] = [];
  if (numericNums.length >= 2) {
    const minQ = Math.min(...numericNums);
    const maxQ = Math.max(...numericNums);
    if (maxQ - minQ <= 60) {
      for (let n = minQ; n <= maxQ; n += 1) {
        if (!numericNums.includes(n)) {
          missingQuestionNumbers.push(n);
        }
      }
    }
  }
  if (missingQuestionNumbers.length > 0) {
    issues.push({
      kind: 'missing_question_number',
      severity: 'warning',
      pageNumbers: sortedPages.map((p) => p.pageNumber),
      message: `Missing sequential question number(s): Q${missingQuestionNumbers.join(', Q')}. Check for skipped pages or crop loss.`,
    });
  }

  // Consistency check 2: Near-duplicate question detection across pages
  const duplicateQuestions: AcademicExamStructureReport['duplicateQuestions'] = [];
  const sigTokens = questions.map((q) =>
    tokenizeForSimilarity(`${q.stem} ${q.subquestions.map((s) => s.text).join(' ')}`)
  );
  for (let i = 0; i < questions.length; i += 1) {
    for (let j = i + 1; j < questions.length; j += 1) {
      const sim = jaccardSimilarity(sigTokens[i], sigTokens[j]);
      if (sim >= 0.85) {
        questions[j].duplicateOfQuestionNumber = questions[i].questionNumber;
        duplicateQuestions.push({
          questionNumber: questions[j].questionNumber,
          matchesQuestionNumber: questions[i].questionNumber,
          similarity: Number(sim.toFixed(2)),
        });
        issues.push({
          kind: 'duplicate_question',
          severity: 'warning',
          questionNumber: questions[j].questionNumber,
          pageNumbers: Array.from(
            new Set([...questions[i].pageNumbers, ...questions[j].pageNumbers])
          ),
          message: `Question ${questions[j].questionNumber} duplicates Question ${questions[i].questionNumber} (${Math.round(sim * 100)}% overlap).`,
        });
      }
    }
  }

  // Consistency check 3: Incomplete question or skipped MCQ option letters (e.g. A, B, D -> missing C)
  const incompleteQuestions: AcademicExamStructureReport['incompleteQuestions'] = [];
  for (const q of questions) {
    const reasons: string[] = [];
    if (q.stem.trim().length < 4 && q.subquestions.length === 0) {
      reasons.push('Empty or unreadable question stem');
    } else if (/[:\-–]$/.test(q.stem.trim()) && q.subquestions.length === 0 && q.options.length === 0 && q.formulaIds.length === 0 && q.tableIds.length === 0) {
      reasons.push('Question appears truncated after colon/dash');
    }

    const checkOptionSequence = (opts: ParsedMcqOption[], scope: string) => {
      if (opts.length < 2) return;
      const letters = opts.map((o) => o.label.charCodeAt(0) - 65).sort((a, b) => a - b);
      const maxCode = Math.max(...letters);
      const missing: string[] = [];
      for (let c = 0; c <= maxCode; c += 1) {
        if (!letters.includes(c)) missing.push(String.fromCharCode(65 + c));
      }
      if (missing.length > 0) {
        reasons.push(`Missing MCQ option(s) ${missing.join(', ')} in ${scope}`);
        issues.push({
          kind: 'missing_mcq_option',
          severity: 'warning',
          questionNumber: q.questionNumber,
          pageNumbers: q.pageNumbers,
          message: `Question ${q.questionNumber} (${scope}) is missing MCQ option(s): ${missing.join(', ')}.`,
        });
      }
    };

    checkOptionSequence(q.options, `Q${q.questionNumber}`);
    for (const sub of q.subquestions) {
      checkOptionSequence(sub.options, `Q${q.questionNumber}${sub.label}`);
    }

    if (q.isUncertain) {
      reasons.push('Contains uncertain OCR marker requiring verification');
    }

    if (reasons.length > 0) {
      q.isIncomplete = true;
      q.incompleteReasons = reasons;
      incompleteQuestions.push({
        questionNumber: q.questionNumber,
        reasons,
        pageNumbers: q.pageNumbers,
      });
      issues.push({
        kind: 'incomplete_question',
        severity: 'warning',
        questionNumber: q.questionNumber,
        pageNumbers: q.pageNumbers,
        message: `Question ${q.questionNumber} flagged incomplete: ${reasons.join('; ')}.`,
      });
    }
  }

  // Consistency check 4: Multi-page conflicting course codes
  if (sortedPages.length > 1) {
    const pageCodes: Array<{ page: number; code: string }> = [];
    for (const pg of sortedPages) {
      const m = pg.text.match(/\b([A-Z]{2,4})\s?(\d{3})\b/);
      if (m) {
        pageCodes.push({ page: pg.pageNumber, code: `${m[1]} ${m[2]}` });
      }
    }
    const distinctCodes = Array.from(new Set(pageCodes.map((p) => p.code)));
    if (distinctCodes.length > 1) {
      issues.push({
        kind: 'conflicting_course_code',
        severity: 'warning',
        pageNumbers: pageCodes.map((p) => p.page),
        message: `Multiple distinct course codes detected across pages (${distinctCodes.join(' vs ')}). Confirm pages belong to one paper.`,
      });
    }
  }

  return {
    examHeadings: examHeadings.slice(0, 16),
    instructions: instructions.slice(0, 12),
    sections: sections.slice(0, 12),
    questions,
    duplicateQuestions,
    incompleteQuestions,
    missingQuestionNumbers,
    continuedQuestionNumbers: questions
      .filter((q) => q.isContinuedAcrossPages)
      .map((q) => q.questionNumber),
    issues,
    totalDetectedQuestions: questions.length,
  };
}
