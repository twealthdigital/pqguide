import { useSyncExternalStore } from 'react';
import type { ExamQuestion, ExamSpec, ExamType } from './mockExam';
import { ALL_COURSES } from './mockExam';

export type TheoryMark = 'got' | 'partly' | 'missed';

export interface ExamPerformanceRecord {
  id: string;
  createdAt: string;
  courseCode: string;
  courseLabel: string;
  examType: ExamType;
  focus: string;
  totalQuestions: number;
  answeredCount: number;
  minutesAllowed: number;
  usedSeconds: number;
  endedByTimer: boolean;
  questions: ExamQuestion[];
  answers: Record<string, string>;
  marks: Record<string, TheoryMark>;
  /** Earned points out of totalQuestions (auto-graded for OBJ/CBT/True-False; from marks for Theory). */
  earnedPoints: number;
  missedCount: number;
  skippedCount: number;
  /** Score out of 100%, sharing 100% equally across all questions in the exam. */
  scorePercent: number;
  /** True for Theory exams until every question has been marked. */
  isTheoryPendingMark: boolean;
}

const STORAGE_KEY = 'pqguide:exam-performances:v1';

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedList: ExamPerformanceRecord[] = [];

function readRecords(): ExamPerformanceRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === cachedRaw) return cachedList;
    cachedRaw = raw;
    if (!raw) {
      cachedList = [];
      return cachedList;
    }
    const parsed = JSON.parse(raw);
    cachedList = Array.isArray(parsed) ? (parsed as ExamPerformanceRecord[]) : [];
    return cachedList;
  } catch {
    return [];
  }
}

function writeRecords(next: ExamPerformanceRecord[]) {
  cachedList = next;
  if (typeof window !== 'undefined') {
    try {
      const raw = JSON.stringify(next);
      cachedRaw = raw;
      window.localStorage.setItem(STORAGE_KEY, raw);
    } catch {
      /* storage quota exceeded or unavailable */
    }
  }
  listeners.forEach((fn) => fn());
}

export function subscribePerformances(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getExamPerformances(): ExamPerformanceRecord[] {
  return readRecords();
}

export function useExamPerformances(): ExamPerformanceRecord[] {
  return useSyncExternalStore(subscribePerformances, readRecords, () => []);
}

export function computeRecordStats(
  examType: ExamType,
  questions: ExamQuestion[],
  answers: Record<string, string>,
  marks: Record<string, TheoryMark>
): {
  answeredCount: number;
  earnedPoints: number;
  missedCount: number;
  skippedCount: number;
  scorePercent: number;
  isTheoryPendingMark: boolean;
} {
  const total = questions.length;
  let answeredCount = 0;
  let earnedPoints = 0;
  let missedCount = 0;
  let skippedCount = 0;
  let markedCount = 0;

  for (const q of questions) {
    const ans = (answers[q.id] ?? '').trim();
    if (ans.length > 0) {
      answeredCount += 1;
    } else {
      skippedCount += 1;
    }

    if (examType === 'theory') {
      const m = marks[q.id];
      if (m) {
        markedCount += 1;
        if (m === 'got') earnedPoints += 1;
        else if (m === 'partly') earnedPoints += 0.5;
        else missedCount += 1;
      }
    } else if (examType === 'boolean') {
      if (ans.length > 0) {
        const expected = q.correctBoolean ? 'true' : 'false';
        if (ans === expected) earnedPoints += 1;
        else missedCount += 1;
      }
    } else {
      if (ans.length > 0 && typeof q.correctIndex === 'number') {
        if (Number(ans) === q.correctIndex) earnedPoints += 1;
        else missedCount += 1;
      }
    }
  }

  // Share 100% equally across all N questions in the exam
  const scorePercent = total > 0 ? Math.round((earnedPoints / total) * 100) : 0;
  const isTheoryPendingMark = examType === 'theory' && markedCount < total;

  return {
    answeredCount,
    earnedPoints,
    missedCount,
    skippedCount,
    scorePercent,
    isTheoryPendingMark,
  };
}

export function saveExamPerformance(params: {
  spec: ExamSpec;
  questions: ExamQuestion[];
  answers: Record<string, string>;
  usedSeconds: number;
  endedByTimer: boolean;
}): ExamPerformanceRecord {
  const stats = computeRecordStats(params.spec.examType, params.questions, params.answers, {});
  const record: ExamPerformanceRecord = {
    id: `perf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    courseCode: params.spec.courseCode,
    courseLabel:
      params.spec.courseCode === ALL_COURSES ? 'All general courses' : params.spec.courseCode,
    examType: params.spec.examType,
    focus: params.spec.focus,
    totalQuestions: params.questions.length,
    answeredCount: stats.answeredCount,
    minutesAllowed: params.spec.minutes,
    usedSeconds: params.usedSeconds,
    endedByTimer: params.endedByTimer,
    questions: params.questions,
    answers: params.answers,
    marks: {},
    earnedPoints: stats.earnedPoints,
    missedCount: stats.missedCount,
    skippedCount: stats.skippedCount,
    scorePercent: stats.scorePercent,
    isTheoryPendingMark: stats.isTheoryPendingMark,
  };

  const current = readRecords();
  writeRecords([record, ...current].slice(0, 60));
  return record;
}

export function updateTheoryMarks(
  recordId: string,
  questionId: string,
  mark: TheoryMark
): void {
  const current = readRecords();
  const next = current.map((rec) => {
    if (rec.id !== recordId) return rec;
    const nextMarks = { ...rec.marks, [questionId]: mark };
    const stats = computeRecordStats(rec.examType, rec.questions, rec.answers, nextMarks);
    return {
      ...rec,
      marks: nextMarks,
      earnedPoints: stats.earnedPoints,
      missedCount: stats.missedCount,
      skippedCount: stats.skippedCount,
      scorePercent: stats.scorePercent,
      isTheoryPendingMark: stats.isTheoryPendingMark,
    };
  });
  writeRecords(next);
}

export interface OverallRatingSummary {
  totalExams: number;
  gradedExams: number;
  totalQuestions: number;
  totalEarnedPoints: number;
  totalMissed: number;
  totalSkipped: number;
  /** Question-weighted overall rating out of 100%, sharing 100% equally across every question. */
  overallPercent: number;
  tierLabel: string;
  tierSummary: string;
  byCourse: Array<{
    courseLabel: string;
    attempts: number;
    questions: number;
    earnedPoints: number;
    percent: number;
  }>;
  byType: Array<{
    examType: ExamType;
    attempts: number;
    questions: number;
    earnedPoints: number;
    percent: number;
  }>;
}

export function computeOverallRating(records: ExamPerformanceRecord[]): OverallRatingSummary {
  // Include all auto-graded exams and any Theory exams that have at least 1 marked question
  const graded = records.filter(
    (r) => r.examType !== 'theory' || Object.keys(r.marks).length > 0
  );

  let totalQuestions = 0;
  let totalEarnedPoints = 0;
  let totalMissed = 0;
  let totalSkipped = 0;

  const courseMap = new Map<
    string,
    { courseLabel: string; attempts: number; questions: number; earnedPoints: number }
  >();
  const typeMap = new Map<
    ExamType,
    { examType: ExamType; attempts: number; questions: number; earnedPoints: number }
  >();

  for (const r of graded) {
    // For partially marked theory exams, count only marked questions in denominator so unmarked ones don't unfairly drag down rating
    const qWeightCount =
      r.examType === 'theory'
        ? Math.max(1, Object.keys(r.marks).length)
        : r.totalQuestions;

    totalQuestions += qWeightCount;
    totalEarnedPoints += r.earnedPoints;
    totalMissed += r.missedCount;
    totalSkipped += r.skippedCount;

    const cEntry = courseMap.get(r.courseLabel) ?? {
      courseLabel: r.courseLabel,
      attempts: 0,
      questions: 0,
      earnedPoints: 0,
    };
    cEntry.attempts += 1;
    cEntry.questions += qWeightCount;
    cEntry.earnedPoints += r.earnedPoints;
    courseMap.set(r.courseLabel, cEntry);

    const tEntry = typeMap.get(r.examType) ?? {
      examType: r.examType,
      attempts: 0,
      questions: 0,
      earnedPoints: 0,
    };
    tEntry.attempts += 1;
    tEntry.questions += qWeightCount;
    tEntry.earnedPoints += r.earnedPoints;
    typeMap.set(r.examType, tEntry);
  }

  const overallPercent =
    totalQuestions > 0 ? Math.round((totalEarnedPoints / totalQuestions) * 100) : 0;

  const tierLabel =
    graded.length === 0
      ? 'Not rated yet'
      : overallPercent >= 80
        ? 'Exam Ready'
        : overallPercent >= 70
          ? 'Strong'
          : overallPercent >= 60
            ? 'Good'
            : overallPercent >= 50
              ? 'Developing'
              : 'Needs Practice';

  const tierSummary =
    graded.length === 0
      ? 'Submit an exam (and mark Theory answers if applicable) to calculate your overall rating out of 100%.'
      : `Your overall rating shares 100% evenly across all ${totalQuestions} graded question${totalQuestions === 1 ? '' : 's'} you have taken (${(100 / totalQuestions).toFixed(totalQuestions <= 20 ? 1 : 2)}% per question).`;

  return {
    totalExams: records.length,
    gradedExams: graded.length,
    totalQuestions,
    totalEarnedPoints,
    totalMissed,
    totalSkipped,
    overallPercent,
    tierLabel,
    tierSummary,
    byCourse: Array.from(courseMap.values())
      .map((c) => ({
        ...c,
        percent: c.questions > 0 ? Math.round((c.earnedPoints / c.questions) * 100) : 0,
      }))
      .sort((a, b) => b.percent - a.percent),
    byType: Array.from(typeMap.values()).map((t) => ({
      ...t,
      percent: t.questions > 0 ? Math.round((t.earnedPoints / t.questions) * 100) : 0,
    })),
  };
}
