import type { CourseContextPayload, ExamQuestion, ExamType } from '../core/mockExam';

export interface TheoryGradeResult {
  id: string;
  verdict: 'got' | 'partly' | 'missed';
  feedback: string;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export async function suggestExamTopics(
  courseCode: string,
  ctx: CourseContextPayload
): Promise<string[]> {
  const data = await postJson<{ topics: string[] }>('/api/exam/suggest-topics', {
    courseCode,
    courseTitle: ctx.courseTitle,
    sampleQuestions: ctx.sampleQuestions,
    materialTopics: ctx.materialTopics,
  });
  return data.topics;
}

export async function generateAiExamQuestions(params: {
  examType: ExamType;
  courseCode: string;
  questionCount: number;
  focus: string;
  ctx: CourseContextPayload;
}): Promise<ExamQuestion[]> {
  const data = await postJson<{ questions: ExamQuestion[] }>('/api/exam/generate', {
    examType: params.examType,
    courseCode: params.courseCode,
    courseTitle: params.ctx.courseTitle,
    questionCount: params.questionCount,
    focus: params.focus,
    sourceQuestions: params.ctx.sourceQuestions,
    materialNotes: params.ctx.materialNotes,
  });
  return data.questions;
}

export async function gradeTheoryAnswers(
  items: Array<{
    id: string;
    question: string;
    modelAnswer: string;
    studentAnswer: string;
  }>
): Promise<TheoryGradeResult[]> {
  const data = await postJson<{ results: TheoryGradeResult[] }>('/api/exam/grade-theory', {
    items,
  });
  return data.results;
}
