import type {
  AcademicDocCategory,
  ClassificationCandidate,
  DetailedAcademicCategory,
  DocumentClassificationResult,
  ExtractedAcademicMetadata,
  ExtractedDiagramAsset,
  ExtractedFormula,
  ExtractedTable,
  FormExtractionResult,
  OmrScanResult,
} from '../../core/types';

export interface DocumentClassificationInput {
  fileName: string;
  text: string;
  headings: string[];
  tables: ExtractedTable[];
  formulas: ExtractedFormula[];
  diagrams: ExtractedDiagramAsset[];
  omrResults?: OmrScanResult;
  formResults?: FormExtractionResult;
  metadata?: ExtractedAcademicMetadata;
}

const CATEGORY_META: Record<
  DetailedAcademicCategory,
  { label: string; legacy: AcademicDocCategory }
> = {
  past_question: { label: 'Past Question', legacy: 'past_question' },
  examination_paper: { label: 'Examination Paper', legacy: 'past_question' },
  answer_sheet: { label: 'Answer Sheet / OMR', legacy: 'past_question' },
  lecture_note: { label: 'Lecture Note', legacy: 'lecture_note' },
  course_material: { label: 'Course Material', legacy: 'study_material' },
  handout: { label: 'Handout', legacy: 'study_material' },
  assignment: { label: 'Assignment / Problem Set', legacy: 'study_material' },
  study_guide: { label: 'Study Guide / Revision', legacy: 'study_material' },
  academic_timetable: { label: 'Academic Timetable', legacy: 'reference' },
  other_academic_document: { label: 'Other Academic Document', legacy: 'reference' },
};

export function mapDetailedToLegacyCategory(
  detailed: DetailedAcademicCategory,
  hasRichDiagrams?: boolean
): AcademicDocCategory {
  if (detailed === 'other_academic_document' && hasRichDiagrams) {
    return 'lab_diagram';
  }
  return CATEGORY_META[detailed].legacy;
}

export function classifyAcademicDocument(
  input: DocumentClassificationInput
): DocumentClassificationResult {
  const {
    fileName,
    text,
    tables,
    formulas,
    diagrams,
    omrResults,
    formResults,
    metadata,
  } = input;

  const lower = `${fileName}\n${text.slice(0, 6000)}`.toLowerCase();

  const scoreMap: Record<DetailedAcademicCategory, { score: number; signals: string[] }> = {
    past_question: { score: 0.05, signals: [] },
    examination_paper: { score: 0.05, signals: [] },
    answer_sheet: { score: 0.05, signals: [] },
    lecture_note: { score: 0.05, signals: [] },
    course_material: { score: 0.05, signals: [] },
    handout: { score: 0.05, signals: [] },
    assignment: { score: 0.05, signals: [] },
    study_guide: { score: 0.05, signals: [] },
    academic_timetable: { score: 0.05, signals: [] },
    other_academic_document: { score: 0.12, signals: ['Baseline fallback'] },
  };

  const add = (
    cat: DetailedAcademicCategory,
    weight: number,
    signal: string
  ) => {
    scoreMap[cat].score += weight;
    scoreMap[cat].signals.push(signal);
  };

  // Answer Sheet / OMR signals
  if (omrResults?.detected) {
    add('answer_sheet', 0.65, 'Detected OMR multiple-choice bubble grid');
  }
  if (/\b(answer\s+sheet|omr\s+sheet|shade\s+correctly|candidate\s+response)\b/i.test(lower)) {
    add('answer_sheet', 0.35, 'Answer sheet / shading instruction wording');
  }
  if (formResults?.detected && formResults.fields.some((f) => /matric|candidate/i.test(f.label))) {
    add('answer_sheet', 0.18, 'Candidate identification form fields');
  }

  // Timetable signals
  if (/\b(timetable|time[\s-]table|exam(?:ination)?\s+schedule|lecture\s+schedule)\b/i.test(lower)) {
    add('academic_timetable', 0.55, 'Explicit timetable / schedule heading');
  }
  const dayHits = (lower.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday)\b/g) || []).length;
  const timeHits = (lower.match(/\b\d{1,2}[:.]\d{2}\s*(am|pm)?\b/g) || []).length;
  if (tables.length > 0 && dayHits >= 3 && timeHits >= 3) {
    add('academic_timetable', 0.45, 'Structured days-of-week & time-slot table');
  }

  // Past Question vs Live Examination Paper signals
  if (/\b(past\s+question|pq|previous\s+exam|compiled\s+questions?)\b/i.test(lower)) {
    add('past_question', 0.48, 'Explicit Past Question marker');
  }
  if (/\b(time\s+allowed|duration\s*:|instructions?\s+to\s+candidates|answer\s+(any|all)\s+\w*\s*questions|section\s+[a-d]|total\s+marks)\b/i.test(lower)) {
    add('examination_paper', 0.38, 'Formal exam instructions / time allowed / sections');
    add('past_question', 0.28, 'Archived examination structure');
  }
  if (metadata?.examinationDuration.status === 'extracted' || metadata?.totalMarks.status === 'extracted') {
    add('examination_paper', 0.22, 'Extracted examination duration/total marks');
    add('past_question', 0.15, 'Exam metadata present');
  }
  const questionMarkers = (text.match(/^\s*(?:Q\.?\s*\d+|\d+\s*[.)]|\([a-e]\))/gim) || []).length;
  if (questionMarkers >= 4) {
    add('past_question', 0.2, `Numbered questions (${questionMarkers})`);
    add('examination_paper', 0.18, `Numbered questions (${questionMarkers})`);
  }

  // Assignment signals
  if (/\b(assignment|homework|problem\s+set|lab\s+(?:exercise|report)|submission\s+deadline|due\s+date)\b/i.test(lower)) {
    add('assignment', 0.52, 'Assignment / submission deadline / problem set cues');
  }

  // Lecture Note signals
  if (/\b(lecture\s+notes?|week\s+\d+|module\s+\d+|chapter\s+\d+|learning\s+objectives?|definitions?)\b/i.test(lower)) {
    add('lecture_note', 0.42, 'Lecture / week / module instructional heading');
  }
  if (formulas.length >= 2 && questionMarkers < 3) {
    add('lecture_note', 0.18, 'Explanatory mathematical derivations');
  }

  // Course Material & Handout signals
  if (/\b(course\s+material|syllabus|course\s+outline|curriculum|reading\s+list)\b/i.test(lower)) {
    add('course_material', 0.48, 'Course material / syllabus / outline cues');
  }
  if (/\b(handout|class\s+handout|tutorial\s+sheet|summary\s+sheet)\b/i.test(lower)) {
    add('handout', 0.5, 'Handout / tutorial sheet keyword');
  }

  // Study Guide signals
  if (/\b(study\s+guide|revision\s+guide|exam\s+prep|key\s+takeaways|cheat\s+sheet|worked\s+examples?)\b/i.test(lower)) {
    add('study_guide', 0.52, 'Study / revision guide terminology');
  }

  if (diagrams.length >= 2 && text.trim().length < 500) {
    add('course_material', 0.15, 'Diagram-rich instructional sheets');
  }

  const candidates: ClassificationCandidate[] = (
    Object.keys(scoreMap) as DetailedAcademicCategory[]
  )
    .map((cat) => {
      const entry = scoreMap[cat];
      const clamped = Math.min(0.99, Number(entry.score.toFixed(2)));
      return {
        category: cat,
        label: CATEGORY_META[cat].label,
        score: clamped,
        matchedSignals: entry.signals.length > 0 ? entry.signals : ['Low signal match'],
      };
    })
    .sort((a, b) => b.score - a.score);

  const top = candidates[0];
  const second = candidates[1];
  const margin = top.score - (second?.score ?? 0);
  const uncertain = top.score < 0.45 || margin < 0.08;

  return {
    primaryCategory: top.category,
    primaryLabel: top.label,
    mappedLegacyCategory: mapDetailedToLegacyCategory(top.category, diagrams.length >= 2),
    confidence: top.score,
    uncertain,
    candidates: candidates.slice(0, 5),
    reason: uncertain
      ? `Low confidence or close tie between ${top.label} (${top.score}) and ${second?.label ?? 'None'} (${second?.score ?? 0}); Super Admin verification recommended.`
      : `Classified as ${top.label} based on: ${top.matchedSignals.slice(0, 3).join('; ')}.`,
  };
}
