import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import sharp from 'sharp';
import {
  createSuryaOcrService,
  normalizeSuryaPagePayload,
  validateConfiguredServiceUrl,
} from '../server/suryaOcrService.ts';
import { createDocumentEngine } from '../server/documentService.ts';
import { createDocumentHttpHandlers } from '../server/httpAdapter.ts';
import { scanSingleAcademicInput } from '../src/services/intelligence/documentScannerEngine.ts';
import {
  recognizeWithTesseractPool,
  shutdownOcrWorkerPool,
} from '../src/services/intelligence/ocrEngine.ts';
import { computeCerAndWer } from '../src/services/intelligence/ocrBenchmark.ts';
import {
  applyConservativeOcrRepairs,
  selectOptimalOcrPlan,
  type SuryaOcrRunner,
} from '../src/services/intelligence/ocrRouter.ts';
import {
  analyzeDocumentLanguages,
  selectTesseractLanguageParam,
} from '../src/services/intelligence/languageDetector.ts';
import { parseAcademicExamStructure } from '../src/services/intelligence/academicQuestionParser.ts';
import { validateScannedDocument } from '../src/services/intelligence/validationEngine.ts';
import type { ExtractedPageContent } from '../src/core/types.ts';

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderSvg(
  lines: string[],
  opts?: { width?: number; height?: number; bg?: string; fg?: string; fontSize?: number; gap?: number }
): Buffer {
  const width = opts?.width ?? 1400;
  const height = opts?.height ?? 720;
  const bg = opts?.bg ?? '#ffffff';
  const fg = opts?.fg ?? '#111111';
  const fontSize = opts?.fontSize ?? 30;
  const gap = opts?.gap ?? 78;
  const body = lines
    .map(
      (line, idx) =>
        `<text x="72" y="${105 + idx * gap}" font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif" font-size="${fontSize}" fill="${fg}">${escapeXml(line)}</text>`
    )
    .join('');
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${bg}"/>${body}</svg>`
  );
}

describe('Surya OCR bridge, routing, repairs, Nigerian languages & Academic Question Parser', () => {
  test('1. Surya URL SSRF protection and payload normalization handle tables, LaTeX, coords & uncertain spans', () => {
    assert.equal(validateConfiguredServiceUrl('http://169.254.169.254/latest').valid, false);
    assert.equal(validateConfiguredServiceUrl('http://metadata.google.internal').valid, false);
    assert.equal(validateConfiguredServiceUrl('http://user:pass@localhost:8001').valid, false);
    assert.equal(validateConfiguredServiceUrl('http://evil.example.com:8001').valid, false);
    assert.equal(validateConfiguredServiceUrl('http://127.0.0.1:8001').valid, true);
    assert.equal(validateConfiguredServiceUrl('https://ocr.pqguide.example/surya').valid, true);

    const normalized = normalizeSuryaPagePayload({
      pageNumber: 1,
      width: 1200,
      height: 1600,
      blocks: [
        { order: 1, label: 'Text', text: '1. Find the derivative of f(x).', confidence: 0.94, bbox: [80, 140, 900, 190] },
        { order: 0, label: 'SectionHeader', text: 'MAT 201 CALCULUS EXAM', confidence: 0.98, bbox: [80, 40, 900, 100] },
        {
          order: 2,
          label: 'Equation',
          html: '<math display="block" alttext="\\frac{dy}{dx} = 3x^2">dy/dx = 3x^2</math>',
          text: '\\frac{dy}{dx} = 3x^2',
          confidence: 0.89,
          bbox: [100, 220, 480, 290],
        },
        {
          order: 3,
          label: 'Table',
          html: '<table><tr><th>x</th><th>f(x)</th></tr><tr><td>1</td><td>2</td></tr></table>',
          confidence: 0.91,
          bbox: [100, 320, 620, 460],
        },
        {
          order: 4,
          label: 'Text',
          text: 'Blurry marginal note [uncertain]',
          confidence: 0.41,
          bbox: [100, 500, 560, 545],
        },
      ],
      lines: [
        { text: 'MAT 201 CALCULUS EXAM', confidence: 0.98, bbox: [80, 40, 900, 100] },
        { text: '1. Find the derivative of f(x).', confidence: 0.94, bbox: [80, 140, 900, 190] },
      ],
    });

    assert.equal(normalized.blocks[0]?.kind, 'heading');
    assert.match(normalized.blocks[0]?.text ?? '', /MAT 201/);
    assert.equal(normalized.equations.length, 1);
    assert.equal(normalized.equations[0]?.latex, '\\frac{dy}{dx} = 3x^2');
    assert.equal(normalized.tables.length, 1);
    assert.deepEqual(normalized.tables[0]?.headers, ['x', 'f(x)']);
    assert.ok(normalized.uncertainSpans.length >= 1, 'Low-confidence block must be flagged uncertain');
    assert.ok(normalized.wordBoxes.length >= 5);
  });

  test('2. Server Surya HTTP, Datalab API, capabilities, and TrOCR handwriting endpoints work cleanly', async () => {
    const samplePng = new Uint8Array(
      await sharp(renderSvg(['CSC 301 EXAM', '1. Analyze Dijkstra shortest path algorithm.'])).png().toBuffer()
    );
    const b64 = `data:image/png;base64,${Buffer.from(samplePng).toString('base64')}`;

    const suryaSvc = createSuryaOcrService({
      env: { SURYA_OCR_URL: 'http://127.0.0.1:8001' },
      fetchImpl: async (url) => {
        assert.match(String(url), /\/analyze$/);
        return new Response(
          JSON.stringify({
            ok: true,
            apiMode: 'surya_foundation_v0_17',
            device: 'cpu',
            pages: [
              {
                pageNumber: 1,
                width: 1400,
                height: 720,
                text: 'CSC 301 EXAM\n\n1. Analyze Dijkstra shortest path algorithm.',
                confidence: 0.93,
                blocks: [
                  { order: 0, label: 'SectionHeader', text: 'CSC 301 EXAM', confidence: 0.95, bbox: [72, 70, 400, 120] },
                  { order: 1, label: 'Text', text: '1. Analyze Dijkstra shortest path algorithm.', confidence: 0.92, bbox: [72, 150, 980, 210] },
                ],
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      },
    });

    const suryaRes = await suryaSvc.analyzeWithSurya({
      body: { imageBase64: b64, mimeType: 'image/png', pageNumber: 1, languages: ['en'] },
    });
    assert.equal(suryaRes.status, 200);
    assert.equal(suryaRes.body.ok, true);
    assert.equal(suryaRes.body.backendMode, 'surya_http');
    assert.equal(suryaRes.body.page?.confidence, 93);

    const datalabSvc = createSuryaOcrService({
      env: { DATALAB_API_KEY: 'dl_test_secret_not_real' },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            success: true,
            pages: [
              {
                page: 1,
                image_bbox: [0, 0, 1400, 720],
                text_lines: [{ text: 'Datalab Surya Line', confidence: 0.91, bbox: [50, 50, 500, 95] }],
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        ),
    });
    const datalabRes = await datalabSvc.analyzeWithSurya({ body: { imageBase64: b64, mimeType: 'image/png' } });
    assert.equal(datalabRes.body.ok, true);
    assert.equal(datalabRes.body.backendMode, 'datalab_api');
    assert.match(datalabRes.body.page?.text ?? '', /Datalab Surya Line/);

    // Capabilities & HTR HTTP handler integration
    const docEngine = createDocumentEngine({
      env: { HTR_SERVICE_URL: 'http://127.0.0.1:8001/htr' },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            ok: true,
            modelAvailable: true,
            modelUsed: 'microsoft/trocr-base-handwritten',
            text: 'Conservation of linear momentum',
            confidence: 82,
            unreadable: false,
            uncertainWords: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        ),
    });
    const handlers = createDocumentHttpHandlers(docEngine, suryaSvc);
    let capPayload = '';
    await handlers.handleOcrCapabilities(
      { method: 'GET', headers: { host: 'localhost:3000' } } as never,
      { setHeader() {}, end(d: string) { capPayload = d; } } as never
    );
    const parsedCaps = JSON.parse(capPayload);
    assert.equal(parsedCaps.surya.available, true);
    assert.equal(parsedCaps.languages.defaultLanguage, 'eng');

    let htrPayload = '';
    await handlers.handleHandwritingOcr(
      {
        method: 'POST',
        headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
        body: { imageBase64: b64, mimeType: 'image/png' },
      } as never,
      { setHeader() {}, end(d: string) { htrPayload = d; } } as never
    );
    const parsedHtr = JSON.parse(htrPayload);
    assert.equal(parsedHtr.ok, true);
    assert.equal(parsedHtr.engine, 'trocr');
    assert.match(parsedHtr.text, /Conservation of linear momentum/);
  });

  test('3. Engine router selects Surya when available, cross-verifies hybrid mode, and falls back to Tesseract on failure', async () => {
    const planNoSurya = selectOptimalOcrPlan({ engineMode: 'auto', capabilities: null });
    assert.equal(planNoSurya.primaryEngine, 'tesseract');
    assert.equal(planNoSurya.tesseractLang, 'eng');

    const planYor = selectOptimalOcrPlan({
      engineMode: 'auto',
      languageHintText: 'Ọlọ́run ní ìgbàlà Yorùbá',
      capabilities: null,
    });
    assert.equal(planYor.tesseractLang, 'eng+yor');

    const samplePng = new Uint8Array(
      await sharp(
        renderSvg([
          'PHY 102 ELECTRICITY AND MAGNETISM',
          '1. Calculate resistance using Ohm law V = IR.',
          '2. Complete Table 1 below carefully.',
        ])
      )
        .png()
        .toBuffer()
    );

    const mockSurya: SuryaOcrRunner = async () => ({
      ok: true,
      engine: 'surya',
      backendMode: 'surya_http',
      providerAvailable: true,
      page: {
        pageNumber: 1,
        width: 1400,
        height: 720,
        text: 'PHY 102 ELECTRICITY AND MAGNETISM\n\n1. Calculate resistance using $V = I R$.',
        confidence: 92,
        blocks: [
          { id: 'sb1', kind: 'heading', pageNumber: 1, text: 'PHY 102 ELECTRICITY AND MAGNETISM', headingLevel: 1 },
          { id: 'sb2', kind: 'question', pageNumber: 1, text: '1. Calculate resistance using $V = I R$.' },
        ],
        lineBoxes: [],
        wordBoxes: [],
        equations: [
          { id: 'seq1', pageNumber: 1, rawText: 'V = IR', latex: 'V = I R', displayMode: false, sourceMethod: 'math_adapter', confidence: 92 },
        ],
        tables: [
          {
            id: 'stbl1',
            pageNumber: 1,
            headers: ['Voltage (V)', 'Current (A)'],
            rows: [['12', '3']],
            markdown: '| Voltage (V) | Current (A) |\n| --- | --- |\n| 12 | 3 |',
          },
        ],
        uncertainSpans: [],
        warnings: [],
      },
    });

    const suryaScan = await scanSingleAcademicInput(
      { name: 'phy102.png', type: 'image/png', size: samplePng.byteLength, bytes: samplePng },
      { bypassCache: true, engineMode: 'surya', suryaRunner: mockSurya, visionFallback: 'off' }
    );
    assert.equal(suryaScan.pages[0]?.ocrEngineUsed, 'surya');
    assert.equal(suryaScan.ocrEngineSummary, 'surya');
    assert.ok(suryaScan.formulas.some((f) => f.latex.includes('V = I R')));
    assert.ok(suryaScan.tables.some((t) => t.headers.includes('Voltage (V)')));

    // Low-confidence Surya (66% < 74%) -> hybrid_surya_tesseract verification
    const lowConfSurya: SuryaOcrRunner = async (inp) => {
      const base = await mockSurya(inp);
      return {
        ...base,
        page: { ...base.page!, confidence: 66 },
      };
    };
    const hybridRes = await recognizeWithTesseractPool({
      bytes: samplePng,
      mimeType: 'image/png',
      engineMode: 'auto',
      suryaRunner: lowConfSurya,
      visionFallback: 'off',
    });
    assert.equal(hybridRes.ocrEngineUsed, 'hybrid_surya_tesseract');
    assert.equal(hybridRes.passesRun, 2);

    // Surya error -> clean automatic fallback to local Tesseract pool
    const brokenSurya: SuryaOcrRunner = async () => {
      throw new Error('ECONNREFUSED sidecar');
    };
    const fallbackRes = await recognizeWithTesseractPool({
      bytes: samplePng,
      mimeType: 'image/png',
      engineMode: 'auto',
      suryaRunner: brokenSurya,
      visionFallback: 'off',
    });
    assert.equal(fallbackRes.ocrEngineUsed, 'tesseract');
    assert.match(fallbackRes.text, /PHY\s*102|Ohm/i);
  });

  test('4. Conservative post-OCR repairs fix split carets/subscripts, ligatures & NFC diacritics without hallucinating', () => {
    const raw = 'E = mc”~2, g = 9.8 m/s"~2, term a_ n = 4, ﬁlter, O\u0323lo\u0323\u0301run\nequiva-\nlent.';
    const repaired = applyConservativeOcrRepairs(raw);
    assert.match(repaired.text, /E = mc\^2/);
    assert.match(repaired.text, /m\/s\^2/);
    assert.match(repaired.text, /a_n = 4/);
    assert.match(repaired.text, /filter/);
    assert.match(repaired.text, /Ọlọ́run/);
    assert.match(repaired.text, /equivalent\./);
    assert.ok(repaired.repairsApplied.includes('math_caret_subscript_artifact_repair'));
    assert.ok(repaired.repairsApplied.includes('ligature_normalization'));
    assert.ok(repaired.repairsApplied.includes('diacritic_nfc_normalization'));
  });

  test('5. Inverted dark-mode scan, 18-deg skew recovery, and Nigerian Yoruba/Hausa/Igbo language OCR support', async () => {
    // 5a. Dark-mode inverted scan recovery
    const darkTruthLines = [
      'CHM 101 GENERAL CHEMISTRY TEST',
      '1. Balance equation 2H2 + O2 = 2H2O clearly.',
      '2. Calculate molarity of 4.5M solution.',
    ];
    const darkPng = new Uint8Array(
      await sharp(renderSvg(darkTruthLines, { bg: '#111827', fg: '#f8fafc', fontSize: 32, gap: 82 }))
        .png()
        .toBuffer()
    );
    const darkOut = await scanSingleAcademicInput(
      { name: 'dark_polarity_chm101.png', type: 'image/png', size: darkPng.byteLength, bytes: darkPng },
      { bypassCache: true, visionFallback: 'off' }
    );
    const darkMetrics = computeCerAndWer(darkTruthLines.join(' '), darkOut.extractedText);
    console.info(
      `[OCR Benchmark] Inverted Dark Scan: CER=${(darkMetrics.cer * 100).toFixed(2)}% WER=${(darkMetrics.wer * 100).toFixed(2)}% PolarityFlag=${darkOut.pages[0]?.qualityMetrics?.isInvertedPolarity}`
    );
    assert.equal(darkOut.pages[0]?.qualityMetrics?.isInvertedPolarity, true);
    assert.ok(darkOut.pages[0]?.preprocessingApplied?.includes('invert_dark_polarity'));
    assert.ok(darkMetrics.cer < 0.08, `Expected dark-mode CER < 8%, got ${darkMetrics.cer}`);

    // 5b. 18-degree rotated scan recovery (beyond old ±14° deskew ceiling)
    const rotLines = [
      'BIO 201 CELL BIOLOGY EXAMINATION',
      '1. Describe mitochondrial ATP synthesis.',
      '2. Explain osmosis across semipermeable membranes.',
    ];
    const rotBase = await sharp(renderSvg(rotLines, { width: 1400, height: 600, fontSize: 30, gap: 82 })).png().toBuffer();
    const rot18Png = new Uint8Array(
      await sharp(rotBase).rotate(18, { background: '#ffffff' }).png().toBuffer()
    );
    const rotOut = await scanSingleAcademicInput(
      { name: 'bio201_rot18.png', type: 'image/png', size: rot18Png.byteLength, bytes: rot18Png },
      { bypassCache: true, visionFallback: 'off' }
    );
    const rotMetrics = computeCerAndWer(rotLines.join(' '), rotOut.extractedText);
    console.info(
      `[OCR Benchmark] Rotated 18°: CER=${(rotMetrics.cer * 100).toFixed(2)}% WER=${(rotMetrics.wer * 100).toFixed(2)}% Skew=${rotOut.pages[0]?.qualityMetrics?.skewAngleDeg}°`
    );
    assert.ok(rotMetrics.cer < 0.12, `Expected 18-deg deskewed CER < 12%, got ${rotMetrics.cer}`);

    // 5c. Yoruba diacritics OCR with @tesseract.js-data/yor + Hausa/Igbo detection
    const yorubaText = 'Yorùbá Exam: Àwọn ọmọ ilé-ìwé ní ẹ̀kọ́ ọlọ́gbọ́n.';
    const yorPng = new Uint8Array(
      await sharp(renderSvg(['YOR 101 YORUBA STUDIES', yorubaText], { width: 1400, height: 400, fontSize: 32 }))
        .png()
        .toBuffer()
    );
    const yorOcr = await recognizeWithTesseractPool({
      bytes: yorPng,
      mimeType: 'image/png',
      language: 'eng+yor',
      visionFallback: 'off',
    });
    const yorMetrics = computeCerAndWer(`YOR 101 YORUBA STUDIES ${yorubaText}`, yorOcr.text);
    console.info(
      `[OCR Benchmark] Yoruba (eng+yor): CER=${(yorMetrics.cer * 100).toFixed(2)}% WER=${(yorMetrics.wer * 100).toFixed(2)}% Text="${yorOcr.text.replace(/\n/g, ' ')}"`
    );
    assert.ok(yorOcr.text.includes('YOR 101'));
    assert.ok(/[ÀàẸẹỌọṢṣÌì]/.test(yorOcr.text), 'Expected Yoruba tonal/subdot diacritics preserved');

    assert.equal(selectTesseractLanguageParam(yorubaText, ['eng', 'yor']), 'eng+yor');
    const hauAnalysis = analyzeDocumentLanguages('Jarrabawar Hausa: Ɓauna da ɗalibi sun ƙera.', ['eng', 'yor']);
    assert.ok(hauAnalysis.detectedLanguages.some((l) => l.code === 'hau'));
    assert.ok(hauAnalysis.unsupportedLanguages.some((u) => u.includes('hau')));
    const iboAnalysis = analyzeDocumentLanguages('Ule Igbo: Ụmụ akwụkwọ na-amụ akwụkwọ n’ụlọ.', ['eng', 'yor']);
    assert.ok(iboAnalysis.detectedLanguages.some((l) => l.code === 'ibo'));
    assert.ok(iboAnalysis.unsupportedLanguages.some((u) => u.includes('ibo')));
  });

  test('6. Academic Question Parser handles 2-col MCQs, subquestions, cross-page continuation, duplicates & consistency checks', async () => {
    const pages: ExtractedPageContent[] = [
      {
        pageNumber: 1,
        text: [
          'ADEKUNLE AJASIN UNIVERSITY',
          'CSC 304: OPERATING SYSTEMS EXAMINATION',
          'Instructions: Answer all questions in Section A and any two in Section B.',
          'SECTION A',
          '1. Which scheduling algorithm suffers from convoy effect? [5 marks]',
          'A. Round Robin   B. First Come First Served',
          'C. Shortest Job First   D. Priority Queue',
          '2. Explain deadlock conditions in operating systems [15 marks]:',
          '(a) Define mutual exclusion and hold-and-wait.',
        ].join('\n'),
        wordCount: 70,
        ocrApplied: false,
        ocrConfidence: null,
        diagrams: [{ id: 'fig-1-1', pageNumber: 1, caption: 'Diagram of deadlock cycle', kind: 'diagram' }],
        tables: [],
        formulas: [{ id: 'fml-1-1', pageNumber: 1, rawText: 'T = W + B', latex: 'T = W + B', displayMode: false }],
        warnings: [],
      },
      {
        pageNumber: 2,
        text: [
          '(b) Compare banker algorithm against resource allocation graph diagrams.',
          '4. Which scheduling algorithm suffers from convoy effect? Explain.',
          'A. Round Robin   B. First Come First Served   D. Priority Queue',
        ].join('\n'),
        wordCount: 38,
        ocrApplied: false,
        ocrConfidence: null,
        diagrams: [],
        tables: [{ id: 'tbl-2-1', pageNumber: 2, headers: ['Process', 'Burst'], rows: [['P1', '4ms']] }],
        formulas: [],
        warnings: [],
      },
    ];

    const report = parseAcademicExamStructure({ pages, fileName: 'CSC304_exam.pdf' });

    assert.ok(report.instructions.length >= 1);
    assert.ok(report.sections.includes('SECTION A'));
    assert.equal(report.totalDetectedQuestions, 3); // Q1, Q2 (with cross-page (b)), Q4 (missing Q3!)

    const q1 = report.questions.find((q) => q.questionNumber === '1')!;
    assert.equal(q1.options.length, 4);
    assert.equal(q1.options[1]?.text, 'First Come First Served');
    assert.equal(q1.marks, '5 marks');

    const q2 = report.questions.find((q) => q.questionNumber === '2')!;
    assert.equal(q2.isContinuedAcrossPages, true);
    assert.deepEqual(q2.pageNumbers, [1, 2]);
    assert.equal(q2.subquestions.length, 2);
    assert.equal(q2.subquestions[0]?.parentQuestionNumber, '2');
    assert.equal(q2.subquestions[1]?.label, '(b)');
    assert.ok(q2.diagramIds.includes('fig-1-1'));

    assert.ok(report.missingQuestionNumbers.includes(3), 'Missing Q3 between Q2 and Q4 must be caught');
    assert.ok(
      report.incompleteQuestions.some((iq) => iq.questionNumber === '4'),
      'Q4 missing option C (A, B, D) must be caught'
    );

    // Verify TXT document scan propagates academicStructure and validationEngine catches consistency warnings
    const dupDocText = [
      'CSC 304 EXAMINATION',
      '1. Explain how virtual memory page replacement works using LRU.',
      '2. Explain how virtual memory page replacement works using LRU.',
    ].join('\n');
    const txtBytes = new TextEncoder().encode(dupDocText);
    const artifact = await scanSingleAcademicInput({
      name: 'CSC304_dup.txt',
      type: 'text/plain',
      size: txtBytes.byteLength,
      bytes: txtBytes,
    });
    assert.ok(artifact.academicStructure);
    assert.equal(artifact.academicStructure!.duplicateQuestions.length, 1);

    const validation = await validateScannedDocument({
      artifact,
      duplicateLookup: { isDuplicate: false },
    });
    const chkExam = validation.deterministicChecks.find((c) => c.id === 'chk-exam-consistency');
    assert.ok(chkExam && !chkExam.passed && chkExam.severity === 'warning');
  });
});

after(async () => {
  await shutdownOcrWorkerPool();
});
