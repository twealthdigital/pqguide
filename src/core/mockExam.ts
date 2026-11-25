import type { PastQuestionDoc, QuestionSolution, StudyMaterial } from './types';
import { cleanCourseTitle } from './docTitle';

/**
 * Practice-exam builder and types.
 *
 * Supports four exam formats:
 * - obj: Full paper list of multiple-choice questions (A–D)
 * - theory: Full paper list of essay/short-answer questions with answer boxes underneath
 * - boolean: Full paper list of True / False statements
 * - cbt: Computer-Based Test (one multiple-choice question at a time with A–D options)
 */

export const ALL_COURSES = 'ALL';

export type ExamType = 'obj' | 'theory' | 'boolean' | 'cbt';

export interface ExamTypeMeta {
  id: ExamType;
  label: string;
  badge: string;
  description: string;
}

export const EXAM_TYPES: ExamTypeMeta[] = [
  {
    id: 'obj',
    label: 'OBJ (Paper)',
    badge: 'OBJ Paper',
    description: 'Full list of questions with A–D options like a real paper',
  },
  {
    id: 'theory',
    label: 'Theory (Paper)',
    badge: 'Theory Paper',
    description: 'All questions on one paper with answer spaces underneath',
  },
  {
    id: 'boolean',
    label: 'True / False',
    badge: 'True / False',
    description: 'Statements where you select True or False only',
  },
  {
    id: 'cbt',
    label: 'CBT',
    badge: 'CBT',
    description: 'Multiple-choice options shown one question at a time',
  },
];

export interface ExamCourseOption {
  code: string;
  title: string;
  level: string;
  questionCount: number;
  sessionCount: number;
}

export interface ExamSpec {
  examType: ExamType;
  /** A course code, or ALL_COURSES. */
  courseCode: string;
  questionCount: number;
  minutes: number;
  /** Optional topic words the student wants more of. */
  focus: string;
}

export interface ExamQuestion {
  id: string;
  number: number;
  text: string;
  courseCode: string;
  source: string;
  solution: QuestionSolution | null;
  /** Short reasons this question was picked, shown as tags. */
  reasons: string[];
  /** Multiple-choice options (A–D) for 'obj' and 'cbt'. */
  options?: string[];
  /** Zero-based correct option index for 'obj' and 'cbt'. */
  correctIndex?: number;
  /** Correct answer for 'boolean' (True/False). */
  correctBoolean?: boolean;
}

export interface BuiltExam {
  examType: ExamType;
  questions: ExamQuestion[];
  /** How many archive past questions were available for the chosen course. */
  poolSize: number;
}

const stripLabel = (q: string) => q.replace(/^Q\d+\s*[:.)-]\s*/i, '').trim();

const STOP = new Set([
  'about', 'above', 'after', 'again', 'also', 'answer', 'because', 'been', 'before', 'between',
  'both', 'could', 'describe', 'discuss', 'does', 'each', 'explain', 'from', 'give', 'have',
  'into', 'list', 'marks', 'more', 'most', 'must', 'much', 'only', 'other', 'question',
  'should', 'some', 'state', 'such', 'than', 'that', 'their', 'them', 'then', 'there', 'these',
  'they', 'this', 'those', 'using', 'what', 'when', 'where', 'which', 'while', 'with', 'would',
  'write', 'your',
]);

const tokens = (text: string): Set<string> => {
  const out = new Set<string>();
  for (const w of text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)) {
    if (w.length >= 4 && !STOP.has(w)) out.add(w);
  }
  return out;
};

const shared = (a: Set<string>, b: Set<string>) => {
  let n = 0;
  a.forEach((w) => {
    if (b.has(w)) n += 1;
  });
  return n;
};

/** Courses that have at least one question, for the course picker. */
export const listExamCourses = (docs: PastQuestionDoc[]): ExamCourseOption[] => {
  const map = new Map<string, ExamCourseOption & { sessions: Set<string> }>();
  for (const doc of docs) {
    const count = doc.questions.map(stripLabel).filter((q) => q.length > 7).length;
    if (count === 0) continue;
    const entry = map.get(doc.courseCode) ?? {
      code: doc.courseCode,
      title: cleanCourseTitle(doc),
      level: doc.level,
      questionCount: 0,
      sessionCount: 0,
      sessions: new Set<string>(),
    };
    entry.questionCount += count;
    entry.sessions.add(doc.session);
    entry.sessionCount = entry.sessions.size;
    if (!entry.title) entry.title = cleanCourseTitle(doc);
    map.set(doc.courseCode, entry);
  }
  return Array.from(map.values())
    .map(({ sessions: _sessions, ...rest }) => rest)
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
};

export const countQuestionsFor = (docs: PastQuestionDoc[], courseCode: string): number =>
  listExamCourses(docs)
    .filter((c) => courseCode === ALL_COURSES || c.code === courseCode)
    .reduce((sum, c) => sum + c.questionCount, 0);

interface Candidate {
  doc: PastQuestionDoc;
  index: number;
  text: string;
  words: Set<string>;
  score: number;
  reasons: string[];
}

export const buildExam = (docs: PastQuestionDoc[], spec: ExamSpec): BuiltExam => {
  const scoped = docs.filter((d) => spec.courseCode === ALL_COURSES || d.courseCode === spec.courseCode);

  const candidates: Candidate[] = [];
  for (const doc of scoped) {
    doc.questions.forEach((raw, index) => {
      const text = stripLabel(raw);
      if (text.length < 8) return;
      candidates.push({ doc, index, text, words: tokens(text), score: 0, reasons: [] });
    });
  }

  const newestYear = Math.max(0, ...scoped.map((d) => d.year));
  const oldestYear = Math.min(newestYear, ...scoped.map((d) => d.year));
  const focusWords = Array.from(tokens(spec.focus));

  const repeats = candidates.map((c) =>
    candidates.filter((o) => o.doc.id !== c.doc.id && shared(c.words, o.words) >= 2).length
  );
  const maxRepeat = Math.max(1, ...repeats);

  candidates.forEach((c, i) => {
    const recency = newestYear === oldestYear ? 0.5 : (c.doc.year - oldestYear) / (newestYear - oldestYear);
    c.score += recency * 0.8;
    if (repeats[i] > 0) {
      c.score += (repeats[i] / maxRepeat) * 1.2 + 0.3;
      c.reasons.push('Theme keeps coming back');
    }
    if (newestYear > 0 && c.doc.year === newestYear && newestYear !== oldestYear) {
      c.reasons.push(`Latest session (${c.doc.session})`);
    }
    if (focusWords.length > 0) {
      const hit = focusWords.filter((w) => c.words.has(w) || c.text.toLowerCase().includes(w)).length;
      if (hit > 0) {
        c.score += 2 + hit * 0.5;
        c.reasons.unshift('Matches your topic');
      }
    }
    c.score += Math.random() * 0.35;
  });

  const wanted = Math.max(1, Math.min(spec.questionCount, candidates.length));
  const picked = [...candidates].sort((a, b) => b.score - a.score).slice(0, wanted);

  picked.sort(
    (a, b) =>
      a.doc.courseCode.localeCompare(b.doc.courseCode, undefined, { numeric: true }) ||
      b.doc.year - a.doc.year ||
      a.index - b.index
  );

  return {
    examType: spec.examType,
    poolSize: candidates.length,
    questions: picked.map((c, i) => ({
      id: `${c.doc.id}#${c.index}`,
      number: i + 1,
      text: c.text,
      courseCode: c.doc.courseCode,
      source: `${c.doc.courseCode} · ${c.doc.session}`,
      solution: c.doc.solutions?.[c.index] ?? null,
      reasons: c.reasons.slice(0, 2),
    })),
  };
};

export interface CourseContextPayload {
  courseTitle: string;
  sampleQuestions: string[];
  sourceQuestions: Array<{
    courseCode: string;
    source: string;
    text: string;
    solutionAnswer?: string;
  }>;
  materialTopics: string[];
  materialNotes: string[];
}

export function collectCourseContext(
  docs: PastQuestionDoc[],
  materials: StudyMaterial[],
  courseCode: string
): CourseContextPayload {
  const scopedDocs = docs.filter((d) => courseCode === ALL_COURSES || d.courseCode === courseCode);
  const scopedMaterials = materials.filter(
    (m) => courseCode === ALL_COURSES || m.courseCode === courseCode
  );

  const courseTitle =
    courseCode === ALL_COURSES
      ? 'General Studies Courses'
      : cleanCourseTitle(scopedDocs[0] ?? { courseCode, courseTitle: courseCode } as PastQuestionDoc) ||
        scopedMaterials[0]?.courseTitle ||
        courseCode;

  const sourceQuestions: CourseContextPayload['sourceQuestions'] = [];
  for (const doc of scopedDocs) {
    doc.questions.forEach((raw, idx) => {
      const text = stripLabel(raw);
      if (text.length < 8) return;
      sourceQuestions.push({
        courseCode: doc.courseCode,
        source: `${doc.courseCode} · ${doc.session}`,
        text,
        solutionAnswer: doc.solutions?.[idx]?.answer,
      });
    });
  }

  const materialTopics: string[] = [];
  const materialNotes: string[] = [];
  for (const mat of scopedMaterials) {
    for (const sec of mat.sections) {
      materialTopics.push(`${mat.courseCode}: ${sec.heading}`);
      const pts = (sec.points ?? []).slice(0, 3).join(' ');
      const para = (sec.paragraphs ?? []).slice(0, 1).join(' ');
      if (pts || para) {
        materialNotes.push(`[${mat.courseCode} - ${sec.heading}] ${para} ${pts}`.trim());
      }
    }
  }

  return {
    courseTitle,
    sampleQuestions: sourceQuestions.map((q) => `[${q.courseCode}] ${q.text}`),
    sourceQuestions,
    materialTopics,
    materialNotes,
  };
}
