import assert from 'node:assert/strict';
import test, { after, beforeEach, describe } from 'node:test';
import JSZip from 'jszip';
import { jsPDF } from 'jspdf';
import sharp from 'sharp';
import { createDocumentEngine } from '../server/documentService.ts';
import type { AuthenticatedUser } from '../src/core/types.ts';
import { archiveRepository } from '../src/services/archiveRepository.ts';
import { validateMagicAndSecurity } from '../src/services/intelligence/fileSecurity.ts';
import {
  extractFormulasFromText,
  extractTablesFromText,
} from '../src/services/intelligence/structuredParser.ts';
import {
  inspectAndExtractZipEntries,
  scanSingleAcademicInput,
} from '../src/services/intelligence/documentScannerEngine.ts';
import {
  computePipelineDecision,
  runDeterministicChecks,
  validateScannedDocument,
} from '../src/services/intelligence/validationEngine.ts';

function makeStudent(id = 'usr-student-1', fullName = 'Tolu Adeyemi'): AuthenticatedUser {
  return {
    id,
    fullName,
    email: `${id}@pqguide.test`,
    role: 'student',
    status: 'active',
    isEmailVerified: true,
    matricNumber: '220102099',
    department: 'Computer Science',
    faculty: 'Science',
    level: '200L',
    createdAt: '2026-01-10T10:00:00.000Z',
  };
}

function makeSchoolAdmin(): AuthenticatedUser {
  return {
    id: 'usr-sadmin-1',
    fullName: 'Dr. Femi Ogunleye',
    email: 'exam@aaua.edu.ng',
    role: 'school_admin',
    status: 'active',
    isEmailVerified: true,
    matricNumber: 'STAFF-AAUA-01',
    department: 'Exams Office',
    faculty: 'Senate',
    level: '500L',
    assignedSchoolId: 'sch-aaua',
    assignedSchoolCode: 'AAUA',
    createdAt: '2026-01-10T10:00:00.000Z',
  };
}

function makeSuperAdmin(): AuthenticatedUser {
  return {
    id: 'usr-super-1',
    fullName: 'Fortune Adeola',
    email: 'fortune@pqguide.test',
    role: 'super_admin',
    status: 'active',
    isEmailVerified: true,
    matricNumber: 'PQG-SUPER-01',
    department: 'Platform Control',
    faculty: 'Central Governance',
    level: '500L',
    createdAt: '2026-01-10T10:00:00.000Z',
  };
}

function buildValidPdfBytes(linesByPage: string[][]): Uint8Array {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  linesByPage.forEach((lines, idx) => {
    if (idx > 0) doc.addPage();
    let y = 60;
    for (const line of lines) {
      doc.text(line, 48, y);
      y += 22;
    }
  });
  const ab = doc.output('arraybuffer');
  return new Uint8Array(ab);
}

async function buildPngBytes(width = 160, height = 90): Promise<Uint8Array> {
  const buf = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 245, g: 247, b: 250 },
    },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buf);
}

async function buildDocxBytes(options?: { includeMacros?: boolean }): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>'
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
      <w:body>
        <w:p>
          <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
          <w:r><w:t>PHY 201 Classical Mechanics Past Questions</w:t></w:r>
        </w:p>
        <w:p>
          <w:r><w:t>2023/2024 First Semester Examination Paper for 200L Physics students.</w:t></w:r>
        </w:p>
        <w:p>
          <m:oMath><m:t>E=mc^2</m:t></m:oMath>
        </w:p>
        <w:tbl>
          <w:tr><w:tc><w:p><w:r><w:t>Quantity</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>SI Unit</w:t></w:r></w:p></w:tc></w:tr>
          <w:tr><w:tc><w:p><w:r><w:t>Force</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Newton (N)</w:t></w:r></w:p></w:tc></w:tr>
        </w:tbl>
      </w:body>
    </w:document>`
  );
  const pngBytes = await buildPngBytes(80, 60);
  zip.file('word/media/diagram1.png', pngBytes);
  if (options?.includeMacros) {
    zip.file('word/vbaProject.bin', new Uint8Array([0x01, 0x02, 0x03, 0x04]));
  }
  const buf = await zip.generateAsync({ type: 'uint8array' });
  return buf;
}

describe('Document Intelligence, Security, Verification & Academic AI Suite', () => {
  beforeEach(() => {
    archiveRepository.resetAllForDev();
  });

  test('1. Scans valid multi-page text PDF and extracts course metadata & structured content', async () => {
    const pdfBytes = buildValidPdfBytes([
      [
        'ADEKUNLE AJASIN UNIVERSITY, AKUNGBA-AKOKO',
        'CSC 201 DATA STRUCTURES AND ALGORITHMS',
        '2023/2024 First Semester Examination',
        'Question 1: Derive Big-O complexity of binary search on sorted arrays.',
      ],
      [
        'Section B: Graph Traversal',
        'Question 2: Compare BFS and DFS space complexity.',
        '$$T(n) = T(n/2) + O(1)$$',
      ],
    ]);

    const artifact = await scanSingleAcademicInput(
      {
        name: 'csc201_2024_exam.pdf',
        type: 'application/pdf',
        size: pdfBytes.byteLength,
        bytes: pdfBytes,
      },
      { bypassCache: true }
    );

    assert.equal(artifact.detectedFormat, 'pdf');
    assert.equal(artifact.pageCount, 2);
    assert.equal(artifact.sha256.length, 64);
    assert.equal(artifact.courseCode, 'CSC 201');
    assert.equal(artifact.level, '200L');
    assert.equal(artifact.session, '2023/2024');
    assert.equal(artifact.semester, 'First Semester');
    assert.ok(artifact.formulas.length >= 1, 'Expected LaTeX formula extraction from PDF');
    assert.ok(artifact.extractedText.includes('binary search'));
  });

  test('2. OCR path handles high-confidence auto-approve vs low-confidence flagged decision', async () => {
    const pngBytes = await buildPngBytes();

    const crispArtifact = await scanSingleAcademicInput(
      {
        name: 'mth101_crisp_scan.png',
        type: 'image/png',
        size: pngBytes.byteLength,
        bytes: pngBytes,
      },
      {
        bypassCache: true,
        ocrRunner: async () => ({
          text: [
            '# MTH 101 Elementary Mathematics I',
            '2023/2024 First Semester Past Question',
            '1. Solve the quadratic equation x^2 - 5x + 6 = 0.',
            '$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$',
          ].join('\n'),
          confidence: 91,
        }),
      }
    );

    assert.equal(crispArtifact.averageOcrConfidence, 91);
    const crispOutcome = await validateScannedDocument({
      artifact: crispArtifact,
      duplicateLookup: { isDuplicate: false },
    });
    assert.equal(crispOutcome.decision, 'auto_approved');
    assert.equal(crispOutcome.publicationStatus, 'published');

    const blurryArtifact = await scanSingleAcademicInput(
      {
        name: 'mth101_blurry_scan.png',
        type: 'image/png',
        size: pngBytes.byteLength,
        bytes: pngBytes,
      },
      {
        bypassCache: true,
        ocrRunner: async () => ({
          text: 'MTH 101 Exam partial illegible text with missing lines across problem statement.',
          confidence: 42,
        }),
      }
    );

    assert.equal(blurryArtifact.averageOcrConfidence, 42);
    const blurryOutcome = await validateScannedDocument({
      artifact: blurryArtifact,
      duplicateLookup: { isDuplicate: false },
    });
    assert.equal(blurryOutcome.decision, 'flagged');
    assert.equal(blurryOutcome.publicationStatus, 'flagged');
    assert.ok(
      blurryOutcome.deterministicChecks.some((c) => c.id === 'chk-ocr-confidence' && !c.passed)
    );
  });

  test('3. Parses DOCX paragraphs, headings, <m:oMath> formulas, <w:tbl> tables, and word/media diagrams', async () => {
    const docxBytes = await buildDocxBytes();
    const artifact = await scanSingleAcademicInput(
      {
        name: 'phy201_notes.docx',
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: docxBytes.byteLength,
        bytes: docxBytes,
      },
      { bypassCache: true }
    );

    assert.equal(artifact.detectedFormat, 'docx');
    assert.ok(artifact.headings.some((h) => h.includes('PHY 201')));
    assert.ok(artifact.formulas.some((f) => f.latex.includes('E=mc^2')));
    assert.equal(artifact.tables.length, 1);
    assert.deepEqual(artifact.tables[0]?.headers, ['Quantity', 'SI Unit']);
    assert.equal(artifact.diagrams.length, 1);
    assert.ok(artifact.diagrams[0]?.dataUrl?.startsWith('data:image/png;base64,'));
  });

  test('4. Rejects DOCX embedded VBA macros (vbaProject.bin) during deterministic security screening', async () => {
    const macroDocx = await buildDocxBytes({ includeMacros: true });
    const artifact = await scanSingleAcademicInput(
      {
        name: 'macro_trap.docx',
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: macroDocx.byteLength,
        bytes: macroDocx,
      },
      { bypassCache: true }
    );

    const checks = runDeterministicChecks({
      artifact,
      duplicateLookup: { isDuplicate: false },
    });
    assert.ok(checks.some((c) => c.id === 'chk-docx-macro' && !c.passed && c.severity === 'blocker'));
    const decision = computePipelineDecision({
      deterministicChecks: checks,
      aiFindings: {
        riskLevel: 'low',
        reason: 'test',
        evidence: [],
        confidence: 0.9,
        recommendedAction: 'auto_approve',
        providerAvailable: false,
        checkedAt: new Date().toISOString(),
      },
    });
    assert.equal(decision.decision, 'rejected');
    assert.equal(decision.publicationStatus, 'rejected');
  });

  test('5. Security checks reject magic-byte spoofing, PDF /JavaScript, and blocked file types', async () => {
    const pngBytes = await buildPngBytes();

    const spoofedPdf = validateMagicAndSecurity({
      fileName: 'notes.pdf',
      mimeType: 'application/pdf',
      bytes: pngBytes,
    });
    assert.equal(spoofedPdf.valid, false);
    assert.ok(spoofedPdf.securityFlags.includes('magic_mismatch_pdf'));

    const svgRes = validateMagicAndSecurity({
      fileName: 'diagram.svg',
      mimeType: 'image/svg+xml',
      bytes: new TextEncoder().encode('<svg onload="alert(1)"></svg>'),
    });
    assert.equal(svgRes.valid, false);
    assert.ok(svgRes.securityFlags.includes('blocked_extension'));

    const jsRes = validateMagicAndSecurity({
      fileName: 'payload.js',
      mimeType: 'application/javascript',
      bytes: new TextEncoder().encode('console.log(1);'),
    });
    assert.equal(jsRes.valid, false);

    const exeRes = validateMagicAndSecurity({
      fileName: 'fake.txt',
      mimeType: 'text/plain',
      bytes: new Uint8Array([0x4d, 0x5a, 0x90, 0x00]),
    });
    assert.equal(exeRes.valid, false);
    assert.ok(exeRes.securityFlags.includes('executable_signature'));

    const scriptPdfBytes = new TextEncoder().encode('%PDF-1.4\n1 0 obj << /JavaScript (app.alert(1)) >> endobj');
    const flaggedPdf = validateMagicAndSecurity({
      fileName: 'scripted.pdf',
      mimeType: 'application/pdf',
      bytes: scriptPdfBytes,
    });
    assert.equal(flaggedPdf.valid, true);
    assert.ok(flaggedPdf.securityFlags.includes('pdf_active_script_action'));
  });

  test('6. ZIP extraction unpacks safe multi-files and blocks traversal, zip-bombs, nested ZIPs, and blocked files', async () => {
    const safeZip = new JSZip();
    safeZip.file('bio101_summary.md', '# BIO 101 Cell Biology\nMitochondria generates ATP.');
    safeZip.file('folder/chem101.txt', 'CHEM 101 Stoichiometry practice questions and answers.');
    const safeBytes = await safeZip.generateAsync({ type: 'uint8array' });
    const extracted = await inspectAndExtractZipEntries(safeBytes, 'study_pack.zip');
    assert.equal(extracted.length, 2);
    assert.equal(extracted[0].parentZipName, 'study_pack.zip');

    // Path traversal test: craft genuine binary ZIP headers containing "../../etc/passwd.txt"
    const { isSafeZipEntryPath } = await import('../src/services/intelligence/fileSecurity.ts');
    assert.equal(isSafeZipEntryPath('../../etc/passwd.txt').safe, false);
    assert.equal(isSafeZipEntryPath('..\\evil.txt').safe, false);
    const traversalZip = new JSZip();
    traversalZip.file('aa/bb/etc/passwd.txt', 'bad path');
    const rawZipStrBytes = await traversalZip.generateAsync({ type: 'uint8array' });
    const rawStr = Buffer.from(rawZipStrBytes);
    let offset = rawStr.indexOf('aa/bb/etc/passwd.txt');
    while (offset !== -1) {
      rawStr.write('../../etc/passwd.txt', offset, 'utf8');
      offset = rawStr.indexOf('aa/bb/etc/passwd.txt', offset + 1);
    }
    await assert.rejects(
      () => inspectAndExtractZipEntries(new Uint8Array(rawStr), 'traversal.zip'),
      /traversal/i
    );

    // Blocked extension inside ZIP test
    const badFileZip = new JSZip();
    badFileZip.file('notes.html', '<script>alert(1)</script>');
    const badFileBytes = await badFileZip.generateAsync({ type: 'uint8array' });
    await assert.rejects(
      () => inspectAndExtractZipEntries(badFileBytes, 'bad_file.zip'),
      /Blocked unsafe file/i
    );

    // Zip-bomb high compression ratio test
    const bombZip = new JSZip();
    bombZip.file('huge_blank.txt', 'A'.repeat(320_000));
    const bombBytes = await bombZip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    });
    await assert.rejects(
      () => inspectAndExtractZipEntries(bombBytes, 'bomb.zip'),
      /compression ratio/i
    );

    // Nested ZIP test
    const nestedZip = new JSZip();
    nestedZip.file('inner.zip', safeBytes);
    const nestedBytes = await nestedZip.generateAsync({ type: 'uint8array' });
    await assert.rejects(
      () => inspectAndExtractZipEntries(nestedBytes, 'nested.zip'),
      /Nested ZIP/i
    );
  });

  test('7. Extracts LaTeX formulas and Markdown tables cleanly', () => {
    const sample = [
      'Thermodynamics Summary',
      '| Law | Statement | Variable |',
      '| --- | --- | --- |',
      '| First | Conservation of energy | dU = dQ - dW |',
      'Equation: $$PV = nRT$$ and $E = h\\nu$',
    ].join('\n');

    const tables = extractTablesFromText(sample, 2);
    assert.equal(tables.length, 1);
    assert.deepEqual(tables[0].headers, ['Law', 'Statement', 'Variable']);
    assert.equal(tables[0].pageNumber, 2);

    const formulas = extractFormulasFromText(sample, 2);
    assert.ok(formulas.some((f) => f.latex === 'PV = nRT' && f.displayMode));
    assert.ok(formulas.some((f) => f.latex.includes('h\\nu') && !f.displayMode));
  });

  test('8. Official transcripts and certificates are never auto-approved; always flagged for Super Admin', async () => {
    const content = [
      'OFFICIAL TRANSCRIPT OF ACADEMIC RECORD',
      'Statement of Result certified with Registrar Signature',
      'CSC 201 Data Structures Grade: A',
    ].join('\n');
    const bytes = new TextEncoder().encode(content);
    const artifact = await scanSingleAcademicInput(
      { name: 'transcript.txt', type: 'text/plain', size: bytes.byteLength, bytes },
      { bypassCache: true }
    );
    const outcome = await validateScannedDocument({
      artifact,
      duplicateLookup: { isDuplicate: false },
    });

    assert.equal(outcome.aiFindings.isOfficialCredentialSuspected, true);
    assert.equal(outcome.decision, 'flagged');
    assert.equal(outcome.publicationStatus, 'flagged');
  });

  test('9. Duplicate SHA-256 detection, Library visibility isolation, Super Admin review workflow & RBAC enforcement', async () => {
    const studentA = makeStudent('usr-stu-a', 'Amina Bello');
    const studentB = makeStudent('usr-stu-b', 'Chinedu Okafor');
    const schoolAdmin = makeSchoolAdmin();
    const superAdmin = makeSuperAdmin();

    const noteText =
      'CSC 301 Operating Systems Process Scheduling Notes\nRound Robin and Shortest Job Next analysis.';
    const bytes = new TextEncoder().encode(noteText);
    const artifact = await scanSingleAcademicInput(
      { name: 'csc301_notes.txt', type: 'text/plain', size: bytes.byteLength, bytes },
      { bypassCache: true }
    );

    const outcome1 = await validateScannedDocument({
      artifact,
      duplicateLookup: (() => {
        const existing = archiveRepository.findDocumentBySha256(artifact.sha256);
        return existing
          ? { isDuplicate: true, existingDocId: existing.id, existingTitle: existing.title }
          : { isDuplicate: false };
      })(),
    });
    assert.equal(outcome1.publicationStatus, 'published');

    const doc1 = archiveRepository.submitScannedDocument(schoolAdmin, {
      schoolId: 'sch-aaua',
      title: 'CSC 301 Process Scheduling',
      courseCode: 'CSC 301',
      courseTitle: 'Operating Systems',
      level: '300L',
      session: '2024/2025',
      semester: 'First Semester',
      category: 'lecture_note',
      originalFileName: artifact.fileName,
      mimeType: artifact.mimeType,
      detectedFormat: artifact.detectedFormat,
      fileSizeBytes: artifact.fileSizeBytes,
      sha256: artifact.sha256,
      pageCount: artifact.pageCount,
      extractedText: artifact.extractedText,
      summary: artifact.summary,
      headings: artifact.headings,
      pages: artifact.pages,
      diagrams: artifact.diagrams,
      tables: artifact.tables,
      formulas: artifact.formulas,
      qrCodesFound: artifact.qrCodesFound,
      averageOcrConfidence: artifact.averageOcrConfidence,
      deterministicChecks: outcome1.deterministicChecks,
      aiFindings: outcome1.aiFindings,
      decision: outcome1.decision,
      riskLevel: outcome1.riskLevel,
      decisionReason: outcome1.decisionReason,
    });

    // Students cannot scan; even clean scans wait for Super Admin verification.
    assert.throws(
      () =>
        archiveRepository.submitScannedDocument(studentA, {
          ...({} as Parameters<typeof archiveRepository.submitScannedDocument>[1]),
        }),
      /School Admin or Super Admin/i
    );
    assert.equal(doc1.publicationStatus, 'pending_review');
    assert.equal(
      archiveRepository.getPublishedLibraryDocuments().some((d) => d.id === doc1.id),
      false
    );
    const verifiedDoc1 = archiveRepository.reviewSubmittedDocument(superAdmin, doc1.id, 'approve');
    assert.equal(verifiedDoc1.publicationStatus, 'published');
    assert.ok(archiveRepository.getPublishedLibraryDocuments().some((d) => d.id === doc1.id));

    // Re-uploading the identical file hits SHA-256 duplicate check and is flagged/rejected out of Library
    const existingDup = archiveRepository.findDocumentBySha256(artifact.sha256);
    assert.ok(existingDup);
    assert.equal(existingDup.id, doc1.id);

    const outcomeDup = await validateScannedDocument({
      artifact,
      duplicateLookup: {
        isDuplicate: true,
        existingDocId: existingDup.id,
        existingTitle: existingDup.title,
      },
    });
    assert.notEqual(outcomeDup.publicationStatus, 'published');

    // Submit a flagged document by Student A -> hidden from Student B, visible to Student A & Super Admin
    const pngBytes = await buildPngBytes();
    const flaggedArtifact = await scanSingleAcademicInput(
      { name: 'flagged_lab.png', type: 'image/png', size: pngBytes.byteLength, bytes: pngBytes },
      {
        bypassCache: true,
        ocrRunner: async () => ({
          text: 'Partial scan unreadable lab graph line.',
          confidence: 45,
        }),
      }
    );
    const flaggedOutcome = await validateScannedDocument({
      artifact: flaggedArtifact,
      duplicateLookup: { isDuplicate: false },
    });
    assert.equal(flaggedOutcome.publicationStatus, 'flagged');

    const flaggedDoc = archiveRepository.submitScannedDocument(schoolAdmin, {
      schoolId: 'sch-aaua',
      title: 'Blurry Biology Lab Chart',
      courseCode: 'BIO 201',
      courseTitle: 'Cell Biology',
      level: '200L',
      session: '2024/2025',
      semester: 'First Semester',
      category: 'lab_diagram',
      originalFileName: flaggedArtifact.fileName,
      mimeType: flaggedArtifact.mimeType,
      detectedFormat: flaggedArtifact.detectedFormat,
      fileSizeBytes: flaggedArtifact.fileSizeBytes,
      sha256: flaggedArtifact.sha256,
      pageCount: flaggedArtifact.pageCount,
      extractedText: flaggedArtifact.extractedText,
      summary: flaggedArtifact.summary,
      headings: flaggedArtifact.headings,
      pages: flaggedArtifact.pages,
      diagrams: flaggedArtifact.diagrams,
      tables: flaggedArtifact.tables,
      formulas: flaggedArtifact.formulas,
      qrCodesFound: flaggedArtifact.qrCodesFound,
      averageOcrConfidence: flaggedArtifact.averageOcrConfidence,
      deterministicChecks: flaggedOutcome.deterministicChecks,
      aiFindings: flaggedOutcome.aiFindings,
      decision: flaggedOutcome.decision,
      riskLevel: flaggedOutcome.riskLevel,
      decisionReason: flaggedOutcome.decisionReason,
    });

    assert.equal(flaggedDoc.publicationStatus, 'flagged');
    assert.equal(
      archiveRepository.getPublishedLibraryDocuments().some((d) => d.id === flaggedDoc.id),
      false
    );
    assert.ok(archiveRepository.getDocumentsForSubmitter(schoolAdmin.id).some((d) => d.id === flaggedDoc.id));
    assert.equal(
      archiveRepository.getDocumentsForSubmitter(studentB.id).some((d) => d.id === flaggedDoc.id),
      false
    );
    assert.ok(
      archiveRepository.getDocumentsForReview(superAdmin).some((d) => d.id === flaggedDoc.id)
    );

    // The Super Admin gets an extra alert when the AI/integrity checks are not okay
    assert.ok(
      archiveRepository
        .getSuperAdminGovernanceNotifications()
        .some((n) => n.categoryLabel === 'AI Cross-Check Alert' && /Blurry Biology Lab Chart/.test(n.message))
    );

    // RBAC: Student and School Admin cannot review submitted documents
    assert.throws(
      () => archiveRepository.reviewSubmittedDocument(studentB, flaggedDoc.id, 'approve'),
      /Only Super Administrators/i
    );
    assert.throws(
      () => archiveRepository.reviewSubmittedDocument(schoolAdmin, flaggedDoc.id, 'approve'),
      /Only Super Administrators/i
    );

    // Super Admin cannot reject without a meaningful reason
    assert.throws(
      () => archiveRepository.reviewSubmittedDocument(superAdmin, flaggedDoc.id, 'reject', { rejectionReason: 'no' }),
      /mandatory/i
    );

    // Super Admin rejects with clear reason -> notifies Student A
    const rejectedDoc = archiveRepository.reviewSubmittedDocument(
      superAdmin,
      flaggedDoc.id,
      'reject',
      { rejectionReason: 'Labels on diagram are too blurry to verify against BIO 201.' }
    );
    assert.equal(rejectedDoc.publicationStatus, 'rejected');
    assert.match(rejectedDoc.rejectionReason ?? '', /too blurry/i);

    // Super Admin can also approve after review -> publishes to Document Library + notifies Student A
    const approvedDoc = archiveRepository.reviewSubmittedDocument(
      superAdmin,
      flaggedDoc.id,
      'approve',
      { note: 'Verified manually against syllabus.' }
    );
    assert.equal(approvedDoc.publicationStatus, 'published');
    assert.ok(archiveRepository.getPublishedLibraryDocuments().some((d) => d.id === flaggedDoc.id));
  });

  test('10. Cancellation via AbortController aborts cleanly without creating a repository entry', async () => {
    const pngBytes = await buildPngBytes();
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      () =>
        scanSingleAcademicInput(
          { name: 'aborted_scan.png', type: 'image/png', size: pngBytes.byteLength, bytes: pngBytes },
          { signal: controller.signal, bypassCache: true }
        ),
      (err: unknown) => (err as { name?: string })?.name === 'AbortError'
    );
  });

  test('11. Server Sharp image optimization and binary validation', async () => {
    const docEngine = createDocumentEngine({ env: {} });
    const pngBytes = await buildPngBytes(240, 120);

    const valRes = await docEngine.validateAndOptimizeBinary({
      body: {
        fileName: 'lab_scan.png',
        mimeType: 'image/png',
        base64Data: `data:image/png;base64,${Buffer.from(pngBytes).toString('base64')}`,
      },
    });
    assert.equal(valRes.status, 200);
    assert.equal(valRes.body.ok, true);
    assert.equal(valRes.body.valid, true);
    assert.equal(valRes.body.sha256?.length, 64);
    assert.ok(valRes.body.optimizedPreviewUrl?.startsWith('data:image/jpeg;base64,'));
    assert.equal(valRes.body.width, 240);
    assert.equal(valRes.body.height, 120);

    // Spoofed PNG bytes rejected at server Sharp/signature boundary
    const badRes = await docEngine.validateAndOptimizeBinary({
      body: {
        fileName: 'spoof.png',
        mimeType: 'image/png',
        base64Data: Buffer.from('not really a png').toString('base64'),
      },
    });
    assert.equal(badRes.status, 422);
    assert.equal(badRes.body.ok, false);
  });

  test('12. Super Admin can force publish, decline and delete any admin upload; catalog follows', () => {
    const schoolAdmin = makeSchoolAdmin();
    const superAdmin = makeSuperAdmin();

    const basePayload = {
      schoolId: 'sch-aaua',
      title: 'CSC 205 Exam Paper',
      courseCode: 'CSC 205',
      courseTitle: 'Discrete Structures',
      level: '200L' as const,
      session: '2023/2024',
      semester: 'First Semester' as const,
      category: 'past_question' as const,
      originalFileName: 'csc205.pdf',
      mimeType: 'application/pdf',
      detectedFormat: 'pdf' as const,
      fileSizeBytes: 2048,
      sha256: 'a'.repeat(64),
      pageCount: 1,
      extractedText:
        'CSC 205 Discrete Structures 2023/2024\n1. Define a partial order and give two examples.\n2. Prove that the sum of two even integers is even.\nInstructions: answer all questions.',
      summary: 'Discrete structures exam',
      headings: [],
      pages: [],
      diagrams: [],
      tables: [],
      formulas: [],
      qrCodesFound: [],
      averageOcrConfidence: 40,
      deterministicChecks: [],
      decision: 'flagged' as const,
      riskLevel: 'high' as const,
      decisionReason: 'Low OCR confidence',
    };

    const flagged = archiveRepository.submitScannedDocument(schoolAdmin, basePayload);
    assert.equal(flagged.publicationStatus, 'flagged');

    // School admins can never publish, decline or delete.
    assert.throws(() => archiveRepository.reviewSubmittedDocument(schoolAdmin, flagged.id, 'approve'));
    assert.throws(() => archiveRepository.deleteAcademicDocument(schoolAdmin, flagged.id));
    assert.ok(archiveRepository.getDocumentsForSubmitter(schoolAdmin.id).some((d) => d.id === flagged.id));

    // Super Admin force publishes a flagged document; the typed past question reaches the catalog.
    const forced = archiveRepository.reviewSubmittedDocument(superAdmin, flagged.id, 'approve');
    assert.equal(forced.publicationStatus, 'published');
    assert.match(forced.processingHistory.at(-1)?.detail ?? '', /override/i);
    const catalogEntry = archiveRepository
      .getPublishedDocuments()
      .find((d) => d.id === `pqdoc-${flagged.id}`);
    assert.ok(catalogEntry, 'published past question appears in student catalog');
    assert.equal(catalogEntry.questions.length, 2);

    // Declining a published document takes the typed copy offline and stores the reason.
    const declined = archiveRepository.reviewSubmittedDocument(superAdmin, flagged.id, 'reject', {
      rejectionReason: 'Wrong course uploaded',
    });
    assert.equal(declined.publicationStatus, 'rejected');
    assert.equal(declined.rejectionReason, 'Wrong course uploaded');
    assert.equal(
      archiveRepository.getPublishedDocuments().some((d) => d.id === `pqdoc-${flagged.id}`),
      false
    );

    // Publish again, then delete: both the upload and its typed copy disappear.
    archiveRepository.reviewSubmittedDocument(superAdmin, flagged.id, 'approve');
    assert.ok(archiveRepository.getPublishedDocuments().some((d) => d.id === `pqdoc-${flagged.id}`));
    archiveRepository.deleteAcademicDocument(superAdmin, flagged.id);
    assert.equal(archiveRepository.findDocumentBySha256(basePayload.sha256), undefined);
    assert.equal(
      archiveRepository.getPublishedDocuments().some((d) => d.id === `pqdoc-${flagged.id}`),
      false
    );

    // Non past question uploads never create catalog entries.
    const note = archiveRepository.submitScannedDocument(schoolAdmin, {
      ...basePayload,
      sha256: 'b'.repeat(64),
      category: 'lecture_note',
      decision: 'auto_approved',
      riskLevel: 'low',
    });
    archiveRepository.reviewSubmittedDocument(superAdmin, note.id, 'approve');
    assert.equal(
      archiveRepository.getPublishedDocuments().some((d) => d.id === `pqdoc-${note.id}`),
      false
    );
  });
});

after(() => {
  archiveRepository.resetAllForDev();
});
