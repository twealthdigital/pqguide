import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { after, beforeEach, describe } from 'node:test';
import JSZip from 'jszip';
import { jsPDF } from 'jspdf';
import sharp from 'sharp';
import type { AuthenticatedUser } from '../src/core/types.ts';
import { archiveRepository } from '../src/services/archiveRepository.ts';
import { scanSingleAcademicInput } from '../src/services/intelligence/documentScannerEngine.ts';
import { shutdownOcrWorkerPool } from '../src/services/intelligence/ocrEngine.ts';
import { rebuildPagesFromEditedText } from '../src/services/intelligence/layoutReconstructor.ts';
import { documentStorageAdapter } from '../src/services/intelligence/storageAdapter.ts';

function makeSchoolAdmin(): AuthenticatedUser {
  return {
    id: 'usr-sadmin-layout',
    fullName: 'Dr. Femi Ogunleye',
    email: 'exam-layout@aaua.edu.ng',
    role: 'school_admin',
    status: 'active',
    isEmailVerified: true,
    matricNumber: 'STAFF-AAUA-02',
    department: 'Physics',
    faculty: 'Science',
    level: '500L',
    assignedSchoolId: 'sch-aaua',
    assignedSchoolCode: 'AAUA',
    createdAt: '2026-01-10T10:00:00.000Z',
  };
}

function makeSuperAdmin(): AuthenticatedUser {
  return {
    id: 'usr-super-layout',
    fullName: 'Fortune Adeola',
    email: 'fortune-layout@pqguide.test',
    role: 'super_admin',
    status: 'active',
    isEmailVerified: true,
    matricNumber: 'PQG-SUPER-02',
    department: 'Platform Control',
    faculty: 'Central Governance',
    level: '500L',
    createdAt: '2026-01-10T10:00:00.000Z',
  };
}

describe('Exact layout-preserving document reconstruction & RBAC isolation', () => {
  beforeEach(() => {
    archiveRepository.resetAllForDev();
  });

  test('1. Real printed exam PNG sheet preserves reading order: heading -> paragraph -> Q1 -> inline Table -> Q2 -> Q3 (KaTeX math) -> Diagram + caption -> Q4', async () => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1750">
        <rect width="1400" height="1750" fill="#ffffff"/>
        <text x="700" y="95" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="36" font-weight="bold" fill="#111111">EXAMINATION QUESTIONS</text>
        <text x="90" y="170" font-family="DejaVu Sans, Arial, sans-serif" font-size="25" fill="#111111">Answer all questions clearly and show every calculation step in full.</text>
        <text x="90" y="215" font-family="DejaVu Sans, Arial, sans-serif" font-size="25" fill="#111111">Write neatly inside the space provided on your answer script.</text>

        <text x="90" y="310" font-family="DejaVu Sans, Arial, sans-serif" font-size="26" font-weight="bold" fill="#111111">1. Explain the relationship between force and acceleration.</text>

        <text x="90" y="385" font-family="DejaVu Sans, Arial, sans-serif" font-size="23" font-weight="bold" fill="#111111">Table 1: Physical Quantities and Units</text>
        <rect x="90" y="405" width="1180" height="210" fill="none" stroke="#111111" stroke-width="4"/>
        <line x1="90" y1="475" x2="1270" y2="475" stroke="#111111" stroke-width="3"/>
        <line x1="90" y1="545" x2="1270" y2="545" stroke="#111111" stroke-width="3"/>
        <line x1="510" y1="405" x2="510" y2="615" stroke="#111111" stroke-width="3"/>
        <line x1="880" y1="405" x2="880" y2="615" stroke="#111111" stroke-width="3"/>
        <text x="130" y="452" font-family="DejaVu Sans, Arial, sans-serif" font-size="24" font-weight="bold" fill="#111111">Quantity</text>
        <text x="550" y="452" font-family="DejaVu Sans, Arial, sans-serif" font-size="24" font-weight="bold" fill="#111111">Symbol</text>
        <text x="920" y="452" font-family="DejaVu Sans, Arial, sans-serif" font-size="24" font-weight="bold" fill="#111111">Unit</text>
        <text x="130" y="522" font-family="DejaVu Sans, Arial, sans-serif" font-size="23" fill="#111111">Force</text>
        <text x="550" y="522" font-family="DejaVu Sans, Arial, sans-serif" font-size="23" fill="#111111">F</text>
        <text x="920" y="522" font-family="DejaVu Sans, Arial, sans-serif" font-size="23" fill="#111111">Newton</text>
        <text x="130" y="592" font-family="DejaVu Sans, Arial, sans-serif" font-size="23" fill="#111111">Mass</text>
        <text x="550" y="592" font-family="DejaVu Sans, Arial, sans-serif" font-size="23" fill="#111111">m</text>
        <text x="920" y="592" font-family="DejaVu Sans, Arial, sans-serif" font-size="23" fill="#111111">Kilogram</text>

        <text x="90" y="705" font-family="DejaVu Sans, Arial, sans-serif" font-size="26" font-weight="bold" fill="#111111">2. Complete the table above using standard SI units.</text>

        <text x="90" y="805" font-family="DejaVu Sans, Arial, sans-serif" font-size="26" font-weight="bold" fill="#111111">3. Calculate the energy using E = mc^2 and acceleration a_n = 4 m/s^2.</text>

        <polygon points="240,1220 760,1220 760,930" fill="none" stroke="#111111" stroke-width="5"/>
        <rect x="460" y="995" width="95" height="65" fill="none" stroke="#111111" stroke-width="4" transform="rotate(-29 505 1030)"/>
        <line x1="510" y1="1030" x2="510" y2="1200" stroke="#111111" stroke-width="4"/>
        <text x="90" y="1295" font-family="DejaVu Sans, Arial, sans-serif" font-size="23" font-weight="bold" fill="#111111">Figure 1: Inclined plane force diagram</text>

        <text x="90" y="1410" font-family="DejaVu Sans, Arial, sans-serif" font-size="26" font-weight="bold" fill="#111111">4. Explain your answer in detail.</text>
      </svg>
    `;

    const pngBytes = new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
    const scan = await scanSingleAcademicInput(
      { name: 'PHY101_exam_sheet.png', type: 'image/png', size: pngBytes.byteLength, bytes: pngBytes },
      { bypassCache: true, visionFallback: 'off' }
    );

    assert.equal(scan.pages.length, 1);
    const page = scan.pages[0];
    const blocks = page.blocks ?? [];
    assert.ok(blocks.length >= 6, `Expected rich reconstructed blocks, got ${blocks.length}`);

    // Original upload preserved cleanly
    assert.ok(scan.originalFileRefKey, 'Original uploaded file ref must be retained');
    const storedOrig = await documentStorageAdapter.getBinary(scan.originalFileRefKey);
    assert.ok(storedOrig && storedOrig.bytes && storedOrig.bytes.byteLength === pngBytes.byteLength);
    assert.ok(scan.optimizedPreviewUrl, 'Preview image URL must be retained for side-by-side comparison');

    const hIdx = blocks.findIndex((b) => b.kind === 'heading' && /EXAMINATION QUESTIONS/i.test(b.text ?? ''));
    const pIdx = blocks.findIndex((b) => b.kind === 'paragraph' && /Answer all questions/i.test(b.text ?? ''));
    const q1Idx = blocks.findIndex((b) => b.kind === 'question' && /force and acceleration/i.test(b.text ?? ''));
    const tIdx = blocks.findIndex((b) => b.kind === 'table');
    const q2Idx = blocks.findIndex((b) => b.kind === 'question' && /Complete the table/i.test(b.text ?? ''));
    const q3Idx = blocks.findIndex((b) => b.kind === 'question' && /Calculate the energy/i.test(b.text ?? ''));
    const figIdx = blocks.findIndex((b) => b.kind === 'diagram');
    const q4Idx = blocks.findIndex((b) => b.kind === 'question' && /Explain your answer/i.test(b.text ?? ''));

    assert.ok(hIdx >= 0, `Heading block missing. Blocks: ${JSON.stringify(blocks.map((b) => ({ k: b.kind, t: b.text })))}`);
    assert.ok(pIdx > hIdx, 'Intro paragraph must come after heading');
    assert.ok(q1Idx > pIdx, 'Q1 must come after intro paragraph');
    assert.ok(tIdx > q1Idx && tIdx < q2Idx, `Table must sit strictly between Q1 (${q1Idx}) and Q2 (${q2Idx}), got table=${tIdx}`);
    assert.ok(q3Idx > q2Idx, 'Q3 must come after Q2');
    assert.ok(figIdx > q3Idx && figIdx < q4Idx, `Diagram must sit between Q3 (${q3Idx}) and Q4 (${q4Idx}), got fig=${figIdx}`);
    assert.ok(q4Idx > q3Idx, 'Q4 must appear at bottom');

    // Table content must not be duplicated into paragraphs
    const paraTexts = blocks
      .filter((b) => b.kind === 'paragraph' || b.kind === 'question' || b.kind === 'subquestion')
      .map((b) => b.text ?? '')
      .join('\n');
    assert.ok(!/\bKilogram\b/i.test(paraTexts), 'Table cell "Kilogram" must not leak as a standalone paragraph');
    assert.ok(!/\bNewton\b/i.test(paraTexts), 'Table cell "Newton" must not leak as a standalone paragraph');

    // Table structure preserved cleanly
    const tbl = blocks[tIdx].table!;
    assert.ok(tbl.headers.join(' ').match(/Quantity/i));
    assert.ok(tbl.rows.flat().join(' ').match(/Kilogram/i));
    assert.ok(tbl.caption && /Table 1/i.test(tbl.caption), `Expected Table 1 caption, got: ${tbl.caption}`);

    // Inline math preserved via KaTeX delimiter inside Q3
    assert.ok(
      blocks[q3Idx].text && blocks[q3Idx].text!.includes('$'),
      `Expected inline KaTeX math in Q3, got: ${blocks[q3Idx].text}`
    );

    // Authentic diagram caption
    assert.ok(
      /Figure 1.*Inclined plane/i.test(blocks[figIdx].diagram?.caption ?? ''),
      `Expected diagram caption from sheet, got: ${blocks[figIdx].diagram?.caption}`
    );
  });

  test('2. Real on-disk exam fixture images (JPG + skewed PNG) scan into ordered ReconstructedBlock[]', async () => {
    const jpgPath = path.resolve(process.cwd(), 'tests/fixtures/ocr/exam_clear_paragraphs.jpg');
    const pngPath = path.resolve(process.cwd(), 'tests/fixtures/ocr/exam_skewed_shadow.png');
    assert.ok(fs.existsSync(jpgPath), 'Expected exam_clear_paragraphs.jpg fixture');
    assert.ok(fs.existsSync(pngPath), 'Expected exam_skewed_shadow.png fixture');

    const jpgBytes = new Uint8Array(fs.readFileSync(jpgPath));
    const pngBytes = new Uint8Array(fs.readFileSync(pngPath));

    const [resJpg, resPng] = await Promise.all([
      scanSingleAcademicInput(
        { name: 'exam_clear_paragraphs.jpg', type: 'image/jpeg', size: jpgBytes.byteLength, bytes: jpgBytes },
        { bypassCache: true, visionFallback: 'off' }
      ),
      scanSingleAcademicInput(
        { name: 'exam_skewed_shadow.png', type: 'image/png', size: pngBytes.byteLength, bytes: pngBytes },
        { bypassCache: true, visionFallback: 'off' }
      ),
    ]);

    for (const [label, res] of [
      ['JPG', resJpg],
      ['PNG', resPng],
    ] as const) {
      assert.equal(res.pages.length, 1);
      const blocks = res.pages[0].blocks ?? [];
      assert.ok(blocks.length >= 3, `${label} fixture should reconstruct >= 3 ordered blocks`);
      assert.ok(
        blocks.some((b) => b.kind === 'heading'),
        `${label} fixture should preserve exam heading block`
      );
      assert.ok(
        blocks.some((b) => b.kind === 'question' || b.kind === 'paragraph'),
        `${label} fixture should preserve question/paragraph blocks`
      );
      assert.ok(res.originalFileRefKey, `${label} fixture must retain originalFileRefKey`);
      assert.ok(res.optimizedPreviewUrl, `${label} fixture must retain visual preview`);
    }
  });

  test('3. Multi-page PDF preserves exact block reading order, running headers/footers, table between questions, KaTeX math, and inline vector diagram', async () => {
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });

    // Page 1
    pdf.setFontSize(9);
    pdf.text('FACULTY OF SCIENCE - PHY 201', 210, 32);
    pdf.setFontSize(16);
    pdf.text('EXAMINATION QUESTIONS', 190, 72);
    pdf.setFontSize(11);
    pdf.text('Answer all questions in Section A clearly. Show units.', 48, 110);
    pdf.text('1. State Newton second law and define impulse.', 48, 155);

    // Inline table strictly between Q1 and Q2
    pdf.text('Trial', 65, 200);
    pdf.text('Time (s)', 210, 200);
    pdf.text('Velocity (m/s)', 360, 200);
    pdf.text('Run A', 65, 224);
    pdf.text('2.0', 210, 224);
    pdf.text('14.5', 360, 224);
    pdf.text('Run B', 65, 248);
    pdf.text('4.0', 210, 248);
    pdf.text('29.0', 360, 248);

    pdf.text('2. Calculate kinetic energy using K = (1/2)mv^2 and x_1 = 3^2.', 48, 310);
    pdf.setFontSize(9);
    pdf.text('Page 1 of 2', 265, 810);

    // Page 2
    pdf.addPage();
    pdf.setFontSize(9);
    pdf.text('FACULTY OF SCIENCE - PHY 201', 210, 32);
    pdf.setFontSize(11);
    pdf.text('3. Study right triangle PQR drawn below.', 48, 90);
    pdf.setLineWidth(1.5);
    pdf.triangle(120, 320, 340, 320, 220, 170, 'S');
    pdf.line(220, 170, 220, 320);
    pdf.text('P', 108, 334);
    pdf.text('Q', 346, 334);
    pdf.text('R', 216, 158);
    pdf.text('Figure 1: Right Triangle PQR', 135, 360);
    pdf.text('4. Explain your answer with a concise derivation.', 48, 430);
    pdf.setFontSize(9);
    pdf.text('Page 2 of 2', 265, 810);

    const pdfBytes = new Uint8Array(pdf.output('arraybuffer'));
    const out = await scanSingleAcademicInput(
      { name: 'PHY201_multipage.pdf', type: 'application/pdf', size: pdfBytes.byteLength, bytes: pdfBytes },
      { bypassCache: true, visionFallback: 'off' }
    );

    assert.equal(out.pageCount, 2);
    const p1 = out.pages[0];
    const p2 = out.pages[1];
    const b1 = p1.blocks ?? [];
    const b2 = p2.blocks ?? [];

    // Page 1 checks
    const p1Heading = b1.findIndex((b) => b.kind === 'heading' && /EXAMINATION QUESTIONS/i.test(b.text ?? ''));
    const p1Para = b1.findIndex((b) => b.kind === 'paragraph' && /Answer all questions/i.test(b.text ?? ''));
    const p1Q1 = b1.findIndex((b) => b.kind === 'question' && /Newton second law/i.test(b.text ?? ''));
    const p1Tbl = b1.findIndex((b) => b.kind === 'table');
    const p1Q2 = b1.findIndex((b) => b.kind === 'question' && /kinetic energy/i.test(b.text ?? ''));
    const p1Footer = b1.findIndex((b) => b.kind === 'footer' && /Page 1 of 2/i.test(b.text ?? ''));

    assert.ok(p1Heading >= 0 && p1Para > p1Heading && p1Q1 > p1Para);
    assert.ok(p1Tbl > p1Q1 && p1Tbl < p1Q2, `PDF Page 1 table must sit between Q1 and Q2 (got p1Q1=${p1Q1}, p1Tbl=${p1Tbl}, p1Q2=${p1Q2})`);
    assert.ok(b1[p1Q2].text?.includes('$'), `Expected KaTeX math inline in Page 1 Q2: ${b1[p1Q2].text}`);
    assert.ok(p1Footer > p1Q2, 'Page 1 footer must appear at end of Page 1');

    // Page 2 checks
    const p2Header = b2.findIndex((b) => b.kind === 'header' && /FACULTY OF SCIENCE/i.test(b.text ?? ''));
    const p2Q3 = b2.findIndex((b) => b.kind === 'question' && /right triangle/i.test(b.text ?? ''));
    const p2Diag = b2.findIndex((b) => b.kind === 'diagram');
    const p2Q4 = b2.findIndex((b) => b.kind === 'question' && /Explain your answer/i.test(b.text ?? ''));
    const p2Footer = b2.findIndex((b) => b.kind === 'footer' && /Page 2 of 2/i.test(b.text ?? ''));

    assert.ok(p2Header === 0, 'Repeated running header on Page 2 must be preserved at top of Page 2');
    assert.ok(p2Q3 > p2Header);
    assert.ok(p2Diag > p2Q3 && p2Diag < p2Q4, `PDF Page 2 vector diagram must sit between Q3 (${p2Q3}) and Q4 (${p2Q4}), got fig=${p2Diag}`);
    assert.ok(/Figure 1.*Triangle PQR/i.test(b2[p2Diag].diagram?.caption ?? ''), `Expected authentic vector caption, got: ${b2[p2Diag].diagram?.caption}`);
    assert.ok(p2Footer > p2Q4, 'Page 2 footer must appear at bottom of Page 2');
  });

  test('4. Two-column exam PDF reads full-width top -> left column -> right column -> full-width bottom', async () => {
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    pdf.setFontSize(14);
    pdf.text('DEPARTMENT OF COMPUTER SCIENCE TWO COLUMN TEST', 80, 56);
    pdf.setFontSize(10);
    // Left column (x ~ 48)
    pdf.text('1. Define stack data structure.', 48, 120);
    pdf.text('2. Explain queue overflow condition.', 48, 170);
    // Right column (x ~ 335)
    pdf.text('3. Define binary search tree.', 335, 120);
    pdf.text('4. Explain hash table collision.', 335, 170);
    // Full-width bottom instruction
    pdf.text('End of Section A - Proceed to Section B on the next sheet.', 120, 250);

    const pdfBytes = new Uint8Array(pdf.output('arraybuffer'));
    const out = await scanSingleAcademicInput(
      { name: 'CSC201_twocol.pdf', type: 'application/pdf', size: pdfBytes.byteLength, bytes: pdfBytes },
      { bypassCache: true, visionFallback: 'off' }
    );

    const blocks = out.pages[0].blocks ?? [];
    const qIndices = [1, 2, 3, 4].map((num) =>
      blocks.findIndex((b) => b.kind === 'question' && (b.label ?? '').startsWith(String(num)))
    );
    assert.ok(
      qIndices.every((idx) => idx >= 0),
      `Expected all 4 two-column questions reconstructed cleanly, got indices ${JSON.stringify(qIndices)}`
    );
    assert.ok(
      qIndices[0] < qIndices[1] && qIndices[1] < qIndices[2] && qIndices[2] < qIndices[3],
      `2-column reading order must be Q1 -> Q2 -> Q3 -> Q4, got ${JSON.stringify(qIndices)}`
    );
    const endIdx = blocks.findIndex((b) => /End of Section A/i.test(b.text ?? ''));
    assert.ok(endIdx > qIndices[3], 'Full-width footer paragraph must come after Q4');
  });

  test('5. DOCX preserves DOM reading order (Paragraph -> Merged Table -> Question -> Embedded Diagram -> Closing Paragraph) without duplicating cell paragraphs', async () => {
    const zip = new JSZip();
    const imgPng = await sharp({
      create: { width: 120, height: 80, channels: 3, background: { r: 220, g: 230, b: 245 } },
    })
      .png()
      .toBuffer();

    zip.file(
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>'
    );
    zip.file(
      'word/_rels/document.xml.rels',
      `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/circuit.png"/>
      </Relationships>`
    );
    zip.file(
      'word/document.xml',
      `<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
        <w:body>
          <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>EEE 301 CIRCUIT THEORY</w:t></w:r></w:p>
          <w:p><w:r><w:t>Read the component schedule carefully before answering Question 1.</w:t></w:r></w:p>
          <w:tbl>
            <w:tr>
              <w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>Component Schedule</w:t></w:r></w:p></w:tc>
            </w:tr>
            <w:tr>
              <w:tc><w:p><w:r><w:t>Resistor R1</w:t></w:r></w:p></w:tc>
              <w:tc><w:p><w:r><w:t>120 Ohms</w:t></w:r></w:p></w:tc>
            </w:tr>
          </w:tbl>
          <w:p><w:r><w:t>1. Using the schedule above, determine total current when V = 24V.</w:t></w:r></w:p>
          <w:p><w:drawing><a:blip r:embed="rId1"/></w:drawing></w:p>
          <w:p><w:r><w:t>Closing note: Round all currents to two decimal places.</w:t></w:r></w:p>
        </w:body>
      </w:document>`
    );
    zip.file('word/media/circuit.png', new Uint8Array(imgPng));

    const docxBytes = await zip.generateAsync({ type: 'uint8array' });
    const out = await scanSingleAcademicInput(
      { name: 'EEE301_guide.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: docxBytes.byteLength, bytes: docxBytes },
      { bypassCache: true, visionFallback: 'off' }
    );

    const blocks = out.pages[0].blocks ?? [];
    const kinds = blocks.map((b) => b.kind);
    const hIdx = kinds.indexOf('heading');
    const p1Idx = blocks.findIndex((b) => b.kind === 'paragraph' && /component schedule carefully/i.test(b.text ?? ''));
    const tblIdx = kinds.indexOf('table');
    const q1Idx = blocks.findIndex((b) => b.kind === 'question' && /determine total current/i.test(b.text ?? ''));
    const figIdx = kinds.indexOf('diagram');
    const p2Idx = blocks.findIndex((b) => b.kind === 'paragraph' && /Round all currents/i.test(b.text ?? ''));

    assert.ok(hIdx >= 0 && p1Idx > hIdx && tblIdx > p1Idx && q1Idx > tblIdx && figIdx > q1Idx && p2Idx > figIdx, `Strict DOCX DOM sequence failed: ${JSON.stringify(kinds)}`);
    assert.equal(blocks[tblIdx].table?.hasMergedCells, true, 'Merged header cell must preserve hasMergedCells=true');
    assert.ok(
      !blocks.some((b) => b.kind === 'paragraph' && /120 Ohms/i.test(b.text ?? '')),
      'DOCX table cell text must NOT duplicate as standalone paragraph block'
    );
  });

  test('6. Publish workflow attaches sanitized reconstructedPages to student catalog with zero admin diagnostics and supports live text edits', async () => {
    const sadmin = makeSchoolAdmin();
    const superAdmin = makeSuperAdmin();

    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    pdf.setFontSize(14);
    pdf.text('CHM 202 PHYSICAL CHEMISTRY EXAMINATION', 90, 60);
    pdf.setFontSize(11);
    pdf.text('1. State the first law of thermodynamics.', 48, 105);
    pdf.text('Substance', 65, 145);
    pdf.text('Enthalpy (kJ/mol)', 240, 145);
    pdf.text('Water', 65, 168);
    pdf.text('-285.8', 240, 168);
    pdf.text('2. Compute dH for combustion of C2H5OH.', 48, 220);

    const bytes = new Uint8Array(pdf.output('arraybuffer'));
    const scanned = await scanSingleAcademicInput(
      { name: 'CHM202_exam.pdf', type: 'application/pdf', size: bytes.byteLength, bytes },
      { bypassCache: true, visionFallback: 'off' }
    );

    const submitted = archiveRepository.submitScannedDocument(sadmin, {
      title: 'CHM 202 Physical Chemistry 2024/2025',
      courseCode: 'CHM 202',
      courseTitle: 'Physical Chemistry',
      department: 'Chemistry',
      faculty: 'Science',
      level: '200L',
      session: '2024/2025',
      semester: 'First Semester',
      category: 'past_question',
      originalFileName: 'CHM202_exam.pdf',
      mimeType: 'application/pdf',
      detectedFormat: 'pdf',
      fileSizeBytes: bytes.byteLength,
      sha256: scanned.sha256,
      originalFileRef: scanned.originalStorageRef ?? {
        adapter: 'memory',
        key: scanned.originalFileRefKey ?? 'orig-chm202',
        sizeBytes: bytes.byteLength,
        mimeType: 'application/pdf',
        storedAt: new Date().toISOString(),
      },
      optimizedPreviewUrl: scanned.optimizedPreviewUrl,
      pageCount: scanned.pageCount,
      extractedText: scanned.extractedText,
      summary: scanned.summary,
      headings: scanned.headings,
      pages: scanned.pages,
      diagrams: scanned.diagrams,
      tables: scanned.tables,
      formulas: scanned.formulas,
      qrCodesFound: scanned.qrCodesFound,
      averageOcrConfidence: scanned.averageOcrConfidence,
      extractionQualityStatus: scanned.extractionQualityStatus,
      processedPages: scanned.processedPages,
      unprocessedPages: scanned.unprocessedPages,
      extractionWarnings: scanned.extractionWarnings,
      deterministicChecks: [],
      decision: 'auto_approved',
      riskLevel: 'low',
    });

    archiveRepository.reviewSubmittedDocument(superAdmin, submitted.id, 'approve', {
      publish: { destination: 'past_question', notify: 'none' },
    });

    const studentDoc = archiveRepository
      .getSnapshot()
      .documents.find((d) => d.id === `pqdoc-${submitted.id}`);
    assert.ok(studentDoc, 'Published PastQuestionDoc must exist in student catalog');
    assert.ok(studentDoc.reconstructedPages && studentDoc.reconstructedPages.length === 1);

    const studentPage = studentDoc.reconstructedPages[0];
    const studentBlocks = studentPage.blocks ?? [];
    const q1 = studentBlocks.findIndex((b) => b.kind === 'question' && /first law/i.test(b.text ?? ''));
    const tbl = studentBlocks.findIndex((b) => b.kind === 'table');
    const q2 = studentBlocks.findIndex((b) => b.kind === 'question' && /Compute dH/i.test(b.text ?? ''));
    assert.ok(q1 >= 0 && tbl > q1 && q2 > tbl, 'Student document must render table inline between Q1 and Q2');

    // RBAC isolation check: zero technical/scanner diagnostics leaked to student-facing page
    assert.equal(studentPage.ocrConfidence, null);
    assert.equal(studentPage.ocrApplied, false);
    assert.equal(studentPage.ocrEngineUsed, undefined);
    assert.equal(studentPage.uncertainSpans, undefined);
    assert.equal(studentPage.qualityMetrics, undefined);
    assert.equal(studentPage.preprocessingApplied, undefined);
    assert.deepEqual(studentPage.warnings, []);
    assert.ok(studentBlocks.every((b) => b.kind !== 'uncertain' && !b.uncertainReason));

    // Edit extracted text as Super Admin and confirm blocks rebuild live
    const editedDoc = archiveRepository.updateAcademicDocumentDetails(superAdmin, submitted.id, {
      extractedText: 'CHM 202 REVISED PAPER\n\n1. State Hess Law cleanly.\n\n| Ion | Charge |\n| --- | --- |\n| Na+ | +1 |\n\n2. Define entropy.',
    });
    const rebuiltStudentDoc = archiveRepository
      .getSnapshot()
      .documents.find((d) => d.id === `pqdoc-${submitted.id}`);
    const rebuiltBlocks = rebuiltStudentDoc?.reconstructedPages?.[0]?.blocks ?? [];
    assert.ok(rebuiltBlocks.some((b) => b.kind === 'question' && /Hess Law/i.test(b.text ?? '')));
    assert.ok(rebuiltBlocks.some((b) => b.kind === 'table' && b.table?.headers.includes('Ion')));
    assert.equal(editedDoc.pages.length, 1);

    // Multi-page rebuildPagesFromEditedText direct verification
    const multiRebuilt = rebuildPagesFromEditedText(
      [
        { pageNumber: 1, text: 'old 1', wordCount: 2, ocrApplied: false, ocrConfidence: null, diagrams: [], tables: [], formulas: [], warnings: [] },
        { pageNumber: 2, text: 'old 2', wordCount: 2, ocrApplied: false, ocrConfidence: null, diagrams: [], tables: [], formulas: [], warnings: [] },
      ],
      '--- Page 1 ---\n# PAPER ONE\n1. First question.\n--- Page 2 ---\n2. Second question.'
    );
    assert.equal(multiRebuilt.length, 2);
    assert.ok(multiRebuilt[0].blocks?.some((b) => b.kind === 'heading' && /PAPER ONE/.test(b.text ?? '')));
    assert.ok(multiRebuilt[1].blocks?.some((b) => b.kind === 'question' && /Second question/.test(b.text ?? '')));
  });
});

after(async () => {
  await shutdownOcrWorkerPool();
});
