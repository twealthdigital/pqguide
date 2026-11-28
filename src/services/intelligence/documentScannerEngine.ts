import JSZip from 'jszip';
import { sanitizePlainText, sanitizeSingleLine } from '../../core/security';
import type {
  AcademicDocFormat,
  AcademicExamStructureReport,
  DeterministicCheckResult,
  DocumentClassificationResult,
  DocumentIntegrityReport,
  ExtractedAcademicMetadata,
  ExtractedDiagramAsset,
  ExtractedFormula,
  ExtractedPageContent,
  ExtractedTable,
  ExtractionQualityStatus,
  FormExtractionResult,
  HandwritingAnalysisResult,
  LanguageAnalysisResult,
  MergedTableCellSpan,
  OmrScanResult,
  OmrTemplateConfig,
  PageExtractionMethod,
  QrCodeMatch,
  ReconstructedBlock,
  ScannerModuleName,
  ScannerModuleRunReport,
  SignatureDetection,
  StampDetection,
  UncertainSpan,
} from '../../core/types';
import {
  computeSha256Hex,
  isSafeZipEntryPath,
  MAX_PDF_PAGES,
  MAX_ZIP_COMPRESSION_RATIO,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_UNCOMPRESSED_BYTES,
  validateMagicAndSecurity,
} from './fileSecurity';
import {
  decodeBytesToRgbaAndGray,
  preprocessImageForOcr,
  uint8ToBase64DataUrl,
  type PreprocessedImageResult,
} from './imagePreprocessor';
import {
  extractPdfVectorDiagrams,
  extractRasterDiagramsFromGrayscale,
  type PdfTextTokenLike,
} from './diagramExtractor';
import {
  recognizeWithTesseractPool,
  type OcrLineBox,
  type OcrWordBox,
  type VisionFallbackMode,
  type VisionOcrRunner,
} from './ocrEngine';
import {
  detectRepeatedHeadersFooters,
  extractTablesFromText,
  formatMultiPageStructuredText,
  parseStructuredDocument,
} from './structuredParser';
import {
  documentStorageAdapter,
  getCachedExtractionByHash,
  setCachedExtractionByHash,
} from './storageAdapter';
import { scanBarcodesAndQrFromBuffer, isSafeBarcodePayload } from './barcodeQrEngine';
import { scanOmrSheet } from './omrEngine';
import { recognizeFormFields } from './formRecognizer';
import {
  analyzeHandwritingRegions,
  type HandwritingEngineAdapter,
} from './handwritingRecognizer';
import { detectSignaturesAndStamps } from './signatureStampDetector';
import { analyzeDocumentLanguages } from './languageDetector';
import {
  extractMathFormulasAdvanced,
  injectInlineLatexIntoText,
  type MathOcrAdapter,
} from './mathFormulaEngine';
import {
  enrichExtractedTable,
  extractBorderedTablesFromGrayscale,
  linkMultiPageTables,
} from './advancedTableExtractor';
import { classifyAcademicDocument } from './documentClassifier';
import { inspectDocumentIntegrity } from './documentIntegrityChecker';
import { extractAcademicMetadata } from './academicMetadataExtractor';
import {
  buildBlocksFromStructuredText,
  reconstructPageBlocks,
} from './layoutReconstructor';
import { parseAcademicExamStructure } from './academicQuestionParser';
import {
  createBackendHandwritingAdapter,
  queryServerOcrCapabilities,
  type OcrEngineMode,
  type SuryaOcrRunner,
} from './ocrRouter';

export type ScanStageId =
  | 'queued'
  | 'validating'
  | 'hashing'
  | 'optimizing'
  | 'extracting'
  | 'ocr'
  | 'deterministic_checks'
  | 'ai_cross_check'
  | 'decision'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface ScanProgressUpdate {
  stage: ScanStageId;
  stageLabel: string;
  currentPage?: number;
  totalPages?: number;
  progressPercent?: number;
  ocrProgress?: number;
  preprocessingStatus?: string;
  detail?: string;
}

export interface OcrRunnerResult {
  text: string;
  confidence: number; // 0..100
  warnings?: string[];
  preprocessed?: PreprocessedImageResult;
  orientationCorrectedDeg?: 0 | 90 | 180 | 270;
  ocrEngineUsed?: ExtractedPageContent['ocrEngineUsed'];
  visionFallbackUsed?: boolean;
  visionFallbackError?: string;
  uncertainSpans?: UncertainSpan[];
  wordBoxes?: OcrWordBox[];
  lineBoxes?: OcrLineBox[];
  perspectiveCorrected?: boolean;
  suryaBlocks?: ReconstructedBlock[];
  suryaEquations?: ExtractedFormula[];
  suryaTables?: ExtractedTable[];
  engineRoutingReason?: string;
}

export type OcrRunner = (input: {
  imageDataUrl?: string;
  bytes?: Uint8Array;
  mimeType?: string;
  pageNumber?: number;
  signal?: AbortSignal;
  skipPreprocessing?: boolean;
  visionFallback?: VisionFallbackMode;
  visionOcrRunner?: VisionOcrRunner;
  engineMode?: OcrEngineMode;
  suryaRunner?: SuryaOcrRunner;
  language?: string;
  onOcrProgress?: (pct: number, statusText: string) => void;
}) => Promise<OcrRunnerResult>;

export type PdfPageRenderer = (params: {
  pageNumber: number;
  totalPages: number;
}) => Promise<{
  imageDataUrl?: string;
  bytes?: Uint8Array;
  mimeType?: string;
  width?: number;
  height?: number;
} | null>;

export interface ScannedArtifactOutput {
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  detectedFormat: AcademicDocFormat;
  sha256: string;
  originalFileRefKey?: string;
  originalStorageRef?: Awaited<ReturnType<typeof documentStorageAdapter.putBinary>>;
  optimizedPreviewUrl?: string;
  pageCount: number;
  extractedText: string;
  pages: ExtractedPageContent[];
  diagrams: ExtractedDiagramAsset[];
  tables: ExtractedTable[];
  formulas: ExtractedFormula[];
  headings: string[];
  summary: string;
  suggestedTitle: string;
  courseCode: string;
  courseTitle: string;
  level: ReturnType<typeof parseStructuredDocument>['level'];
  session: string;
  semester: ReturnType<typeof parseStructuredDocument>['semester'];
  category: ReturnType<typeof parseStructuredDocument>['category'];
  qrCodesFound: QrCodeMatch[];
  averageOcrConfidence: number | null;
  extractionQualityStatus: ExtractionQualityStatus;
  processedPages: number[];
  unprocessedPages: number[];
  extractionWarnings: string[];
  securityFlags: string[];
  earlyChecks: DeterministicCheckResult[];
  parentZipName?: string;
  processingDurationMs: number;
  academicMetadata?: ExtractedAcademicMetadata;
  classification?: DocumentClassificationResult;
  integrityReport?: DocumentIntegrityReport;
  languageAnalysis?: LanguageAnalysisResult;
  academicStructure?: AcademicExamStructureReport;
  ocrEngineSummary?: string;
  omrResults?: OmrScanResult;
  formResults?: FormExtractionResult;
  handwritingAnalysis?: HandwritingAnalysisResult;
  signatures?: SignatureDetection[];
  stamps?: StampDetection[];
  moduleReports?: ScannerModuleRunReport[];
}

export interface ScanInputFile {
  name: string;
  type: string;
  size: number;
  bytes: Uint8Array;
  parentZipName?: string;
}

const MAX_PAGE_TEXT_CHARS = 60_000;
const MAX_DOC_TEXT_CHARS = 240_000;

export async function fileToScanInput(file: File): Promise<ScanInputFile> {
  const buf = await file.arrayBuffer();
  return {
    name: file.name,
    type: file.type,
    size: file.size,
    bytes: new Uint8Array(buf),
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Document scan cancelled by user.', 'AbortError');
  }
}

function guessMimeFromExtension(ext: string, fallback = 'application/octet-stream'): string {
  switch (ext.toLowerCase()) {
    case 'pdf':
      return 'application/pdf';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'zip':
      return 'application/zip';
    case 'txt':
      return 'text/plain';
    case 'md':
      return 'text/markdown';
    case 'csv':
      return 'text/csv';
    default:
      return fallback;
  }
}

function uint8ToDataUrl(bytes: Uint8Array, mimeType: string): string {
  return uint8ToBase64DataUrl(bytes, mimeType);
}

/** Unified adaptive OCR runner working seamlessly in Browser and Node.js. */
export async function defaultBrowserOcrRunner(input: {
  imageDataUrl?: string;
  bytes?: Uint8Array;
  mimeType?: string;
  pageNumber?: number;
  signal?: AbortSignal;
  skipPreprocessing?: boolean;
  visionFallback?: VisionFallbackMode;
  visionOcrRunner?: VisionOcrRunner;
  engineMode?: OcrEngineMode;
  suryaRunner?: SuryaOcrRunner;
  language?: string;
  onOcrProgress?: (pct: number, statusText: string) => void;
}): Promise<OcrRunnerResult> {
  throwIfAborted(input.signal);
  const res = await recognizeWithTesseractPool({
    imageDataUrl: input.imageDataUrl,
    bytes: input.bytes,
    mimeType: input.mimeType,
    pageNumber: input.pageNumber,
    signal: input.signal,
    skipPreprocessing: input.skipPreprocessing,
    visionFallback: input.visionFallback,
    visionOcrRunner: input.visionOcrRunner,
    engineMode: input.engineMode,
    suryaRunner: input.suryaRunner,
    language: input.language,
    onOcrProgress: input.onOcrProgress,
  });
  return {
    text: res.text,
    confidence: res.confidence,
    warnings: res.warnings,
    preprocessed: res.preprocessed,
    orientationCorrectedDeg: res.orientationCorrectedDeg,
    ocrEngineUsed: res.ocrEngineUsed,
    visionFallbackUsed: res.visionFallbackUsed,
    visionFallbackError: res.visionFallbackError,
    uncertainSpans: res.uncertainSpans,
    wordBoxes: res.wordBoxes,
    lineBoxes: res.lineBoxes,
    perspectiveCorrected: res.perspectiveCorrected,
    suryaBlocks: res.suryaBlocks,
    suryaEquations: res.suryaEquations,
    suryaTables: res.suryaTables,
    engineRoutingReason: res.engineRoutingReason,
  };
}

function deduplicateExtractedTables(raw: ExtractedTable[]): ExtractedTable[] {
  const seen = new Set<string>();
  const out: ExtractedTable[] = [];
  for (const tbl of raw) {
    const hSig = tbl.headers.map((h) => h.trim().toLowerCase()).filter(Boolean).join('|');
    const rSig = tbl.rows
      .map((r) => r.map((c) => c.trim().toLowerCase()).filter(Boolean).join('|'))
      .filter(Boolean)
      .join(';');
    const sig = `${hSig}::${rSig}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(tbl);
  }
  return out;
}

function isSafeQrUrl(payload: string): boolean {
  return isSafeBarcodePayload(payload);
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function extractXmlTagsText(xmlSnippet: string): string {
  return decodeXmlEntities(
    xmlSnippet
      .replace(/<w:tab\b[^>]*\/>/g, '\t')
      .replace(/<w:br\b[^>]*\/>/g, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim()
  );
}

async function parseDocxArchive(
  bytes: Uint8Array,
  docId: string,
  signal?: AbortSignal
): Promise<{
  text: string;
  headings: string[];
  tables: ExtractedTable[];
  formulas: ExtractedFormula[];
  diagrams: ExtractedDiagramAsset[];
  blocks: ReconstructedBlock[];
  hasMacros: boolean;
  wasTruncated: boolean;
}> {
  throwIfAborted(signal);
  const zip = await JSZip.loadAsync(bytes);
  const entryNames = Object.keys(zip.files);
  const hasMacros = entryNames.some((n) => /vbaProject\.bin$/i.test(n));
  const documentEntry = zip.file('word/document.xml');
  if (!documentEntry) {
    throw new Error('Corrupt or unsupported DOCX: missing word/document.xml.');
  }
  const xml = await documentEntry.async('string');

  // Map DOCX relationship IDs -> word/media/... entries so embedded images render at exact DOM spot
  const relIdToMediaPath = new Map<string, string>();
  const relsEntry = zip.file('word/_rels/document.xml.rels');
  if (relsEntry) {
    try {
      const relsXml = await relsEntry.async('string');
      const relRegex = /<Relationship\b([^>]+)\/?>/gi;
      let relMatch: RegExpExecArray | null;
      while ((relMatch = relRegex.exec(relsXml)) !== null) {
        const attrs = relMatch[1];
        const idM = attrs.match(/\bId="([^"]+)"/i);
        const targetM = attrs.match(/\bTarget="([^"]+)"/i);
        if (idM && targetM) {
          const cleanTarget = targetM[1].replace(/^\/+/, '');
          const fullPath = cleanTarget.startsWith('word/') ? cleanTarget : `word/${cleanTarget}`;
          relIdToMediaPath.set(idM[1], fullPath);
        }
      }
    } catch {
      // Non-fatal
    }
  }

  // Load embedded images first so inline DOM blocks can reference them directly
  const diagramByMediaPath = new Map<string, ExtractedDiagramAsset>();
  const diagrams: ExtractedDiagramAsset[] = [];
  const mediaEntries = entryNames.filter(
    (name) => /^word\/media\/.+\.(png|jpg|jpeg|webp)$/i.test(name) && !zip.files[name].dir
  );
  for (let i = 0; i < Math.min(mediaEntries.length, 10); i += 1) {
    throwIfAborted(signal);
    const entryName = mediaEntries[i];
    const mediaBytes = await zip.files[entryName].async('uint8array');
    const ext = entryName.split('.').pop()?.toLowerCase() ?? 'png';
    const mimeType = guessMimeFromExtension(ext, 'image/png');
    const dataUrl =
      mediaBytes.byteLength <= 450_000 ? uint8ToDataUrl(mediaBytes, mimeType) : undefined;
    const ref = await documentStorageAdapter.putBinary({
      folder: 'diagrams',
      docId,
      fileName: entryName.split('/').pop() ?? `figure-${i + 1}.${ext}`,
      mimeType,
      bytes: mediaBytes,
      dataUrl,
    });
    const asset: ExtractedDiagramAsset = {
      id: `docx-fig-${i + 1}`,
      pageNumber: 1,
      caption: `Figure ${i + 1} (${entryName.split('/').pop() ?? 'diagram'})`,
      kind: 'diagram',
      mimeType,
      dataUrl,
      storageRef: ref,
    };
    diagrams.push(asset);
    diagramByMediaPath.set(entryName, asset);
  }

  const headings: string[] = [];
  const tables: ExtractedTable[] = [];
  const formulas: ExtractedFormula[] = [];
  const blocks: ReconstructedBlock[] = [];
  const textStreamLines: string[] = [];
  const placedDiagramIds = new Set<string>();
  let blockSeq = 1;

  // Walk <w:body> top-level <w:p> and <w:tbl> nodes in true DOM sequence without duplicating nested table <w:p> cells
  const bodyMatch = xml.match(/<w:body\b[^>]*>([\s\S]*)<\/w:body>/i);
  const bodyXml = bodyMatch ? bodyMatch[1] : xml;

  const extractTopLevelNodes = (source: string): Array<{ kind: 'p' | 'tbl'; xml: string }> => {
    const out: Array<{ kind: 'p' | 'tbl'; xml: string }> = [];
    let cursor = 0;
    const tagRe = /<(?:(\/)?w:(tbl|p))\b[^>]*(\/?)>/g;
    let tblDepth = 0;
    let pDepth = 0;
    let curKind: 'p' | 'tbl' | null = null;
    let curStart = 0;
    let m: RegExpExecArray | null;

    while ((m = tagRe.exec(source)) !== null) {
      const isClose = Boolean(m[1]);
      const tagType = m[2] as 'p' | 'tbl';
      const selfClose = Boolean(m[3]);
      if (selfClose) continue;

      if (tagType === 'tbl') {
        if (!isClose) {
          if (tblDepth === 0 && pDepth === 0) {
            curKind = 'tbl';
            curStart = m.index;
          }
          tblDepth += 1;
        } else {
          tblDepth = Math.max(0, tblDepth - 1);
          if (tblDepth === 0 && curKind === 'tbl') {
            out.push({ kind: 'tbl', xml: source.slice(curStart, tagRe.lastIndex) });
            curKind = null;
            cursor = tagRe.lastIndex;
          }
        }
      } else if (tagType === 'p') {
        if (tblDepth > 0) continue; // Ignore nested <w:p> inside table cells
        if (!isClose) {
          if (pDepth === 0) {
            curKind = 'p';
            curStart = m.index;
          }
          pDepth += 1;
        } else {
          pDepth = Math.max(0, pDepth - 1);
          if (pDepth === 0 && curKind === 'p') {
            out.push({ kind: 'p', xml: source.slice(curStart, tagRe.lastIndex) });
            curKind = null;
            cursor = tagRe.lastIndex;
          }
        }
      }
    }
    void cursor;
    return out;
  };

  const nodes = extractTopLevelNodes(bodyXml);

  for (const node of nodes) {
    if (node.kind === 'tbl') {
      if (tables.length >= 16) continue;
      const rows: string[][] = [];
      const mergedCells: MergedTableCellSpan[] = [];
      const trRegex = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g;
      let trMatch: RegExpExecArray | null;
      let rIdx = 0;

      while ((trMatch = trRegex.exec(node.xml)) !== null) {
        const rowCells: string[] = [];
        const tcRegex = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g;
        let tcMatch: RegExpExecArray | null;
        let cIdx = 0;

        while ((tcMatch = tcRegex.exec(trMatch[1])) !== null) {
          const tcXml = tcMatch[1];
          const cellVal = sanitizeSingleLine(extractXmlTagsText(tcXml), 140);
          const spanMatch = tcXml.match(/<w:gridSpan\b[^>]*w:val="(\d+)"/i);
          const colSpan = spanMatch ? Math.max(1, Number(spanMatch[1])) : 1;
          const hasVMergeRestart = /<w:vMerge\b[^>]*w:val="restart"/i.test(tcXml);
          const hasVMergeCont =
            /<w:vMerge\b(?![^>]*w:val="restart")/i.test(tcXml) ||
            /<w:vMerge\b[^>]*w:val="continue"/i.test(tcXml);

          if (colSpan > 1 || hasVMergeRestart) {
            mergedCells.push({
              row: rIdx,
              col: cIdx,
              rowSpan: hasVMergeRestart ? 2 : 1,
              colSpan,
              value: cellVal,
            });
          }
          if (hasVMergeCont) {
            const prevRowSpan = mergedCells.find(
              (m) => m.col === cIdx && m.row < rIdx && m.row + m.rowSpan >= rIdx
            );
            if (prevRowSpan) prevRowSpan.rowSpan += 1;
          }

          rowCells.push(cellVal);
          for (let k = 1; k < colSpan; k += 1) {
            rowCells.push('');
          }
          cIdx += colSpan;
        }

        if (rowCells.length > 0) {
          rows.push(rowCells);
          rIdx += 1;
        }
      }

      if (rows.length >= 2 && rows[0].length >= 2) {
        const colCount = Math.max(...rows.map((r) => r.length));
        const headers = Array.from({ length: colCount }, (_, i) => rows[0][i] ?? '');
        const bodyRows = rows.slice(1).map((r) => Array.from({ length: colCount }, (_, i) => r[i] ?? ''));
        const tblObj = enrichExtractedTable(
          {
            id: `docx-tbl-${tables.length + 1}`,
            pageNumber: 1,
            headers,
            rows: bodyRows,
          },
          {
            borderStyle: 'bordered',
            mergedCells: mergedCells.length > 0 ? mergedCells : undefined,
          }
        );
        tables.push(tblObj);
        blocks.push({
          id: `docx-blk-${blockSeq++}`,
          kind: 'table',
          pageNumber: 1,
          table: tblObj,
        });
        if (tblObj.markdown) {
          textStreamLines.push(tblObj.markdown);
        }
      }
      continue;
    }

    // Paragraph <w:p> node: inspect OMML math, drawings, style, alignment, and text
    const pXml = node.xml;
    const styleMatch = pXml.match(/<w:pStyle\b[^>]*w:val="([^"]+)"/i);
    const styleVal = styleMatch?.[1] ?? '';
    const isTitleStyle = /^Title$/i.test(styleVal);
    const isHeadingStyle = /^(Heading\d|Subtitle)$/i.test(styleVal);
    const jcMatch = pXml.match(/<w:jc\b[^>]*w:val="(center|right|left)"/i);
    const alignment = (jcMatch?.[1]?.toLowerCase() as 'center' | 'right' | 'left' | undefined) ?? 'left';

    // Check embedded OMML formulas inside this paragraph
    const pMathRegex = /<m:oMath[^>]*>([\s\S]*?)<\/m:oMath>/g;
    let pMathMatch: RegExpExecArray | null;
    while ((pMathMatch = pMathRegex.exec(pXml)) !== null && formulas.length < 32) {
      const mathText = extractXmlTagsText(pMathMatch[1]).replace(/\s+/g, ' ').trim();
      if (mathText) {
        formulas.push({
          id: `omml-${formulas.length + 1}`,
          pageNumber: 1,
          rawText: mathText,
          latex: mathText,
          displayMode: true,
          sourceMethod: 'omml_xml',
        });
      }
    }

    const text = extractXmlTagsText(pXml);
    if (text) {
      if (isTitleStyle || isHeadingStyle) {
        if (headings.length < 24) headings.push(sanitizeSingleLine(text, 120));
        const hLevel: 1 | 2 | 3 = isTitleStyle || /Heading1/i.test(styleVal) ? 1 : /Heading2/i.test(styleVal) ? 2 : 3;
        textStreamLines.push(`${'#'.repeat(hLevel)} ${text}`);
        blocks.push({
          id: `docx-blk-${blockSeq++}`,
          kind: hLevel === 3 ? 'subheading' : 'heading',
          headingLevel: hLevel,
          pageNumber: 1,
          text,
          alignment: isTitleStyle ? 'center' : alignment,
        });
      } else {
        textStreamLines.push(text);
        const qMatch = text.match(/^((?:Q(?:uestion)?\s*)?\d+[.)]|Question\s+(?:One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|\d+)[:.)]?)\s+(.+)$/i);
        const subMatch = text.match(/^(\([a-z0-9]{1,4}\)|[A-Ea-e][.)]|[ivxlcdm]{1,4}[.)])\s+(.+)$/);
        if (qMatch) {
          blocks.push({
            id: `docx-blk-${blockSeq++}`,
            kind: 'question',
            pageNumber: 1,
            label: qMatch[1],
            text: injectInlineLatexIntoText(qMatch[2]),
            alignment,
          });
        } else if (subMatch) {
          blocks.push({
            id: `docx-blk-${blockSeq++}`,
            kind: 'subquestion',
            pageNumber: 1,
            label: subMatch[1],
            text: injectInlineLatexIntoText(subMatch[2]),
            indentLevel: 1,
            alignment,
          });
        } else if (/<m:oMathPara/i.test(pXml) || (/^<m:oMath/i.test(pXml.trim()) && text.length < 100)) {
          blocks.push({
            id: `docx-blk-${blockSeq++}`,
            kind: 'formula',
            pageNumber: 1,
            latex: text,
            text,
            displayMode: true,
            alignment: 'center',
          });
        } else {
          blocks.push({
            id: `docx-blk-${blockSeq++}`,
            kind: 'paragraph',
            pageNumber: 1,
            text: injectInlineLatexIntoText(text),
            alignment,
          });
        }
      }
    }

    // Emit any embedded images referenced inside this <w:p> right at its DOM position
    const blipRegex = /r:embed="(rId\d+)"/gi;
    let blipMatch: RegExpExecArray | null;
    while ((blipMatch = blipRegex.exec(pXml)) !== null) {
      const targetPath = relIdToMediaPath.get(blipMatch[1]);
      const diagAsset = targetPath ? diagramByMediaPath.get(targetPath) : undefined;
      if (diagAsset && !placedDiagramIds.has(diagAsset.id)) {
        placedDiagramIds.add(diagAsset.id);
        blocks.push({
          id: `docx-blk-${blockSeq++}`,
          kind: 'diagram',
          pageNumber: 1,
          diagram: diagAsset,
          text: diagAsset.caption,
        });
      }
    }
  }

  for (const diagAsset of diagrams) {
    if (!placedDiagramIds.has(diagAsset.id)) {
      blocks.push({
        id: `docx-blk-${blockSeq++}`,
        kind: 'diagram',
        pageNumber: 1,
        diagram: diagAsset,
        text: diagAsset.caption,
      });
    }
  }

  const joined = textStreamLines.join('\n');
  const sanitized = sanitizePlainText(joined, MAX_PAGE_TEXT_CHARS);
  return {
    text: sanitized,
    headings,
    tables,
    formulas,
    diagrams,
    blocks,
    hasMacros,
    wasTruncated: joined.trim().length > MAX_PAGE_TEXT_CHARS,
  };
}

interface PdfTextItemLike {
  str?: string;
  width?: number;
  height?: number;
  hasEOL?: boolean;
  transform?: number[];
}

interface NativePdfTextInspection {
  text: string;
  alnumCount: number;
  wordCount: number;
  garbleRatio: number;
  isMultiColumn: boolean;
  wasTruncated: boolean;
  placedTokens?: PdfTextTokenLike[];
}

/**
 * Reconstructs reading order from PDF text items by grouping Y baselines, reconstructing
 * coordinate-aligned 2+ column tables inline as clean Markdown tables, and detecting
 * true 2-column vertical prose gutters.
 */
export function extractPdfPageStructuredText(
  rawItems: PdfTextItemLike[],
  pageWidth = 612
): NativePdfTextInspection {
  interface PlacedToken {
    str: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }

  const tokens: PlacedToken[] = [];
  for (const item of rawItems) {
    const str = typeof item.str === 'string' ? item.str : '';
    if (!str.trim()) continue;
    const x = Array.isArray(item.transform) ? Number(item.transform[4] ?? 0) : 0;
    const y = Array.isArray(item.transform) ? Number(item.transform[5] ?? 0) : 0;
    const h = Math.abs(
      typeof item.height === 'number' && item.height > 0
        ? item.height
        : Array.isArray(item.transform)
          ? Number(item.transform[3] ?? 10)
          : 10
    );
    const w =
      typeof item.width === 'number' && item.width >= 0 ? item.width : str.length * h * 0.45;
    tokens.push({ str: str.trimEnd(), x, y, w, h });
  }

  if (tokens.length === 0) {
    return {
      text: '',
      alnumCount: 0,
      wordCount: 0,
      garbleRatio: 0,
      isMultiColumn: false,
      wasTruncated: false,
      placedTokens: [],
    };
  }

  // Detect 2-column reading layout: significant prose/question tokens strictly left/right of central gutter
  const midX = pageWidth * 0.5;
  const gutterHalf = Math.max(12, pageWidth * 0.035);
  const leftTokensOnly: PlacedToken[] = [];
  const rightTokensOnly: PlacedToken[] = [];
  const crossingTokens: PlacedToken[] = [];
  let leftWordSum = 0;
  let rightWordSum = 0;
  let leftQOrProse = 0;
  let rightQOrProse = 0;
  const qPrefixRe = /^((?:Q(?:uestion)?\s*)?\d+[.)]|\([a-z0-9]{1,3}\))\s+[A-Za-z]/i;

  for (const t of tokens) {
    const endX = t.x + t.w;
    const words = t.str.trim().split(/\s+/).filter(Boolean).length;
    if (endX <= midX - gutterHalf) {
      leftTokensOnly.push(t);
      leftWordSum += words;
      if (words >= 4 || qPrefixRe.test(t.str.trim())) leftQOrProse += 1;
    } else if (t.x >= midX + gutterHalf) {
      rightTokensOnly.push(t);
      rightWordSum += words;
      if (words >= 4 || qPrefixRe.test(t.str.trim())) rightQOrProse += 1;
    } else if (t.w > gutterHalf * 2.5) {
      crossingTokens.push(t);
    }
  }
  const leftOnly = leftTokensOnly.length;
  const rightOnly = rightTokensOnly.length;
  const colYMax = Math.min(
    leftOnly > 0 ? Math.max(...leftTokensOnly.map((t) => t.y + t.h)) : -Infinity,
    rightOnly > 0 ? Math.max(...rightTokensOnly.map((t) => t.y + t.h)) : -Infinity
  );
  const colYMin = Math.max(
    leftOnly > 0 ? Math.min(...leftTokensOnly.map((t) => t.y)) : Infinity,
    rightOnly > 0 ? Math.min(...rightTokensOnly.map((t) => t.y)) : Infinity
  );
  const innerCrossingMid =
    leftOnly > 0 && rightOnly > 0
      ? crossingTokens.filter((t) => t.y <= colYMax + 6 && t.y + t.h >= colYMin - 6).length
      : crossingTokens.length;
  const avgLeftTokWords = leftWordSum / Math.max(1, leftOnly);
  const avgRightTokWords = rightWordSum / Math.max(1, rightOnly);
  const isDenseTwoCol =
    leftOnly >= 8 &&
    rightOnly >= 8 &&
    innerCrossingMid <= Math.min(leftOnly, rightOnly) * 0.25 &&
    (avgLeftTokWords >= 2.2 || avgRightTokWords >= 2.2 || leftOnly + rightOnly >= 24);
  const isCompactProseTwoCol =
    leftOnly >= 2 &&
    rightOnly >= 2 &&
    colYMax >= colYMin - 12 &&
    innerCrossingMid <= Math.floor(Math.min(leftOnly, rightOnly) * 0.25) &&
    ((avgLeftTokWords >= 3.2 && avgRightTokWords >= 3.2) ||
      (leftQOrProse >= 2 && rightQOrProse >= 2));
  const isMultiColumn = isDenseTwoCol || isCompactProseTwoCol;

  const rebuildStream = (stream: PlacedToken[], allowInlineTables: boolean): string => {
    if (stream.length === 0) return '';
    // Sort top-to-bottom (higher PDF Y first), then left-to-right (smaller X first)
    const sorted = stream.slice().sort((a, b) => {
      if (Math.abs(a.y - b.y) > 4.2) return b.y - a.y;
      return a.x - b.x;
    });

    // Cluster into horizontal baseline lines
    const lines: PlacedToken[][] = [];
    for (const tok of sorted) {
      const curLine = lines[lines.length - 1];
      if (!curLine || Math.abs(curLine[0].y - tok.y) > 4.2) {
        lines.push([tok]);
      } else {
        curLine.push(tok);
      }
    }

    interface LineRowInfo {
      y: number;
      avgH: number;
      text: string;
      cells: Array<{ text: string; x0: number; x1: number }>;
    }

    const rowInfos: LineRowInfo[] = [];
    for (const line of lines) {
      line.sort((a, b) => a.x - b.x);
      const baselineY = line[0].y;
      const avgH = line.reduce((acc, t) => acc + t.h, 0) / line.length || 10;

      // Split into coordinate cell spans for table detection + normal assembled text
      const cells: Array<{ text: string; x0: number; x1: number }> = [];
      let curCellText = '';
      let cellX0 = line[0].x;
      let cellX1 = line[0].x + line[0].w;
      let assembled = '';
      let prevEndX: number | null = null;
      const cellGapThresh = Math.max(11, avgH * 1.15);

      for (const tok of line) {
        const cleanedTok = tok.str.trim();
        if (!cleanedTok) continue;
        if (prevEndX !== null) {
          const gap = tok.x - prevEndX;
          if (gap > Math.max(18, avgH * 1.9)) {
            assembled += '\t';
          } else if (gap > Math.max(1.5, avgH * 0.14) && !assembled.endsWith(' ')) {
            assembled += ' ';
          }
          if (gap > cellGapThresh && curCellText.trim()) {
            cells.push({ text: curCellText.trim(), x0: cellX0, x1: cellX1 });
            curCellText = cleanedTok;
            cellX0 = tok.x;
            cellX1 = tok.x + tok.w;
          } else {
            curCellText = curCellText ? `${curCellText} ${cleanedTok}` : cleanedTok;
            cellX1 = Math.max(cellX1, tok.x + tok.w);
          }
        } else {
          curCellText = cleanedTok;
          cellX0 = tok.x;
          cellX1 = tok.x + tok.w;
        }
        assembled += tok.str;
        prevEndX = tok.x + tok.w;
      }
      if (curCellText.trim()) {
        cells.push({ text: curCellText.trim(), x0: cellX0, x1: cellX1 });
      }
      if (assembled.trim()) {
        rowInfos.push({ y: baselineY, avgH, text: assembled.trimEnd(), cells });
      }
    }

    const isTableCandidateRow = (r: LineRowInfo): boolean => {
      if (!allowInlineTables) return false;
      if (r.cells.length < 2 || r.cells.length > 8) return false;
      if (r.text.length > 165) return false;
      const avgWords =
        r.cells.reduce((s, c) => s + c.text.split(/\s+/).filter(Boolean).length, 0) / r.cells.length;
      if (avgWords > 6) return false;
      if (
        r.cells.length === 2 &&
        (/^((?:Q(?:uestion)?\s*)?\d+[.)])\s+[A-Za-z]/i.test(r.cells[0].text) ||
          /^((?:Q(?:uestion)?\s*)?\d+[.)])\s+[A-Za-z]/i.test(r.cells[1].text))
      ) {
        return false;
      }
      if (
        r.cells.length === 2 &&
        /^[A-D][.)]\s/i.test(r.cells[0].text) &&
        /^[A-D][.)]\s/i.test(r.cells[1].text)
      ) {
        return false;
      }
      return true;
    };

    const outBlocks: string[] = [];
    let prevBaselineY: number | null = null;
    let idx = 0;

    while (idx < rowInfos.length) {
      const row = rowInfos[idx];
      if (isTableCandidateRow(row)) {
        let end = idx + 1;
        while (end < rowInfos.length && isTableCandidateRow(rowInfos[end])) {
          const vGap = rowInfos[end - 1].y - rowInfos[end].y;
          if (vGap > row.avgH * 4.2) break;
          end += 1;
        }
        const run = rowInfos.slice(idx, end);
        if (run.length >= 2) {
          const bands: Array<{ minX: number; maxX: number; center: number }> = [];
          const runCells = run.flatMap((r) => r.cells).sort((a, b) => a.x0 - b.x0);
          for (const cell of runCells) {
            const match = bands.find(
              (b) => cell.x0 <= b.maxX + row.avgH * 0.85 && cell.x1 >= b.minX - row.avgH * 0.85
            );
            if (match) {
              match.minX = Math.min(match.minX, cell.x0);
              match.maxX = Math.max(match.maxX, cell.x1);
              match.center = (match.minX + match.maxX) * 0.5;
            } else {
              bands.push({ minX: cell.x0, maxX: cell.x1, center: (cell.x0 + cell.x1) * 0.5 });
            }
          }
          bands.sort((a, b) => a.center - b.center);
          const avgCellWords =
            runCells.reduce((s, c) => s + c.text.split(/\s+/).filter(Boolean).length, 0) /
            Math.max(1, runCells.length);

          if (bands.length >= 2 && bands.length <= 8 && (bands.length >= 3 || avgCellWords <= 4.2)) {
            const grid = run.map((r) => {
              const slots = Array.from({ length: bands.length }, () => '');
              for (const cell of r.cells) {
                let bestIdx = 0;
                let bestDist = Infinity;
                const center = (cell.x0 + cell.x1) * 0.5;
                for (let bi = 0; bi < bands.length; bi += 1) {
                  const overlap = Math.min(cell.x1, bands[bi].maxX) - Math.max(cell.x0, bands[bi].minX);
                  const d = overlap > 0 ? -overlap : Math.abs(center - bands[bi].center);
                  if (d < bestDist) {
                    bestDist = d;
                    bestIdx = bi;
                  }
                }
                slots[bestIdx] = slots[bestIdx] ? `${slots[bestIdx]} ${cell.text}` : cell.text;
              }
              return slots;
            });
            if (prevBaselineY !== null && prevBaselineY - row.y > row.avgH * 1.5) {
              outBlocks.push('');
            }
            outBlocks.push(
              [
                `| ${grid[0].map((c) => c || ' ').join(' | ')} |`,
                `| ${bands.map(() => '---').join(' | ')} |`,
                ...grid.slice(1).map((r) => `| ${r.map((c) => c || ' ').join(' | ')} |`),
              ].join('\n')
            );
            prevBaselineY = run[run.length - 1].y;
            idx = end;
            continue;
          }
        }
      }

      if (prevBaselineY !== null && prevBaselineY - row.y > row.avgH * 1.65) {
        outBlocks.push('');
      }
      outBlocks.push(row.text);
      prevBaselineY = row.y;
      idx += 1;
    }

    return outBlocks.join('\n');
  };

  let rawText = '';
  if (isMultiColumn) {
    const headerOrFull: PlacedToken[] = [];
    const leftCol: PlacedToken[] = [];
    const rightCol: PlacedToken[] = [];
    for (const t of tokens) {
      const endX = t.x + t.w;
      if (t.x < midX - gutterHalf && endX > midX + gutterHalf) {
        headerOrFull.push(t);
      } else if (endX <= midX + gutterHalf * 0.5) {
        leftCol.push(t);
      } else {
        rightCol.push(t);
      }
    }
    const colTopY = Math.max(
      ...leftCol.map((t) => t.y + t.h),
      ...rightCol.map((t) => t.y + t.h),
      -Infinity
    );
    const colBottomY = Math.min(
      ...leftCol.map((t) => t.y),
      ...rightCol.map((t) => t.y),
      Infinity
    );
    const topFull = headerOrFull.filter((t) => t.y >= colTopY - 8);
    const bottomFull = headerOrFull.filter((t) => t.y + t.h <= colBottomY + 8);
    const midFull = headerOrFull.filter((t) => !topFull.includes(t) && !bottomFull.includes(t));

    rawText = [
      rebuildStream(topFull, true),
      rebuildStream(leftCol, false),
      rebuildStream(midFull, true),
      rebuildStream(rightCol, false),
      rebuildStream(bottomFull, true),
    ]
      .filter((s) => s.trim().length > 0)
      .join('\n\n');
  } else {
    rawText = rebuildStream(tokens, true);
  }

  const cleanText = sanitizePlainText(rawText, MAX_PAGE_TEXT_CHARS);
  const nonWs = cleanText.replace(/\s+/g, '');
  const alnumCount = (cleanText.match(/[A-Za-z0-9]/g) ?? []).length;
  const wordCount = cleanText.split(/\s+/).filter((w) => /[A-Za-z0-9]{2,}/.test(w)).length;
  const weirdChars = (
    rawText.match(/[\uFFFD\uE000-\uF8FF]|[^\x20-\x7E\n\r\t\u00A0-\u024F\u2000-\u22FF]/g) ?? []
  ).length;
  const garbleRatio = nonWs.length > 0 ? weirdChars / nonWs.length : 0;

  return {
    text: cleanText,
    alnumCount,
    wordCount,
    garbleRatio,
    isMultiColumn,
    wasTruncated: rawText.trim().length > MAX_PAGE_TEXT_CHARS,
    placedTokens: tokens,
  };
}

/** Merges OCR lines from embedded graphics/scans into native PDF text without duplicating native lines or appending diagnostic headers. */
function mergeNativeAndOcrText(nativeText: string, ocrText: string): {
  merged: string;
  addedLines: number;
} {
  const nativeLines = nativeText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const nativeTokenSets = nativeLines.map(
    (l) =>
      new Set(
        l
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          .filter((w) => w.length >= 2)
      )
  );

  const ocrLines = ocrText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => (l.match(/[A-Za-z0-9]/g) ?? []).length >= 5);

  const uniqueOcrLines: string[] = [];
  for (const line of ocrLines) {
    const norm = line.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (norm.length < 4) continue;
    const words = line
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2);
    const isDuplicate = nativeTokenSets.some((set) => {
      if (set.size === 0 || words.length === 0) return false;
      let overlap = 0;
      for (const w of words) {
        if (set.has(w)) overlap += 1;
      }
      return overlap / Math.max(words.length, set.size) >= 0.55 || overlap / words.length >= 0.72;
    });
    if (!isDuplicate) {
      uniqueOcrLines.push(line);
    }
  }

  if (uniqueOcrLines.length === 0) {
    return { merged: nativeText, addedLines: 0 };
  }

  return {
    merged: `${nativeText.trim()}\n\n${uniqueOcrLines.join('\n')}`,
    addedLines: uniqueOcrLines.length,
  };
}

/** Extracts raw raster image bytes embedded inside a PDF page in headless Node environments. */
async function extractNodePdfPageRasterFallback(
  page: {
    getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
    objs: { has: (id: string) => boolean; get: (id: string) => unknown };
    commonObjs?: { has: (id: string) => boolean; get: (id: string) => unknown };
  },
  imageOpIds: Set<number>
): Promise<{ bytes: Uint8Array; mimeType: string; width: number; height: number } | null> {
  if (typeof window !== 'undefined' && typeof document !== 'undefined') return null;
  try {
    const dynamicImport = new Function('mod', 'return import(mod)') as (
      mod: string
    ) => Promise<{
      default?: (
        buf: Uint8Array,
        opts: { raw: { width: number; height: number; channels: 1 | 3 | 4 } }
      ) => { png: () => { toBuffer: () => Promise<Buffer> } };
    }>;
    const sharpMod = await dynamicImport('sharp');
    const sharpFn = sharpMod.default;
    if (!sharpFn) return null;

    const opList = await page.getOperatorList();
    let bestImg: {
      width: number;
      height: number;
      channels: 1 | 3 | 4;
      data: Uint8Array | Uint8ClampedArray;
      pixels: number;
    } | null = null;

    for (let idx = 0; idx < opList.fnArray.length; idx += 1) {
      if (!imageOpIds.has(opList.fnArray[idx])) continue;
      const objId = opList.argsArray[idx]?.[0];
      if (typeof objId !== 'string') continue;
      const imgObj = (
        page.objs.has(objId)
          ? page.objs.get(objId)
          : page.commonObjs?.has(objId)
            ? page.commonObjs.get(objId)
            : null
      ) as {
        width?: number;
        height?: number;
        kind?: number;
        data?: Uint8Array | Uint8ClampedArray;
      } | null;
      if (!imgObj || !imgObj.data || !imgObj.width || !imgObj.height) continue;
      const pixelCount = imgObj.width * imgObj.height;
      if (pixelCount < 400) continue;
      const channels: 0 | 1 | 3 | 4 =
        imgObj.data.length === pixelCount * 4
          ? 4
          : imgObj.data.length === pixelCount * 3
            ? 3
            : imgObj.data.length === pixelCount
              ? 1
              : 0;
      if (channels === 0) continue;
      if (!bestImg || pixelCount > bestImg.pixels) {
        bestImg = {
          width: imgObj.width,
          height: imgObj.height,
          channels,
          data: imgObj.data,
          pixels: pixelCount,
        };
      }
    }

    if (bestImg) {
      const pngBuf = await sharpFn(new Uint8Array(bestImg.data), {
        raw: { width: bestImg.width, height: bestImg.height, channels: bestImg.channels },
      })
        .png()
        .toBuffer();
      return {
        bytes: new Uint8Array(pngBuf),
        mimeType: 'image/png',
        width: bestImg.width,
        height: bestImg.height,
      };
    }
  } catch {
    // Non-fatal fallback; browser canvas or pdfPageRenderer handles rendering
  }
  return null;
}

function classifyPageStatus(params: {
  text: string;
  ocrApplied: boolean;
  ocrConfidence: number | null;
  warnings: string[];
  errors: string[];
}): { status: ExtractionQualityStatus; isIncomplete: boolean } {
  const alnum = (params.text.match(/[A-Za-z0-9]/g) ?? []).length;
  if (params.errors.length > 0 && alnum < 15) {
    return { status: 'failed', isIncomplete: true };
  }
  if (alnum < 15) {
    return { status: 'needs_review', isIncomplete: true };
  }
  if (params.ocrApplied && (params.ocrConfidence ?? 0) < 42) {
    return { status: 'needs_review', isIncomplete: alnum < 60 };
  }
  if (
    params.errors.length > 0 ||
    params.warnings.length > 0 ||
    (params.ocrApplied && (params.ocrConfidence ?? 100) < 65)
  ) {
    return { status: 'completed_with_warnings', isIncomplete: false };
  }
  return { status: 'completed', isIncomplete: false };
}

async function processPdfBuffer(params: {
  bytes: Uint8Array;
  docId: string;
  signal?: AbortSignal;
  ocrRunner: OcrRunner;
  pdfPageRenderer?: PdfPageRenderer;
  visionFallback?: VisionFallbackMode;
  visionOcrRunner?: VisionOcrRunner;
  engineMode?: OcrEngineMode;
  suryaRunner?: SuryaOcrRunner;
  language?: string;
  onProgress?: (update: ScanProgressUpdate) => void;
  handwritingAdapter?: HandwritingEngineAdapter;
  mathAdapter?: MathOcrAdapter;
  omrTemplate?: OmrTemplateConfig;
}): Promise<{
  pages: ExtractedPageContent[];
  diagrams: ExtractedDiagramAsset[];
  tables: ExtractedTable[];
  formulas: ExtractedFormula[];
  qrMatches: QrCodeMatch[];
  averageOcrConfidence: number | null;
  optimizedPreviewUrl?: string;
  processedPages: number[];
  unprocessedPages: number[];
  pdfWarnings: string[];
  omrPages: OmrScanResult[];
  formPages: FormExtractionResult[];
  handwritingPages: HandwritingAnalysisResult[];
  signatures: SignatureDetection[];
  stamps: StampDetection[];
}> {
  throwIfAborted(params.signal);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (typeof window !== 'undefined' && pdfjs.GlobalWorkerOptions) {
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/legacy/build/pdf.worker.mjs',
        import.meta.url
      ).toString();
    }
  }

  const loadingTask = pdfjs.getDocument({
    data: params.bytes.slice(),
    disableWorker: typeof window === 'undefined',
    isEvalSupported: false,
    useSystemFonts: true,
  } as Parameters<typeof pdfjs.getDocument>[0]);

  if (params.signal) {
    params.signal.addEventListener(
      'abort',
      () => {
        void loadingTask.destroy().catch(() => {});
      },
      { once: true }
    );
  }

  const pdfDoc = await loadingTask.promise;
  const totalPagesInPdf = pdfDoc.numPages;
  const totalPages = Math.min(totalPagesInPdf, MAX_PDF_PAGES);
  const processedPages: number[] = [];
  const unprocessedPages: number[] = [];
  for (let p = MAX_PDF_PAGES + 1; p <= totalPagesInPdf; p += 1) {
    unprocessedPages.push(p);
  }

  const pages: ExtractedPageContent[] = [];
  const allDiagrams: ExtractedDiagramAsset[] = [];
  const allTables: ExtractedTable[] = [];
  const allFormulas: ExtractedFormula[] = [];
  const qrMatches: QrCodeMatch[] = [];
  const ocrScores: number[] = [];
  const pdfWarnings: string[] = [];
  const omrPages: OmrScanResult[] = [];
  const formPages: FormExtractionResult[] = [];
  const handwritingPages: HandwritingAnalysisResult[] = [];
  const signatures: SignatureDetection[] = [];
  const stamps: StampDetection[] = [];
  let optimizedPreviewUrl: string | undefined;

  const imageOpIds = new Set<number>([
    pdfjs.OPS.paintImageXObject,
    pdfjs.OPS.paintInlineImageXObject,
  ]);

  for (let pageNo = 1; pageNo <= totalPages; pageNo += 1) {
    throwIfAborted(params.signal);
    processedPages.push(pageNo);

    const basePercent = Math.round(((pageNo - 1) / Math.max(1, totalPages)) * 70) + 15;
    params.onProgress?.({
      stage: 'extracting',
      stageLabel: `Inspecting PDF page ${pageNo} of ${totalPages}`,
      currentPage: pageNo,
      totalPages,
      progressPercent: basePercent,
    });
    await new Promise<void>((r) => setTimeout(r, 0));

    const page = await pdfDoc.getPage(pageNo);
    const baseViewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const nativeInspection = extractPdfPageStructuredText(
      textContent.items as PdfTextItemLike[],
      baseViewport.width || 612
    );

    let cleanedPageText = nativeInspection.text;
    let renderedPreviewUrl: string | undefined;
    let highResOcrDataUrl: string | undefined;
    let highResOcrBytes: Uint8Array | undefined;
    let highResMime: string | undefined;
    let ocrApplied = false;
    let ocrConfidence: number | null = null;
    let extractionMethod: PageExtractionMethod = 'native_text';
    let wasTruncated = nativeInspection.wasTruncated;
    const warnings: string[] = [];
    const errors: string[] = [];
    const preprocessingApplied: string[] = [];
    const pageDiagrams: ExtractedDiagramAsset[] = [];

    let hasEmbeddedGraphics = false;
    let hasVectorDrawings = false;
    try {
      const opList = await page.getOperatorList();
      hasEmbeddedGraphics = opList.fnArray.some((fn: number) => imageOpIds.has(fn));
      const vectorDiagrams = extractPdfVectorDiagrams({
        opList: opList as { fnArray: number[]; argsArray: unknown[][] },
        OPS: pdfjs.OPS as unknown as Record<string, number>,
        pageWidth: baseViewport.width || 612,
        pageHeight: baseViewport.height || 792,
        textTokens: nativeInspection.placedTokens,
        pageNumber: pageNo,
      });
      if (vectorDiagrams.length > 0) {
        hasVectorDrawings = true;
        pageDiagrams.push(...vectorDiagrams);
      }
    } catch {
      // Non-fatal
    }

    const nativeGarbled = nativeInspection.garbleRatio > 0.16;
    const nativeTooSparse =
      nativeInspection.alnumCount < 60 ||
      (nativeInspection.wordCount < 14 && hasEmbeddedGraphics);
    const needsFullOcr = nativeGarbled || nativeTooSparse;
    const isMixedPage = !needsFullOcr && hasEmbeddedGraphics;

    if (nativeGarbled) {
      warnings.push(
        `Native text encoding on page ${pageNo} appears garbled; triggering OCR recovery.`
      );
    }
    if (nativeInspection.wasTruncated) {
      warnings.push(`Page ${pageNo} exceeded ${MAX_PAGE_TEXT_CHARS} characters and was capped.`);
    }

    if (params.pdfPageRenderer) {
      try {
        const custom = await params.pdfPageRenderer({ pageNumber: pageNo, totalPages });
        if (custom) {
          highResOcrBytes = custom.bytes;
          highResMime = custom.mimeType || 'image/png';
          highResOcrDataUrl =
            custom.imageDataUrl ??
            (custom.bytes ? uint8ToDataUrl(custom.bytes, highResMime) : undefined);
          renderedPreviewUrl = highResOcrDataUrl;
          if (!optimizedPreviewUrl && renderedPreviewUrl) {
            optimizedPreviewUrl = renderedPreviewUrl;
          }
        }
      } catch (err) {
        warnings.push(
          `Custom renderer failed on page ${pageNo}: ${err instanceof Error ? err.message : 'unknown error'}`
        );
      }
    } else if (typeof document !== 'undefined') {
      try {
        const targetScale = Math.min(3.0, Math.max(2.4, 2100 / Math.max(300, baseViewport.width)));
        const ocrViewport = page.getViewport({ scale: targetScale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(ocrViewport.width));
        canvas.height = Math.max(1, Math.round(ocrViewport.height));
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport: ocrViewport, canvas }).promise;
          highResOcrDataUrl = canvas.toDataURL('image/png');
          highResMime = 'image/png';

          const prevW = Math.min(1280, canvas.width);
          const prevH = Math.max(1, Math.round((canvas.height * prevW) / canvas.width));
          const prevCanvas = document.createElement('canvas');
          prevCanvas.width = prevW;
          prevCanvas.height = prevH;
          const prevCtx = prevCanvas.getContext('2d');
          if (prevCtx) {
            prevCtx.fillStyle = '#FFFFFF';
            prevCtx.fillRect(0, 0, prevW, prevH);
            prevCtx.drawImage(canvas, 0, 0, prevW, prevH);
            renderedPreviewUrl = prevCanvas.toDataURL('image/jpeg', 0.85);
            try {
              const imgData = prevCtx.getImageData(0, 0, prevW, prevH);
              const grayBuf = new Uint8Array(prevW * prevH);
              for (let k = 0; k < grayBuf.length; k += 1) {
                const off = k * 4;
                grayBuf[k] = Math.round(
                  0.299 * imgData.data[off] +
                    0.587 * imgData.data[off + 1] +
                    0.114 * imgData.data[off + 2]
                );
              }
              const pageCodes = scanBarcodesAndQrFromBuffer({
                rgba: imgData.data,
                gray: grayBuf,
                width: prevW,
                height: prevH,
                pageNumber: pageNo,
              });
              for (const code of pageCodes) {
                if (!code.unreadableDetected) qrMatches.push(code);
              }
            } catch {
              // Ignore QR/barcode scan issues
            }
          } else {
            renderedPreviewUrl = highResOcrDataUrl;
          }

          if (!optimizedPreviewUrl) optimizedPreviewUrl = renderedPreviewUrl;

          if (
            (hasEmbeddedGraphics || hasVectorDrawings) &&
            pageDiagrams.length === 0 &&
            renderedPreviewUrl
          ) {
            const ref = await documentStorageAdapter.putBinary({
              folder: 'diagrams',
              docId: params.docId,
              fileName: `pdf-page-${pageNo}-diagram.jpg`,
              mimeType: 'image/jpeg',
              dataUrl: renderedPreviewUrl,
            });
            pageDiagrams.push({
              id: `pdf-diag-${pageNo}`,
              pageNumber: pageNo,
              caption: `Embedded figure / page graphic (Page ${pageNo})`,
              kind: 'diagram',
              mimeType: 'image/jpeg',
              dataUrl: renderedPreviewUrl,
              storageRef: ref,
              width: canvas.width,
              height: canvas.height,
            });
          }
        }
      } catch {
        warnings.push(`Visual preview render unavailable for page ${pageNo}.`);
      }
    } else if (hasEmbeddedGraphics && (needsFullOcr || isMixedPage)) {
      const nodeRaster = await extractNodePdfPageRasterFallback(
        page as unknown as Parameters<typeof extractNodePdfPageRasterFallback>[0],
        imageOpIds
      );
      if (nodeRaster) {
        highResOcrBytes = nodeRaster.bytes;
        highResMime = nodeRaster.mimeType;
        highResOcrDataUrl = uint8ToDataUrl(nodeRaster.bytes, nodeRaster.mimeType);
        renderedPreviewUrl = highResOcrDataUrl;
        if (!optimizedPreviewUrl) optimizedPreviewUrl = renderedPreviewUrl;
      }
    }

    let ocrEngineUsed: ExtractedPageContent['ocrEngineUsed'];
    let visionFallbackUsed = false;
    let visionFallbackError: string | undefined;
    let uncertainSpans: UncertainSpan[] = [];
    let perspectiveCorrected = false;
    let pageLineBoxes: OcrLineBox[] | undefined;
    let pageWordBoxes: OcrWordBox[] | undefined;
    let pagePrep: PreprocessedImageResult | undefined;
    let pageSuryaBlocks: ReconstructedBlock[] | undefined;
    let pageSuryaEquations: ExtractedFormula[] = [];
    let pageSuryaTables: ExtractedTable[] = [];

    const canRunOcr = Boolean(highResOcrBytes || highResOcrDataUrl);
    if ((needsFullOcr || isMixedPage) && canRunOcr) {
      params.onProgress?.({
        stage: 'ocr',
        stageLabel: needsFullOcr
          ? `Running OCR on scanned PDF page ${pageNo} of ${totalPages}`
          : `Inspecting embedded graphics on mixed page ${pageNo} of ${totalPages}`,
        currentPage: pageNo,
        totalPages,
        progressPercent: basePercent + 5,
        preprocessingStatus: 'Adaptive contrast & deskew active',
      });
      try {
        const ocrRes = await params.ocrRunner({
          imageDataUrl: highResOcrDataUrl,
          bytes: highResOcrBytes,
          mimeType: highResMime || 'image/png',
          pageNumber: pageNo,
          signal: params.signal,
          visionFallback: params.visionFallback ?? 'off',
          visionOcrRunner: params.visionOcrRunner,
          engineMode: params.engineMode,
          suryaRunner: params.suryaRunner,
          language: params.language,
          onOcrProgress: (pct, statusText) => {
            params.onProgress?.({
              stage: 'ocr',
              stageLabel: `OCR page ${pageNo}/${totalPages} (${pct}%)`,
              currentPage: pageNo,
              totalPages,
              ocrProgress: pct,
              progressPercent: Math.min(88, basePercent + Math.round((pct / 100) * 15)),
              detail: statusText,
            });
          },
        });
        ocrApplied = true;
        ocrConfidence = ocrRes.confidence;
        ocrScores.push(ocrRes.confidence);
        ocrEngineUsed = ocrRes.ocrEngineUsed ?? 'tesseract';
        visionFallbackUsed = Boolean(ocrRes.visionFallbackUsed);
        visionFallbackError = ocrRes.visionFallbackError;
        uncertainSpans = ocrRes.uncertainSpans ?? [];
        pageLineBoxes = ocrRes.lineBoxes;
        pageWordBoxes = ocrRes.wordBoxes;
        pagePrep = ocrRes.preprocessed;
        perspectiveCorrected = Boolean(ocrRes.perspectiveCorrected);
        pageSuryaBlocks = ocrRes.suryaBlocks;
        pageSuryaEquations = ocrRes.suryaEquations ?? [];
        pageSuryaTables = ocrRes.suryaTables ?? [];
        if (ocrRes.preprocessed?.appliedSteps) {
          preprocessingApplied.push(...ocrRes.preprocessed.appliedSteps);
        }
        if (ocrRes.preprocessed?.previewDataUrl && needsFullOcr) {
          renderedPreviewUrl = ocrRes.preprocessed.previewDataUrl;
        }
        if (ocrRes.warnings) warnings.push(...ocrRes.warnings);

        if (needsFullOcr) {
          extractionMethod = 'ocr';
          const ocrAlnum = (ocrRes.text.match(/[A-Za-z0-9]/g) ?? []).length;
          if (nativeGarbled || ocrAlnum >= nativeInspection.alnumCount) {
            cleanedPageText = ocrRes.text;
          } else if (ocrAlnum > 0) {
            const merged = mergeNativeAndOcrText(cleanedPageText, ocrRes.text);
            cleanedPageText = merged.merged;
            extractionMethod = 'hybrid_native_plus_ocr';
          }
        } else {
          const merged = mergeNativeAndOcrText(cleanedPageText, ocrRes.text);
          if (merged.addedLines > 0) {
            cleanedPageText = sanitizePlainText(merged.merged, MAX_PAGE_TEXT_CHARS);
            extractionMethod = 'hybrid_native_plus_ocr';
            if (merged.merged.length > MAX_PAGE_TEXT_CHARS) wasTruncated = true;
          }
        }
        // Raster diagram pass runs below after bordered tables are identified so grid tables are excluded.
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') throw err;
        errors.push(
          `OCR failed on page ${pageNo}: ${err instanceof Error ? err.message : 'unknown error'}`
        );
      }
    } else if (needsFullOcr && !canRunOcr) {
      warnings.push(
        `Page ${pageNo} appears scanned or image-based (${nativeInspection.alnumCount} native alphanumeric chars), but no visual rasterizer was available to run OCR.`
      );
    }

    // Visual raster modules on page pixels when available (barcodes, bordered tables, OMR, forms, handwriting, signatures/stamps)
    let visualGray: Uint8Array | undefined = pagePrep?.ocrGray;
    let visualRgba: Uint8ClampedArray | undefined =
      pagePrep && pagePrep.originalWidth === pagePrep.width && pagePrep.originalHeight === pagePrep.height
        ? pagePrep.rawRgba // rawRgba is original-sized; only valid when no resize happened
        : undefined;
    let visualW = pagePrep?.width ?? 0;
    let visualH = pagePrep?.height ?? 0;

    if (!visualGray && highResOcrBytes) {
      try {
        const decoded = await decodeBytesToRgbaAndGray(
          highResOcrBytes,
          highResMime || 'image/png'
        );
        visualGray = decoded.gray;
        visualRgba = decoded.rgba;
        visualW = decoded.width;
        visualH = decoded.height;
      } catch {
        // Non-fatal
      }
    }

    const visualTables =
      visualGray && visualW > 0 && visualH > 0
        ? extractBorderedTablesFromGrayscale({
            gray: visualGray,
            width: visualW,
            height: visualH,
            pageNumber: pageNo,
            wordBoxes: pageWordBoxes,
          })
        : [];
    const textTables = extractTablesFromText(cleanedPageText, pageNo);
    const pageTables = deduplicateExtractedTables([
      ...pageSuryaTables.map((t) => enrichExtractedTable(t)),
      ...visualTables,
      ...textTables.filter((tt) => tt.rows.length > 0 || visualTables.length === 0),
    ]);

    if (!hasVectorDrawings && visualGray && visualW > 0 && visualH > 0) {
      try {
        const rasterFigs = await extractRasterDiagramsFromGrayscale({
          gray: visualGray,
          width: visualW,
          height: visualH,
          pageNumber: pageNo,
          wordBoxes: pageWordBoxes,
          ocrText: cleanedPageText,
          excludeBboxes: visualTables
            .map((t) => t.bbox)
            .filter((b): b is NonNullable<typeof b> => Boolean(b)),
        });
        if (rasterFigs.length > 0) {
          const nonFullPage = pageDiagrams.filter((d) => !d.id.startsWith('pdf-diag-'));
          pageDiagrams.length = 0;
          pageDiagrams.push(...nonFullPage, ...rasterFigs);
        }
      } catch {
        // Non-fatal
      }
    }

    const baseFormulas = await extractMathFormulasAdvanced({
      text: cleanedPageText,
      pageNumber: pageNo,
      wordBoxes: pageWordBoxes,
      adapter: params.mathAdapter,
    });
    const seenLatexPdf = new Set(pageSuryaEquations.map((f) => f.latex.replace(/\s+/g, '')));
    const pageFormulas: ExtractedFormula[] = [
      ...pageSuryaEquations,
      ...baseFormulas.filter((f) => !seenLatexPdf.has(f.latex.replace(/\s+/g, ''))),
    ];

    let pageHandwriting: HandwritingAnalysisResult | undefined;
    let pageOmr: OmrScanResult | undefined;
    let pageForms: FormExtractionResult | undefined;
    let pageSignatures: SignatureDetection[] = [];
    let pageStamps: StampDetection[] = [];

    if (visualGray && visualW > 0 && visualH > 0) {
      const codes = scanBarcodesAndQrFromBuffer({
        rgba: visualRgba,
        gray: visualGray,
        width: visualW,
        height: visualH,
        pageNumber: pageNo,
      });
      for (const code of codes) {
        if (!qrMatches.some((existing) => existing.pageNumber === pageNo && existing.payload === code.payload)) {
          qrMatches.push(code);
        }
        if (code.warning) warnings.push(code.warning);
      }

      pageOmr = scanOmrSheet({
        gray: visualGray,
        width: visualW,
        height: visualH,
        pageNumber: pageNo,
        ocrText: cleanedPageText,
        template: params.omrTemplate,
      });
      if (pageOmr.detected) {
        omrPages.push(pageOmr);
        warnings.push(...pageOmr.warnings);
      }

      pageForms = recognizeFormFields({
        gray: visualGray,
        width: visualW,
        height: visualH,
        pageNumber: pageNo,
        ocrText: cleanedPageText,
        wordBoxes: pageWordBoxes,
      });
      if (pageForms.detected) {
        formPages.push(pageForms);
        warnings.push(...pageForms.warnings);
      }

      pageHandwriting = await analyzeHandwritingRegions({
        gray: visualGray,
        width: visualW,
        height: visualH,
        pageNumber: pageNo,
        ocrText: cleanedPageText,
        ocrConfidence,
        wordBoxes: pageWordBoxes,
        adapter: params.handwritingAdapter,
        isScannedOrRaster: needsFullOcr || isMixedPage,
      });
      if (pageHandwriting.detected) handwritingPages.push(pageHandwriting);

      const sigStamp = detectSignaturesAndStamps({
        rgba: visualRgba,
        gray: visualGray,
        width: visualW,
        height: visualH,
        pageNumber: pageNo,
        ocrText: cleanedPageText,
        wordBoxes: pageWordBoxes,
      });
      pageSignatures = sigStamp.signatures;
      pageStamps = sigStamp.stamps;
      signatures.push(...pageSignatures);
      stamps.push(...pageStamps);
    }

    allDiagrams.push(...pageDiagrams);
    allTables.push(...pageTables);
    allFormulas.push(...pageFormulas);

    const charCount = cleanedPageText.replace(/\s+/g, '').length;
    const wordCount = cleanedPageText.split(/\s+/).filter(Boolean).length;
    const pageStatus = classifyPageStatus({
      text: cleanedPageText,
      ocrApplied,
      ocrConfidence,
      warnings,
      errors,
    });

    const pageBlocks =
      pageSuryaBlocks && pageSuryaBlocks.length >= 2
        ? pageSuryaBlocks
        : reconstructPageBlocks({
            pageNumber: pageNo,
            text: cleanedPageText,
            tables: pageTables,
            formulas: pageFormulas,
            diagrams: pageDiagrams,
            lineBoxes: pageLineBoxes,
            wordBoxes: pageWordBoxes,
            pdfPlacedTokens: !needsFullOcr ? nativeInspection.placedTokens : undefined,
            pdfPageWidth: baseViewport.width || 612,
            pdfPageHeight: baseViewport.height || 792,
            pageWidth: visualW || baseViewport.width || 612,
            pageHeight: visualH || baseViewport.height || 792,
            uncertainSpans,
          });

    pages.push({
      pageNumber: pageNo,
      text: cleanedPageText,
      wordCount,
      charCount,
      extractionMethod,
      ocrApplied,
      ocrConfidence,
      ocrEngineUsed,
      visionFallbackUsed,
      visionFallbackError,
      uncertainSpans: uncertainSpans.length > 0 ? uncertainSpans : undefined,
      perspectiveCorrected,
      qualityMetrics: pagePrep?.qualityMetrics,
      processingStatus: pageStatus.status,
      isIncomplete: pageStatus.isIncomplete,
      wasTruncated,
      preprocessingApplied: preprocessingApplied.length > 0 ? preprocessingApplied : undefined,
      errors: errors.length > 0 ? errors : undefined,
      renderedPreviewUrl,
      handwritingRegions:
        pageHandwriting?.detected ? pageHandwriting.regions : undefined,
      omrResult: pageOmr?.detected ? pageOmr.questions : undefined,
      formFields: pageForms?.detected ? pageForms.fields : undefined,
      signatures: pageSignatures.length > 0 ? pageSignatures : undefined,
      stamps: pageStamps.length > 0 ? pageStamps : undefined,
      diagrams: pageDiagrams,
      tables: pageTables,
      formulas: pageFormulas,
      blocks: pageBlocks,
      warnings: Array.from(new Set(warnings)),
    });
  }

  if (unprocessedPages.length > 0) {
    const notice = `PDF has ${totalPagesInPdf} pages; processed pages 1–${totalPages}. Unprocessed pages beyond the ${MAX_PDF_PAGES}-page safety limit: ${unprocessedPages[0]}–${unprocessedPages[unprocessedPages.length - 1]}.`;
    pdfWarnings.push(notice);
    pages[pages.length - 1]?.warnings.push(notice);
  }

  await (pdfDoc as unknown as { destroy?: () => Promise<void> }).destroy?.();
  const averageOcrConfidence =
    ocrScores.length > 0
      ? Math.round(ocrScores.reduce((acc, s) => acc + s, 0) / ocrScores.length)
      : null;

  return {
    pages,
    diagrams: allDiagrams,
    tables: linkMultiPageTables(allTables),
    formulas: allFormulas,
    qrMatches,
    averageOcrConfidence,
    optimizedPreviewUrl,
    processedPages,
    unprocessedPages,
    pdfWarnings,
    omrPages,
    formPages,
    handwritingPages,
    signatures,
    stamps,
  };
}

export async function inspectAndExtractZipEntries(
  zipBytes: Uint8Array,
  zipFileName: string,
  signal?: AbortSignal
): Promise<ScanInputFile[]> {
  throwIfAborted(signal);
  const zip = await JSZip.loadAsync(zipBytes);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  if (names.length === 0) {
    throw new Error(`Archive "${zipFileName}" contains no files.`);
  }
  if (names.length > MAX_ZIP_ENTRIES) {
    throw new Error(
      `Archive "${zipFileName}" contains ${names.length} files, exceeding the ${MAX_ZIP_ENTRIES}-file safety limit.`
    );
  }

  let totalUncompressedBytes = 0;
  const extractedFiles: ScanInputFile[] = [];

  for (const name of Object.keys(zip.files)) {
    throwIfAborted(signal);
    const entryObj = zip.files[name];
    const unsafeName =
      (entryObj as unknown as { unsafeOriginalName?: string }).unsafeOriginalName || name;
    const safetyRaw = isSafeZipEntryPath(unsafeName);
    if (!safetyRaw.safe) {
      throw new Error(safetyRaw.reason ?? `Unsafe archive entry "${unsafeName}".`);
    }
  }

  for (const name of names) {
    throwIfAborted(signal);
    const entry = zip.files[name];
    const rawEntryName =
      (entry as unknown as { unsafeOriginalName?: string }).unsafeOriginalName || name;
    const safety = isSafeZipEntryPath(rawEntryName);
    if (!safety.safe) {
      throw new Error(safety.reason ?? `Unsafe archive entry "${rawEntryName}".`);
    }
    if (name.startsWith('__MACOSX/') || safety.baseName.startsWith('._')) {
      continue;
    }
    if (safety.extension === 'zip') {
      throw new Error(`Nested ZIP archive "${safety.baseName}" is rejected for archive safety.`);
    }
    const data = await entry.async('uint8array');
    totalUncompressedBytes += data.byteLength;
    if (totalUncompressedBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
      throw new Error(
        `Archive "${zipFileName}" exceeds ${Math.round(MAX_ZIP_UNCOMPRESSED_BYTES / (1024 * 1024))} MB uncompressed safety limit.`
      );
    }
    const internalData = (entry as unknown as { _data?: { compressedSize?: number } })._data;
    const compressedSize = internalData?.compressedSize ?? 0;
    if (
      data.byteLength > 200_000 &&
      compressedSize > 0 &&
      data.byteLength / compressedSize > MAX_ZIP_COMPRESSION_RATIO
    ) {
      throw new Error(
        `Archive "${zipFileName}" rejected due to suspicious compression ratio in "${safety.baseName}".`
      );
    }

    extractedFiles.push({
      name: safety.baseName,
      type: guessMimeFromExtension(safety.extension),
      size: data.byteLength,
      bytes: data,
      parentZipName: zipFileName,
    });
  }

  if (extractedFiles.length === 0) {
    throw new Error(`Archive "${zipFileName}" contained no valid academic files.`);
  }
  return extractedFiles;
}

function summarizeExtractionQuality(params: {
  pages: ExtractedPageContent[];
  unprocessedPages: number[];
  docWarnings: string[];
  averageOcrConfidence: number | null;
  totalAlnumChars: number;
}): ExtractionQualityStatus {
  if (params.pages.length === 0) return 'failed';
  const failedPages = params.pages.filter((p) => p.processingStatus === 'failed').length;
  const reviewPages = params.pages.filter(
    (p) => p.processingStatus === 'needs_review' || p.isIncomplete
  ).length;
  if (failedPages === params.pages.length || (params.totalAlnumChars < 12 && failedPages > 0)) {
    return 'failed';
  }
  if (
    failedPages > 0 ||
    reviewPages > 0 ||
    params.unprocessedPages.length > 0 ||
    params.totalAlnumChars < 25 ||
    (params.averageOcrConfidence !== null && params.averageOcrConfidence < 45)
  ) {
    return 'needs_review';
  }
  const hasWarnings =
    params.docWarnings.length > 0 ||
    params.pages.some(
      (p) =>
        p.processingStatus === 'completed_with_warnings' ||
        p.warnings.length > 0 ||
        Boolean(p.wasTruncated)
    ) ||
    (params.averageOcrConfidence !== null && params.averageOcrConfidence < 65);
  return hasWarnings ? 'completed_with_warnings' : 'completed';
}

function aggregateOmrPages(omrPages: OmrScanResult[]): OmrScanResult | undefined {
  if (omrPages.length === 0) return undefined;
  const allQuestions = omrPages.flatMap((o) => o.questions);
  const firstWithId = omrPages.find((o) => o.studentIdGridDetected);
  const answered = allQuestions.filter((q) => q.status === 'answered').length;
  const unanswered = allQuestions.filter((q) => q.status === 'unanswered').length;
  const multipleSelected = allQuestions.filter((q) => q.status === 'multiple_selected').length;
  const ambiguous = allQuestions.filter((q) => q.status === 'ambiguous').length;
  return {
    detected: true,
    pageNumbers: Array.from(new Set(omrPages.flatMap((o) => o.pageNumbers))),
    templateUsed: omrPages[0].templateUsed,
    studentIdGridDetected: Boolean(firstWithId),
    studentIdDigits: firstWithId?.studentIdDigits,
    studentIdValue: firstWithId?.studentIdValue,
    questions: allQuestions,
    summary: {
      totalQuestions: allQuestions.length,
      answered,
      unanswered,
      multipleSelected,
      ambiguous,
    },
    needsAdminReview: omrPages.some((o) => o.needsAdminReview) || ambiguous > 0 || multipleSelected > 0,
    warnings: Array.from(new Set(omrPages.flatMap((o) => o.warnings))),
  };
}

function aggregateFormPages(formPages: FormExtractionResult[]): FormExtractionResult | undefined {
  if (formPages.length === 0) return undefined;
  const fields = formPages.flatMap((f) => f.fields);
  const filledCount = fields.filter((f) => f.status === 'filled').length;
  const unfilledCount = fields.filter((f) => f.status === 'unfilled').length;
  const ambiguousCount = fields.filter((f) => f.status === 'ambiguous').length;
  return {
    detected: fields.length > 0,
    fields,
    totalFields: fields.length,
    filledCount,
    unfilledCount,
    ambiguousCount,
    isIncompleteForm: unfilledCount > 0 || ambiguousCount > 0,
    warnings: Array.from(new Set(formPages.flatMap((f) => f.warnings))),
  };
}

function aggregateHandwritingPages(
  hwPages: HandwritingAnalysisResult[]
): HandwritingAnalysisResult | undefined {
  if (hwPages.length === 0) return undefined;
  const regions = hwPages.flatMap((h) => h.regions);
  const withExternal = hwPages.find((h) => h.engineUsed === 'external_htr_adapter');
  return {
    detected: regions.length > 0,
    engineUsed: withExternal
      ? 'external_htr_adapter'
      : hwPages[0].engineUsed,
    engineStatus: hwPages.some((h) => h.engineStatus === 'executed')
      ? 'executed'
      : hwPages[0].engineStatus,
    missingModelNote: hwPages.find((h) => h.missingModelNote)?.missingModelNote,
    regions,
    uncertainCount: hwPages.reduce((sum, h) => sum + h.uncertainCount, 0),
    unreadableCount: hwPages.reduce((sum, h) => sum + h.unreadableCount, 0),
  };
}

export async function scanSingleAcademicInput(
  input: ScanInputFile,
  options?: {
    docId?: string;
    signal?: AbortSignal;
    ocrRunner?: OcrRunner;
    pdfPageRenderer?: PdfPageRenderer;
    onProgress?: (update: ScanProgressUpdate) => void;
    bypassCache?: boolean;
    visionFallback?: VisionFallbackMode;
    visionOcrRunner?: VisionOcrRunner;
    engineMode?: OcrEngineMode;
    suryaRunner?: SuryaOcrRunner;
    language?: string;
    handwritingAdapter?: HandwritingEngineAdapter;
    mathAdapter?: MathOcrAdapter;
    omrTemplate?: OmrTemplateConfig;
  }
): Promise<ScannedArtifactOutput> {
  const startedAt = Date.now();
  const docId = options?.docId ?? `adoc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const ocrRunner = options?.ocrRunner ?? defaultBrowserOcrRunner;
  const effectiveVisionFallback: VisionFallbackMode = options?.visionFallback ?? 'off';
  let effectiveHandwritingAdapter = options?.handwritingAdapter;
  if (!effectiveHandwritingAdapter && typeof window !== 'undefined' && effectiveVisionFallback !== 'off') {
    try {
      const caps = await queryServerOcrCapabilities();
      if (caps?.handwriting?.available) {
        effectiveHandwritingAdapter = createBackendHandwritingAdapter();
      }
    } catch {
      // Optional backend HTR capability lookup never blocks offline scan
    }
  }
  const moduleReports: ScannerModuleRunReport[] = [];

  throwIfAborted(options?.signal);
  options?.onProgress?.({
    stage: 'validating',
    stageLabel: 'Validating file signature & format security',
    progressPercent: 5,
  });

  const magicCheck = validateMagicAndSecurity({
    fileName: input.name,
    mimeType: input.type,
    bytes: input.bytes,
  });
  if (!magicCheck.valid) {
    throw new Error(magicCheck.error ?? 'File failed magic-byte or security validation.');
  }
  if (magicCheck.format === 'zip') {
    throw new Error('ZIP archives must be unpacked via inspectAndExtractZipEntries before scanning.');
  }

  throwIfAborted(options?.signal);
  options?.onProgress?.({
    stage: 'hashing',
    stageLabel: 'Computing SHA-256 fingerprint',
    progressPercent: 10,
  });

  const sha256 = await computeSha256Hex(input.bytes);
  const mimeType = input.type || guessMimeFromExtension(magicCheck.extension);

  const originalStorageRef = await documentStorageAdapter.putBinary({
    folder: 'originals',
    docId,
    fileName: magicCheck.safeFileName,
    mimeType,
    bytes: input.bytes,
  });

  const cached = !options?.bypassCache ? getCachedExtractionByHash(sha256) : null;

  const earlyChecks: DeterministicCheckResult[] = [
    {
      id: 'chk-magic',
      label: 'File signature & magic bytes',
      category: 'integrity',
      passed: true,
      severity: 'info',
      detail: `Verified ${magicCheck.format.toUpperCase()} signature for ${magicCheck.safeFileName}.`,
    },
  ];
  if (magicCheck.securityFlags.includes('pdf_active_script_action')) {
    earlyChecks.push({
      id: 'chk-pdf-js',
      label: 'Active script / action detection',
      category: 'security',
      passed: false,
      severity: 'blocker',
      detail: 'PDF contains /JavaScript, /JS, /Launch, or /OpenAction triggers.',
    });
  }

  let pages: ExtractedPageContent[] = [];
  let diagrams: ExtractedDiagramAsset[] = [];
  let tables: ExtractedTable[] = [];
  let formulas: ExtractedFormula[] = [];
  let qrCodesFound: QrCodeMatch[] = [];
  let optimizedPreviewUrl: string | undefined;
  let averageOcrConfidence: number | null = null;
  let extraHeadings: string[] = [];
  let processedPages: number[] = [1];
  let unprocessedPages: number[] = [];
  const docWarnings: string[] = [];

  let omrResults: OmrScanResult | undefined;
  let formResults: FormExtractionResult | undefined;
  let handwritingAnalysis: HandwritingAnalysisResult | undefined;
  let signatures: SignatureDetection[] = [];
  let stamps: StampDetection[] = [];

  if (magicCheck.format === 'image') {
    throwIfAborted(options?.signal);
    const qualStart = Date.now();
    options?.onProgress?.({
      stage: 'optimizing',
      stageLabel: 'Analyzing scan quality & preprocessing image',
      currentPage: 1,
      totalPages: 1,
      progressPercent: 22,
      preprocessingStatus: 'Detecting borders, skew & lighting profile',
    });

    let prep: PreprocessedImageResult | undefined;
    try {
      prep = await preprocessImageForOcr({
        bytes: input.bytes,
        mimeType,
      });
      optimizedPreviewUrl = prep.previewDataUrl;
      qrCodesFound = prep.qrMatches.map((payload) => ({
        pageNumber: 1,
        payload: sanitizeSingleLine(payload, 240),
        isSafeUrl: isSafeBarcodePayload(payload),
        format: 'QR_CODE',
      }));
      await documentStorageAdapter.putBinary({
        folder: 'optimized',
        docId,
        fileName: `opt-${magicCheck.safeFileName}.jpg`,
        mimeType: 'image/jpeg',
        dataUrl: prep.previewDataUrl,
      });
      moduleReports.push({
        module: 'quality_inspector',
        status: 'executed',
        durationMs: Date.now() - qualStart,
        detail: `${prep.strategy}: ${prep.appliedSteps.join(', ') || 'clean'}`,
      });
    } catch (err) {
      optimizedPreviewUrl = uint8ToDataUrl(input.bytes, mimeType);
      moduleReports.push({
        module: 'quality_inspector',
        status: 'failed',
        durationMs: Date.now() - qualStart,
        detail: err instanceof Error ? err.message : 'Image preprocessing failed.',
      });
    }

    throwIfAborted(options?.signal);
    options?.onProgress?.({
      stage: 'ocr',
      stageLabel: 'Running adaptive multi-pass OCR',
      currentPage: 1,
      totalPages: 1,
      progressPercent: 35,
      ocrProgress: 0,
      preprocessingStatus: prep
        ? `${prep.strategy} (${prep.appliedSteps.join(', ') || 'clean'})`
        : 'Raw fallback',
    });

    let ocrText = '';
    const pageWarnings: string[] = [...(prep?.qualityMetrics.actionableWarnings ?? [])];
    const pageErrors: string[] = [];
    let finalPrep = prep;
    let ocrEngineUsed: ExtractedPageContent['ocrEngineUsed'] = 'tesseract';
    let visionFallbackUsed = false;
    let visionFallbackError: string | undefined;
    let uncertainSpans: UncertainSpan[] = [];
    let pageLineBoxes: OcrLineBox[] | undefined;
    let pageWordBoxes: OcrWordBox[] | undefined;
    let perspectiveCorrected = Boolean(prep?.perspectiveCorrected);
    let imgSuryaBlocks: ReconstructedBlock[] | undefined;
    let imgSuryaEquations: ExtractedFormula[] = [];
    let imgSuryaTables: ExtractedTable[] = [];

    try {
      const ocrRes = await ocrRunner({
        imageDataUrl: prep?.ocrDataUrl ?? optimizedPreviewUrl,
        bytes: input.bytes,
        mimeType,
        pageNumber: 1,
        signal: options?.signal,
        visionFallback: effectiveVisionFallback,
        visionOcrRunner: options?.visionOcrRunner,
        engineMode: options?.engineMode,
        suryaRunner: options?.suryaRunner,
        language: options?.language,
        onOcrProgress: (pct, statusText) => {
          options?.onProgress?.({
            stage: 'ocr',
            stageLabel: `Recognizing scanned text (${pct}%)`,
            currentPage: 1,
            totalPages: 1,
            ocrProgress: pct,
            progressPercent: 35 + Math.round((pct / 100) * 40),
            detail: statusText,
          });
        },
      });
      ocrText = ocrRes.text;
      averageOcrConfidence = ocrRes.confidence;
      ocrEngineUsed = ocrRes.ocrEngineUsed ?? 'tesseract';
      visionFallbackUsed = Boolean(ocrRes.visionFallbackUsed);
      visionFallbackError = ocrRes.visionFallbackError;
      uncertainSpans = ocrRes.uncertainSpans ?? [];
      pageLineBoxes = ocrRes.lineBoxes;
      pageWordBoxes = ocrRes.wordBoxes;
      imgSuryaBlocks = ocrRes.suryaBlocks;
      imgSuryaEquations = ocrRes.suryaEquations ?? [];
      imgSuryaTables = ocrRes.suryaTables ?? [];
      if (ocrRes.preprocessed) {
        finalPrep = ocrRes.preprocessed;
        optimizedPreviewUrl = ocrRes.preprocessed.previewDataUrl || optimizedPreviewUrl;
        perspectiveCorrected = Boolean(ocrRes.preprocessed.perspectiveCorrected);
      } else if (ocrRes.perspectiveCorrected !== undefined) {
        perspectiveCorrected = ocrRes.perspectiveCorrected;
      }
      if (ocrRes.warnings) pageWarnings.push(...ocrRes.warnings);
      if (ocrRes.orientationCorrectedDeg && ocrRes.orientationCorrectedDeg > 0) {
        pageWarnings.push(`Auto-rotated scan by ${ocrRes.orientationCorrectedDeg}° for upright text.`);
      }
      if (ocrRes.confidence < 65 && !pageWarnings.some((w) => /confidence/i.test(w))) {
        pageWarnings.push(`Low OCR confidence (${ocrRes.confidence}%). Image may be blurry or skewed.`);
      }
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') throw err;
      averageOcrConfidence = 0;
      const msg = err instanceof Error ? err.message : 'OCR recognition failed.';
      pageErrors.push(msg);
      pageWarnings.push(`OCR error: ${msg}`);
    }

    // Ensure grayscale & rgba pixel buffers exist even when custom ocrRunner skipped preprocessing
    let visualGray: Uint8Array | undefined = finalPrep?.ocrGray;
    let visualRgba: Uint8ClampedArray | undefined =
      finalPrep && finalPrep.originalWidth === finalPrep.width && finalPrep.originalHeight === finalPrep.height
        ? finalPrep.rawRgba // rawRgba is original-sized; only valid when no resize happened
        : undefined;
    let visualW = finalPrep?.width ?? 0;
    let visualH = finalPrep?.height ?? 0;
    if (!visualGray || visualW <= 0 || visualH <= 0) {
      try {
        const decoded = await decodeBytesToRgbaAndGray(input.bytes, mimeType);
        visualGray = decoded.gray;
        visualRgba = decoded.rgba;
        visualW = decoded.width;
        visualH = decoded.height;
      } catch {
        // Unreadable image pixels
      }
    }

    throwIfAborted(options?.signal);
    options?.onProgress?.({
      stage: 'extracting',
      stageLabel: 'Extracting tables, formulas, diagrams, OMR, forms & barcodes',
      currentPage: 1,
      totalPages: 1,
      progressPercent: 78,
    });

    // 1. Barcode & QR multi-angle detection
    const barcodeStart = Date.now();
    try {
      if (visualGray && visualW > 0 && visualH > 0) {
        const codes = scanBarcodesAndQrFromBuffer({
          rgba: visualRgba,
          gray: visualGray,
          width: visualW,
          height: visualH,
          pageNumber: 1,
        });
        for (const c of codes) {
          if (!qrCodesFound.some((e) => e.payload === c.payload)) {
            qrCodesFound.push(c);
          }
          if (c.warning) pageWarnings.push(c.warning);
        }
      }
      moduleReports.push({
        module: 'barcode_qr',
        status: 'executed',
        durationMs: Date.now() - barcodeStart,
        detail: `${qrCodesFound.length} barcode/QR entry(ies) inspected.`,
      });
    } catch (err) {
      moduleReports.push({
        module: 'barcode_qr',
        status: 'failed',
        durationMs: Date.now() - barcodeStart,
        detail: err instanceof Error ? err.message : 'Barcode/QR scan failed.',
      });
    }

    // 2. Advanced Tables (visual bordered grid + text borderless + merged/header enrichment)
    const tableStart = Date.now();
    try {
      const visualTables =
        visualGray && visualW > 0 && visualH > 0
          ? extractBorderedTablesFromGrayscale({
              gray: visualGray,
              width: visualW,
              height: visualH,
              pageNumber: 1,
              wordBoxes: pageWordBoxes,
            })
          : [];
      const textTables = extractTablesFromText(ocrText, 1);
      const mergedTables = deduplicateExtractedTables([
        ...imgSuryaTables.map((t) => enrichExtractedTable(t)),
        ...visualTables,
        ...textTables.filter((tt) => tt.rows.length > 0 || visualTables.length === 0),
      ]);
      tables = linkMultiPageTables(mergedTables.map((t) => enrichExtractedTable(t)));
      moduleReports.push({
        module: 'advanced_tables',
        status: 'executed',
        durationMs: Date.now() - tableStart,
        detail: `Extracted ${tables.length} structured table(s).`,
      });
    } catch (err) {
      tables = deduplicateExtractedTables([
        ...imgSuryaTables,
        ...extractTablesFromText(ocrText, 1),
      ]);
      moduleReports.push({
        module: 'advanced_tables',
        status: 'failed',
        durationMs: Date.now() - tableStart,
        detail: err instanceof Error ? err.message : 'Visual table reconstruction failed.',
      });
    }

    // 3. Mathematical Formulas (Surya LaTeX + 2D spatial word-box + algebraic/calculus/matrix LaTeX)
    const mathStart = Date.now();
    try {
      const textAndSpatialFormulas = await extractMathFormulasAdvanced({
        text: ocrText,
        pageNumber: 1,
        wordBoxes: pageWordBoxes,
        adapter: options?.mathAdapter,
      });
      const seenLatexImg = new Set(imgSuryaEquations.map((f) => f.latex.replace(/\s+/g, '')));
      formulas = [
        ...imgSuryaEquations,
        ...textAndSpatialFormulas.filter((f) => !seenLatexImg.has(f.latex.replace(/\s+/g, ''))),
      ];
      moduleReports.push({
        module: 'math_formulas',
        status: 'executed',
        durationMs: Date.now() - mathStart,
        detail: `Extracted ${formulas.length} mathematical formula(s).`,
      });
    } catch (err) {
      moduleReports.push({
        module: 'math_formulas',
        status: 'failed',
        durationMs: Date.now() - mathStart,
        detail: err instanceof Error ? err.message : 'Math formula recognition failed.',
      });
    }

    // 4. Diagram & Graph extraction (all 12 semantic classes + preserved crop reference)
    const diagStart = Date.now();
    const extractedShapeDiagrams: ExtractedDiagramAsset[] = [];
    try {
      if (visualGray && visualW > 0 && visualH > 0) {
        const tableExcludeBoxes = tables
          .map((t) => t.bbox)
          .filter((b): b is NonNullable<typeof b> => Boolean(b));
        const isolated = await extractRasterDiagramsFromGrayscale({
          gray: visualGray,
          width: visualW,
          height: visualH,
          pageNumber: 1,
          wordBoxes: pageWordBoxes,
          ocrText,
          excludeBboxes: tableExcludeBoxes,
        });
        for (const fig of isolated) {
          const ref = await documentStorageAdapter.putBinary({
            folder: 'diagrams',
            docId,
            fileName: `${fig.id}-${magicCheck.safeFileName}.png`,
            mimeType: 'image/png',
            dataUrl: fig.dataUrl,
          });
          extractedShapeDiagrams.push({ ...fig, storageRef: ref });
        }
      }
      moduleReports.push({
        module: 'diagram_recognition',
        status: 'executed',
        durationMs: Date.now() - diagStart,
        detail: `Isolated ${extractedShapeDiagrams.length} figure/diagram region(s).`,
      });
    } catch (err) {
      moduleReports.push({
        module: 'diagram_recognition',
        status: 'failed',
        durationMs: Date.now() - diagStart,
        detail: err instanceof Error ? err.message : 'Diagram extraction failed.',
      });
    }

    // 5. OMR Recognition
    const omrStart = Date.now();
    try {
      if (visualGray && visualW > 0 && visualH > 0) {
        const omr = scanOmrSheet({
          gray: visualGray,
          width: visualW,
          height: visualH,
          pageNumber: 1,
          ocrText,
          template: options?.omrTemplate,
        });
        if (omr.detected) {
          omrResults = omr;
          pageWarnings.push(...omr.warnings);
        }
      }
      moduleReports.push({
        module: 'omr_recognition',
        status: omrResults ? 'executed' : 'skipped_not_applicable',
        durationMs: Date.now() - omrStart,
        detail: omrResults
          ? `Detected ${omrResults.summary.totalQuestions} OMR bubble rows.`
          : 'No OMR bubble grid detected on sheet.',
      });
    } catch (err) {
      moduleReports.push({
        module: 'omr_recognition',
        status: 'failed',
        durationMs: Date.now() - omrStart,
        detail: err instanceof Error ? err.message : 'OMR scan failed.',
      });
    }

    // 6. Checkbox & Form Recognition
    const formStart = Date.now();
    try {
      if (visualGray && visualW > 0 && visualH > 0) {
        const form = recognizeFormFields({
          gray: visualGray,
          width: visualW,
          height: visualH,
          pageNumber: 1,
          ocrText,
          wordBoxes: pageWordBoxes,
        });
        if (form.detected) {
          formResults = form;
          pageWarnings.push(...form.warnings);
        }
      }
      moduleReports.push({
        module: 'form_checkbox',
        status: formResults ? 'executed' : 'skipped_not_applicable',
        durationMs: Date.now() - formStart,
        detail: formResults
          ? `Detected ${formResults.totalFields} form fields/checkboxes.`
          : 'No checkboxes or form fields detected.',
      });
    } catch (err) {
      moduleReports.push({
        module: 'form_checkbox',
        status: 'failed',
        durationMs: Date.now() - formStart,
        detail: err instanceof Error ? err.message : 'Form recognition failed.',
      });
    }

    // 7. Handwriting Recognition (HTR)
    const htrStart = Date.now();
    try {
      if (visualGray && visualW > 0 && visualH > 0) {
        const htr = await analyzeHandwritingRegions({
          gray: visualGray,
          width: visualW,
          height: visualH,
          pageNumber: 1,
          ocrText,
          ocrConfidence: averageOcrConfidence,
          wordBoxes: pageWordBoxes,
          adapter: effectiveHandwritingAdapter,
          isScannedOrRaster: true,
        });
        handwritingAnalysis = htr;
        moduleReports.push({
          module: 'handwriting_htr',
          status: htr.detected ? htr.engineStatus : 'skipped_not_applicable',
          durationMs: Date.now() - htrStart,
          detail: htr.detected
            ? `Detected ${htr.regions.length} handwritten stroke region(s).`
            : 'No distinct handwritten stroke clusters detected.',
          missingRequirement: htr.missingModelNote,
        });
      } else {
        moduleReports.push({
          module: 'handwriting_htr',
          status: 'skipped_not_applicable',
          durationMs: Date.now() - htrStart,
        });
      }
    } catch (err) {
      moduleReports.push({
        module: 'handwriting_htr',
        status: 'failed',
        durationMs: Date.now() - htrStart,
        detail: err instanceof Error ? err.message : 'Handwriting analysis failed.',
      });
    }

    // 8. Signature Presence & Stamp/Seal Detection
    const sigStart = Date.now();
    try {
      if (visualGray && visualW > 0 && visualH > 0) {
        const sigStamp = detectSignaturesAndStamps({
          rgba: visualRgba,
          gray: visualGray,
          width: visualW,
          height: visualH,
          pageNumber: 1,
          ocrText,
          wordBoxes: pageWordBoxes,
        });
        signatures = sigStamp.signatures;
        stamps = sigStamp.stamps;
      }
      moduleReports.push({
        module: 'signature_detection',
        status: signatures.length > 0 ? 'executed' : 'skipped_not_applicable',
        durationMs: Date.now() - sigStart,
        detail: signatures.length > 0 ? `${signatures.length} signature region(s) flagged.` : 'No signature cues detected.',
      });
      moduleReports.push({
        module: 'stamp_seal_detection',
        status: stamps.length > 0 ? 'executed' : 'skipped_not_applicable',
        durationMs: Date.now() - sigStart,
        detail: stamps.length > 0 ? `${stamps.length} stamp/seal outline(s) flagged.` : 'No stamp/seal detected.',
      });
    } catch (err) {
      moduleReports.push({
        module: 'signature_detection',
        status: 'failed',
        durationMs: Date.now() - sigStart,
        detail: err instanceof Error ? err.message : 'Signature detection failed.',
      });
      moduleReports.push({
        module: 'stamp_seal_detection',
        status: 'failed',
        durationMs: Date.now() - sigStart,
        detail: err instanceof Error ? err.message : 'Stamp detection failed.',
      });
    }

    const imgDiagramRef = await documentStorageAdapter.putBinary({
      folder: 'diagrams',
      docId,
      fileName: `page-1-${magicCheck.safeFileName}`,
      mimeType: optimizedPreviewUrl?.startsWith('data:image/png') ? 'image/png' : 'image/jpeg',
      dataUrl: optimizedPreviewUrl,
    });
    const pageDiagrams: ExtractedDiagramAsset[] = [
      ...extractedShapeDiagrams,
      {
        id: 'scan-sheet-1',
        pageNumber: 1,
        caption: `Scanned sheet (${magicCheck.safeFileName})`,
        kind: 'illustration',
        mimeType: optimizedPreviewUrl?.startsWith('data:image/png') ? 'image/png' : 'image/jpeg',
        dataUrl: optimizedPreviewUrl,
        storageRef: imgDiagramRef,
        width: finalPrep?.width || undefined,
        height: finalPrep?.height || undefined,
      },
    ];
    diagrams = pageDiagrams;

    const dedupWarnings = Array.from(new Set(pageWarnings));
    const pageStatus = classifyPageStatus({
      text: ocrText,
      ocrApplied: true,
      ocrConfidence: averageOcrConfidence,
      warnings: dedupWarnings,
      errors: pageErrors,
    });

    const pageBlocks =
      imgSuryaBlocks && imgSuryaBlocks.length >= 2
        ? imgSuryaBlocks
        : reconstructPageBlocks({
            pageNumber: 1,
            text: ocrText,
            tables,
            formulas,
            diagrams: pageDiagrams,
            lineBoxes: pageLineBoxes,
            wordBoxes: pageWordBoxes,
            pageWidth: visualW || finalPrep?.width,
            pageHeight: visualH || finalPrep?.height,
            uncertainSpans,
          });

    pages = [
      {
        pageNumber: 1,
        text: ocrText,
        wordCount: ocrText.split(/\s+/).filter(Boolean).length,
        charCount: ocrText.replace(/\s+/g, '').length,
        extractionMethod: 'ocr',
        ocrApplied: true,
        ocrConfidence: averageOcrConfidence,
        ocrEngineUsed,
        visionFallbackUsed,
        visionFallbackError,
        uncertainSpans: uncertainSpans.length > 0 ? uncertainSpans : undefined,
        perspectiveCorrected,
        processingStatus: pageStatus.status,
        isIncomplete: pageStatus.isIncomplete,
        wasTruncated: ocrText.length >= MAX_PAGE_TEXT_CHARS,
        qualityMetrics: finalPrep?.qualityMetrics,
        preprocessingApplied: finalPrep?.appliedSteps,
        errors: pageErrors.length > 0 ? pageErrors : undefined,
        renderedPreviewUrl: optimizedPreviewUrl,
        handwritingRegions: handwritingAnalysis?.detected ? handwritingAnalysis.regions : undefined,
        omrResult: omrResults?.detected ? omrResults.questions : undefined,
        formFields: formResults?.detected ? formResults.fields : undefined,
        signatures: signatures.length > 0 ? signatures : undefined,
        stamps: stamps.length > 0 ? stamps : undefined,
        diagrams: pageDiagrams,
        tables,
        formulas,
        blocks: pageBlocks,
        warnings: dedupWarnings,
      },
    ];
  } else if (magicCheck.format === 'pdf') {
    throwIfAborted(options?.signal);
    const pdfStart = Date.now();
    options?.onProgress?.({
      stage: 'extracting',
      stageLabel: 'Inspecting PDF pages & embedded graphics',
      progressPercent: 15,
    });
    const pdfOut = await processPdfBuffer({
      bytes: input.bytes,
      docId,
      signal: options?.signal,
      ocrRunner,
      pdfPageRenderer: options?.pdfPageRenderer,
      visionFallback: effectiveVisionFallback,
      visionOcrRunner: options?.visionOcrRunner,
      engineMode: options?.engineMode,
      suryaRunner: options?.suryaRunner,
      language: options?.language,
      onProgress: options?.onProgress,
      handwritingAdapter: effectiveHandwritingAdapter,
      mathAdapter: options?.mathAdapter,
      omrTemplate: options?.omrTemplate,
    });
    pages = pdfOut.pages;
    diagrams = pdfOut.diagrams;
    tables = pdfOut.tables;
    formulas = pdfOut.formulas;
    qrCodesFound = pdfOut.qrMatches;
    averageOcrConfidence = pdfOut.averageOcrConfidence;
    optimizedPreviewUrl = pdfOut.optimizedPreviewUrl;
    processedPages = pdfOut.processedPages;
    unprocessedPages = pdfOut.unprocessedPages;
    docWarnings.push(...pdfOut.pdfWarnings);
    omrResults = aggregateOmrPages(pdfOut.omrPages);
    formResults = aggregateFormPages(pdfOut.formPages);
    handwritingAnalysis = aggregateHandwritingPages(pdfOut.handwritingPages);
    signatures = pdfOut.signatures;
    stamps = pdfOut.stamps;

    const elapsed = Date.now() - pdfStart;
    moduleReports.push(
      { module: 'quality_inspector', status: pages.some((p) => p.qualityMetrics) ? 'executed' : 'skipped_not_applicable', durationMs: Math.round(elapsed * 0.1) },
      { module: 'advanced_tables', status: 'executed', durationMs: Math.round(elapsed * 0.1), detail: `${tables.length} table(s)` },
      { module: 'math_formulas', status: 'executed', durationMs: Math.round(elapsed * 0.1), detail: `${formulas.length} formula(s)` },
      { module: 'diagram_recognition', status: 'executed', durationMs: Math.round(elapsed * 0.1), detail: `${diagrams.length} diagram asset(s)` },
      { module: 'omr_recognition', status: omrResults ? 'executed' : 'skipped_not_applicable', durationMs: 0 },
      { module: 'form_checkbox', status: formResults ? 'executed' : 'skipped_not_applicable', durationMs: 0 },
      {
        module: 'handwriting_htr',
        status: handwritingAnalysis?.detected ? handwritingAnalysis.engineStatus : 'skipped_not_applicable',
        durationMs: 0,
        missingRequirement: handwritingAnalysis?.missingModelNote,
      },
      { module: 'barcode_qr', status: 'executed', durationMs: 0, detail: `${qrCodesFound.length} barcode/QR entry(ies)` },
      { module: 'signature_detection', status: signatures.length > 0 ? 'executed' : 'skipped_not_applicable', durationMs: 0 },
      { module: 'stamp_seal_detection', status: stamps.length > 0 ? 'executed' : 'skipped_not_applicable', durationMs: 0 }
    );
  } else if (magicCheck.format === 'docx') {
    throwIfAborted(options?.signal);
    const docxStart = Date.now();
    options?.onProgress?.({
      stage: 'extracting',
      stageLabel: 'Unpacking DOCX paragraphs, tables, formulas & media',
      currentPage: 1,
      totalPages: 1,
      progressPercent: 45,
    });
    const docxOut = await parseDocxArchive(input.bytes, docId, options?.signal);
    extraHeadings = docxOut.headings;
    tables = linkMultiPageTables(docxOut.tables.map((t) => enrichExtractedTable(t)));
    formulas = docxOut.formulas;
    if (docxOut.text) {
      const textFormulas = await extractMathFormulasAdvanced({
        text: docxOut.text,
        pageNumber: 1,
        adapter: options?.mathAdapter,
      });
      const seenLatex = new Set(formulas.map((f) => f.latex.trim().toLowerCase()));
      for (const tf of textFormulas) {
        if (!seenLatex.has(tf.latex.trim().toLowerCase())) {
          formulas.push(tf);
          seenLatex.add(tf.latex.trim().toLowerCase());
        }
      }
    }
    diagrams = docxOut.diagrams;
    optimizedPreviewUrl = docxOut.diagrams[0]?.dataUrl;
    if (docxOut.hasMacros) {
      magicCheck.securityFlags.push('docx_vba_macros');
      earlyChecks.push({
        id: 'chk-docx-macro',
        label: 'DOCX macro security scan',
        category: 'security',
        passed: false,
        severity: 'blocker',
        detail: 'Embedded VBA macro archive (vbaProject.bin) detected inside DOCX.',
      });
    }
    const pageWarnings: string[] = [];
    if (docxOut.wasTruncated) {
      pageWarnings.push(`DOCX text exceeded ${MAX_PAGE_TEXT_CHARS} character page limit.`);
    }
    const pageStatus = classifyPageStatus({
      text: docxOut.text,
      ocrApplied: false,
      ocrConfidence: null,
      warnings: pageWarnings,
      errors: [],
    });
    pages = [
      {
        pageNumber: 1,
        text: docxOut.text,
        wordCount: docxOut.text.split(/\s+/).filter(Boolean).length,
        charCount: docxOut.text.replace(/\s+/g, '').length,
        extractionMethod: 'docx_xml',
        ocrApplied: false,
        ocrConfidence: null,
        processingStatus: pageStatus.status,
        isIncomplete: pageStatus.isIncomplete,
        wasTruncated: docxOut.wasTruncated,
        diagrams: docxOut.diagrams,
        tables,
        formulas,
        blocks: docxOut.blocks,
        warnings: pageWarnings,
      },
    ];
    const docxMs = Date.now() - docxStart;
    moduleReports.push(
      { module: 'advanced_tables', status: 'executed', durationMs: docxMs, detail: `${tables.length} DOCX table(s)` },
      { module: 'math_formulas', status: 'executed', durationMs: 0, detail: `${formulas.length} OMML/text formula(s)` },
      { module: 'diagram_recognition', status: diagrams.length > 0 ? 'executed' : 'skipped_not_applicable', durationMs: 0 }
    );
  } else {
    throwIfAborted(options?.signal);
    const txtStart = Date.now();
    options?.onProgress?.({
      stage: 'extracting',
      stageLabel: 'Reading text & tabular structure',
      currentPage: 1,
      totalPages: 1,
      progressPercent: 45,
    });
    const rawDecoded = new TextDecoder('utf-8', { fatal: false }).decode(input.bytes);
    const decoded = sanitizePlainText(rawDecoded, MAX_PAGE_TEXT_CHARS);
    const wasTruncated = rawDecoded.trim().length > MAX_PAGE_TEXT_CHARS;
    const pageWarnings = wasTruncated
      ? [`Text file exceeded ${MAX_PAGE_TEXT_CHARS} characters and was safely capped.`]
      : [];
    tables = linkMultiPageTables(extractTablesFromText(decoded, 1).map((t) => enrichExtractedTable(t)));
    formulas = await extractMathFormulasAdvanced({
      text: decoded,
      pageNumber: 1,
      adapter: options?.mathAdapter,
    });
    const pageStatus = classifyPageStatus({
      text: decoded,
      ocrApplied: false,
      ocrConfidence: null,
      warnings: pageWarnings,
      errors: [],
    });
    const textBlocks = buildBlocksFromStructuredText({
      pageNumber: 1,
      text: decoded,
      tables,
      formulas,
      diagrams: [],
    });
    pages = [
      {
        pageNumber: 1,
        text: decoded,
        wordCount: decoded.split(/\s+/).filter(Boolean).length,
        charCount: decoded.replace(/\s+/g, '').length,
        extractionMethod: 'plain_text',
        ocrApplied: false,
        ocrConfidence: null,
        processingStatus: pageStatus.status,
        isIncomplete: pageStatus.isIncomplete,
        wasTruncated,
        diagrams: [],
        tables,
        formulas,
        blocks: textBlocks,
        warnings: pageWarnings,
      },
    ];
    moduleReports.push(
      { module: 'advanced_tables', status: 'executed', durationMs: Date.now() - txtStart },
      { module: 'math_formulas', status: 'executed', durationMs: 0 }
    );
  }

  // Strip/normalize repeated multi-page running headers/footers before final structure assembly,
  // while preserving authentic per-page header/footer metadata & blocks in reading order.
  const layoutStart = Date.now();
  const headerClean = detectRepeatedHeadersFooters(pages.map((p) => p.text));
  if (headerClean.cleanedPages.length === pages.length && pages.length > 1) {
    pages = pages.map((pg, idx) => {
      const cleanedText = headerClean.cleanedPages[idx];
      const rawLines = pg.text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const cleanLines = cleanedText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      const detectedHeaders: string[] = [];
      const detectedFooters: string[] = [];
      if (rawLines.length >= 4 && cleanLines.length < rawLines.length) {
        // Check leading edge lines removed by detectRepeatedHeadersFooters
        let cleanStart = 0;
        for (let li = 0; li < Math.min(2, rawLines.length); li += 1) {
          if (cleanLines[cleanStart] === rawLines[li]) {
            cleanStart += 1;
          } else {
            detectedHeaders.push(rawLines[li]);
          }
        }
        // Check trailing edge lines removed by detectRepeatedHeadersFooters
        let cleanEnd = cleanLines.length - 1;
        for (let li = rawLines.length - 1; li >= Math.max(2, rawLines.length - 2); li -= 1) {
          if (cleanEnd >= 0 && cleanLines[cleanEnd] === rawLines[li]) {
            cleanEnd -= 1;
          } else {
            detectedFooters.unshift(rawLines[li]);
          }
        }
      }

      const headerSet = new Set(detectedHeaders.map((h) => h.toLowerCase()));
      const footerSet = new Set(detectedFooters.map((f) => f.toLowerCase()));
      let updatedBlocks: ReconstructedBlock[] | undefined = pg.blocks;
      if (pg.blocks && (headerSet.size > 0 || footerSet.size > 0)) {
        updatedBlocks = pg.blocks.map((blk): ReconstructedBlock => {
          const tLower = (blk.text ?? '').trim().toLowerCase();
          if (tLower && headerSet.has(tLower)) {
            return {
              ...blk,
              kind: 'header',
              headingLevel: undefined,
              alignment: 'center',
            };
          }
          if (tLower && footerSet.has(tLower)) {
            return {
              ...blk,
              kind: 'footer',
              headingLevel: undefined,
              alignment: 'center',
            };
          }
          return blk;
        });
      }

      return {
        ...pg,
        text: cleanedText,
        headerLines: detectedHeaders.length > 0 ? detectedHeaders : pg.headerLines,
        footerLines: detectedFooters.length > 0 ? detectedFooters : pg.footerLines,
        blocks: updatedBlocks,
        charCount: cleanedText.replace(/\s+/g, '').length,
        wordCount: cleanedText.split(/\s+/).filter(Boolean).length,
      };
    });
  }

  const formattedText = formatMultiPageStructuredText(
    pages.map((p) => ({ pageNumber: p.pageNumber, text: p.text }))
  );
  const combinedText = sanitizePlainText(formattedText, MAX_DOC_TEXT_CHARS);
  if (formattedText.length > MAX_DOC_TEXT_CHARS) {
    docWarnings.push(`Combined extracted text exceeded ${MAX_DOC_TEXT_CHARS} characters and was capped.`);
  }
  moduleReports.push({
    module: 'layout_reconstruction',
    status: 'executed',
    durationMs: Date.now() - layoutStart,
  });

  if (!cached && combinedText) {
    setCachedExtractionByHash({
      sha256,
      detectedFormat: magicCheck.format,
      pageCount: pages.length,
      extractedText: combinedText,
      cachedAt: new Date().toISOString(),
    });
  }

  const structured = parseStructuredDocument({
    fileName: magicCheck.safeFileName,
    extractedText: combinedText,
    extraHeadings,
    extraTables: tables,
    extraFormulas: formulas,
    detectedHeadersFooters: headerClean.detected,
  });

  // Document-wide Language Detection
  const langStart = Date.now();
  let languageAnalysis: LanguageAnalysisResult | undefined;
  try {
    languageAnalysis = analyzeDocumentLanguages(combinedText);
    docWarnings.push(...languageAnalysis.warnings);
    moduleReports.push({
      module: 'language_detection',
      status: languageAnalysis.unsupportedLanguages.length > 0 ? 'model_unavailable_partial' : 'executed',
      durationMs: Date.now() - langStart,
      detail: `Primary: ${languageAnalysis.primaryLanguage}`,
      missingRequirement:
        languageAnalysis.unsupportedLanguages.length > 0
          ? `Missing traineddata models: ${languageAnalysis.unsupportedLanguages.join(', ')}`
          : undefined,
    });
  } catch (err) {
    moduleReports.push({
      module: 'language_detection',
      status: 'failed',
      durationMs: Date.now() - langStart,
      detail: err instanceof Error ? err.message : 'Language detection failed.',
    });
  }

  // Page Sequence & Document Integrity Audit
  const integStart = Date.now();
  let integrityReport: DocumentIntegrityReport | undefined;
  try {
    integrityReport = inspectDocumentIntegrity({
      pages,
      detectedFormat: magicCheck.format,
    });
    docWarnings.push(...integrityReport.warnings);
    moduleReports.push({
      module: 'document_integrity',
      status: 'executed',
      durationMs: Date.now() - integStart,
      detail: integrityReport.isComplete ? 'Page sequence intact' : integrityReport.warnings.join(' '),
    });
  } catch (err) {
    moduleReports.push({
      module: 'document_integrity',
      status: 'failed',
      durationMs: Date.now() - integStart,
      detail: err instanceof Error ? err.message : 'Integrity audit failed.',
    });
  }

  // 14-Field Academic Metadata Extraction
  const metaStart = Date.now();
  let academicMetadata: ExtractedAcademicMetadata | undefined;
  try {
    academicMetadata = extractAcademicMetadata({
      fileName: magicCheck.safeFileName,
      pages,
      extractedText: combinedText,
    });
    moduleReports.push({
      module: 'academic_metadata',
      status: 'executed',
      durationMs: Date.now() - metaStart,
    });
  } catch (err) {
    moduleReports.push({
      module: 'academic_metadata',
      status: 'failed',
      durationMs: Date.now() - metaStart,
      detail: err instanceof Error ? err.message : 'Academic metadata extraction failed.',
    });
  }

  // 10-Category Academic Document Classifier
  const clsStart = Date.now();
  let classification: DocumentClassificationResult | undefined;
  try {
    classification = classifyAcademicDocument({
      fileName: magicCheck.safeFileName,
      text: combinedText,
      headings: structured.headings,
      tables: structured.tables,
      formulas: structured.formulas,
      diagrams,
      omrResults,
      formResults,
      metadata: academicMetadata,
    });
    moduleReports.push({
      module: 'document_classifier',
      status: 'executed',
      durationMs: Date.now() - clsStart,
      detail: `${classification.primaryLabel} (${Math.round(classification.confidence * 100)}%)`,
    });
  } catch (err) {
    moduleReports.push({
      module: 'document_classifier',
      status: 'failed',
      durationMs: Date.now() - clsStart,
      detail: err instanceof Error ? err.message : 'Document classification failed.',
    });
  }

  // Academic Question, Option, Subquestion & Multi-Page Continuation Parser
  const qpStart = Date.now();
  let academicStructure: AcademicExamStructureReport | undefined;
  try {
    academicStructure = parseAcademicExamStructure({
      pages,
      fileName: magicCheck.safeFileName,
    });
    for (const issue of academicStructure.issues) {
      if (issue.severity === 'warning') {
        docWarnings.push(issue.message);
      }
    }
    moduleReports.push({
      module: 'academic_question_parser',
      status: 'executed',
      durationMs: Date.now() - qpStart,
      detail: `${academicStructure.totalDetectedQuestions} question(s), ${academicStructure.continuedQuestionNumbers.length} cross-page continuation(s)`,
    });
  } catch (err) {
    moduleReports.push({
      module: 'academic_question_parser',
      status: 'failed',
      durationMs: Date.now() - qpStart,
      detail: err instanceof Error ? err.message : 'Academic question structure parse failed.',
    });
  }

  for (const pg of pages) {
    if (pg.warnings.length > 0) docWarnings.push(...pg.warnings);
    if (pg.errors && pg.errors.length > 0) docWarnings.push(...pg.errors);
  }
  const uniqueDocWarnings = Array.from(new Set(docWarnings));
  const totalAlnumChars = (combinedText.match(/[A-Za-z0-9]/g) ?? []).length;

  const extractionQualityStatus = summarizeExtractionQuality({
    pages,
    unprocessedPages,
    docWarnings: uniqueDocWarnings,
    averageOcrConfidence,
    totalAlnumChars,
  });

  const engineList = Array.from(new Set(pages.map((p) => p.ocrEngineUsed).filter(Boolean)));
  const ocrEngineSummary = engineList.length > 0 ? engineList.join(', ') : undefined;

  return {
    fileName: magicCheck.safeFileName,
    mimeType,
    fileSizeBytes: input.size || input.bytes.byteLength,
    detectedFormat: magicCheck.format,
    sha256,
    originalFileRefKey: originalStorageRef.key,
    originalStorageRef,
    optimizedPreviewUrl,
    pageCount: Math.max(1, pages.length),
    extractedText: combinedText,
    pages,
    diagrams,
    tables: linkMultiPageTables(structured.tables),
    formulas: structured.formulas,
    headings: structured.headings,
    summary: structured.summary,
    suggestedTitle: structured.suggestedTitle,
    courseCode: academicMetadata?.courseCode.value || structured.courseCode,
    courseTitle: academicMetadata?.courseTitle.value || structured.courseTitle,
    level: structured.level,
    session: academicMetadata?.academicSession.value || structured.session,
    semester: structured.semester,
    category: classification?.mappedLegacyCategory ?? structured.category,
    qrCodesFound,
    averageOcrConfidence,
    ocrEngineSummary,
    extractionQualityStatus,
    processedPages,
    unprocessedPages,
    extractionWarnings: uniqueDocWarnings,
    securityFlags: magicCheck.securityFlags,
    earlyChecks,
    parentZipName: input.parentZipName,
    processingDurationMs: Date.now() - startedAt,
    academicMetadata,
    classification,
    integrityReport,
    languageAnalysis,
    academicStructure,
    omrResults,
    formResults,
    handwritingAnalysis,
    signatures: signatures.length > 0 ? signatures : undefined,
    stamps: stamps.length > 0 ? stamps : undefined,
    moduleReports,
  };
}
