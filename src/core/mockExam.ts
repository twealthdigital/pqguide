import type { PastQuestionDoc, QuestionSolution } from './types';
import { cleanCourseTitle } from './docTitle';

/**
 * Practice-exam "prediction".
 *
 * There is no AI behind this: the exam is assembled from the real past
 * questions in the archive, favouring questions whose themes keep coming back
 * across sessions, questions from the most recent session, and anything that
 * matches the topic the student asked to focus on.
 */

export const ALL_COURSES = 'ALL';

export interface ExamCourseOption {
  code: string;
  title: string;
  level: string;
  questionCount: number;
  sessionCount: number;
}

export interface ExamSpec {
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
}

export interface BuiltExam {
  questions: ExamQuestion[];
  /** How many questions were available for the chosen course. */
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

  // Repeated themes: other questions (from other papers) sharing 2+ key words.
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
    c.score += Math.random() * 0.35; // keeps repeat attempts from being identical
  });

  const wanted = Math.max(1, Math.min(spec.questionCount, candidates.length));
  const picked = [...candidates].sort((a, b) => b.score - a.score).slice(0, wanted);

  // Present like a real paper: grouped by course, then in the original order.
  picked.sort(
    (a, b) =>
      a.doc.courseCode.localeCompare(b.doc.courseCode, undefined, { numeric: true }) ||
      b.doc.year - a.doc.year ||
      a.index - b.index
  );

  return {
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
