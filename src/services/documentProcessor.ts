import type { DocumentSourceType, MaterialSection, SemesterType } from '../core/types';
import { sanitizePlainText, sanitizeSingleLine } from '../core/security';
import { fileToScanInput, scanSingleAcademicInput } from './intelligence/documentScannerEngine';
import { extractQuestionsFromText } from './intelligence/structuredParser';

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

/** Unified entry point delegating both images and documents to the upgraded scanner engine. */
export async function processUploadedDocument(
  file: File
): Promise<ProcessedDocumentResult> {
  const input = await fileToScanInput(file);
  const artifact = await scanSingleAcademicInput(input);
  const questionLines = extractQuestionsFromText(artifact.extractedText, 24);
  const isImageBased =
    artifact.detectedFormat === 'image' ||
    artifact.pages.some((p) => p.ocrApplied);

  return {
    sourceType: isImageBased ? 'scanned_image' : 'typed_document',
    originalFileName: artifact.fileName,
    scannedPagePreviewUrl: artifact.optimizedPreviewUrl,
    extractedText: artifact.extractedText,
    suggestedCourseCode: artifact.courseCode,
    suggestedSession: artifact.session,
    suggestedSemester: artifact.semester,
    suggestedQuestions:
      questionLines.length > 0
        ? questionLines
        : artifact.extractedText
            .split(/\r?\n/)
            .map((l) => sanitizeSingleLine(l, 240))
            .filter((l) => l.length > 10)
            .slice(0, 12),
    processingSummary: `Processed ${artifact.pageCount} page(s) (${artifact.extractionQualityStatus})${
      artifact.averageOcrConfidence !== null
        ? ` · OCR ${artifact.averageOcrConfidence}%`
        : ''
    }.`,
  };
}

export async function processUploadedStudyMaterial(
  file: File
): Promise<ProcessedStudyMaterialResult> {
  const input = await fileToScanInput(file);
  const artifact = await scanSingleAcademicInput(input);
  const lines = artifact.extractedText
    .split(/\r?\n/)
    .map((l) => sanitizeSingleLine(l, 400))
    .filter(Boolean);
  const wordCount = artifact.extractedText.split(/\s+/).filter(Boolean).length;

  const suggestedSections: MaterialSection[] = [
    {
      heading: artifact.headings[0] || 'Extracted Study Notes',
      paragraphs: lines.slice(0, 4).length > 0 ? lines.slice(0, 4) : [artifact.summary],
      points: lines.slice(4, 12),
    },
  ];

  return {
    sourceType: artifact.detectedFormat === 'image' ? 'scanned_image' : 'typed_document',
    originalFileName: artifact.fileName,
    attachmentPreviewUrl: artifact.optimizedPreviewUrl,
    extractedText: sanitizePlainText(artifact.extractedText, 60_000),
    suggestedCourseCode: artifact.courseCode,
    suggestedTitle: artifact.suggestedTitle,
    suggestedSummary: artifact.summary,
    suggestedSections,
    suggestedReadMinutes: Math.max(2, Math.min(45, Math.ceil(wordCount / 180))),
    processingSummary: `Extracted ${wordCount} words across ${artifact.pageCount} page(s) (${artifact.extractionQualityStatus}).`,
  };
}
