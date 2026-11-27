import type { GroundedAcademicContextPayload } from '../../../server/aiService';
import { computeOverallRating, getExamPerformances } from '../../core/performanceStore';
import type { AppStoreState } from '../archiveRepository';

export function buildGroundedAcademicContext(
  store: AppStoreState,
  options?: {
    pinnedStudentDocId?: string;
    pinnedCourseCode?: string;
  }
): GroundedAcademicContextPayload {
  const activeSchool =
    store.schools.find((s) => s.id === store.selectedSchoolId) ?? store.schools[0];
  const schoolId = activeSchool?.id;
  const schoolCode = activeSchool?.code ?? 'AAUA';

  const publishedPqs = store.documents.filter(
    (d) => d.status === 'published' && (!schoolId || d.schoolId === schoolId)
  );
  const publishedMaterials = store.materials.filter(
    (m) =>
      (m.status ?? 'published') === 'published' &&
      (!schoolId || !m.schoolId || m.schoolId === schoolId)
  );
  const publishedStudentDocs = (store.academicDocuments ?? []).filter(
    (d) =>
      d.publicationStatus === 'published' ||
      (options?.pinnedStudentDocId && d.id === options.pinnedStudentDocId)
  );

  // Put pinned or matching course items first so context budget preserves them
  const pinCode = options?.pinnedCourseCode?.trim().toUpperCase();
  const sortWithPin = <T extends { id?: string; courseCode?: string }>(items: T[]): T[] => {
    if (!pinCode && !options?.pinnedStudentDocId) return items;
    return [...items].sort((a, b) => {
      const aMatch =
        (options?.pinnedStudentDocId && a.id === options.pinnedStudentDocId) ||
        (pinCode && a.courseCode?.toUpperCase() === pinCode)
          ? 1
          : 0;
      const bMatch =
        (options?.pinnedStudentDocId && b.id === options.pinnedStudentDocId) ||
        (pinCode && b.courseCode?.toUpperCase() === pinCode)
          ? 1
          : 0;
      return bMatch - aMatch;
    });
  };

  const perfRecords = getExamPerformances();
  const rating = computeOverallRating(perfRecords);
  const weakCourses = rating.byCourse
    .filter((c) => c.percent < 65)
    .slice(0, 4)
    .map((c) => `${c.courseLabel} (${c.percent}%)`);

  return {
    activeSchoolCode: schoolCode,
    pastQuestions: sortWithPin(publishedPqs)
      .slice(0, 22)
      .map((pq) => ({
        id: pq.id,
        schoolCode: pq.schoolCode,
        courseCode: pq.courseCode,
        courseTitle: pq.courseTitle,
        level: pq.level,
        session: pq.session,
        semester: pq.semester,
        questions: pq.questions.slice(0, 8),
      })),
    materials: sortWithPin(publishedMaterials)
      .slice(0, 16)
      .map((m) => ({
        id: m.id,
        courseCode: m.courseCode,
        title: m.title,
        summary: m.summary,
        headings: m.sections.map((s) => s.heading).slice(0, 10),
      })),
    studentDocuments: sortWithPin(publishedStudentDocs)
      .slice(0, 16)
      .map((doc) => ({
        id: doc.id,
        title: doc.title,
        courseCode: doc.courseCode,
        summary: doc.summary,
        headings: doc.headings.slice(0, 10),
        formulas: doc.formulas.slice(0, 12).map((f) => ({
          latex: f.latex,
          displayMode: f.displayMode,
        })),
        tablesCount: doc.tables.length,
        diagramsCount: doc.diagrams.length,
        excerpt: doc.extractedText.slice(0, 1200),
      })),
    performanceSummary:
      perfRecords.length > 0
        ? {
            totalAttempts: rating.totalExams,
            averageScore: rating.overallPercent,
            weakCourses,
          }
        : undefined,
  };
}
