import type {
  ExtractedAcademicMetadata,
  ExtractedPageContent,
  MetadataFieldResult,
} from '../../core/types';

export interface MetadataExtractionInput {
  fileName: string;
  pages: ExtractedPageContent[];
  extractedText: string;
}

function notFound(): MetadataFieldResult {
  return {
    value: null,
    status: 'not_found',
    confidence: 0,
  };
}

function findLineMatch(
  pages: ExtractedPageContent[],
  pattern: RegExp,
  groupIndex = 1,
  confidence = 0.88
): MetadataFieldResult {
  for (const page of pages) {
    const lines = page.text.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      const m = line.match(pattern);
      if (m && m[groupIndex]) {
        const val = m[groupIndex].replace(/\s{2,}/g, ' ').trim();
        if (val.length >= 2) {
          return {
            value: val,
            status: 'extracted',
            confidence,
            sourcePage: page.pageNumber,
            sourceExcerpt: line.slice(0, 140),
          };
        }
      }
    }
  }
  return notFound();
}

export function extractAcademicMetadata(
  input: MetadataExtractionInput
): ExtractedAcademicMetadata {
  const { pages, extractedText, fileName } = input;

  // 1. Institution
  const institution = findLineMatch(
    pages,
    /\b((?:Federal\s+University|State\s+University|University|Polytechnic|College\s+of\s+Education|Institute\s+of\s+Technology)[^\n,;]{0,70})/i,
    1,
    0.9
  );

  // 2. Faculty / School / College
  const faculty = findLineMatch(
    pages,
    /\b(?:Faculty|School|College)\s+of\s+([A-Za-z&,\s]{3,65})/i,
    0,
    0.88
  );

  // 3. Department
  const department = findLineMatch(
    pages,
    /\bDepartment\s+of\s+([A-Za-z&,\s]{3,65})/i,
    0,
    0.9
  );

  // 4. Course Code (e.g., CSC 301, MTH 204, PHY-101)
  let courseCode = findLineMatch(
    pages,
    /\b(?:Course\s*Code\s*[:\-]?\s*)?([A-Z]{2,4}\s*[-]?\s*\d{3})\b/,
    1,
    0.92
  );
  if (courseCode.status === 'not_found') {
    const fnameMatch = fileName.match(/\b([A-Z]{2,4}[\s_-]?\d{3})\b/i);
    if (fnameMatch) {
      courseCode = {
        value: fnameMatch[1].toUpperCase().replace(/[_-]/g, ' '),
        status: 'uncertain',
        confidence: 0.65,
        sourceExcerpt: fileName,
      };
    }
  }

  // 5. Course Title
  let courseTitle = findLineMatch(
    pages,
    /\bCourse\s*Title\s*[:\-]\s*(.{3,90})$/i,
    1,
    0.9
  );
  if (courseTitle.status === 'not_found' && courseCode.value) {
    const escapedCode = courseCode.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    courseTitle = findLineMatch(
      pages,
      new RegExp(`${escapedCode}\\s*[:\\-–]\\s*(.{4,90})$`, 'i'),
      1,
      0.82
    );
  }

  // 6. Course Unit
  let courseUnit = findLineMatch(
    pages,
    /\b(?:Course\s*)?(?:Units?|Credits?)\s*[:\-]?\s*(\d{1,2}\s*(?:Units?|Credits?)?)/i,
    1,
    0.86
  );
  if (courseUnit.status === 'not_found') {
    // Papers usually print the load after the title, e.g. "CSC 301: Data Structures (3 Units)"
    // or "3 Credit Units", rather than as a "Units: 3" label.
    courseUnit = findLineMatch(
      pages,
      /\b(\d{1,2}\s*(?:Credit\s*)?(?:Units?|Credits?|Credit\s*Hours?))\b/i,
      1,
      0.84
    );
  }

  // 7. Academic Session (e.g., 2023/2024 or 2024-2025)
  const academicSession = findLineMatch(
    pages,
    /\b((?:19|20)\d{2}\s*[\/\-]\s*(?:19|20)\d{2})\b(?:\s*(?:Academic\s*)?Session)?/i,
    1,
    0.92
  );

  // 8. Semester
  const semester = findLineMatch(
    pages,
    /\b(First|Second|Harmattan|Rain|Fall|Spring|Summer|1st|2nd)\s+Semester\b/i,
    0,
    0.9
  );

  // 9. Examination Type
  const examinationType = findLineMatch(
    pages,
    /\b(Mid[\s-]?Semester\s+Test|Continuous\s+Assessment|Final\s+Examination|Degree\s+Examination|Semester\s+Examination|Practical\s+Examination|Resit\s+Examination|Mock\s+Examination|Quiz\s+\d*)/i,
    1,
    0.87
  );

  // 10. Examination Date
  const examinationDate = findLineMatch(
    pages,
    /\b(?:Exam(?:ination)?\s*)?Date\s*[:\-]\s*([^\n]{5,45})/i,
    1,
    0.86
  );

  // 11. Examination Duration
  const examinationDuration = findLineMatch(
    pages,
    /\b(?:Time\s*Allowed|Duration)\s*[:\-]\s*([^\n]{3,40})/i,
    1,
    0.9
  );

  // 12. Instructions
  let instructions = findLineMatch(
    pages,
    /\bInstructions?(?:\s+to\s+Candidates)?\s*[:\-]\s*([^\n]{8,180})/i,
    1,
    0.88
  );
  if (instructions.status === 'not_found') {
    instructions = findLineMatch(
      pages,
      /\b(Answer\s+(?:any|all)\s+[^\n.]{5,120})/i,
      1,
      0.8
    );
  }

  // 13. Total Marks
  const totalMarks = findLineMatch(
    pages,
    /\b(?:Total\s*Marks?|Maximum\s*Marks?|Marks?\s*Obtainable)\s*[:\-]?\s*(\d{1,3}\s*(?:Marks?)?)/i,
    1,
    0.88
  );

  // 14. Examiner / Lecturer Name
  const examinerName = findLineMatch(
    pages,
    /\b(?:Examiner(?:'s\s*Name)?|Course\s*Lecturer|Instructor|Prepared\s*by)\s*[:\-]\s*([^\n]{3,65})/i,
    1,
    0.84
  );

  // Guard against false-positive extraction on nearly empty documents
  if (extractedText.trim().length < 15 && courseCode.status === 'not_found') {
    return {
      institution: notFound(),
      faculty: notFound(),
      department: notFound(),
      courseTitle: notFound(),
      courseCode: notFound(),
      courseUnit: notFound(),
      academicSession: notFound(),
      semester: notFound(),
      examinationType: notFound(),
      examinationDate: notFound(),
      examinationDuration: notFound(),
      instructions: notFound(),
      totalMarks: notFound(),
      examinerName: notFound(),
    };
  }

  return {
    institution,
    faculty,
    department,
    courseTitle,
    courseCode,
    courseUnit,
    academicSession,
    semester,
    examinationType,
    examinationDate,
    examinationDuration,
    instructions,
    totalMarks,
    examinerName,
  };
}
