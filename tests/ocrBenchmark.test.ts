import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import sharp from 'sharp';
import { jsPDF } from 'jspdf';
import { scanSingleAcademicInput } from '../src/services/intelligence/documentScannerEngine.ts';
import { shutdownOcrWorkerPool, recognizeWithTesseractPool, detectMathUncertainty } from '../src/services/intelligence/ocrEngine.ts';
import { computeCerAndWer } from '../src/services/intelligence/ocrBenchmark.ts';
import { validateScannedDocument } from '../src/services/intelligence/validationEngine.ts';
import { createDocumentEngine } from '../server/documentService.ts';

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderSvgTextPage(lines: string[], width = 1400, height = 900, fontSize = 32, gap = 78): Buffer {
  const body = lines
    .map(
      (line, idx) =>
        `<text x="${Math.round(width * 0.06)}" y="${Math.round(height * 0.14) + idx * gap}" font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif" font-size="${fontSize}" font-weight="${idx < 2 ? 'bold' : 'normal'}" fill="#121212">${escapeXml(line)}</text>`
    )
    .join('');
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#ffffff"/>${body}</svg>`
  );
}

/**
 * Generates a synthetic perspective-warped document photo on a dark wooden desk canvas
 * by inverse-sampling the flat white sheet into a tilted trapezoid inside a larger frame.
 */
async function createPerspectiveWarpedDeskPhoto(
  sheetGray: Uint8Array,
  sw: number,
  sh: number,
  frameW: number,
  frameH: number
): Promise<Uint8Array> {
  // Trapezoid corners inside frame (tilted ~5 degrees + keystone foreshortening)
  const dstQuad = [
    { x: Math.round(frameW * 0.14), y: Math.round(frameH * 0.11) }, // TL
    { x: Math.round(frameW * 0.87), y: Math.round(frameH * 0.07) }, // TR
    { x: Math.round(frameW * 0.92), y: Math.round(frameH * 0.90) }, // BR
    { x: Math.round(frameW * 0.09), y: Math.round(frameH * 0.87) }, // BL
  ];
  const srcQuad = [
    { x: 0, y: 0 },
    { x: sw - 1, y: 0 },
    { x: sw - 1, y: sh - 1 },
    { x: 0, y: sh - 1 },
  ];

  // Solve homography mapping frame (u,v) -> sheet (sx,sy)
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const u = dstQuad[i].x;
    const v = dstQuad[i].y;
    const x = srcQuad[i].x;
    const y = srcQuad[i].y;
    A.push([u, v, 1, 0, 0, 0, -x * u, -x * v]);
    b.push(x);
    A.push([0, 0, 0, u, v, 1, -y * u, -y * v]);
    b.push(y);
  }
  const n = 8;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let col = 0; col < n; col += 1) {
    let p = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(M[r][col]) > Math.abs(M[p][col])) p = r;
    }
    [M[col], M[p]] = [M[p], M[col]];
    const diag = M[col][col];
    for (let k = col; k <= n; k += 1) M[col][k] /= diag;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = M[r][col];
      for (let k = col; k <= n; k += 1) M[r][k] -= f * M[col][k];
    }
  }
  const [h0, h1, h2, h3, h4, h5, h6, h7] = M.map((r) => r[n]);

  const out = new Uint8Array(frameW * frameH);
  // Dark wood desk background texture (~38 intensity)
  for (let y = 0; y < frameH; y += 1) {
    for (let x = 0; x < frameW; x += 1) {
      const denom = h6 * x + h7 * y + 1;
      const sx = (h0 * x + h1 * y + h2) / denom;
      const sy = (h3 * x + h4 * y + h5) / denom;
      if (sx >= 0 && sx < sw - 1 && sy >= 0 && sy < sh - 1) {
        const x0 = Math.floor(sx);
        const y0 = Math.floor(sy);
        const fx = sx - x0;
        const fy = sy - y0;
        const r0 = y0 * sw;
        const r1 = (y0 + 1) * sw;
        const topV = sheetGray[r0 + x0] * (1 - fx) + sheetGray[r0 + x0 + 1] * fx;
        const botV = sheetGray[r1 + x0] * (1 - fx) + sheetGray[r1 + x0 + 1] * fx;
        out[y * frameW + x] = Math.round(topV * (1 - fy) + botV * fy);
      } else {
        out[y * frameW + x] = 35 + ((x + y) % 12);
      }
    }
  }

  const png = await sharp(Buffer.from(out), {
    raw: { width: frameW, height: frameH, channels: 1 },
  })
    .png()
    .toBuffer();
  return new Uint8Array(png);
}

describe('PQGuide OCR benchmark (generated pages with known text + optional real fixtures)', () => {
  const standardLines = [
    'ADEKUNLE AJASIN UNIVERSITY, AKUNGBA AKOKO',
    'COURSE CODE: CSC 304 - OPERATING SYSTEMS',
    'FIRST SEMESTER EXAMINATION 2024/2025',
    '1. Define process scheduling and explain deadlock prevention.',
    '2. Calculate waiting time for turnaround intervals 12.5ms and 18.0ms.',
  ];
  const standardTruth = standardLines.join(' ');

  test('1. Crisp PNG and low-res mobile PNG benchmark reports real CER & WER', async () => {
    const crispPng = new Uint8Array(
      await sharp(renderSvgTextPage(standardLines, 1500, 900, 34, 88)).png().toBuffer()
    );
    const crispOut = await scanSingleAcademicInput(
      { name: 'CSC304_crisp.png', type: 'image/png', size: crispPng.byteLength, bytes: crispPng },
      { bypassCache: true, visionFallback: 'off' }
    );
    const crispMetrics = computeCerAndWer(standardTruth, crispOut.extractedText);
    console.info(
      `[OCR Benchmark] Crisp PNG: CER=${(crispMetrics.cer * 100).toFixed(2)}% WER=${(crispMetrics.wer * 100).toFixed(2)}% Conf=${crispOut.averageOcrConfidence}%`
    );
    assert.ok(crispMetrics.cer < 0.12, `Expected crisp CER < 12%, got ${crispMetrics.cer}`);
    assert.ok(crispMetrics.wer < 0.18, `Expected crisp WER < 18%, got ${crispMetrics.wer}`);

    const lowResPng = new Uint8Array(
      await sharp(renderSvgTextPage(standardLines, 1500, 900, 34, 88))
        .resize({ width: 520 })
        .png()
        .toBuffer()
    );
    const lowResOut = await scanSingleAcademicInput(
      { name: 'CSC304_lowres.png', type: 'image/png', size: lowResPng.byteLength, bytes: lowResPng },
      { bypassCache: true, visionFallback: 'off' }
    );
    const lowResMetrics = computeCerAndWer(standardTruth, lowResOut.extractedText);
    console.info(
      `[OCR Benchmark] Low-Res (520px): CER=${(lowResMetrics.cer * 100).toFixed(2)}% WER=${(lowResMetrics.wer * 100).toFixed(2)}% Conf=${lowResOut.averageOcrConfidence}%`
    );
    assert.ok(lowResMetrics.cer < 0.2, `Expected low-res CER < 20%, got ${lowResMetrics.cer}`);
  });

  test('2. 4-corner perspective-warped desk photo detects document quad and rectifies text', async () => {
    const { data, info } = await sharp(renderSvgTextPage(standardLines, 1200, 760, 32, 82))
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const deskPhoto = await createPerspectiveWarpedDeskPhoto(
      new Uint8Array(data),
      info.width,
      info.height,
      1500,
      980
    );

    const warpedOut = await scanSingleAcademicInput(
      { name: 'CSC304_desk_perspective.png', type: 'image/png', size: deskPhoto.byteLength, bytes: deskPhoto },
      { bypassCache: true, visionFallback: 'off' }
    );
    const metrics = computeCerAndWer(standardTruth, warpedOut.extractedText);
    console.info(
      `[OCR Benchmark] Perspective Desk Photo: CER=${(metrics.cer * 100).toFixed(2)}% WER=${(metrics.wer * 100).toFixed(2)}% PerspectiveRectified=${warpedOut.pages[0]?.perspectiveCorrected}`
    );
    assert.equal(warpedOut.pages[0]?.perspectiveCorrected, true);
    assert.ok(warpedOut.pages[0]?.preprocessingApplied?.includes('perspective_warp_4pt'));
    assert.ok(metrics.cer < 0.25, `Expected perspective-rectified CER < 25%, got ${metrics.cer}`);
    assert.ok(/CSC\s*304/i.test(warpedOut.extractedText));
    assert.ok(/scheduling|deadlock/i.test(warpedOut.extractedText));
  });

  test('3. Heavy uneven shadow gradient + crease simulation normalized cleanly without erasing small digits', async () => {
    const { data, info } = await sharp(renderSvgTextPage(standardLines, 1300, 820, 30, 82))
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const shadowed = new Uint8Array(data);
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        // Strong diagonal flash falloff (factor 0.38 in bottom-right) + vertical paper fold shadow band
        const grad = 1.0 - 0.58 * (0.5 * (x / info.width) + 0.5 * (y / info.height));
        const crease = Math.abs(x - info.width * 0.52) < 10 ? 0.78 : 1.0;
        shadowed[y * info.width + x] = Math.round(shadowed[y * info.width + x] * grad * crease);
      }
    }
    const shadowedPng = new Uint8Array(
      await sharp(Buffer.from(shadowed), { raw: { width: info.width, height: info.height, channels: 1 } })
        .png()
        .toBuffer()
    );

    const out = await scanSingleAcademicInput(
      { name: 'CSC304_shadow_crease.png', type: 'image/png', size: shadowedPng.byteLength, bytes: shadowedPng },
      { bypassCache: true, visionFallback: 'off' }
    );
    const metrics = computeCerAndWer(standardTruth, out.extractedText);
    console.info(
      `[OCR Benchmark] Heavy Shadow & Crease: CER=${(metrics.cer * 100).toFixed(2)}% WER=${(metrics.wer * 100).toFixed(2)}% Steps=${out.pages[0]?.preprocessingApplied?.join(',')}`
    );
    assert.ok(metrics.cer < 0.22, `Expected shadow-corrected CER < 22%, got ${metrics.cer}`);
    assert.ok(/12\.5/.test(out.extractedText), 'Small decimal numbers should survive shadow normalization');
  });

  test('4. Preserves 2-column scanned reading order (left column before right column) and tabular/numeric text', async () => {
    const twoColSvg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="920">
        <rect width="1500" height="920" fill="#ffffff"/>
        <text x="80" y="90" font-family="DejaVu Sans, Arial, sans-serif" font-size="32" font-weight="bold" fill="#111">MAT 201 LINEAR ALGEBRA EXAM</text>
        <text x="80" y="200" font-family="DejaVu Sans, Arial, sans-serif" font-size="26" fill="#111">1. Alpha determinant rule</text>
        <text x="80" y="270" font-family="DejaVu Sans, Arial, sans-serif" font-size="26" fill="#111">Define matrix rank.</text>
        <text x="80" y="340" font-family="DejaVu Sans, Arial, sans-serif" font-size="26" fill="#111">2. Beta vector basis</text>
        <text x="80" y="410" font-family="DejaVu Sans, Arial, sans-serif" font-size="26" fill="#111">Solve Ax = b for x.</text>
        <text x="80" y="480" font-family="DejaVu Sans, Arial, sans-serif" font-size="26" fill="#111">Verify eigenvalues.</text>

        <text x="830" y="200" font-family="DejaVu Sans, Arial, sans-serif" font-size="26" fill="#111">3. Gamma orthogonality</text>
        <text x="830" y="270" font-family="DejaVu Sans, Arial, sans-serif" font-size="26" fill="#111">Apply Gram-Schmidt steps.</text>
        <text x="830" y="340" font-family="DejaVu Sans, Arial, sans-serif" font-size="26" fill="#111">4. Delta inner product</text>
        <text x="830" y="410" font-family="DejaVu Sans, Arial, sans-serif" font-size="26" fill="#111">Prove Cauchy-Schwarz.</text>
        <text x="830" y="480" font-family="DejaVu Sans, Arial, sans-serif" font-size="26" fill="#111">Compute trace 42.5.</text>
      </svg>`
    );
    const pngBytes = new Uint8Array(await sharp(twoColSvg).png().toBuffer());
    const out = await scanSingleAcademicInput(
      { name: 'MAT201_twocol.png', type: 'image/png', size: pngBytes.byteLength, bytes: pngBytes },
      { bypassCache: true, visionFallback: 'off' }
    );
    const text = out.extractedText;
    const betaIdx = text.search(/Beta vector/i);
    const gammaIdx = text.search(/Gamma orthogonality/i);
    assert.ok(betaIdx !== -1 && gammaIdx !== -1, `Expected both columns in output:\n${text}`);
    assert.ok(betaIdx < gammaIdx, 'Left column Question 2 (Beta) must precede Right column Question 3 (Gamma)');
  });

  test('5. Server Vision OCR endpoint validation, disabled/mocked provider flow & uncertainty safeguard', async () => {
    // (a) Unconfigured server key returns structured providerAvailable: false
    const unconfEngine = createDocumentEngine({ env: {} });
    const tinyPng = new Uint8Array(await sharp(renderSvgTextPage(['Test Vision Line'], 600, 200, 28, 50)).png().toBuffer());
    const unconfRes = await unconfEngine.performVisionOcr({
      body: {
        imageBase64: `data:image/png;base64,${Buffer.from(tinyPng).toString('base64')}`,
        mimeType: 'image/png',
        pageNumber: 1,
      },
    });
    assert.equal(unconfRes.status, 200);
    assert.equal(unconfRes.body.ok, false);
    assert.equal(unconfRes.body.providerAvailable, false);

    // (b) Rejects non-image payload via magic bytes check
    const bogusRes = await unconfEngine.performVisionOcr({
      body: {
        imageBase64: `data:image/png;base64,${Buffer.from('<html>not-an-image</html>').toString('base64')}`,
        mimeType: 'image/png',
      },
    });
    assert.equal(bogusRes.status, 422);
    assert.equal(bogusRes.body.ok, false);

    // (c) OpenAI-compatible Vision provider integration + uncertain spans flagging in validationEngine
    const oaiEngine = createDocumentEngine({
      env: {
        VISION_OCR_PROVIDER: 'openai_compatible',
        VISION_OCR_API_KEY: 'test-runtime-key',
        VISION_OCR_BASE_URL: 'https://vision.example.test/v1',
        VISION_OCR_MODEL: 'vision-ocr-test',
      },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    text: 'PHY 302 QUANTUM OPTICS\n1. Derive Planck law [uncertain: k_B T] cleanly.',
                    confidenceEstimate: 87,
                    uncertainSpans: [
                      {
                        text: 'k_B T',
                        confidence: 42,
                        reason: 'Smudged subscript notation',
                      },
                    ],
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        ),
    });

    const scanRes = await recognizeWithTesseractPool({
      bytes: tinyPng,
      mimeType: 'image/png',
      visionFallback: 'always',
      visionOcrRunner: async (req) => {
        const res = await oaiEngine.performVisionOcr({
          body: {
            imageBase64: req.imageBase64,
            mimeType: req.mimeType,
            pageNumber: req.pageNumber,
            reason: req.reason,
          },
        });
        return res.body;
      },
    });

    assert.equal(scanRes.visionFallbackUsed, true);
    assert.equal(scanRes.ocrEngineUsed, 'hybrid_tesseract_vision');
    assert.ok(scanRes.uncertainSpans.length >= 1);
    assert.match(scanRes.text, /PHY 302 QUANTUM OPTICS/);

    // Ensure uncertain spans prevent silent auto-approval
    const artifact = await scanSingleAcademicInput(
      { name: 'PHY302_vision.png', type: 'image/png', size: tinyPng.byteLength, bytes: tinyPng },
      {
        bypassCache: true,
        visionFallback: 'always',
        visionOcrRunner: async (req) =>
          (
            await oaiEngine.performVisionOcr({
              body: {
                imageBase64: req.imageBase64,
                mimeType: req.mimeType,
                pageNumber: req.pageNumber,
              },
            })
          ).body,
      }
    );
    const val = await validateScannedDocument({
      artifact,
      duplicateLookup: { isDuplicate: false },
    });
    assert.equal(val.decision, 'flagged');
    assert.equal(val.publicationStatus, 'flagged');
    const chkUncertain = val.deterministicChecks.find((c) => c.id === 'chk-uncertainty');
    assert.ok(chkUncertain && !chkUncertain.passed);
  });

  test('6. Multi-page mixed PDF measures accurate page-level OCR + native extraction without duplication', async () => {
    const page2Img = await sharp(
      renderSvgTextPage(
        ['QUESTION THREE (25 MARKS)', 'Analyze Fourier transform convergence criteria cleanly.'],
        1300,
        750,
        34,
        92
      )
    )
      .jpeg({ quality: 92 })
      .toBuffer();

    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    pdf.text('MTH 301 REAL ANALYSIS - FIRST SEMESTER 2024/2025', 48, 72);
    pdf.text('1. Prove that every convergent sequence of real numbers is bounded.', 48, 108);
    pdf.addPage();
    pdf.addImage(page2Img.toString('base64'), 'JPEG', 40, 80, 500, 290);

    const pdfBytes = new Uint8Array(pdf.output('arraybuffer'));
    const res = await scanSingleAcademicInput(
      { name: 'MTH301_hybrid.pdf', type: 'application/pdf', size: pdfBytes.byteLength, bytes: pdfBytes },
      { bypassCache: true, visionFallback: 'off' }
    );
    assert.equal(res.pageCount, 2);
    assert.equal(res.pages[0]?.extractionMethod, 'native_text');
    assert.equal(res.pages[1]?.extractionMethod, 'ocr');
    const p2Metrics = computeCerAndWer(
      'QUESTION THREE (25 MARKS) Analyze Fourier transform convergence criteria cleanly.',
      res.pages[1]?.text ?? ''
    );
    console.info(
      `[OCR Benchmark] Scanned PDF Page 2: CER=${(p2Metrics.cer * 100).toFixed(2)}% WER=${(p2Metrics.wer * 100).toFixed(2)}%`
    );
    assert.ok(p2Metrics.cer < 0.16);
  });
  test('7. Real photographed/scanned fixtures (tests/fixtures/ocr): measured CER & WER, report only', async (t) => {
    const dir = path.join(process.cwd(), 'tests', 'fixtures', 'ocr');
    const images = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
      : [];
    const pairs = images.filter((f) => fs.existsSync(path.join(dir, f.replace(/\.[^.]+$/, '.txt'))));
    if (pairs.length === 0) {
      t.skip('No real fixtures yet. Add image + verified .txt pairs to tests/fixtures/ocr (see README).');
      return;
    }
    for (const file of pairs) {
      const bytes = new Uint8Array(fs.readFileSync(path.join(dir, file)));
      const truth = fs.readFileSync(path.join(dir, file.replace(/\.[^.]+$/, '.txt')), 'utf8');
      const mime = /\.png$/i.test(file) ? 'image/png' : /\.webp$/i.test(file) ? 'image/webp' : 'image/jpeg';
      const out = await scanSingleAcademicInput(
        { name: file, type: mime, size: bytes.byteLength, bytes },
        { bypassCache: true, visionFallback: 'off' }
      );
      const m = computeCerAndWer(truth, out.extractedText);
      console.info(
        `[OCR Benchmark] REAL ${file}: CER=${(m.cer * 100).toFixed(2)}% WER=${(m.wer * 100).toFixed(2)}% ` +
          `(${m.refCharCount} reference chars, local OCR only)`
      );
      assert.ok(Number.isFinite(m.cer) && Number.isFinite(m.wer));
    }
  });
  test('8. Lost superscripts are flagged for review, never silently accepted or rewritten', () => {
    const flagged = detectMathUncertainty('1. Solve x2 + 3x - 4 = 0 and state the roots.');
    assert.equal(flagged.length, 1);
    assert.equal(flagged[0].text, 'x2');
    assert.match(flagged[0].reason, /superscript/i);
    assert.equal(detectMathUncertainty('CSC 304 first semester 2024/2025').length, 0, 'plain prose is not flagged');
    assert.equal(detectMathUncertainty('Q2 total = 40 marks').length, 0, 'capital + digit labels are not flagged');
  });

  test('9. Harder generated pages (rotation, blur + heavy JPEG, small font, tiny image) stay readable', async () => {
    const lines = [
      'CSC 304 OPERATING SYSTEMS FIRST SEMESTER 2024/2025',
      '1. Which scheduling algorithm can cause starvation?',
      'A. Round robin  B. Shortest job first  C. FCFS  D. Multilevel feedback',
      '2. Calculate the average waiting time for burst times 5, 8 and 12 milliseconds.',
    ];
    const truth = lines.join(' ');
    const base = await sharp(renderSvgTextPage(lines, 1500, 560, 30, 70)).png().toBuffer();
    const variants: Array<{ name: string; type: string; bytes: Buffer }> = [
      { name: 'rotated12.png', type: 'image/png', bytes: await sharp(base).rotate(12, { background: '#fff' }).png().toBuffer() },
      { name: 'blur_jpeg35.jpg', type: 'image/jpeg', bytes: await sharp(base).blur(1.6).jpeg({ quality: 35 }).toBuffer() },
      { name: 'tiny480.png', type: 'image/png', bytes: await sharp(base).resize({ width: 480 }).png().toBuffer() },
    ];
    for (const v of variants) {
      const out = await scanSingleAcademicInput(
        { name: v.name, type: v.type, size: v.bytes.byteLength, bytes: new Uint8Array(v.bytes) },
        { bypassCache: true, visionFallback: 'off' }
      );
      const m = computeCerAndWer(truth, out.extractedText);
      console.info(`[OCR Benchmark] ${v.name}: CER=${(m.cer * 100).toFixed(2)}% WER=${(m.wer * 100).toFixed(2)}%`);
      assert.ok(m.cer < 0.08, `${v.name}: expected CER < 8%, got ${m.cer}`);
    }
  });

  test('10. Raster PNG extracts simple 2-column table and isolated broken-stroke drawn geometric figure', async () => {
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1050">
        <rect width="1400" height="1050" fill="#ffffff"/>
        <text x="80" y="90" font-family="DejaVu Sans, Arial, sans-serif" font-size="30" font-weight="bold" fill="#111">PHY 101 MECHANICS TEST</text>

        <text x="80" y="160" font-family="DejaVu Sans, Arial, sans-serif" font-size="24" font-weight="bold" fill="#111">Quantity</text>
        <text x="520" y="160" font-family="DejaVu Sans, Arial, sans-serif" font-size="24" font-weight="bold" fill="#111">Unit</text>
        <text x="80" y="220" font-family="DejaVu Sans, Arial, sans-serif" font-size="24" fill="#111">Velocity</text>
        <text x="520" y="220" font-family="DejaVu Sans, Arial, sans-serif" font-size="24" fill="#111">m/s</text>
        <text x="80" y="280" font-family="DejaVu Sans, Arial, sans-serif" font-size="24" fill="#111">Force</text>
        <text x="520" y="280" font-family="DejaVu Sans, Arial, sans-serif" font-size="24" fill="#111">Newton</text>

        <text x="80" y="380" font-family="DejaVu Sans, Arial, sans-serif" font-size="24" fill="#111">1. Find the resultant angle in the triangle below:</text>
        <line x1="220" y1="800" x2="660" y2="800" stroke="#111" stroke-width="5" stroke-dasharray="18 2"/>
        <line x1="660" y1="800" x2="430" y2="480" stroke="#111" stroke-width="5" stroke-dasharray="16 2"/>
        <line x1="430" y1="480" x2="220" y2="800" stroke="#111" stroke-width="5" stroke-dasharray="18 2"/>
        <text x="195" y="832" font-family="DejaVu Sans, Arial, sans-serif" font-size="24" font-weight="bold" fill="#111">A</text>
        <text x="670" y="832" font-family="DejaVu Sans, Arial, sans-serif" font-size="24" font-weight="bold" fill="#111">B</text>
        <text x="422" y="460" font-family="DejaVu Sans, Arial, sans-serif" font-size="24" font-weight="bold" fill="#111">C</text>
      </svg>`
    );

    const pngBytes = new Uint8Array(await sharp(svg).png().toBuffer());
    const res = await scanSingleAcademicInput(
      { name: 'PHY101_table_and_shape.png', type: 'image/png', size: pngBytes.byteLength, bytes: pngBytes },
      { bypassCache: true, visionFallback: 'off' }
    );

    assert.ok(res.tables.length >= 1, `Expected at least 1 extracted 2-column table, got 0. Text:\n${res.extractedText}`);
    const tbl = res.tables[0];
    assert.equal(tbl.headers.length, 2, `Expected 2 columns, got ${tbl.headers.join(' | ')}`);
    assert.match(tbl.headers.join(' '), /Quantity/i);
    assert.match(tbl.rows.flat().join(' '), /Velocity/i);
    assert.match(tbl.rows.flat().join(' '), /Newton/i);

    const extractedFigures = res.diagrams.filter((d) => d.id.startsWith('fig-'));
    assert.ok(extractedFigures.length >= 1, 'Expected isolated drawn triangle crop (fig-1-...)');
    assert.equal(extractedFigures[0].kind, 'diagram');
    assert.ok(extractedFigures[0].dataUrl?.startsWith('data:image/png;base64,'));
  });

  test('11. Digital PDF extracts simple 2-column table and vector diagram polylines + vertex labels', async () => {
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    pdf.setFontSize(13);
    pdf.text('MTH 204 GEOMETRY AND VECTORS', 48, 60);

    // Simple borderless 2-column table
    pdf.text('Parameter', 60, 110);
    pdf.text('Value', 260, 110);
    pdf.text('Mass', 60, 134);
    pdf.text('14 kg', 260, 134);
    pdf.text('Length', 60, 158);
    pdf.text('8 m', 260, 158);

    pdf.text('1. Calculate the area of triangle PQR drawn below.', 48, 210);

    // Vector triangle + inner altitude line + vertex labels
    pdf.setLineWidth(1.5);
    pdf.triangle(120, 420, 320, 420, 210, 270, 'S');
    pdf.line(210, 270, 210, 420);
    pdf.text('P', 108, 434);
    pdf.text('Q', 326, 434);
    pdf.text('R', 206, 260);

    const pdfBytes = new Uint8Array(pdf.output('arraybuffer'));
    const res = await scanSingleAcademicInput(
      { name: 'MTH204_vector_and_table.pdf', type: 'application/pdf', size: pdfBytes.byteLength, bytes: pdfBytes },
      { bypassCache: true, visionFallback: 'off' }
    );

    assert.ok(res.tables.length >= 1, `Expected extracted 2-col PDF table. Text:\n${res.extractedText}`);
    assert.match(res.tables[0].headers.join(' '), /Parameter/i);
    assert.match(res.tables[0].rows.flat().join(' '), /14 kg/i);

    const vecFigs = res.diagrams.filter((d) => d.id.startsWith('vec-fig-'));
    assert.ok(vecFigs.length >= 1, 'Expected VectorDiagramScene extracted from PDF vector operators');
    const scene = vecFigs[0].vectorScene;
    assert.ok(scene && scene.polylines.length >= 2, 'Expected triangle + altitude polylines in vectorScene');
    const labelTexts = (scene?.labels ?? []).map((l) => l.text);
    assert.ok(
      labelTexts.some((t) => /^[PQR]$/.test(t)),
      `Expected vertex labels attached to vectorScene, got: ${JSON.stringify(labelTexts)}`
    );
  });

  test('12. End-to-end pipeline preserves paragraphs, headings, superscripts/subscripts, 3-page PDF order (logo+scan), and handwriting HTR', async () => {
    // 12a. Paragraphs, line breaks, and uppercase headings preserved via real PNG OCR
    const structuredPng = new Uint8Array(
      await sharp(
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="760">
            <rect width="1400" height="760" fill="#ffffff"/>
            <text x="80" y="95" font-family="DejaVu Sans, Arial, sans-serif" font-size="30" font-weight="bold" fill="#111">SECTION A: ALGORITHMS</text>
            <text x="80" y="180" font-family="DejaVu Sans, Arial, sans-serif" font-size="24" fill="#111">First line of question one explaining</text>
            <text x="80" y="220" font-family="DejaVu Sans, Arial, sans-serif" font-size="24" fill="#111">merge sort recurrence relations clearly.</text>
            <text x="80" y="340" font-family="DejaVu Sans, Arial, sans-serif" font-size="24" fill="#111">Second paragraph defining graph traversal</text>
            <text x="80" y="380" font-family="DejaVu Sans, Arial, sans-serif" font-size="24" fill="#111">using breadth first search queues.</text>
          </svg>`
        )
      )
        .png()
        .toBuffer()
    );
    const structOut = await scanSingleAcademicInput(
      { name: 'CSC301_structure.png', type: 'image/png', size: structuredPng.byteLength, bytes: structuredPng },
      { bypassCache: true, visionFallback: 'off' }
    );
    assert.ok(
      structOut.headings.some((h) => /SECTION A.*ALGORITHMS/i.test(h)),
      `Expected SECTION A heading preserved, got: ${JSON.stringify(structOut.headings)}`
    );
    assert.ok(structOut.extractedText.includes('\n\n'), 'Expected blank-line paragraph separation preserved');
    assert.ok(/merge sort recurrence/i.test(structOut.extractedText));
    assert.ok(/breadth first search/i.test(structOut.extractedText));

    // 12b. Multi-page 3-page PDF preserves exact page order and selects largest scanned image over small header logo
    const logoPng = await sharp(
      Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="90" height="90"><rect width="90" height="90" fill="#1d4ed8"/><text x="15" y="55" font-size="24" fill="#fff">LOGO</text></svg>`)
    ).png().toBuffer();
    const fullScanJpg = await sharp(
      renderSvgTextPage(['QUESTION TWO (25 MARKS)', 'Derive Einstein relation E = mc^2 and chemical stoichiometry for H2O.'], 1350, 680, 32, 88)
    ).jpeg({ quality: 92 }).toBuffer();

    const pdf3 = new jsPDF({ unit: 'pt', format: 'a4' });
    pdf3.text('PHY 301 MODERN PHYSICS AND CHEMISTRY - FIRST SEMESTER 2024/2025', 48, 70);
    pdf3.text('1. State Heisenberg uncertainty relation: dx * dp >= h / (4 * pi).', 48, 110);
    pdf3.addPage();
    // Embed small logo FIRST, then full scanned page SECOND
    pdf3.addImage(logoPng.toString('base64'), 'PNG', 40, 30, 50, 50);
    pdf3.addImage(fullScanJpg.toString('base64'), 'JPEG', 40, 100, 500, 260);
    pdf3.addPage();
    pdf3.text('SECTION C: Thermodynamics Summary and Reaction Equilibrium.', 48, 70);
    pdf3.text('$$E = mc^2$$ and subscript reaction $a_n = 2^n$ with kinetic term $K = (1/2) m v^2$.', 48, 110);

    const pdf3Bytes = new Uint8Array(pdf3.output('arraybuffer'));
    const pdf3Out = await scanSingleAcademicInput(
      { name: 'PHY301_3pages.pdf', type: 'application/pdf', size: pdf3Bytes.byteLength, bytes: pdf3Bytes },
      { bypassCache: true, visionFallback: 'off' }
    );
    assert.equal(pdf3Out.pageCount, 3);
    const p1Pos = pdf3Out.extractedText.indexOf('--- Page 1 ---');
    const p2Pos = pdf3Out.extractedText.indexOf('--- Page 2 ---');
    const p3Pos = pdf3Out.extractedText.indexOf('--- Page 3 ---');
    assert.ok(p1Pos !== -1 && p2Pos > p1Pos && p3Pos > p2Pos, 'Page markers must preserve strict 1 -> 2 -> 3 order');
    assert.ok(/Heisenberg uncertainty/i.test(pdf3Out.pages[0]?.text ?? ''), 'Page 1 native physics question preserved');
    assert.ok(/Einstein|uncertainty|QUESTION TWO/i.test(pdf3Out.pages[1]?.text ?? ''), 'Page 2 should OCR full scanned block, not only the 90x90 logo');
    assert.ok(/Thermodynamics Summary/i.test(pdf3Out.pages[2]?.text ?? ''), 'Page 3 thermodynamics section preserved');
    assert.ok(pdf3Out.formulas.some((f) => /mc\^?\{?2\}?/i.test(f.latex)), 'Superscript E=mc^2 preserved');
    assert.ok(pdf3Out.formulas.some((f) => /a_\{?n\}?/.test(f.latex)), 'Subscript a_n preserved');

    // 12c. Handwritten stroke crop through scanSingleAcademicInput (both default honest mode + custom HTR adapter)
    const hwPng = new Uint8Array(
      await sharp(
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="680" height="260">
            <rect width="680" height="260" fill="#ffffff"/>
            <path d="M55 120 C 75 75, 105 150, 130 98 S 175 135, 210 92 C 245 78, 270 140, 310 104" fill="none" stroke="#111" stroke-width="5"/>
            <path d="M330 112 C 355 70, 385 148, 415 95 S 455 140, 495 102" fill="none" stroke="#111" stroke-width="4"/>
          </svg>`
        )
      ).png().toBuffer()
    );
    const hwDefault = await scanSingleAcademicInput(
      { name: 'handwritten_ans.png', type: 'image/png', size: hwPng.byteLength, bytes: hwPng },
      { bypassCache: true, visionFallback: 'off' }
    );
    assert.equal(hwDefault.handwritingAnalysis?.detected, true);
    assert.equal(hwDefault.handwritingAnalysis?.engineStatus, 'model_unavailable_partial');

    const hwAdapted = await scanSingleAcademicInput(
      { name: 'handwritten_ans.png', type: 'image/png', size: hwPng.byteLength, bytes: hwPng },
      {
        bypassCache: true,
        visionFallback: 'off',
        handwritingAdapter: {
          name: 'VerifiedHTR',
          async recognizeRegion() {
            return {
              text: 'Momentum is conserved in elastic collisions.',
              confidence: 86,
              uncertainWords: [],
              unreadable: false,
            };
          },
        },
      }
    );
    assert.equal(hwAdapted.handwritingAnalysis?.detected, true);
    assert.equal(hwAdapted.handwritingAnalysis?.engineStatus, 'executed');
    assert.ok(hwAdapted.handwritingAnalysis?.regions.some((r) => /Momentum is conserved/.test(r.extractedText)));
  });
});

after(async () => {
  await shutdownOcrWorkerPool();
});
