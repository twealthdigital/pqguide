import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Eye,
  FileText,
  FolderOpen,
  RotateCcw,
  ScanLine,
  ShieldAlert,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import type {
  AcademicDocCategory,
  AcademicDocumentRecord,
  AppScreen,
  AuthenticatedUser,
  SemesterType,
  StudentLevel,
} from '../core/types';
import { isRestrictedAccount } from '../core/permissions';
import { sanitizeSafeUrl } from '../core/security';
import { archiveRepository } from '../services/archiveRepository';
import { useArchiveStore } from '../hooks/useArchiveStore';
import {
  MAX_SCANNER_BATCH_FILES,
  MAX_SCANNER_FILE_BYTES,
  validateMagicAndSecurity,
} from '../services/intelligence/fileSecurity';
import {
  fileToScanInput,
  inspectAndExtractZipEntries,
  scanSingleAcademicInput,
  type ScanInputFile,
  type ScanProgressUpdate,
  type ScanStageId,
} from '../services/intelligence/documentScannerEngine';
import { validateScannedDocument } from '../services/intelligence/validationEngine';
import {
  AcademicBlocksRenderer,
  ExtractedDiagramsGallery,
  ExtractedFormulasList,
  ExtractedTableCard,
  RichInlineText,
} from '../components/academic/AcademicContentRenderer';
import {
  CustomSelect,
  DetailDialog,
  PqGuideAiIcon,
  SectionHeadingBar,
  SurfaceCard,
  TactileButton,
} from '../components/ui';

interface DocumentScannerScreenProps {
  currentUser: AuthenticatedUser;
  onNavigate: (screen: AppScreen, opts?: { docLibraryId?: string; aiPrompt?: string }) => void;
}

interface QueueItem {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  parentZipName?: string;
  status: 'queued' | 'processing' | 'completed' | 'cancelled' | 'failed';
  stage: ScanStageId;
  stageLabel: string;
  currentPage?: number;
  totalPages?: number;
  error?: string;
  inputFile?: ScanInputFile;
  abortController?: AbortController;
  record?: AcademicDocumentRecord;
}

const LEVELS: StudentLevel[] = ['100L', '200L', '300L', '400L', '500L'];
const SEMESTERS: SemesterType[] = ['First Semester', 'Second Semester'];
const CATEGORIES: Array<{ value: AcademicDocCategory | 'auto'; label: string }> = [
  { value: 'auto', label: 'Auto-Detect Category' },
  { value: 'past_question', label: 'Past Question Paper' },
  { value: 'study_material', label: 'Study Material / Guide' },
  { value: 'lecture_note', label: 'Lecture Notes' },
  { value: 'lab_diagram', label: 'Lab Report & Diagrams' },
  { value: 'reference', label: 'Reference Formula Sheet' },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function decisionBadge(record: AcademicDocumentRecord): {
  label: string;
  toneClass: string;
} {
  if (record.publicationStatus === 'published') {
    return {
      label:
        record.decision === 'auto_approved'
          ? 'Auto-Approved & Published'
          : 'Approved & Published',
      toneClass: 'bg-[#DCFCE7] text-[#15803D] border-[#86EFAC]',
    };
  }
  if (record.publicationStatus === 'rejected') {
    return {
      label: 'Blocked / Rejected',
      toneClass: 'bg-[#FEE2E2] text-[#B91C1C] border-[#FECACA]',
    };
  }
  return {
    label: 'Queued for Super Admin Review',
    toneClass: 'bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]',
  };
}

export const DocumentScannerScreen: React.FC<DocumentScannerScreenProps> = ({
  currentUser,
  onNavigate,
}) => {
  const store = useArchiveStore();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [schoolId, setSchoolId] = useState(
    currentUser.assignedSchoolId || store.selectedSchoolId || store.schools[0]?.id || 'sch-aaua'
  );
  const [level, setLevel] = useState<StudentLevel | 'auto'>('auto' as unknown as StudentLevel);
  const [semester, setSemester] = useState<SemesterType>('First Semester');
  const [categoryOverride, setCategoryOverride] = useState<AcademicDocCategory | 'auto'>('auto');
  const [courseCodeOverride, setCourseCodeOverride] = useState('');
  const [sessionOverride, setSessionOverride] = useState('2024/2025');

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [previewRecord, setPreviewRecord] = useState<AcademicDocumentRecord | null>(null);
  const [previewMode, setPreviewMode] = useState<'extracted' | 'optimized'>('extracted');

  const restricted = isRestrictedAccount(currentUser);

  const patchQueueItem = (id: string, patch: Partial<QueueItem>) => {
    setQueue((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const processSingleQueueItem = async (id: string, inputFile: ScanInputFile) => {
    const controller = new AbortController();
    patchQueueItem(id, {
      status: 'processing',
      stage: 'validating',
      stageLabel: 'Checking magic bytes & format security',
      error: undefined,
      abortController: controller,
    });

    const onProgress = (upd: ScanProgressUpdate) => {
      patchQueueItem(id, {
        stage: upd.stage,
        stageLabel: upd.stageLabel,
        currentPage: upd.currentPage,
        totalPages: upd.totalPages,
      });
    };

    try {
      const artifact = await scanSingleAcademicInput(inputFile, {
        docId: id,
        signal: controller.signal,
        onProgress,
      });

      if (controller.signal.aborted) {
        patchQueueItem(id, {
          status: 'cancelled',
          stage: 'cancelled',
          stageLabel: 'Scan cancelled safely',
        });
        return;
      }

      // Optional server binary optimization & Redis SHA-256 lookup when under 2.5 MB image/document
      let serverOptimizedPreviewUrl: string | undefined;
      let serverDuplicateId: string | undefined;
      if (artifact.detectedFormat === 'image' && inputFile.bytes.byteLength <= 2_400_000) {
        patchQueueItem(id, {
          stage: 'optimizing',
          stageLabel: 'Normalizing scan clarity on server',
        });
        try {
          let b64 = '';
          if (typeof window !== 'undefined') {
            let bin = '';
            const chunk = 0x8000;
            for (let i = 0; i < inputFile.bytes.length; i += chunk) {
              bin += String.fromCharCode(...inputFile.bytes.subarray(i, i + chunk));
            }
            b64 = btoa(bin);
          }
          const srvRes = await fetch('/api/documents/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              docId: id,
              fileName: inputFile.name,
              mimeType: inputFile.type,
              base64Data: b64,
              sha256: artifact.sha256,
            }),
          });
          if (srvRes.ok) {
            const payload = (await srvRes.json()) as {
              ok?: boolean;
              optimizedPreviewUrl?: string;
              duplicateKnownInIndex?: boolean;
              existingDocId?: string;
            };
            if (payload.optimizedPreviewUrl) {
              serverOptimizedPreviewUrl = payload.optimizedPreviewUrl;
            }
            if (payload.duplicateKnownInIndex && payload.existingDocId) {
              serverDuplicateId = payload.existingDocId;
            }
          }
        } catch (err) {
          if ((err as { name?: string })?.name === 'AbortError') throw err;
        }
      }

      patchQueueItem(id, {
        stage: 'deterministic_checks',
        stageLabel: 'Running deterministic integrity, duplicate & structure checks',
      });

      const localDup = archiveRepository.findDocumentBySha256(artifact.sha256);
      const effectiveCourseCode = courseCodeOverride.trim()
        ? courseCodeOverride.trim().toUpperCase()
        : artifact.courseCode;

      patchQueueItem(id, {
        stage: 'ai_cross_check',
        stageLabel: 'Cross-checking academic structure & risk signals',
      });

      const validation = await validateScannedDocument({
        artifact: {
          ...artifact,
          courseCode: effectiveCourseCode,
        },
        duplicateLookup: localDup
          ? {
              isDuplicate: true,
              existingDocId: localDup.id,
              existingTitle: localDup.title,
            }
          : serverDuplicateId
            ? {
                isDuplicate: true,
                existingDocId: serverDuplicateId,
                existingTitle: `Indexed Document (${serverDuplicateId})`,
              }
            : { isDuplicate: false },
        overrideCourseCode: effectiveCourseCode,
        signal: controller.signal,
      });

      patchQueueItem(id, {
        stage: 'decision',
        stageLabel: 'Finalizing verification status & saving to repository',
      });

      const selectedLevel: StudentLevel =
        level === 'auto' ? artifact.level : level;

      const saved = archiveRepository.submitScannedDocument(currentUser, {
        id,
        title: artifact.suggestedTitle,
        courseCode: effectiveCourseCode,
        courseTitle: artifact.courseTitle,
        level: selectedLevel,
        schoolId,
        session: sessionOverride.trim() || artifact.session,
        semester,
        category: categoryOverride === 'auto' ? artifact.category : categoryOverride,
        originalFileName: artifact.fileName,
        mimeType: artifact.mimeType,
        detectedFormat: artifact.detectedFormat,
        fileSizeBytes: artifact.fileSizeBytes,
        sha256: artifact.sha256,
        originalFileRef: artifact.originalStorageRef,
        optimizedPreviewUrl: serverOptimizedPreviewUrl ?? artifact.optimizedPreviewUrl,
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
        deterministicChecks: validation.deterministicChecks,
        aiFindings: validation.aiFindings,
        decision: validation.decision,
        riskLevel: validation.riskLevel,
        decisionReason: validation.decisionReason,
        parentZipName: artifact.parentZipName,
      });

      patchQueueItem(id, {
        status: 'completed',
        stage: 'completed',
        stageLabel: decisionBadge(saved).label,
        record: saved,
        abortController: undefined,
      });
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError' || controller.signal.aborted) {
        patchQueueItem(id, {
          status: 'cancelled',
          stage: 'cancelled',
          stageLabel: 'Scan cancelled cleanly',
          abortController: undefined,
        });
        return;
      }

      patchQueueItem(id, {
        status: 'failed',
        stage: 'failed',
        stageLabel: 'Processing failed',
        error: err instanceof Error ? err.message : 'Unable to scan this file.',
        abortController: undefined,
      });
    }
  };

  const enqueueFiles = async (rawFiles: FileList | File[]) => {
    setBannerError(null);
    if (restricted) {
      setBannerError(
        'Your account is currently in read-only mode. Contact support before scanning new documents.'
      );
      return;
    }

    const files = Array.from(rawFiles);
    if (files.length === 0) return;
    if (files.length > MAX_SCANNER_BATCH_FILES) {
      setBannerError(
        `Please select up to ${MAX_SCANNER_BATCH_FILES} files per upload batch.`
      );
      return;
    }

    const workQueue: Array<{ id: string; input: ScanInputFile }> = [];

    for (const file of files) {
      if (file.size === 0) {
        setQueue((prev) => [
          {
            id: `fail-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            fileName: file.name,
            mimeType: file.type,
            sizeBytes: 0,
            status: 'failed',
            stage: 'failed',
            stageLabel: 'Empty file',
            error: 'File has 0 bytes and cannot be scanned.',
          },
          ...prev,
        ]);
        continue;
      }

      if (file.size > MAX_SCANNER_FILE_BYTES) {
        setQueue((prev) => [
          {
            id: `fail-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            fileName: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
            status: 'failed',
            stage: 'failed',
            stageLabel: 'Size limit exceeded',
            error: `File exceeds the ${Math.round(MAX_SCANNER_FILE_BYTES / (1024 * 1024))} MB limit.`,
          },
          ...prev,
        ]);
        continue;
      }

      const input = await fileToScanInput(file);
      const quickCheck = validateMagicAndSecurity({
        fileName: input.name,
        mimeType: input.type,
        bytes: input.bytes,
      });

      if (!quickCheck.valid) {
        setQueue((prev) => [
          {
            id: `fail-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            fileName: input.name,
            mimeType: input.type,
            sizeBytes: input.size,
            status: 'failed',
            stage: 'failed',
            stageLabel: 'Blocked file signature',
            error: quickCheck.error ?? 'Unsupported or unsafe file.',
            inputFile: input,
          },
          ...prev,
        ]);
        continue;
      }

      if (quickCheck.format === 'zip') {
        try {
          const unpacked = await inspectAndExtractZipEntries(input.bytes, input.name);
          for (const entry of unpacked) {
            const id = `adoc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            setQueue((prev) => [
              {
                id,
                fileName: entry.name,
                mimeType: entry.type,
                sizeBytes: entry.size,
                parentZipName: input.name,
                status: 'queued',
                stage: 'queued',
                stageLabel: `Extracted from ${input.name} · Queued`,
                inputFile: entry,
              },
              ...prev,
            ]);
            workQueue.push({ id, input: entry });
          }
        } catch (err) {
          setQueue((prev) => [
            {
              id: `zipfail-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              fileName: input.name,
              mimeType: input.type,
              sizeBytes: input.size,
              status: 'failed',
              stage: 'failed',
              stageLabel: 'Archive safety check failed',
              error: err instanceof Error ? err.message : 'ZIP archive rejected.',
            },
            ...prev,
          ]);
        }
      } else {
        const id = `adoc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setQueue((prev) => [
          {
            id,
            fileName: input.name,
            mimeType: input.type,
            sizeBytes: input.size,
            status: 'queued',
            stage: 'queued',
            stageLabel: 'Queued for scanning',
            inputFile: input,
          },
          ...prev,
        ]);
        workQueue.push({ id, input });
      }
    }

    // Process queue items sequentially so progress & OCR memory stay smooth
    for (const job of workQueue) {
      await processSingleQueueItem(job.id, job.input);
    }
  };

  const handleCancelItem = (item: QueueItem) => {
    item.abortController?.abort();
  };

  const handleRetryItem = (item: QueueItem) => {
    if (!item.inputFile || item.status === 'processing') return;
    void processSingleQueueItem(item.id, item.inputFile);
  };

  const handleRemoveItem = (id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  };

  const activeCount = useMemo(
    () => queue.filter((q) => q.status === 'processing' || q.status === 'queued').length,
    [queue]
  );

  return (
    <div className="space-y-6 page-enter">
      {/* Header Banner */}
      <SurfaceCard tone="ash" withWaves className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#C3C7D2]">
              <PqGuideAiIcon
                size="sm"
                state={activeCount > 0 ? 'scanning' : 'idle'}
              />
              <span>Document Intelligence Scanner</span>
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-white leading-tight">
              Scan &amp; Verify Academic Documents
            </h1>
            <p className="text-sm text-[#B8BCC8] max-w-2xl">
              Upload past questions, lecture notes, lab diagrams, DOCX files, or ZIP archives.
              PQGuide extracts pages, formulas, tables, diagrams, and runs deterministic + AI cross-checks.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <TactileButton
              variant="light"
              size="sm"
              icon={<FolderOpen className="w-4 h-4" />}
              onClick={() => onNavigate('document_library')}
            >
              Document Library
            </TactileButton>
            <TactileButton
              variant="light"
              size="sm"
              icon={<PqGuideAiIcon size="xs" state="idle" />}
              onClick={() => onNavigate('ai_assistant')}
            >
              Ask PQGuide AI
            </TactileButton>
          </div>
        </div>
      </SurfaceCard>

      {bannerError && (
        <div
          role="alert"
          className="rounded-2xl bg-[#FEF2F2] border border-[#FECACA] px-4 py-3 text-xs font-semibold text-[#B91C1C] flex items-center gap-2"
        >
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>{bannerError}</span>
        </div>
      )}

      {/* Optional Course Context */}
      <SurfaceCard tone="white" className="p-5 space-y-4">
        <SectionHeadingBar
          title="Submission Metadata (Optional Overrides)"
          subtitle="Leave blank or Auto-Detect to extract course codes, formulas, and topics automatically from the document"
          icon={<ScanLine className="w-4 h-4" />}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          <CustomSelect
            id="scan-school"
            label="University"
            value={schoolId}
            options={store.schools
              .filter((s) => s.isActive)
              .map((s) => ({ value: s.id, label: `${s.code} — ${s.shortName}` }))}
            onChange={setSchoolId}
          />

          <CustomSelect
            id="scan-level"
            label="Academic Level"
            value={level as string}
            options={[
              { value: 'auto', label: 'Auto-Detect Level' },
              ...LEVELS.map((l) => ({ value: l, label: l })),
            ]}
            onChange={(val) => setLevel(val as StudentLevel)}
          />

          <CustomSelect
            id="scan-semester"
            label="Semester"
            value={semester}
            options={SEMESTERS.map((s) => ({ value: s, label: s }))}
            onChange={(val) => setSemester(val as SemesterType)}
          />

          <CustomSelect
            id="scan-category"
            label="Document Category"
            value={categoryOverride}
            options={CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
            onChange={(val) => setCategoryOverride(val as AcademicDocCategory | 'auto')}
          />

          <div>
            <label
              htmlFor="scan-course-code"
              className="block text-xs font-medium text-[#686C78] mb-1.5"
            >
              Course Code Hint
            </label>
            <input
              id="scan-course-code"
              type="text"
              value={courseCodeOverride}
              onChange={(e) => setCourseCodeOverride(e.target.value)}
              placeholder="e.g. CSC 201 (auto if blank)"
              className="w-full min-h-[44px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3.5 text-sm font-medium text-[#1A1B20] placeholder:text-[#8E93A2] focus:outline-none focus:border-[#1D1E23] focus:bg-white"
            />
          </div>

          <div>
            <label
              htmlFor="scan-session"
              className="block text-xs font-medium text-[#686C78] mb-1.5"
            >
              Session
            </label>
            <input
              id="scan-session"
              type="text"
              value={sessionOverride}
              onChange={(e) => setSessionOverride(e.target.value)}
              placeholder="e.g. 2024/2025"
              className="w-full min-h-[44px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3.5 text-sm font-mono-tabular font-medium text-[#1A1B20] placeholder:text-[#8E93A2] focus:outline-none focus:border-[#1D1E23] focus:bg-white"
            />
          </div>
        </div>
      </SurfaceCard>

      {/* Drag and Drop Upload Area */}
      <SurfaceCard tone="white" className="p-5">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (e.dataTransfer.files?.length) {
              void enqueueFiles(e.dataTransfer.files);
            }
          }}
          className={`rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
            isDragging
              ? 'border-[#1D1E23] bg-[#EFF1F5]'
              : 'border-[#1A1B20]/15 bg-[#F6F7F9]'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.zip,.txt,.md,.csv"
            onChange={(e) => {
              if (e.target.files?.length) {
                void enqueueFiles(e.target.files);
              }
              e.target.value = '';
            }}
            className="hidden"
          />

          <div className="mx-auto h-14 w-14 rounded-2xl bg-[#1D1E23] text-white flex items-center justify-center mb-3">
            {activeCount > 0 ? (
              <PqGuideAiIcon size="lg" state="scanning" />
            ) : (
              <UploadCloud className="w-6 h-6" />
            )}
          </div>

          <h2 className="font-display text-base sm:text-lg font-bold text-[#1A1B20]">
            Drop Academic Documents Here
          </h2>
          <p className="text-xs sm:text-sm text-[#505460] mt-1 max-w-lg mx-auto">
            Supports multi-file batches up to 15 MB per file: PDF, PNG, JPG, JPEG, WEBP, DOCX,
            ZIP archives, TXT, MD, and CSV. Scripts, SVG, HTML, executables, and zip bombs are blocked.
          </p>

          <div className="mt-5 flex flex-wrap justify-center gap-2.5">
            <TactileButton
              variant="dark"
              size="md"
              icon={<ScanLine className="w-4 h-4" />}
              disabled={restricted}
              onClick={() => fileInputRef.current?.click()}
            >
              Choose Files to Scan
            </TactileButton>
          </div>
        </div>
      </SurfaceCard>

      {/* Processing Queue & Results */}
      {queue.length > 0 && (
        <SurfaceCard tone="white" className="p-5 space-y-4">
          <SectionHeadingBar
            title={`Scanning Session (${queue.length} document${queue.length === 1 ? '' : 's'})`}
            subtitle={
              activeCount > 0
                ? `${activeCount} file(s) currently scanning...`
                : 'All queued documents finished processing'
            }
            icon={
              activeCount > 0 ? (
                <PqGuideAiIcon size="sm" state="scanning" />
              ) : (
                <FileText className="w-4 h-4" />
              )
            }
          />

          <div className="space-y-3">
            {queue.map((item) => {
              const badge = item.record ? decisionBadge(item.record) : null;
              return (
                <div
                  key={item.id}
                  className="rounded-2xl border border-[#1A1B20]/10 bg-[#F6F7F9] p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className="h-10 w-10 rounded-xl bg-white border border-[#1A1B20]/10 flex items-center justify-center shrink-0">
                        {item.status === 'processing' ? (
                          <PqGuideAiIcon size="sm" state="scanning" />
                        ) : item.status === 'completed' ? (
                          <CheckCircle2 className="w-5 h-5 text-[#15803D]" />
                        ) : item.status === 'failed' ? (
                          <ShieldAlert className="w-5 h-5 text-[#B91C1C]" />
                        ) : item.parentZipName ? (
                          <Archive className="w-5 h-5 text-[#505460]" />
                        ) : (
                          <FileText className="w-5 h-5 text-[#1D1E23]" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-display text-sm font-bold text-[#1A1B20] truncate">
                            {item.fileName}
                          </p>
                          <span className="font-mono-tabular text-[11px] text-[#686C78]">
                            {formatBytes(item.sizeBytes)}
                          </span>
                          {item.parentZipName && (
                            <span className="rounded-md bg-[#ECEEF3] px-2 py-0.5 text-[10px] font-semibold text-[#505460]">
                              From {item.parentZipName}
                            </span>
                          )}
                        </div>

                        <p className="text-xs text-[#505460] mt-0.5">
                          {item.stageLabel}
                          {item.currentPage && item.totalPages
                            ? ` (Page ${item.currentPage} of ${item.totalPages})`
                            : ''}
                        </p>

                        {item.error && (
                          <p className="mt-1.5 rounded-xl bg-[#FEF2F2] border border-[#FECACA] px-3 py-1.5 text-xs font-medium text-[#B91C1C]">
                            {item.error}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {badge && (
                        <span
                          className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold ${badge.toneClass}`}
                        >
                          {badge.label}
                        </span>
                      )}

                      {item.status === 'processing' && (
                        <TactileButton
                          variant="light"
                          size="sm"
                          icon={<X className="w-3.5 h-3.5" />}
                          onClick={() => handleCancelItem(item)}
                        >
                          Cancel
                        </TactileButton>
                      )}

                      {(item.status === 'failed' || item.status === 'cancelled') &&
                        item.inputFile && (
                          <TactileButton
                            variant="dark"
                            size="sm"
                            icon={<RotateCcw className="w-3.5 h-3.5" />}
                            onClick={() => handleRetryItem(item)}
                          >
                            Retry
                          </TactileButton>
                        )}

                      {item.status === 'completed' && item.record && (
                        <TactileButton
                          variant="dark"
                          size="sm"
                          icon={<Eye className="w-3.5 h-3.5" />}
                          onClick={() => {
                            setPreviewMode('extracted');
                            setPreviewRecord(item.record ?? null);
                          }}
                        >
                          Preview Result
                        </TactileButton>
                      )}

                      {item.status !== 'processing' && (
                        <button
                          type="button"
                          aria-label={`Dismiss ${item.fileName}`}
                          onClick={() => handleRemoveItem(item.id)}
                          className="h-9 w-9 rounded-xl bg-white border border-[#1A1B20]/10 text-[#686C78] hover:text-[#B91C1C] flex items-center justify-center cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </SurfaceCard>
      )}

      {/* Completed Document Inspection Dialog */}
      <DetailDialog
        open={Boolean(previewRecord)}
        onClose={() => setPreviewRecord(null)}
        title={previewRecord?.title ?? 'Scanned Document Preview'}
        subtitle={
          previewRecord
            ? `${previewRecord.courseCode} · ${previewRecord.detectedFormat.toUpperCase()} · ${previewRecord.pageCount} page(s)`
            : undefined
        }
        icon={<FileText className="w-4 h-4" />}
        maxWidthClass="max-w-3xl"
        footer={
          previewRecord ? (
            <>
              <TactileButton
                variant="light"
                size="sm"
                icon={<FolderOpen className="w-3.5 h-3.5" />}
                onClick={() => {
                  const id = previewRecord.id;
                  setPreviewRecord(null);
                  onNavigate('document_library', { docLibraryId: id });
                }}
              >
                Open in Document Library
              </TactileButton>
              <TactileButton
                variant="dark"
                size="sm"
                icon={<PqGuideAiIcon size="xs" state="idle" />}
                onClick={() => {
                  const prompt = `Summarize key concepts and exam topics from ${previewRecord.courseCode} (${previewRecord.title})`;
                  setPreviewRecord(null);
                  onNavigate('ai_assistant', { aiPrompt: prompt, docLibraryId: previewRecord.id });
                }}
              >
                Ask PQGuide AI
              </TactileButton>
            </>
          ) : null
        }
      >
        {previewRecord && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-[#F6F7F9] p-3 border border-[#1A1B20]/10">
              <div className="space-y-0.5 text-xs">
                <p className="font-bold text-[#1A1B20]">{decisionBadge(previewRecord).label}</p>
                <p className="text-[#505460]">
                  SHA-256: <span className="font-mono-tabular">{previewRecord.sha256.slice(0, 16)}...</span>
                  {previewRecord.averageOcrConfidence !== null &&
                    ` · OCR Confidence: ${previewRecord.averageOcrConfidence}%`}
                </p>
              </div>
              {sanitizeSafeUrl(previewRecord.optimizedPreviewUrl) && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPreviewMode('extracted')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer ${
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
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer ${
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

            {previewMode === 'optimized' && sanitizeSafeUrl(previewRecord.optimizedPreviewUrl) ? (
              <div className="rounded-2xl border border-[#1A1B20]/10 bg-[#F6F7F9] p-3">
                <img
                  src={sanitizeSafeUrl(previewRecord.optimizedPreviewUrl)}
                  alt={`Optimized scan of ${previewRecord.title}`}
                  className="w-full max-h-[420px] object-contain rounded-xl bg-white"
                />
              </div>
            ) : (
              <div className="space-y-4">
                {previewRecord.summary && (
                  <div className="rounded-2xl bg-[#F6F7F9] p-3.5 text-xs sm:text-sm text-[#1A1B20]">
                    <p className="font-bold text-xs uppercase tracking-wider text-[#686C78] mb-1">
                      Summary
                    </p>
                    <RichInlineText text={previewRecord.summary} />
                  </div>
                )}

                {previewRecord.formulas.length > 0 && (
                  <ExtractedFormulasList formulas={previewRecord.formulas} />
                )}

                {previewRecord.tables.length > 0 && (
                  <div className="space-y-2">
                    {previewRecord.tables.map((t) => (
                      <ExtractedTableCard key={t.id} table={t} />
                    ))}
                  </div>
                )}

                {previewRecord.diagrams.length > 0 && (
                  <ExtractedDiagramsGallery diagrams={previewRecord.diagrams} />
                )}

                {previewRecord.extractedText && (
                  <div className="rounded-2xl border border-[#1A1B20]/10 bg-white p-3.5 space-y-1.5">
                    <p className="font-bold text-xs uppercase tracking-wider text-[#686C78]">
                      Extracted Text
                    </p>
                    <RichInlineText
                      text={previewRecord.extractedText.slice(0, 3500)}
                      className="text-xs sm:text-sm text-[#3A3D47]"
                    />
                  </div>
                )}

                <AcademicBlocksRenderer
                  blocks={previewRecord.deterministicChecks
                    .filter((c) => !c.passed)
                    .map((c) => ({
                      type: 'paragraph' as const,
                      title: c.label,
                      text: c.detail,
                    }))}
                />

                {previewRecord.aiFindings && (
                  <div className="rounded-2xl border border-[#1A1B20]/10 bg-[#F6F7F9] p-3.5 text-xs space-y-1">
                    <div className="flex items-center gap-1.5 font-bold text-[#1A1B20]">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>
                        Verification Assessment ({previewRecord.riskLevel.toUpperCase()} risk)
                      </span>
                    </div>
                    <p className="text-[#505460]">{previewRecord.aiFindings.reason}</p>
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
