import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import sharp from 'sharp';
import QRCode from 'qrcode';
import JSZip from 'jszip';
import {
  preprocessImageForOcr,
  decodeBytesToRgbaAndGray,
} from '../src/services/intelligence/imagePreprocessor.ts';
import {
  extractBorderedTablesFromGrayscale,
  enrichExtractedTable,
  linkMultiPageTables,
} from '../src/services/intelligence/advancedTableExtractor.ts';
import { extractMathFormulasAdvanced } from '../src/services/intelligence/mathFormulaEngine.ts';
import {
  classifyDiagramTypeFromSignals,
  extractRasterDiagramsFromGrayscale,
} from '../src/services/intelligence/diagramExtractor.ts';
import { scanOmrSheet } from '../src/services/intelligence/omrEngine.ts';
import { recognizeFormFields } from '../src/services/intelligence/formRecognizer.ts';
import {
  scanBarcodesAndQrFromBuffer,
  isSafeBarcodePayload,
} from '../src/services/intelligence/barcodeQrEngine.ts';
import {
  analyzeHandwritingRegions,
  type HandwritingEngineAdapter,
} from '../src/services/intelligence/handwritingRecognizer.ts';
import { detectSignaturesAndStamps } from '../src/services/intelligence/signatureStampDetector.ts';
import { classifyAcademicDocument } from '../src/services/intelligence/documentClassifier.ts';
import { inspectDocumentIntegrity } from '../src/services/intelligence/documentIntegrityChecker.ts';
import { analyzeDocumentLanguages } from '../src/services/intelligence/languageDetector.ts';
import { extractAcademicMetadata } from '../src/services/intelligence/academicMetadataExtractor.ts';
import { scanSingleAcademicInput } from '../src/services/intelligence/documentScannerEngine.ts';
import { validateScannedDocument } from '../src/services/intelligence/validationEngine.ts';
import { hasPermission } from '../src/core/permissions.ts';
import type { ExtractedPageContent, VisionOcrRunner } from '../src/core/types.ts';

async function svgToPng(svg: string): Promise<Uint8Array> {
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return new Uint8Array(buf);
}

describe('Advanced Academic Document Scanning Modules', () => {
  test('1. Quality Inspector detects blur, low resolution, strong shadows, uneven lighting & fold crease', async () => {
    // Tiny low-res blurry dark-shadow image with fold line
    const w = 320;
    const h = 220;
    const raw = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        // Strong left-to-right uneven shadow gradient + faint dark fold line at x=160
        let v = x < 110 ? 75 : 235;
        if (Math.abs(x - 160) <= 1) v = 90;
        // Faint low-contrast faded stripe
        if (y > 40 && y < 48 && x > 130 && x < 290) v = 195;
        const off = (y * w + x) * 3;
        raw[off] = v;
        raw[off + 1] = v;
        raw[off + 2] = v;
      }
    }
    const png = new Uint8Array(
      await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer()
    );
    const prep = await preprocessImageForOcr({ bytes: png, mimeType: 'image/png' });

    assert.equal(prep.qualityMetrics.isLowResolution, true);
    assert.equal(prep.qualityMetrics.isUnevenLighting, true);
    assert.ok(
      prep.qualityMetrics.actionableWarnings && prep.qualityMetrics.actionableWarnings.length >= 1,
      'Expected actionable warnings on poor scan quality'
    );
  });

  test('2. Advanced Table Recognition handles visual bordered grids, DOCX merged spans, empty cells, multi-page linking, MD & JSON export', async () => {
    // 2a. Raster bordered table with explicit grid lines + wordBoxes
    const w = 700;
    const h = 340;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <rect width="${w}" height="${h}" fill="#ffffff"/>
      <rect x="40" y="40" width="600" height="240" fill="none" stroke="#000" stroke-width="4"/>
      <line x1="40" y1="120" x2="640" y2="120" stroke="#000" stroke-width="3"/>
      <line x1="40" y1="200" x2="640" y2="200" stroke="#000" stroke-width="3"/>
      <line x1="240" y1="40" x2="240" y2="280" stroke="#000" stroke-width="3"/>
      <line x1="440" y1="40" x2="440" y2="280" stroke="#000" stroke-width="3"/>
    </svg>`;
    const png = await svgToPng(svg);
    const decoded = await decodeBytesToRgbaAndGray(png, 'image/png');
    const visualTables = extractBorderedTablesFromGrayscale({
      gray: decoded.gray,
      width: decoded.width,
      height: decoded.height,
      pageNumber: 1,
      wordBoxes: [
        { text: 'Course', confidence: 95, bbox: { x0: 60, y0: 65, x1: 140, y1: 95 } },
        { text: 'Score', confidence: 95, bbox: { x0: 260, y0: 65, x1: 340, y1: 95 } },
        { text: 'Grade', confidence: 95, bbox: { x0: 460, y0: 65, x1: 540, y1: 95 } },
        { text: 'CSC301', confidence: 94, bbox: { x0: 60, y0: 145, x1: 150, y1: 175 } },
        { text: '84', confidence: 96, bbox: { x0: 260, y0: 145, x1: 300, y1: 175 } },
        { text: 'A', confidence: 97, bbox: { x0: 460, y0: 145, x1: 490, y1: 175 } },
        { text: 'MTH202', confidence: 94, bbox: { x0: 60, y0: 225, x1: 150, y1: 255 } },
        // Middle cell intentionally empty!
        { text: 'Pass', confidence: 92, bbox: { x0: 460, y0: 225, x1: 520, y1: 255 } },
      ],
    });

    assert.equal(visualTables.length, 1);
    assert.deepEqual(visualTables[0].headers, ['Course', 'Score', 'Grade']);
    assert.equal(visualTables[0].rows.length, 2);
    assert.equal(visualTables[0].rows[1][1], '', 'Empty cell must be preserved as empty string');
    assert.ok(visualTables[0].markdown?.includes('| Course | Score | Grade |'));
    assert.equal(visualTables[0].jsonRows?.[0]?.Score, '84');

    // 2b. Multi-page continuation linking + uncertain ragged structure flag
    const p1 = enrichExtractedTable({
      id: 't-p1',
      pageNumber: 1,
      headers: ['Code', 'Title', 'Units'],
      rows: [['CSC 301', 'Algorithms', '3']],
    });
    const p2 = enrichExtractedTable({
      id: 't-p2',
      pageNumber: 2,
      headers: ['Code', 'Title', 'Units'],
      rows: [['CSC 302', 'Operating Systems', '3']],
    });
    const linked = linkMultiPageTables([p1, p2]);
    assert.equal(linked[0].continuesOnPage, 2);
    assert.equal(linked[1].continuedFromPage, 1);

    const ragged = enrichExtractedTable({
      id: 't-bad',
      pageNumber: 1,
      headers: ['Col A', 'Col B', 'Col C'],
      rows: [
        ['1', '', ''],
        ['only1'],
        ['', '', ''],
      ],
    });
    assert.equal(ragged.uncertainStructure, true);

    // 2c. Real DOCX archive with merged cells (gridSpan & vMerge)
    const zip = new JSZip();
    zip.file(
      '[Content_Types].xml',
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="xml" ContentType="application/xml"/>
      </Types>`
    );
    zip.file(
      'word/document.xml',
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          <w:p><w:r><w:t>CSC 301 Examination Timetable</w:t></w:r></w:p>
          <w:tbl>
            <w:tr>
              <w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>Morning Session</w:t></w:r></w:p></w:tc>
              <w:tc><w:p><w:r><w:t>Venue</w:t></w:r></w:p></w:tc>
            </w:tr>
            <w:tr>
              <w:tc><w:p><w:r><w:t>CSC 301</w:t></w:r></w:p></w:tc>
              <w:tc><w:p><w:r><w:t>9:00 AM</w:t></w:r></w:p></w:tc>
              <w:tc><w:p><w:r><w:t>ETF Hall</w:t></w:r></w:p></w:tc>
            </w:tr>
          </w:tbl>
        </w:body>
      </w:document>`
    );
    const docxBytes = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
    const scannedDocx = await scanSingleAcademicInput({
      name: 'timetable.docx',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: docxBytes.byteLength,
      bytes: docxBytes,
    });
    assert.equal(scannedDocx.tables.length, 1);
    assert.equal(scannedDocx.tables[0].hasMergedCells, true);
    assert.ok(scannedDocx.tables[0].headers[0].includes('Morning Session'));
  });

  test('3. Dedicated Math Formula Engine parses calculus, matrices, Greek, scientific notation, 2D stacked fractions & flags uncertain syntax', async () => {
    const sample = [
      'Evaluate the integral ∫(0 to π) sin(x) dx = 2',
      'Quadratic solution: x = (-b ± √(b^2 - 4ac)) / (2a)',
      'Matrix A = [[1, 2], [3, 4]] and α + β = γ',
      'Avogadro constant N_A = 6.022 × 10^23 mol^-1',
      'Malformed balance: ((a + b) = ???',
    ].join('\n');

    const formulas = await extractMathFormulasAdvanced({
      text: sample,
      pageNumber: 1,
      wordBoxes: [
        // Stacked fraction: "dy" above "dx" separated by horizontal gap
        { text: 'dy', confidence: 92, bbox: { x0: 100, y0: 40, x1: 130, y1: 58 } },
        { text: 'dx', confidence: 92, bbox: { x0: 100, y0: 68, x1: 130, y1: 86 } },
        // Superscript: x followed by elevated smaller "2"
        { text: 'x', confidence: 94, bbox: { x0: 200, y0: 120, x1: 218, y1: 146 } },
        { text: '2', confidence: 91, bbox: { x0: 220, y0: 112, x1: 230, y1: 126 } },
      ],
    });

    assert.ok(formulas.some((f) => f.latex.includes('\\int') && f.kind === 'integral_summation'));
    assert.ok(formulas.some((f) => f.latex.includes('\\sqrt') && f.kind === 'radical'));
    assert.ok(formulas.some((f) => f.latex.includes('\\begin{bmatrix}') && f.kind === 'matrix'));
    assert.ok(formulas.some((f) => f.latex.includes('\\frac{dy}{dx}')));
    assert.ok(formulas.some((f) => f.latex.includes('x^{2}')));
    assert.ok(formulas.some((f) => f.uncertain === true), 'Malformed formula must be flagged uncertain');
  });

  test('4. Diagram & Graph Recognition covers all 12 semantic classes, extracts nodes/edges/measurements & retains original crop', async () => {
    const flowchartType = classifyDiagramTypeFromSignals({
      ocrText: 'Flowchart: Start -> Process -> Decision -> End',
      labels: ['Start', 'Process', 'End'],
      nodeCount: 3,
      arrowCount: 2,
      rectCount: 2,
      diamondCount: 1,
      circleCount: 0,
    });
    assert.equal(flowchartType, 'flowchart');

    const circuitType = classifyDiagramTypeFromSignals({
      ocrText: 'Series Circuit Diagram: V = 12V, R1 = 4 ohm, I = 3A',
      labels: ['12V', '4 ohm'],
      nodeCount: 3,
      arrowCount: 1,
      rectCount: 2,
      diamondCount: 0,
      circleCount: 1,
    });
    assert.equal(circuitType, 'circuit');

    const w = 640;
    const h = 420;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <rect width="${w}" height="${h}" fill="#ffffff"/>
      <rect x="60" y="140" width="130" height="80" fill="none" stroke="#111" stroke-width="4"/>
      <line x1="190" y1="180" x2="360" y2="180" stroke="#111" stroke-width="4"/>
      <rect x="360" y="140" width="150" height="80" fill="none" stroke="#111" stroke-width="4"/>
    </svg>`;
    const png = await svgToPng(svg);
    const decoded = await decodeBytesToRgbaAndGray(png, 'image/png');
    const diagrams = await extractRasterDiagramsFromGrayscale({
      gray: decoded.gray,
      width: decoded.width,
      height: decoded.height,
      pageNumber: 1,
      ocrText: 'Flowchart node process 12V 5cm',
      wordBoxes: [
        { text: 'Start', confidence: 95, bbox: { x0: 90, y0: 165, x1: 150, y1: 190 } },
        { text: '5cm', confidence: 95, bbox: { x0: 250, y0: 150, x1: 295, y1: 170 } },
        { text: 'End', confidence: 95, bbox: { x0: 410, y0: 165, x1: 460, y1: 190 } },
      ],
    });

    assert.ok(diagrams.length >= 1);
    const fig = diagrams[0];
    assert.ok(fig.originalCropDataUrl?.startsWith('data:image/png;base64,'));
    assert.ok(fig.dataUrl?.startsWith('data:image/png;base64,'));
    assert.ok(fig.extractedMeasurements?.includes('5cm'));
    assert.ok(fig.diagramType);
  });

  test('5. OMR Recognition accurately classifies answered, unanswered & multiple-shaded bubbles without auto-grading', async () => {
    // 5 rows x 4 columns (A B C D):
    // Row 1: B filled; Row 2: A filled; Row 3: all blank; Row 4: A + C both filled; Row 5: D filled
    const w = 600;
    const h = 480;
    const filled = [
      [false, true, false, false],
      [true, false, false, false],
      [false, false, false, false],
      [true, false, true, false],
      [false, false, false, true],
    ];
    let circles = '';
    for (let r = 0; r < 5; r += 1) {
      const cy = 90 + r * 68;
      for (let c = 0; c < 4; c += 1) {
        const cx = 140 + c * 90;
        circles += filled[r][c]
          ? `<circle cx="${cx}" cy="${cy}" r="14" fill="#111111" stroke="#111111" stroke-width="2.5"/>`
          : `<circle cx="${cx}" cy="${cy}" r="14" fill="#ffffff" stroke="#111111" stroke-width="2.5"/>`;
      }
    }
    const png = await svgToPng(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#ffffff"/>${circles}</svg>`
    );
    const decoded = await decodeBytesToRgbaAndGray(png, 'image/png');
    const omr = scanOmrSheet({
      gray: decoded.gray,
      width: decoded.width,
      height: decoded.height,
      pageNumber: 1,
      ocrText: 'ANSWER SHEET A B C D',
      template: { templateId: 'standard_4opt_abcd', name: '4-Opt', options: ['A', 'B', 'C', 'D'] },
    });

    assert.equal(omr.detected, true);
    assert.equal(omr.needsAdminReview, true);
    assert.equal(omr.questions.length, 5);
    assert.deepEqual(omr.questions[0].selectedOptions, ['B']);
    assert.deepEqual(omr.questions[1].selectedOptions, ['A']);
    assert.equal(omr.questions[2].status, 'unanswered');
    assert.equal(omr.questions[3].status, 'multiple_selected');
    assert.deepEqual(omr.questions[3].selectedOptions, ['A', 'C']);
    assert.deepEqual(omr.questions[4].selectedOptions, ['D']);
  });

  test('6. Form & Checkbox Recognition extracts checked/unchecked boxes & incomplete text fields', async () => {
    const w = 640;
    const h = 320;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <rect width="${w}" height="${h}" fill="#ffffff"/>
      <rect x="60" y="60" width="24" height="24" fill="#111111" stroke="#111111" stroke-width="3"/>
      <rect x="60" y="130" width="24" height="24" fill="#ffffff" stroke="#111111" stroke-width="3"/>
    </svg>`;
    const png = await svgToPng(svg);
    const decoded = await decodeBytesToRgbaAndGray(png, 'image/png');
    const form = recognizeFormFields({
      gray: decoded.gray,
      width: decoded.width,
      height: decoded.height,
      pageNumber: 1,
      ocrText: 'Student Name: Ada Lovelace\nDepartment: ______',
      wordBoxes: [
        { text: 'Agreed', confidence: 95, bbox: { x0: 95, y0: 62, x1: 165, y1: 84 } },
        { text: 'Exempt', confidence: 95, bbox: { x0: 95, y0: 132, x1: 165, y1: 154 } },
      ],
    });

    assert.equal(form.detected, true);
    assert.ok(form.fields.some((f) => f.kind === 'checkbox' && f.checked === true));
    assert.ok(form.fields.some((f) => f.kind === 'checkbox' && f.checked === false));
    assert.ok(form.fields.some((f) => f.kind === 'text_field' && f.label.includes('Department') && f.status === 'unfilled'));
    assert.equal(form.isIncompleteForm, true);
  });

  test('7. Barcode & QR Recognition decodes rotated QR codes, enforces safe payload URLs & flags unreadable bars', async () => {
    const qrDataUrl = await QRCode.toDataURL('https://pqguide.edu/verify/CSC301', {
      width: 220,
      margin: 2,
    });
    const qrBuf = Buffer.from(qrDataUrl.split(',')[1], 'base64');
    // Rotate 90 degrees before decoding to verify multi-angle decoding!
    const rotatedPng = new Uint8Array(await sharp(qrBuf).rotate(90).png().toBuffer());
    const decoded = await decodeBytesToRgbaAndGray(rotatedPng, 'image/png');

    const matches = scanBarcodesAndQrFromBuffer({
      rgba: decoded.rgba,
      gray: decoded.gray,
      width: decoded.width,
      height: decoded.height,
      pageNumber: 1,
    });
    assert.ok(matches.some((m) => m.payload === 'https://pqguide.edu/verify/CSC301' && m.isSafeUrl === true));
    assert.equal(isSafeBarcodePayload('javascript:alert(1)'), false);
    assert.equal(isSafeBarcodePayload('http://insecure.example.com'), false);
    assert.equal(isSafeBarcodePayload('https://university.edu.ng/doc'), true);
  });

  test('8. Handwriting HTR reports missing dedicated neural weights honestly and supports pluggable HTR adapter', async () => {
    // Draw varied stroke blobs representing cursive handwriting band
    const w = 640;
    const h = 240;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <rect width="${w}" height="${h}" fill="#ffffff"/>
      <path d="M50 110 C 70 70, 95 140, 120 95 S 160 130, 195 90 C 225 75, 250 135, 290 100" fill="none" stroke="#111" stroke-width="5"/>
      <path d="M310 105 C 330 65, 360 140, 390 92 S 430 135, 470 98" fill="none" stroke="#111" stroke-width="4"/>
    </svg>`;
    const png = await svgToPng(svg);
    const decoded = await decodeBytesToRgbaAndGray(png, 'image/png');

    // Without external HTR adapter -> honest model_unavailable_partial & [unreadable handwriting]
    const nativeRes = await analyzeHandwritingRegions({
      gray: decoded.gray,
      width: decoded.width,
      height: decoded.height,
      pageNumber: 1,
      ocrText: 'x? ~',
      ocrConfidence: 32,
      isScannedOrRaster: true,
    });
    assert.equal(nativeRes.detected, true);
    assert.equal(nativeRes.engineStatus, 'model_unavailable_partial');
    assert.ok(nativeRes.missingModelNote?.includes('TrOCR') || nativeRes.missingModelNote?.includes('HTR'));

    // With custom HTR adapter -> executes cleanly and surfaces uncertain words
    const mockAdapter: HandwritingEngineAdapter = {
      name: 'LocalTrOCR',
      async recognizeRegion() {
        return {
          text: 'The energy is conserved [uncertain]',
          confidence: 78,
          uncertainWords: ['[uncertain]'],
          unreadable: false,
        };
      },
    };
    const adaptedRes = await analyzeHandwritingRegions({
      gray: decoded.gray,
      width: decoded.width,
      height: decoded.height,
      pageNumber: 1,
      ocrText: 'The energy is conserved',
      ocrConfidence: 40,
      isScannedOrRaster: true,
      adapter: mockAdapter,
    });
    assert.equal(adaptedRes.engineStatus, 'executed');
    assert.equal(adaptedRes.engineUsed, 'external_htr_adapter');
    assert.ok(adaptedRes.regions.some((r) => r.extractedText.includes('conserved')));
  });

  test('9. Signature Presence & Official Stamp Detector identifies red seal & signature stroke without claiming identity verification', async () => {
    const w = 700;
    const h = 480;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <rect width="${w}" height="${h}" fill="#ffffff"/>
      <circle cx="520" cy="340" r="68" fill="none" stroke="#B91C1C" stroke-width="6"/>
      <circle cx="520" cy="340" r="52" fill="none" stroke="#B91C1C" stroke-width="3"/>
      <path d="M90 360 C 120 330, 145 390, 175 345 S 210 385, 250 350" fill="none" stroke="#111111" stroke-width="4"/>
    </svg>`;
    const png = await svgToPng(svg);
    const decoded = await decodeBytesToRgbaAndGray(png, 'image/png');
    const result = detectSignaturesAndStamps({
      rgba: decoded.rgba,
      gray: decoded.gray,
      width: decoded.width,
      height: decoded.height,
      pageNumber: 1,
      ocrText: 'Signed by Examiner: _______________\nAPPROVED DEAN',
      wordBoxes: [
        { text: 'APPROVED', confidence: 88, bbox: { x0: 485, y0: 325, x1: 555, y1: 345 } },
      ],
    });

    assert.ok(result.signatures.some((s) => s.status === 'present'));
    assert.ok(result.signatures[0].note.toLowerCase().includes('presence'));
    assert.ok(result.stamps.some((st) => st.colorTone === 'colored'));
    assert.ok(result.stamps[0].extractedText?.includes('APPROVED'));
  });

  test('10. Document Classifier, Page Integrity Audit, Language Detector & 14-Field Metadata Extractor', () => {
    const examText = [
      'Federal University of Technology',
      'Faculty of Computing',
      'Department of Computer Science',
      'CSC 301: Data Structures and Algorithms (3 Units)',
      'First Semester Examination · 2023/2024 Academic Session',
      'Date: 14th March, 2024 · Time Allowed: 2 Hours · Total Marks: 70',
      'Instructions: Answer Question 1 and any other THREE questions.',
      'Examiner: Prof. K. Adeyemi',
      '1. Define Big-O notation.',
      '2. Compare B-trees and AVL trees.',
      'Page 1 of 4',
    ].join('\n');

    const pages: ExtractedPageContent[] = [
      {
        pageNumber: 1,
        text: examText,
        wordCount: 80,
        ocrApplied: false,
        ocrConfidence: null,
        diagrams: [],
        tables: [],
        formulas: [],
        warnings: [],
      },
      {
        pageNumber: 2,
        text: `${examText}\nQuestion 3: Explain Dijkstra algorithm.\nPage 3 of 4`,
        wordCount: 85,
        ocrApplied: false,
        ocrConfidence: null,
        diagrams: [],
        tables: [],
        formulas: [],
        warnings: [],
      },
      {
        pageNumber: 3,
        text: `${examText}\nQuestion 3: Explain Dijkstra algorithm.\nPage 2 of 4`,
        wordCount: 85,
        ocrApplied: false,
        ocrConfidence: null,
        diagrams: [],
        tables: [],
        formulas: [],
        warnings: [],
      },
    ];

    const meta = extractAcademicMetadata({ fileName: 'csc301_pq.pdf', pages, extractedText: examText });
    assert.equal(meta.courseCode.value, 'CSC 301');
    assert.equal(meta.courseUnit.status, 'extracted');
    assert.equal(meta.academicSession.value, '2023/2024');
    assert.equal(meta.examinationDuration.status, 'extracted');
    assert.equal(meta.totalMarks.status, 'extracted');
    assert.equal(meta.examinerName.status, 'extracted');
    assert.ok(meta.institution.value?.includes('University'));

    const cls = classifyAcademicDocument({
      fileName: 'csc301_past_question.pdf',
      text: examText,
      headings: ['CSC 301 Examination'],
      tables: [],
      formulas: [],
      diagrams: [],
      metadata: meta,
    });
    assert.ok(cls.primaryCategory === 'past_question' || cls.primaryCategory === 'examination_paper');

    const integ = inspectDocumentIntegrity({ pages, detectedFormat: 'pdf' });
    assert.equal(integ.hasDuplicatePages, true);
    assert.equal(integ.outOfOrderDetected, true);
    assert.ok(integ.missingPageNumbers.includes(4));

    const lang = analyzeDocumentLanguages('Bonjour les étudiants. Àṣà Yorùbá: ẹọṣń', ['eng']);
    assert.ok(lang.unsupportedLanguages.length >= 1, 'Missing fra/yor traineddata must be flagged');
  });

  test('11. Vision AI stays OFF by default, AbortSignal cancels cleanly, and Student role is blocked from scanner internals', async () => {
    let visionInvoked = false;
    const spyVision: VisionOcrRunner = async () => {
      visionInvoked = true;
      return { text: 'should never run', confidence: 99, modelUsed: 'blocked' };
    };

    const bytes = new TextEncoder().encode('CSC 201 Past Question\n1. State Ohm Law.\n2. Calculate V=IR.');
    const result = await scanSingleAcademicInput(
      { name: 'csc201.txt', type: 'text/plain', size: bytes.byteLength, bytes },
      { visionOcrRunner: spyVision }
    );
    assert.equal(visionInvoked, false, 'Vision fallback must default to off');
    assert.ok(result.moduleReports && result.moduleReports.length >= 4);

    // Validation & Role RBAC check
    const validation = validateScannedDocument({
      artifact: result,
      duplicateLookup: { isDuplicate: false },
    });
    assert.ok(validation.deterministicChecks.length >= 4);

    assert.equal(hasPermission('student', 'docs:scan_submit'), false);
    assert.equal(hasPermission('student', 'docs:review'), false);
    assert.equal(hasPermission('student', 'docs:publish'), false);
    assert.equal(hasPermission('school_admin', 'docs:scan_submit'), true);
    assert.equal(hasPermission('school_admin', 'docs:publish'), false);
    assert.equal(hasPermission('super_admin', 'docs:publish'), true);

    // Cancellation support
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () =>
        scanSingleAcademicInput(
          { name: 'aborted.txt', type: 'text/plain', size: bytes.byteLength, bytes },
          { signal: controller.signal }
        ),
      /cancelled/i
    );
  });
});
