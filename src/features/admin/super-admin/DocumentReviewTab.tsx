import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  FileText,
  MessageSquarePlus,
  RotateCcw,
  ShieldAlert,
  Trash2,
  XCircle,
} from 'lucide-react';
import type {
  AcademicDocumentRecord,
  AuthenticatedUser,
  DetailedAcademicCategory,
} from '../../../core/types';
import { sanitizeSafeUrl } from '../../../core/security';
import { mapDetailedToLegacyCategory } from '../../../services/intelligence/documentClassifier';
import { archiveRepository, type AppStoreState } from '../../../services/archiveRepository';
import { downloadOriginalDocumentFile } from '../../../services/intelligence/storageAdapter';
import {
  ReconstructedDocumentRenderer,
  ScannedPageSideBySide,
  SuperAdminIntelligenceSuite,
} from '../../../components/academic/AcademicContentRenderer';
import {
  DetailDialog,
  SearchField,
  SectionHeadingBar,
  SurfaceCard,
  TactileButton,
} from '../../../components/ui';

interface DocumentReviewTabProps {
  currentUser: AuthenticatedUser;
  store: AppStoreState;
  onNotice: (msg: string) => void;
  onError: (msg: string) => void;
}

type ReviewFilter = 'pending_flagged' | 'checks_passed' | 'rejected' | 'all';

function riskBadge(risk: AcademicDocumentRecord['riskLevel']): string {
  if (risk === 'high') return 'bg-[#FEE2E2] text-[#B91C1C] border-[#FECACA]';
  if (risk === 'medium') return 'bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]';
  return 'bg-[#DCFCE7] text-[#15803D] border-[#86EFAC]';
}

export const DocumentReviewTab: React.FC<DocumentReviewTabProps> = ({
  currentUser,
  store,
  onNotice,
  onError,
}) => {
  const [filter, setFilter] = useState<ReviewFilter>('pending_flagged');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<'extracted' | 'optimized'>('extracted');
  const [rejectionReason, setRejectionReason] = useState('');
  const [internalNote, setInternalNote] = useState('');

  const allDocs = useMemo(
    () => archiveRepository.getDocumentsForReview(currentUser, 'all'),
    [currentUser, store.academicDocuments]
  );

  const counts = useMemo(
    () => ({
      pending_flagged: archiveRepository.getDocumentsForReview(currentUser, 'pending_flagged')
        .length,
      checks_passed: archiveRepository.getDocumentsForReview(currentUser, 'checks_passed')
        .length,
      rejected: archiveRepository.getDocumentsForReview(currentUser, 'rejected').length,
      all: allDocs.length,
    }),
    [currentUser, allDocs]
  );

  const filteredDocs = useMemo(() => {
    const base = archiveRepository.getDocumentsForReview(currentUser, filter);
    const q = searchQuery.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        d.courseCode.toLowerCase().includes(q) ||
        d.submittedByName.toLowerCase().includes(q) ||
        d.sha256.toLowerCase().includes(q) ||
        d.originalFileName.toLowerCase().includes(q)
    );
  }, [currentUser, filter, searchQuery, store.academicDocuments]);

  const selectedDoc = useMemo(
    () => allDocs.find((d) => d.id === selectedDocId) ?? null,
    [allDocs, selectedDocId]
  );

  const openInspect = (doc: AcademicDocumentRecord) => {
    setSelectedDocId(doc.id);
    setPreviewMode('extracted');
    setRejectionReason(doc.rejectionReason ?? '');
    setInternalNote('');
  };

  const handleReviewAction = (action: 'approve' | 'reject' | 'request_resubmission') => {
    if (!selectedDoc) return;
    try {
      const updated = archiveRepository.reviewSubmittedDocument(
        currentUser,
        selectedDoc.id,
        action,
        {
          rejectionReason: action === 'approve' ? undefined : rejectionReason,
          note: internalNote.trim() || undefined,
        }
      );
      setRejectionReason('');
      setInternalNote('');
      onNotice(
        action === 'approve'
          ? `Approved & published "${updated.title}".`
          : action === 'request_resubmission'
            ? `Requested resubmission for "${updated.title}" and notified ${updated.submittedByName}.`
            : `Rejected "${updated.title}" and sent explanation to ${updated.submittedByName}.`
      );
      setSelectedDocId(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unable to save review decision.');
    }
  };

  const handleDeleteDoc = () => {
    if (!selectedDoc) return;
    if (!window.confirm(`Delete "${selectedDoc.title}" permanently?`)) return;
    try {
      archiveRepository.deleteAcademicDocument(currentUser, selectedDoc.id);
      onNotice(`Deleted "${selectedDoc.title}".`);
      setSelectedDocId(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unable to delete this document.');
    }
  };

  const handleAddNote = () => {
    if (!selectedDoc || !internalNote.trim()) return;
    try {
      archiveRepository.addDocumentReviewNote(currentUser, selectedDoc.id, internalNote);
      setInternalNote('');
      onNotice('Added internal reviewer note.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not save reviewer note.');
    }
  };

  return (
    <div className="space-y-5">
      <SurfaceCard tone="white" className="p-5 space-y-4">
        <SectionHeadingBar
          title="Document Verification & Review Queue"
          subtitle="Inspect flagged uploads, duplicate SHA-256 hits, OCR confidence scores, and AI cross-check evidence"
          icon={<ClipboardCheck className="w-4 h-4" />}
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ['pending_flagged', `Pending & Flagged (${counts.pending_flagged})`],
                ['checks_passed', `Passed Checks (${counts.checks_passed})`],
                ['rejected', `Rejected (${counts.rejected})`],
                ['all', `All Submissions (${counts.all})`],
              ] as Array<[ReviewFilter, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-colors ${
                  filter === key
                    ? 'bg-[#1D1E23] text-white'
                    : 'bg-[#F6F7F9] text-[#505460] hover:bg-[#ECEEF3]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="w-full sm:w-72">
            <SearchField
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search title, student, SHA-256..."
            />
          </div>
        </div>
      </SurfaceCard>

      {filteredDocs.length === 0 ? (
        <SurfaceCard tone="white" className="p-8 text-center space-y-2">
          <FileText className="w-6 h-6 text-[#686C78] mx-auto" />
          <h3 className="font-display text-base font-bold text-[#1A1B20]">
            No Documents in This Queue
          </h3>
          <p className="text-xs text-[#686C78]">
            Scanned student uploads matching "{filter.replace('_', ' ')}" will appear here.
          </p>
        </SurfaceCard>
      ) : (
        <div className="space-y-3">
          {filteredDocs.map((doc) => (
            <SurfaceCard key={doc.id} tone="white" className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-[#1D1E23] text-white px-2 py-0.5 font-mono-tabular text-[11px] font-bold">
                      {doc.courseCode}
                    </span>
                    <span
                      className={`rounded-md border px-2 py-0.5 text-[11px] font-bold uppercase ${riskBadge(doc.riskLevel)}`}
                    >
                      {doc.riskLevel} risk
                    </span>
                    {doc.duplicateOfDocId && (
                      <span className="rounded-md bg-[#FEF3C7] text-[#92400E] px-2 py-0.5 text-[11px] font-bold">
                        Duplicate Hash
                      </span>
                    )}
                    <span className="rounded-md bg-[#F6F7F9] text-[#505460] px-2 py-0.5 text-[11px] font-semibold">
                      {doc.detectedFormat.toUpperCase()} · {doc.pageCount} pg
                    </span>
                  </div>

                  <p className="font-display text-sm sm:text-base font-bold text-[#1A1B20] truncate">
                    {doc.title}
                  </p>
                  <p className="text-xs text-[#686C78]">
                    Submitted by <strong className="text-[#1A1B20]">{doc.submittedByName}</strong> ·{' '}
                    {doc.schoolCode} · SHA-256{' '}
                    <span className="font-mono-tabular">{doc.sha256.slice(0, 14)}...</span>
                    {doc.averageOcrConfidence !== null &&
                      ` · OCR ${doc.averageOcrConfidence}%`}
                  </p>
                </div>

                <TactileButton
                  variant="dark"
                  size="sm"
                  icon={<Eye className="w-3.5 h-3.5" />}
                  onClick={() => openInspect(doc)}
                >
                  Inspect &amp; Decide
                </TactileButton>
              </div>
            </SurfaceCard>
          ))}
        </div>
      )}

      {/* Inspection Modal */}
      <DetailDialog
        open={Boolean(selectedDoc)}
        onClose={() => setSelectedDocId(null)}
        title={selectedDoc?.title ?? 'Inspect Submission'}
        subtitle={
          selectedDoc
            ? `${selectedDoc.submittedByName} · ${selectedDoc.courseCode} · ${selectedDoc.originalFileName}`
            : undefined
        }
        icon={<ClipboardCheck className="w-4 h-4" />}
        maxWidthClass="max-w-4xl"
        footer={
          selectedDoc ? (
            <>
              <TactileButton
                variant="light"
                size="sm"
                icon={<Trash2 className="w-3.5 h-3.5 text-[#B91C1C]" />}
                onClick={handleDeleteDoc}
              >
                Delete
              </TactileButton>
              <TactileButton
                variant="light"
                size="sm"
                icon={<XCircle className="w-3.5 h-3.5 text-[#B91C1C]" />}
                onClick={() => handleReviewAction('reject')}
              >
                Reject
              </TactileButton>
              <TactileButton
                variant="light"
                size="sm"
                icon={<RotateCcw className="w-3.5 h-3.5 text-[#92400E]" />}
                onClick={() => handleReviewAction('request_resubmission')}
              >
                Request Resubmission
              </TactileButton>
              <TactileButton
                variant="dark"
                size="sm"
                icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                onClick={() => handleReviewAction('approve')}
              >
                Approve &amp; Publish
              </TactileButton>
            </>
          ) : null
        }
      >
        {selectedDoc && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-[#F6F7F9] p-3 border border-[#1A1B20]/10 text-xs">
              <div>
                <p className="font-bold text-[#1A1B20]">
                  Status: {selectedDoc.publicationStatus} ({selectedDoc.riskLevel.toUpperCase()} risk)
                </p>
                <p className="font-mono-tabular text-[#686C78]">
                  SHA-256: {selectedDoc.sha256}
                </p>
              </div>
              {sanitizeSafeUrl(selectedDoc.optimizedPreviewUrl) && (
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPreviewMode('extracted')}
                    className={`px-3 py-1.5 rounded-xl font-bold cursor-pointer ${
                      previewMode === 'extracted'
                        ? 'bg-[#1D1E23] text-white'
                        : 'bg-white text-[#505460] border border-[#1A1B20]/10'
                    }`}
                  >
                    Extracted View
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewMode('optimized')}
                    className={`px-3 py-1.5 rounded-xl font-bold cursor-pointer ${
                      previewMode === 'optimized'
                        ? 'bg-[#1D1E23] text-white'
                        : 'bg-white text-[#505460] border border-[#1A1B20]/10'
                    }`}
                  >
                    Scan Preview
                  </button>
                </div>
              )}
            </div>

            {previewMode === 'optimized' && sanitizeSafeUrl(selectedDoc.optimizedPreviewUrl) ? (
              <div className="rounded-2xl border border-[#1A1B20]/10 bg-[#F6F7F9] p-3">
                <img
                  src={sanitizeSafeUrl(selectedDoc.optimizedPreviewUrl)}
                  alt={selectedDoc.title}
                  className="w-full max-h-[420px] object-contain rounded-xl bg-white"
                />
              </div>
            ) : (
              <div className="space-y-4">
                {/* Deterministic & AI Findings */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-[#1A1B20]/10 bg-[#F6F7F9] p-3.5 space-y-2">
                    <p className="font-bold text-xs text-[#1A1B20]">Deterministic Checks</p>
                    {selectedDoc.deterministicChecks.map((chk) => (
                      <div key={chk.id} className="text-xs flex items-start gap-2">
                        {chk.passed ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#15803D] shrink-0 mt-0.5" />
                        ) : chk.severity === 'blocker' ? (
                          <ShieldAlert className="w-3.5 h-3.5 text-[#B91C1C] shrink-0 mt-0.5" />
                        ) : (
                          <AlertTriangle className="w-3.5 h-3.5 text-[#92400E] shrink-0 mt-0.5" />
                        )}
                        <div>
                          <p className="font-semibold text-[#1A1B20]">{chk.label}</p>
                          <p className="text-[#505460]">{chk.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-2xl border border-[#1A1B20]/10 bg-[#F6F7F9] p-3.5 space-y-2 text-xs">
                    <p className="font-bold text-[#1A1B20]">AI Cross-Check Summary</p>
                    {selectedDoc.aiFindings ? (
                      <>
                        <p className="text-[#3A3D47]">{selectedDoc.aiFindings.reason}</p>
                        <p className="text-[#686C78]">
                          Recommended:{' '}
                          <strong className="text-[#1A1B20]">
                            {selectedDoc.aiFindings.recommendedAction}
                          </strong>{' '}
                          · Confidence {Math.round(selectedDoc.aiFindings.confidence * 100)}%
                        </p>
                        {selectedDoc.aiFindings.isOfficialCredentialSuspected && (
                          <p className="rounded-lg bg-[#FEF2F2] text-[#B91C1C] px-2.5 py-1 font-bold">
                            Suspected official credential / transcript — human decision required.
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-[#686C78]">No AI findings recorded.</p>
                    )}
                  </div>
                </div>

                {selectedDoc.unprocessedPages && selectedDoc.unprocessedPages.length > 0 && (
                  <div className="rounded-xl bg-[#FEF3C7] border border-[#FDE68A] px-3 py-2 text-xs font-semibold text-[#92400E]">
                    Pages {selectedDoc.unprocessedPages[0]}–{selectedDoc.unprocessedPages[selectedDoc.unprocessedPages.length - 1]} were beyond the safety page limit and were not scanned.
                  </div>
                )}
                {selectedDoc.pages.length > 0 ? (
                  <div className="space-y-3">
                    {selectedDoc.pages.map((pg) => (
                      <ScannedPageSideBySide
                        key={pg.pageNumber}
                        page={pg}
                        fallbackImageUrl={selectedDoc.optimizedPreviewUrl}
                        showTechnical
                        totalPages={selectedDoc.pages.length}
                        onOpenOriginalFile={() =>
                          void downloadOriginalDocumentFile({
                            originalFileRefKey: selectedDoc.originalFileRef?.key,
                            originalFileName: selectedDoc.originalFileName,
                            mimeType: selectedDoc.mimeType,
                            fallbackPreviewUrl: sanitizeSafeUrl(
                              pg.renderedPreviewUrl ?? selectedDoc.optimizedPreviewUrl
                            ),
                          })
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-[#1A1B20]/10 bg-white p-4">
                    <ReconstructedDocumentRenderer
                      variant="admin"
                      pages={[
                        {
                          pageNumber: 1,
                          text: selectedDoc.extractedText || '',
                          wordCount: (selectedDoc.extractedText || '').split(/\s+/).filter(Boolean).length,
                          ocrApplied: false,
                          ocrConfidence: null,
                          diagrams: selectedDoc.diagrams,
                          tables: selectedDoc.tables,
                          formulas: selectedDoc.formulas,
                          warnings: [],
                        },
                      ]}
                    />
                  </div>
                )}

                <SuperAdminIntelligenceSuite
                  doc={selectedDoc}
                  onOverrideCategory={(nextCat: DetailedAcademicCategory) => {
                    if (!selectedDoc.classification) return;
                    try {
                      archiveRepository.updateAcademicDocumentDetails(currentUser, selectedDoc.id, {
                        category: mapDetailedToLegacyCategory(nextCat, selectedDoc.diagrams.length > 0),
                        classification: {
                          ...selectedDoc.classification,
                          primaryCategory: nextCat,
                          primaryLabel: nextCat.replace(/_/g, ' '),
                          mappedLegacyCategory: mapDetailedToLegacyCategory(
                            nextCat,
                            selectedDoc.diagrams.length > 0
                          ),
                          overriddenByAdmin: true,
                        },
                      });
                      onNotice(`Updated document classification to ${nextCat.replace(/_/g, ' ')}.`);
                    } catch (err) {
                      onError(err instanceof Error ? err.message : 'Unable to override classification.');
                    }
                  }}
                />
              </div>
            )}

            {/* Reviewer Reason & Notes */}
            <div className="rounded-2xl border border-[#1A1B20]/10 bg-[#F6F7F9] p-4 space-y-3">
              <div>
                <label
                  htmlFor="doc-reject-reason"
                  className="block text-xs font-bold text-[#1A1B20] mb-1"
                >
                  Rejection / Resubmission Reason (Required to Reject or Request Resubmission)
                </label>
                <input
                  id="doc-reject-reason"
                  type="text"
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="Clear feedback sent to submitter..."
                  className="w-full min-h-[42px] rounded-xl bg-white border border-[#1A1B20]/10 px-3.5 text-xs sm:text-sm text-[#1A1B20] focus:outline-none focus:border-[#1D1E23]"
                />
              </div>

              <div className="flex flex-wrap gap-2 items-end">
                <div className="flex-1 min-w-[200px]">
                  <label
                    htmlFor="doc-internal-note"
                    className="block text-xs font-bold text-[#1A1B20] mb-1"
                  >
                    Internal Reviewer Note
                  </label>
                  <input
                    id="doc-internal-note"
                    type="text"
                    value={internalNote}
                    onChange={(e) => setInternalNote(e.target.value)}
                    placeholder="Private audit note for admin team..."
                    className="w-full min-h-[40px] rounded-xl bg-white border border-[#1A1B20]/10 px-3.5 text-xs text-[#1A1B20] focus:outline-none focus:border-[#1D1E23]"
                  />
                </div>
                <TactileButton
                  variant="light"
                  size="sm"
                  icon={<MessageSquarePlus className="w-3.5 h-3.5" />}
                  onClick={handleAddNote}
                >
                  Save Note
                </TactileButton>
              </div>

              {selectedDoc.internalNotes.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-[#1A1B20]/10">
                  {selectedDoc.internalNotes.map((n) => (
                    <p key={n.id} className="text-xs text-[#505460]">
                      <strong className="text-[#1A1B20]">{n.authorName}:</strong> {n.note}
                    </p>
                  ))}
                </div>
              )}

              {selectedDoc.processingHistory.length > 0 && (
                <div className="space-y-1 pt-2 border-t border-[#1A1B20]/10 text-[11px] text-[#686C78]">
                  <p className="font-bold text-[#1A1B20]">Processing Audit Trail</p>
                  {selectedDoc.processingHistory.map((h) => (
                    <p key={h.id}>
                      <span className="font-semibold text-[#1A1B20]">{h.stage}</span> — {h.detail}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </DetailDialog>
    </div>
  );
};
