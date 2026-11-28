import type {
  AiCrossCheckFindings,
  DeterministicCheckResult,
  DocumentPipelineDecision,
  DocumentPublicationStatus,
  DocumentRiskLevel,
} from '../../core/types';
import type { ScannedArtifactOutput } from './documentScannerEngine';

export interface DuplicateLookupResult {
  isDuplicate: boolean;
  existingDocId?: string;
  existingTitle?: string;
}

export interface FullValidationOutcome {
  deterministicChecks: DeterministicCheckResult[];
  aiFindings: AiCrossCheckFindings;
  decision: DocumentPipelineDecision;
  publicationStatus: DocumentPublicationStatus;
  riskLevel: DocumentRiskLevel;
  decisionReason: string;
}

const CREDENTIAL_PATTERNS = [
  /\bofficial\s+transcript\b/i,
  /\bstatement\s+of\s+result\b/i,
  /\bcertificate\s+of\s+(graduation|completion|merit|award)\b/i,
  /\bregistrar\s+signature\b/i,
  /\bdegree\s+certificate\b/i,
];

export function runDeterministicChecks(params: {
  artifact: ScannedArtifactOutput;
  duplicateLookup: DuplicateLookupResult;
  overrideCourseCode?: string;
}): DeterministicCheckResult[] {
  const { artifact, duplicateLookup } = params;
  const checks: DeterministicCheckResult[] = [...artifact.earlyChecks];

  // 1. Duplicate hash verification
  checks.push({
    id: 'chk-duplicate',
    label: 'SHA-256 duplicate check',
    category: 'duplicate',
    passed: !duplicateLookup.isDuplicate,
    severity: duplicateLookup.isDuplicate ? 'blocker' : 'info',
    detail: duplicateLookup.isDuplicate
      ? `Exact duplicate of existing document "${duplicateLookup.existingTitle ?? duplicateLookup.existingDocId}" (SHA-256: ${artifact.sha256.slice(0, 12)}...).`
      : `Unique SHA-256 fingerprint (${artifact.sha256.slice(0, 12)}...).`,
  });

  // 2. Text legibility & density
  const charCount = artifact.extractedText.replace(/\s+/g, '').length;
  const hasVisualEvidence =
    artifact.diagrams.length > 0 && artifact.detectedFormat === 'image';
  const legibleText = charCount >= 40 || (charCount >= 12 && hasVisualEvidence);
  checks.push({
    id: 'chk-legibility',
    label: 'Extracted text & legibility',
    category: 'quality',
    passed: legibleText,
    severity: charCount < 15 && !hasVisualEvidence ? 'blocker' : !legibleText ? 'warning' : 'info',
    detail: legibleText
      ? `Extracted ${charCount} non-whitespace characters across ${artifact.pageCount} page(s).`
      : `Insufficient readable text (${charCount} characters extracted). Image may be blank or unreadable.`,
  });

  // 3. OCR confidence threshold
  if (artifact.averageOcrConfidence !== null) {
    const confidenceOk = artifact.averageOcrConfidence >= 65;
    checks.push({
      id: 'chk-ocr-confidence',
      label: 'OCR recognition confidence',
      category: 'quality',
      passed: confidenceOk,
      severity: confidenceOk ? 'info' : 'warning',
      detail: confidenceOk
        ? `OCR confidence is ${artifact.averageOcrConfidence}% (meets >= 65% legibility threshold).`
        : `Low OCR confidence (${artifact.averageOcrConfidence}% < 65% threshold). Routed for human review.`,
      pageNumbers: artifact.pages
        .filter((p) => p.ocrApplied && (p.ocrConfidence ?? 100) < 65)
        .map((p) => p.pageNumber),
    });
  }

  // 3b. Page completeness, failed pages, blank scans & page-limit truncation audit
  const failedOrIncompletePages = artifact.pages.filter(
    (p) => p.processingStatus === 'failed' || p.isIncomplete || (p.errors && p.errors.length > 0)
  );
  const unprocessed = artifact.unprocessedPages ?? [];
  const truncatedPages = artifact.pages.filter((p) => p.wasTruncated);
  const qualityStatus = artifact.extractionQualityStatus;
  if (
    failedOrIncompletePages.length > 0 ||
    unprocessed.length > 0 ||
    truncatedPages.length > 0 ||
    qualityStatus === 'needs_review' ||
    qualityStatus === 'failed'
  ) {
    const isHardFailure =
      qualityStatus === 'failed' ||
      (artifact.pages.length > 0 && failedOrIncompletePages.length === artifact.pages.length && charCount < 20);
    const parts: string[] = [];
    if (failedOrIncompletePages.length > 0) {
      parts.push(
        `Incomplete or failed extraction on page(s): ${failedOrIncompletePages.map((p) => p.pageNumber).join(', ')}.`
      );
    }
    if (unprocessed.length > 0) {
      parts.push(
        `${unprocessed.length} page(s) (${unprocessed[0]}–${unprocessed[unprocessed.length - 1]}) exceed PDF safety page limit and were not scanned.`
      );
    }
    if (truncatedPages.length > 0) {
      parts.push(
        `Content capped on page(s) ${truncatedPages.map((p) => p.pageNumber).join(', ')}.`
      );
    }
    checks.push({
      id: 'chk-completeness',
      label: 'Page completeness & extraction coverage',
      category: 'quality',
      passed: false,
      severity: isHardFailure ? 'blocker' : 'warning',
      detail: parts.join(' ') || 'Extraction flagged for manual review due to low completeness.',
      pageNumbers: failedOrIncompletePages.map((p) => p.pageNumber),
    });
  }

  // 4. QR code safety inspection
  if (artifact.qrCodesFound.length > 0) {
    const unsafeQr = artifact.qrCodesFound.filter((q) => !q.isSafeUrl);
    checks.push({
      id: 'chk-qr-safety',
      label: 'Embedded QR code payload inspection',
      category: 'qr_code',
      passed: unsafeQr.length === 0,
      severity: unsafeQr.length > 0 ? 'warning' : 'info',
      detail:
        unsafeQr.length > 0
          ? `${unsafeQr.length} QR code(s) contain non-HTTPS or local/suspicious URLs.`
          : `Decoded ${artifact.qrCodesFound.length} safe QR code payload(s).`,
      pageNumbers: artifact.qrCodesFound.map((q) => q.pageNumber),
    });
  }

  // 5. Course code / academic structure metadata check
  const claimedCode = (params.overrideCourseCode || artifact.courseCode).toUpperCase().trim();
  const mentionsCourseCode =
    claimedCode.length >= 4 &&
    artifact.extractedText.toUpperCase().includes(claimedCode.replace(/\s+/g, ''));
  const hasAcademicStructure =
    artifact.headings.length > 0 ||
    artifact.tables.length > 0 ||
    artifact.formulas.length > 0 ||
    mentionsCourseCode ||
    charCount >= 80;
  checks.push({
    id: 'chk-structure',
    label: 'Academic structure & metadata consistency',
    category: 'structure',
    passed: hasAcademicStructure,
    severity: hasAcademicStructure ? 'info' : 'warning',
    detail: hasAcademicStructure
      ? 'Academic formatting, headings, or course references detected.'
      : 'Sparse academic headings or course identifiers; verify document relevance.',
  });

  // 6. Official credential suspicion flag (never auto-approve certificates/transcripts via AI alone)
  const credentialMatch = CREDENTIAL_PATTERNS.some((re) => re.test(artifact.extractedText));
  if (credentialMatch) {
    checks.push({
      id: 'chk-credential',
      label: 'Official credential / certificate safeguard',
      category: 'security',
      passed: false,
      severity: 'warning',
      detail:
        'Text references official transcripts or certificates. PQGuide never auto-verifies official credentials; routed to Super Admin Review.',
    });
  }

  return checks;
}

export async function runAiDocumentCrossCheck(params: {
  artifact: ScannedArtifactOutput;
  deterministicChecks: DeterministicCheckResult[];
  signal?: AbortSignal;
}): Promise<AiCrossCheckFindings> {
  const { artifact, deterministicChecks } = params;
  const fallbackNow = new Date().toISOString();
  const officialSuspected = deterministicChecks.some((c) => c.id === 'chk-credential');

  try {
    const res = await fetch('/api/documents/cross-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: params.signal,
      body: JSON.stringify({
        fileName: artifact.fileName,
        detectedFormat: artifact.detectedFormat,
        courseCode: artifact.courseCode,
        category: artifact.category,
        pageCount: artifact.pageCount,
        averageOcrConfidence: artifact.averageOcrConfidence,
        extractedExcerpt: artifact.extractedText.slice(0, 6000),
        headings: artifact.headings.slice(0, 12),
        qrPayloads: artifact.qrCodesFound.map((q) => q.payload),
        deterministicSummary: deterministicChecks.map((c) => ({
          id: c.id,
          passed: c.passed,
          severity: c.severity,
          detail: c.detail,
        })),
      }),
    });

    if (res.ok) {
      const payload = (await res.json()) as {
        ok?: boolean;
        findings?: AiCrossCheckFindings;
      };
      if (payload.ok && payload.findings) {
        return {
          ...payload.findings,
          isOfficialCredentialSuspected:
            Boolean(payload.findings.isOfficialCredentialSuspected) || officialSuspected,
        };
      }
    }
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') throw err;
  }

  // Deterministic non-blocking fallback when offline or GEMINI_API_KEY not configured
  const hasBlocker = deterministicChecks.some((c) => !c.passed && c.severity === 'blocker');
  const hasWarning = deterministicChecks.some((c) => !c.passed && c.severity === 'warning');

  return {
    riskLevel: hasBlocker ? 'high' : hasWarning ? 'medium' : 'low',
    reason: hasBlocker
      ? 'Server AI cross-check skipped because deterministic security or integrity blockers failed.'
      : hasWarning
        ? 'Deterministic warnings detected and server AI unavailable; routed to manual review.'
        : 'All deterministic integrity, quality, and security checks passed while external AI cross-check was not configured.',
    evidence: deterministicChecks
      .filter((c) => !c.passed)
      .slice(0, 4)
      .map((c) => ({
        pageNumber: c.pageNumbers?.[0],
        excerpt: c.detail,
        checkType: c.category,
      })),
    confidence: hasBlocker ? 0.95 : hasWarning ? 0.62 : 0.82,
    recommendedAction: hasBlocker
      ? 'reject'
      : hasWarning || officialSuspected
        ? 'manual_review'
        : 'auto_approve',
    isOfficialCredentialSuspected: officialSuspected,
    providerAvailable: false,
    checkedAt: fallbackNow,
  };
}

export function computePipelineDecision(params: {
  deterministicChecks: DeterministicCheckResult[];
  aiFindings: AiCrossCheckFindings;
}): {
  decision: DocumentPipelineDecision;
  publicationStatus: DocumentPublicationStatus;
  riskLevel: DocumentRiskLevel;
  decisionReason: string;
} {
  const { deterministicChecks, aiFindings } = params;

  const failedBlockers = deterministicChecks.filter((c) => !c.passed && c.severity === 'blocker');
  const failedWarnings = deterministicChecks.filter((c) => !c.passed && c.severity === 'warning');

  if (failedBlockers.length > 0) {
    return {
      decision: 'rejected',
      publicationStatus: 'rejected',
      riskLevel: 'high',
      decisionReason: failedBlockers.map((c) => c.detail).join(' '),
    };
  }

  if (aiFindings.recommendedAction === 'reject' && aiFindings.confidence >= 0.85) {
    return {
      decision: 'rejected',
      publicationStatus: 'rejected',
      riskLevel: 'high',
      decisionReason: aiFindings.reason,
    };
  }

  const mustFlag =
    failedWarnings.length > 0 ||
    aiFindings.isOfficialCredentialSuspected === true ||
    aiFindings.riskLevel !== 'low' ||
    aiFindings.confidence < 0.72 ||
    aiFindings.recommendedAction === 'manual_review' ||
    aiFindings.recommendedAction === 'request_resubmission';

  if (mustFlag) {
    const riskLevel: DocumentRiskLevel =
      aiFindings.riskLevel === 'high' ? 'high' : 'medium';
    const reasons = [
      ...failedWarnings.map((w) => w.detail),
      ...(aiFindings.riskLevel !== 'low' || aiFindings.recommendedAction !== 'auto_approve'
        ? [aiFindings.reason]
        : []),
    ];
    return {
      decision: 'flagged',
      publicationStatus: 'flagged',
      riskLevel,
      decisionReason:
        reasons.filter(Boolean).join(' ') ||
        'Flagged for Super Admin verification before student library publication.',
    };
  }

  return {
    decision: 'auto_approved',
    publicationStatus: 'published',
    riskLevel: 'low',
    decisionReason: 'Passed all deterministic checks and AI cross-check; awaiting Super Admin verification before publication.',
  };
}

export async function validateScannedDocument(params: {
  artifact: ScannedArtifactOutput;
  duplicateLookup: DuplicateLookupResult;
  overrideCourseCode?: string;
  signal?: AbortSignal;
}): Promise<FullValidationOutcome> {
  const deterministicChecks = runDeterministicChecks({
    artifact: params.artifact,
    duplicateLookup: params.duplicateLookup,
    overrideCourseCode: params.overrideCourseCode,
  });

  const aiFindings = await runAiDocumentCrossCheck({
    artifact: params.artifact,
    deterministicChecks,
    signal: params.signal,
  });

  const decisionResult = computePipelineDecision({
    deterministicChecks,
    aiFindings,
  });

  return {
    deterministicChecks,
    aiFindings,
    ...decisionResult,
  };
}
