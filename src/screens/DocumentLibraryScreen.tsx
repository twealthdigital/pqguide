import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  FolderOpen,
  ShieldAlert,
} from 'lucide-react';
import type {
  AcademicDocCategory,
  AcademicDocFormat,
  AcademicDocumentRecord,
  AppScreen,
  AuthenticatedUser,
  StudentLevel,
} from '../core/types';
import { sanitizeSafeUrl } from '../core/security';
import { archiveRepository } from '../services/archiveRepository';
import { useArchiveStore } from '../hooks/useArchiveStore';
import {
  ExtractedDiagramsGallery,
  ExtractedFormulasList,
  ExtractedTableCard,
  RichInlineText,
  ScannedPageSideBySide,
  pageImageUrl,
} from '../components/academic/AcademicContentRenderer';
import {
  CustomSelect,
  DetailDialog,
  SearchField,
  SectionHeadingBar,
  SurfaceCard,
  TactileButton,
} from '../components/ui';

interface DocumentLibraryScreenProps {
  currentUser: AuthenticatedUser;
  /** A Super Admin previewing the School Admin workspace sees what a School Admin sees. */
  asSchoolAdmin?: boolean;
  initialDocId?: string | null;
  onNavigate?: (screen: AppScreen, opts?: { docLibraryId?: string }) => void;
}

const CATEGORY_LABELS: Record<AcademicDocCategory, string> = {
  past_question: 'Past Question',
  study_material: 'Study Guide',
  lecture_note: 'Lecture Notes',
  lab_diagram: 'Lab / Diagram',
  reference: 'Reference Sheet',
};

function statusChip(doc: AcademicDocumentRecord): { label: string; cls: string } {
  switch (doc.publicationStatus) {
    case 'published':
      return {
        label: 'Verified Published',
        cls: 'bg-[#DCFCE7] text-[#15803D]',
      };
    case 'rejected':
      return { label: 'Rejected', cls: 'bg-[#FEE2E2] text-[#B91C1C]' };
    case 'resubmission_requested':
      return { label: 'Resubmission Requested', cls: 'bg-[#FEF3C7] text-[#92400E]' };
    default:
      return { label: 'Pending Review', cls: 'bg-[#FEF3C7] text-[#92400E]' };
  }
}

export const DocumentLibraryScreen: React.FC<DocumentLibraryScreenProps> = ({
  currentUser,
  asSchoolAdmin = false,
  initialDocId,
}) => {
  const store = useArchiveStore();
  // Checks, OCR scores, hashes and risk notes are for the Super Admin only.
  const showTechnical = currentUser.role === 'super_admin' && !asSchoolAdmin;
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | AcademicDocCategory>('all');
  const [formatFilter, setFormatFilter] = useState<'all' | AcademicDocFormat>('all');
  const [levelFilter, setLevelFilter] = useState<'all' | StudentLevel>('all');

  const [selectedDocId, setSelectedDocId] = useState<string | null>(initialDocId ?? null);
  const [viewMode, setViewMode] = useState<'structured' | 'preview'>('structured');
  const [pageNumber, setPageNumber] = useState(1);

  useEffect(() => {
    if (initialDocId) {
      setSelectedDocId(initialDocId);
      setPageNumber(1);
    }
  }, [initialDocId]);

  const publishedDocs = archiveRepository.getPublishedLibraryDocuments();

  const visibleDocs = useMemo(() => {
    const base = publishedDocs;
    const q = query.trim().toLowerCase();
    return base.filter((doc) => {
      if (categoryFilter !== 'all' && doc.category !== categoryFilter) return false;
      if (formatFilter !== 'all' && doc.detectedFormat !== formatFilter) return false;
      if (levelFilter !== 'all' && doc.level !== levelFilter) return false;
      if (!q) return true;
      return (
        doc.title.toLowerCase().includes(q) ||
        doc.courseCode.toLowerCase().includes(q) ||
        doc.courseTitle.toLowerCase().includes(q) ||
        doc.summary.toLowerCase().includes(q) ||
        doc.extractedText.toLowerCase().includes(q)
      );
    });
  }, [publishedDocs, query, categoryFilter, formatFilter, levelFilter]);

  // Enforce strict access scope: only published docs OR submitter's own submissions (Super Admin can also inspect)
  const selectedDoc = useMemo(() => {
    if (!selectedDocId) return null;
    const doc = (store.academicDocuments ?? []).find((d) => d.id === selectedDocId);
    if (!doc) return null;
    if (
      doc.publicationStatus === 'published' ||
      doc.submittedById === currentUser.id ||
      currentUser.role === 'super_admin'
    ) {
      return doc;
    }
    return null;
  }, [selectedDocId, store.academicDocuments, currentUser.id, currentUser.role]);

  const activePage = useMemo(() => {
    if (!selectedDoc || selectedDoc.pages.length === 0) return null;
    return (
      selectedDoc.pages.find((p) => p.pageNumber === pageNumber) ?? selectedDoc.pages[0]
    );
  }, [selectedDoc, pageNumber]);

  return (
    <div className="space-y-6 page-enter">
      {/* Banner */}
      <SurfaceCard tone="ash" withWaves className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#C3C7D2]">
              <FolderOpen className="w-4 h-4" />
              <span>Student Document Library</span>
            </span>
            <h1 className="font-display text-[32px] sm:text-[40px] font-extrabold tracking-tight text-white leading-[1.1]">
              Verified Scanned Academic Library
            </h1>
            <p className="text-sm text-[#B8BCC8] max-w-2xl">
              Browse verified uploads with preserved diagrams, structured tables, KaTeX math
              formulas, and page-by-page navigation — verified by the Super Admin.
            </p>
          </div>

        </div>
      </SurfaceCard>

      {/* Switcher + Search + Filters */}
      <SurfaceCard tone="white" className="p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="w-full sm:w-72">
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="Search course, formula, title..."
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <CustomSelect
            id="lib-filter-cat"
            label="Category"
            size="sm"
            value={categoryFilter}
            options={[
              { value: 'all', label: 'All Categories' },
              { value: 'past_question', label: 'Past Questions' },
              { value: 'study_material', label: 'Study Materials' },
              { value: 'lecture_note', label: 'Lecture Notes' },
              { value: 'lab_diagram', label: 'Lab & Diagrams' },
              { value: 'reference', label: 'Reference Sheets' },
            ]}
            onChange={(val) => setCategoryFilter(val as 'all' | AcademicDocCategory)}
          />

          <CustomSelect
            id="lib-filter-fmt"
            label="Format"
            size="sm"
            value={formatFilter}
            options={[
              { value: 'all', label: 'All Formats' },
              { value: 'pdf', label: 'PDF' },
              { value: 'image', label: 'Scanned Image' },
              { value: 'docx', label: 'DOCX' },
              { value: 'text', label: 'Text / CSV' },
            ]}
            onChange={(val) => setFormatFilter(val as 'all' | AcademicDocFormat)}
          />

          <CustomSelect
            id="lib-filter-lvl"
            label="Level"
            size="sm"
            value={levelFilter}
            options={[
              { value: 'all', label: 'All Levels' },
              { value: '100L', label: '100L' },
              { value: '200L', label: '200L' },
              { value: '300L', label: '300L' },
              { value: '400L', label: '400L' },
              { value: '500L', label: '500L' },
            ]}
            onChange={(val) => setLevelFilter(val as 'all' | StudentLevel)}
          />
        </div>
      </SurfaceCard>

      {/* Results List */}
      {visibleDocs.length === 0 ? (
        <SurfaceCard tone="white" className="p-8 text-center space-y-3">
          <div className="mx-auto h-12 w-12 rounded-2xl bg-[#F6F7F9] text-[#1D1E23] flex items-center justify-center">
            <BookOpen className="w-5 h-5" />
          </div>
          <h2 className="font-display text-base font-bold text-[#1A1B20]">
            No Published Documents Match Yet
          </h2>
          <p className="text-xs sm:text-sm text-[#505460] max-w-md mx-auto">
            Verified documents appear here once a Super Admin approves them.
          </p>
        </SurfaceCard>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visibleDocs.map((doc) => {
            const chip = statusChip(doc);
            return (
              <SurfaceCard key={doc.id} tone="white" className="p-5 flex flex-col justify-between gap-4">
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-lg bg-[#1D1E23] text-white px-2 py-0.5 font-mono-tabular text-[11px] font-bold">
                        {doc.courseCode}
                      </span>
                      <span className="rounded-lg bg-[#F6F7F9] text-[#505460] px-2 py-0.5 text-[11px] font-semibold">
                        {doc.detectedFormat.toUpperCase()}
                      </span>
                      <span className="rounded-lg bg-[#F6F7F9] text-[#505460] px-2 py-0.5 text-[11px] font-semibold">
                        {CATEGORY_LABELS[doc.category]}
                      </span>
                    </div>
                    <span className={`rounded-lg px-2 py-0.5 text-[11px] font-bold shrink-0 ${chip.cls}`}>
                      {chip.label}
                    </span>
                  </div>

                  <div>
                    <h3 className="font-display text-base font-bold text-[#1A1B20] leading-snug">
                      {doc.title}
                    </h3>
                    <p className="text-xs text-[#686C78] mt-0.5">
                      {doc.schoolCode} · {doc.level} · {doc.pageCount} page(s)
                      {doc.formulas.length > 0 ? ` · ${doc.formulas.length} formula(s)` : ''}
                      {doc.diagrams.length > 0 ? ` · ${doc.diagrams.length} diagram(s)` : ''}
                      {doc.tables.length > 0 ? ` · ${doc.tables.length} table(s)` : ''}
                    </p>
                  </div>

                  {doc.summary && (
                    <p className="text-xs text-[#3A3D47] line-clamp-2">{doc.summary}</p>
                  )}

                  {doc.rejectionReason && doc.submittedById === currentUser.id && (
                    <div className="rounded-xl bg-[#FEF2F2] border border-[#FECACA] px-3 py-2 text-xs text-[#B91C1C]">
                      <span className="font-bold">Review feedback:</span> {doc.rejectionReason}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-[#1A1B20]/[0.06]">
                  <span className="text-[11px] text-[#686C78]">
                    By {doc.submittedByName}
                  </span>
                  <div className="flex items-center gap-2">
                    <TactileButton
                      variant="dark"
                      size="sm"
                      icon={<Eye className="w-3.5 h-3.5" />}
                      onClick={() => {
                        setViewMode('structured');
                        setPageNumber(1);
                        setSelectedDocId(doc.id);
                      }}
                    >
                      Open Reader
                    </TactileButton>
                  </div>
                </div>
              </SurfaceCard>
            );
          })}
        </div>
      )}

      {/* Rich Document Reader Modal */}
      <DetailDialog
        open={Boolean(selectedDoc)}
        onClose={() => setSelectedDocId(null)}
        title={selectedDoc?.title ?? 'Document Reader'}
        subtitle={
          selectedDoc
            ? `${selectedDoc.courseCode} · ${selectedDoc.schoolCode} · ${selectedDoc.level} · ${selectedDoc.session}`
            : undefined
        }
        icon={<FileText className="w-4 h-4" />}
        maxWidthClass="max-w-4xl"
      >
        {selectedDoc && (
          <div className="space-y-4">
            <SectionHeadingBar
              title={`${selectedDoc.courseCode} · ${selectedDoc.detectedFormat.toUpperCase()}`}
              subtitle={
                showTechnical
                  ? `SHA-256 ${selectedDoc.sha256.slice(0, 14)}... · ${selectedDoc.pageCount} page(s)`
                  : `${selectedDoc.pageCount} page(s)`
              }
              right={
                sanitizeSafeUrl(selectedDoc.optimizedPreviewUrl) ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setViewMode('structured')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${
                        viewMode === 'structured'
                          ? 'bg-white text-[#1D1E23]'
                          : 'bg-white/10 text-white'
                      }`}
                    >
                      Structured Content
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('preview')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${
                        viewMode === 'preview'
                          ? 'bg-white text-[#1D1E23]'
                          : 'bg-white/10 text-white'
                      }`}
                    >
                      Page Image
                    </button>
                  </div>
                ) : undefined
              }
            />

            {selectedDoc.rejectionReason && (
              <div className="rounded-2xl bg-[#FEF2F2] border border-[#FECACA] p-3.5 text-xs text-[#B91C1C] flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Super Admin Feedback</p>
                  <p>{selectedDoc.rejectionReason}</p>
                </div>
              </div>
            )}

            {viewMode === 'preview' &&
            sanitizeSafeUrl(activePage?.renderedPreviewUrl ?? selectedDoc.optimizedPreviewUrl) ? (
              <div className="rounded-2xl border border-[#1A1B20]/10 bg-[#F6F7F9] p-3">
                <img
                  src={sanitizeSafeUrl(
                    activePage?.renderedPreviewUrl ?? selectedDoc.optimizedPreviewUrl
                  )}
                  alt={`${selectedDoc.title} page ${pageNumber}`}
                  className="w-full max-h-[520px] object-contain rounded-xl bg-white"
                />
              </div>
            ) : (
              <div className="space-y-4">
                {selectedDoc.pages.length > 0 && activePage && (
                  <div className="rounded-2xl border border-[#1A1B20]/10 bg-[#F6F7F9] p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-bold text-[#1A1B20]">
                        Page {activePage.pageNumber} of {selectedDoc.pages.length}
                        {showTechnical &&
                          activePage.ocrApplied &&
                          activePage.ocrConfidence !== null &&
                          ` · OCR ${activePage.ocrConfidence}% confidence`}
                      </div>

                      {selectedDoc.pages.length > 1 && (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={pageNumber <= 1}
                            onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
                            className="h-8 w-8 rounded-lg bg-white border border-[#1A1B20]/10 flex items-center justify-center disabled:opacity-40 cursor-pointer"
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            disabled={pageNumber >= selectedDoc.pages.length}
                            onClick={() =>
                              setPageNumber((p) => Math.min(selectedDoc.pages.length, p + 1))
                            }
                            className="h-8 w-8 rounded-lg bg-white border border-[#1A1B20]/10 flex items-center justify-center disabled:opacity-40 cursor-pointer"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>

                    {showTechnical && activePage.warnings.length > 0 && (
                      <div className="rounded-xl bg-[#FEF3C7] border border-[#FDE68A] px-3 py-2 text-xs text-[#92400E] flex items-center gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>{activePage.warnings.join(' ')}</span>
                      </div>
                    )}

                    <ScannedPageSideBySide
                      page={activePage}
                      totalPages={selectedDoc.pages.length}
                      imageUrl={pageImageUrl(
                        activePage,
                        activePage.pageNumber === 1 ? selectedDoc.optimizedPreviewUrl : undefined
                      )}
                    />
                  </div>
                )}

                {selectedDoc.formulas.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-display text-sm font-bold text-[#1A1B20]">
                      Extracted Formulas
                    </h4>
                    <ExtractedFormulasList formulas={selectedDoc.formulas} />
                  </div>
                )}

                {selectedDoc.tables.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-display text-sm font-bold text-[#1A1B20]">
                      Extracted Tables
                    </h4>
                    {selectedDoc.tables.map((t) => (
                      <ExtractedTableCard key={t.id} table={t} />
                    ))}
                  </div>
                )}

                {selectedDoc.diagrams.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-display text-sm font-bold text-[#1A1B20]">
                      Preserved Diagrams &amp; Figures
                    </h4>
                    <ExtractedDiagramsGallery diagrams={selectedDoc.diagrams} />
                  </div>
                )}

                {showTechnical && (
                <div className="rounded-2xl border border-[#1A1B20]/10 bg-[#F6F7F9] p-3.5 space-y-2">
                  <p className="text-xs font-bold text-[#1A1B20]">
                    Verification &amp; Integrity Log
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {selectedDoc.deterministicChecks.map((chk) => (
                      <div
                        key={chk.id}
                        className="rounded-xl bg-white border border-[#1A1B20]/[0.06] px-3 py-2 text-xs flex items-start gap-2"
                      >
                        {chk.passed ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#15803D] shrink-0 mt-0.5" />
                        ) : (
                          <AlertTriangle className="w-3.5 h-3.5 text-[#92400E] shrink-0 mt-0.5" />
                        )}
                        <div>
                          <p className="font-semibold text-[#1A1B20]">{chk.label}</p>
                          <p className="text-[#686C78]">{chk.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                )}
              </div>
            )}
          </div>
        )}
      </DetailDialog>
    </div>
  );
};
