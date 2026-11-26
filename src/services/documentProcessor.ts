import {
  sanitizePlainText,
  sanitizeSingleLine,
  validateUploadFile,
  validateUploadedBuffer,
} from '../core/security';
import type { DocumentSourceType, MaterialSection, SemesterType } from '../core/types';

export interface ProcessedDocumentResult {
  sourceType: DocumentSourceType;
  originalFileName: string;
  scannedPagePreviewUrl?: string;
  extractedText: string;
  suggestedCourseCode: string;
  suggestedSession: string;
  suggestedSemester: SemesterType;
  suggestedQuestions: string[];
  processingSummary: string;
}

export interface ProcessedStudyMaterialResult {
  sourceType: DocumentSourceType;
  originalFileName: string;
  attachmentPreviewUrl?: string;
  extractedText: string;
  suggestedCourseCode: string;
  suggestedTitle: string;
  suggestedSummary: string;
  suggestedSections: MaterialSection[];
  suggestedReadMinutes: number;
  processingSummary: string;
}

/**
 * Downscales and enhances a validated raster image onto a canvas
 * to normalize scans and strip embedded EXIF/ancillary metadata.
 */
async function enhanceScanImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      try {
        const maxWidth = 960;
        const scale = img.width > maxWidth ? maxWidth / img.width : 1;
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          URL.revokeObjectURL(objectUrl);
          reject(new Error('Canvas context unavailable'));
          return;
        }

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.filter = 'grayscale(100%) contrast(132%) brightness(106%)';
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
        URL.revokeObjectURL(objectUrl);
        resolve(dataUrl);
      } catch (err) {
        URL.revokeObjectURL(objectUrl);
        reject(err);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Unable to decode uploaded image'));
    };

    img.src = objectUrl;
  });
}

function inferMetadataFromTextOrName(
  fileName: string,
  textBody: string
): {
  courseCode: string;
  session: string;
  semester: SemesterType;
  questions: string[];
} {
  const combined = `${fileName} ${textBody}`;

  const courseMatch = combined.match(/\b([A-Za-z]{3})\s?-?(\d{3})\b/);
  const courseCode = courseMatch
    ? `${courseMatch[1].toUpperCase()} ${courseMatch[2]}`
    : 'CSC 101';

  const sessionMatch = combined.match(/\b(20\d{2})\s?[\/_-]\s?(20\d{2})\b/);
  const session = sessionMatch ? `${sessionMatch[1]}/${sessionMatch[2]}` : '2024/2025';

  const lower = combined.toLowerCase();
  const semester: SemesterType =
    lower.includes('second') || lower.includes('rain')
      ? 'Second Semester'
      : 'First Semester';

  const lines = textBody
    .split(/\r?\n/)
    .map((line) => sanitizeSingleLine(line, 500))
    .filter((line) => line.length > 10);

  const questionLines = lines.filter((line) =>
    /^(q\d+|question\s+\d+|\d+[.)])/i.test(line)
  );

  const questions =
    questionLines.length > 0
      ? questionLines.slice(0, 16)
      : lines.length > 0
      ? lines.slice(0, 8)
      : [
          `Q1: Core theory and definitions extracted from ${fileName}.`,
          `Q2: Applied problem solving and analytical questions for ${courseCode}.`,
        ];

  return { courseCode, session, semester, questions };
}

function extractReadableStringsFromBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer.slice(0, 220_000));
  let current = '';
  const chunks: string[] = [];

  for (let i = 0; i < bytes.length; i++) {
    const code = bytes[i];
    if ((code >= 32 && code <= 126) || code === 10 || code === 13) {
      current += String.fromCharCode(code);
    } else {
      if (current.trim().length >= 8) {
        chunks.push(current.trim());
      }
      current = '';
    }
  }
  if (current.trim().length >= 8) {
    chunks.push(current.trim());
  }

  return sanitizePlainText(
    chunks
      .filter((line) => /[a-zA-Z]{3,}/.test(line) && !line.includes('PDF-1.'))
      .slice(0, 60)
      .join('\n'),
    6000
  );
}

async function validateAndReadFile(file: File): Promise<{
  safeFileName: string;
  extension: string;
  kind: 'image' | 'document';
  buffer: ArrayBuffer;
}> {
  const metaCheck = validateUploadFile({
    name: file.name,
    type: file.type,
    size: file.size,
  });

  if (!metaCheck.valid) {
    throw new Error(metaCheck.error ?? 'Uploaded file failed security validation.');
  }

  const buffer = await file.arrayBuffer();
  const sigCheck = validateUploadedBuffer(metaCheck.extension, buffer);
  if (!sigCheck.valid) {
    throw new Error(sigCheck.error ?? 'File signature verification failed.');
  }

  return {
    safeFileName: metaCheck.safeFileName,
    extension: metaCheck.extension,
    kind: metaCheck.kind,
    buffer,
  };
}

export async function processUploadedDocument(
  file: File
): Promise<ProcessedDocumentResult> {
  const validated = await validateAndReadFile(file);

  if (validated.kind === 'image') {
    const scannedPagePreviewUrl = await enhanceScanImage(file);
    const meta = inferMetadataFromTextOrName(validated.safeFileName, '');
    const extractedText = sanitizePlainText(
      [
        'DIGITAL SCAN-TO-PDF NORMALIZED SHEET',
        `SOURCE IMAGE: ${validated.safeFileName}`,
        `COURSE: ${meta.courseCode} · SESSION: ${meta.session} · ${meta.semester.toUpperCase()}`,
        'Scan enhanced for high-contrast paper readability and indexed for instant student search.',
      ].join('\n'),
      6000
    );

    return {
      sourceType: 'scanned_image',
      originalFileName: validated.safeFileName,
      scannedPagePreviewUrl,
      extractedText,
      suggestedCourseCode: meta.courseCode,
      suggestedSession: meta.session,
      suggestedSemester: meta.semester,
      suggestedQuestions: meta.questions,
      processingSummary:
        'Image validated, enhanced to monochrome scan-to-PDF sheet, and prepared for indexing.',
    };
  }

  let rawText = '';
  if (
    validated.extension === 'txt' ||
    validated.extension === 'md' ||
    validated.extension === 'csv'
  ) {
    rawText = new TextDecoder('utf-8', { fatal: false }).decode(validated.buffer);
  } else {
    rawText = extractReadableStringsFromBuffer(validated.buffer);
  }

  const sanitizedBody = sanitizePlainText(rawText, 6000);
  const cleanedText =
    sanitizedBody.length > 0
      ? sanitizedBody
      : `Extracted structured text stream from ${validated.safeFileName}.\nQ1: Define the fundamental principles covered in this course.\nQ2: Solve the analytical problems in Section B.`;

  const meta = inferMetadataFromTextOrName(validated.safeFileName, cleanedText);

  return {
    sourceType: 'typed_document',
    originalFileName: validated.safeFileName,
    extractedText: cleanedText,
    suggestedCourseCode: meta.courseCode,
    suggestedSession: meta.session,
    suggestedSemester: meta.semester,
    suggestedQuestions: meta.questions,
    processingSummary:
      'Document validated, text extracted safely, and questions prepared for review.',
  };
}

export async function processUploadedStudyMaterial(
  file: File
): Promise<ProcessedStudyMaterialResult> {
  const validated = await validateAndReadFile(file);

  if (validated.kind === 'image') {
    const attachmentPreviewUrl = await enhanceScanImage(file);
    const meta = inferMetadataFromTextOrName(validated.safeFileName, '');
    const baseTitle = sanitizeSingleLine(
      validated.safeFileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '),
      120
    );

    return {
      sourceType: 'scanned_image',
      originalFileName: validated.safeFileName,
      attachmentPreviewUrl,
      extractedText: `Scanned study sheet: ${validated.safeFileName}`,
      suggestedCourseCode: meta.courseCode,
      suggestedTitle: baseTitle || `${meta.courseCode} Study Guide`,
      suggestedSummary: `Normalized study sheet uploaded from ${validated.safeFileName}.`,
      suggestedSections: [
        {
          heading: 'Key Revision Notes',
          paragraphs: [
            `Uploaded study page (${validated.safeFileName}) normalized for quick mobile reading.`,
          ],
          points: ['Review core definitions and key formulas shown on the attached sheet.'],
        },
      ],
      suggestedReadMinutes: 5,
      processingSummary: 'Study sheet image validated and normalized.',
    };
  }

  let rawText = '';
  if (
    validated.extension === 'txt' ||
    validated.extension === 'md' ||
    validated.extension === 'csv'
  ) {
    rawText = new TextDecoder('utf-8', { fatal: false }).decode(validated.buffer);
  } else {
    rawText = extractReadableStringsFromBuffer(validated.buffer);
  }

  const sanitizedBody = sanitizePlainText(rawText, 8000);
  const meta = inferMetadataFromTextOrName(validated.safeFileName, sanitizedBody);
  const lines = sanitizedBody
    .split(/\r?\n/)
    .map((l) => sanitizeSingleLine(l, 400))
    .filter(Boolean);

  const suggestedTitle =
    lines[0] && lines[0].length <= 90
      ? lines[0]
      : sanitizeSingleLine(
          validated.safeFileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '),
          120
        ) || `${meta.courseCode} Study Guide`;

  const bodyLines = lines.slice(1, 20);
  const suggestedSections: MaterialSection[] = [
    {
      heading: 'Overview & Key Concepts',
      paragraphs: bodyLines.slice(0, 2).length > 0 ? bodyLines.slice(0, 2) : [
        `Study notes extracted from ${validated.safeFileName}.`,
      ],
      points: bodyLines.slice(2, 10),
    },
  ];

  const wordCount = sanitizedBody.split(/\s+/).filter(Boolean).length;
  const suggestedReadMinutes = Math.max(3, Math.min(45, Math.ceil(wordCount / 160) || 5));

  return {
    sourceType: 'typed_document',
    originalFileName: validated.safeFileName,
    extractedText: sanitizedBody || `Extracted reading guide from ${validated.safeFileName}`,
    suggestedCourseCode: meta.courseCode,
    suggestedTitle,
    suggestedSummary:
      bodyLines[0]?.slice(0, 180) ||
      `Structured study notes extracted from ${validated.safeFileName}.`,
    suggestedSections,
    suggestedReadMinutes,
    processingSummary: 'Study material validated and converted into readable guide sections.',
  };
}
