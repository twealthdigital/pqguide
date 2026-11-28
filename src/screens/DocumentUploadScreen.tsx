import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  Loader2,
  Pencil,
  RotateCcw,
  ShieldAlert,
  Trash2,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import type {
  AcademicDocCategory,
  AcademicDocumentRecord,
  AuthenticatedUser,
  DocumentPublishOptions,
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
  DetailDialog,
  SectionHeadingBar,
  SurfaceCard,
  TactileButton,
} from '../components/ui';

interface DocumentUploadScreenProps {
  currentUser: AuthenticatedUser;
  /** A Super Admin previewing the School Admin workspace sees what a School Admin sees. */
  asSchoolAdmin?: boolean;
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
  /** Set when this file replaces an existing upload ("Update"). */
  replaceDocId?: string;
}

const CATEGORY_LABELS: Record<AcademicDocCategory, string> = {
  past_question: 'Past question',
  study_material: 'Study material',
  lecture_note: 'Lecture note',
  lab_diagram: 'Lab diagram',
  reference: 'Reference',
};

const LEVEL_OPTIONS: StudentLevel[] = ['100L', '200L', '300L', '400L', '500L'];
const SEMESTER_OPTIONS: SemesterType[] = ['First Semester', 'Second Semester'];

const DESTINATION_OPTIONS: Array<{ value: DocumentPublishOptions['destination']; label: string }> = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'past_question', label: 'Past Questions' },
  { value: 'study_material', label: 'Materials' },
];

const NOTIFY_OPTIONS: Array<{ value: DocumentPublishOptions['notify']; label: string }> = [
  { value: 'students', label: 'Students' },
  { value: 'school_admins', label: 'School Admins' },
  { value: 'both', label: 'Both' },
  { value: 'none', label: 'No alert' },
];

function destinationLabel(d?: string): string {
  return d === 'past_question' ? 'Past Questions' : d === 'study_material' ? 'Materials' : 'the student side';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * What the person who uploaded sees. The scanning, typed conversion and AI
 * cross-check all run in the background, so only the outcome is shown.
 */
function uploadStatus(
  record: AcademicDocumentRecord,
  isSuperAdmin = true
): {
  label: string;
  note: string;
  toneClass: string;
} {
  // School admins only ever see Pending until the Super Admin publishes, or explicitly
  // declines / asks for a new copy. Automated check results are never shown to them.
  const decidedBySuperAdmin =
    Boolean(record.reviewerId) &&
    (record.publicationStatus === 'rejected' || record.publicationStatus === 'resubmission_requested');
  if (!isSuperAdmin && record.publicationStatus !== 'published' && !decidedBySuperAdmin) {
    return {
      label: 'Pending',
      note: 'Waiting for the Super Admin.',
      toneClass: 'bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]',
    };
  }
  if (record.publicationStatus === 'published') {
    return {
      label: 'Published',
      note: 'Live and available.',
      toneClass: 'bg-[#DCFCE7] text-[#15803D] border-[#86EFAC]',
    };
  }
  if (record.publicationStatus === 'rejected') {
    return {
      label: 'Declined',
      note: record.rejectionReason || 'This document was declined.',
      toneClass: 'bg-[#FEE2E2] text-[#B91C1C] border-[#FECACA]',
    };
  }
  if (record.publicationStatus === 'resubmission_requested') {
    return {
      label: 'Resubmit',
      note: record.rejectionReason || 'A clearer copy is needed.',
      toneClass: 'bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]',
    };
  }
  if (record.publicationStatus === 'flagged' || record.decision !== 'auto_approved') {
    return {
      label: 'Needs attention',
      note: 'The automatic checks found an issue with this document.',
      toneClass: 'bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]',
    };
  }
  return {
    label: 'Success',
    note: 'Converted to a typed document and cross-checked. Waiting for the Super Admin to publish.',
    toneClass: 'bg-[#DCFCE7] text-[#15803D] border-[#86EFAC]',
  };
}

export const DocumentUploadScreen: React.FC<DocumentUploadScreenProps> = ({
  currentUser,
  asSchoolAdmin = false,
}) => {
  const store = useArchiveStore();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const isSuperAdmin = currentUser.role === 'super_admin' && !asSchoolAdmin;
  const schoolId =
    currentUser.assignedSchoolId || store.selectedSchoolId || store.schools[0]?.id || 'sch-aaua';
  // Everything below is detected automatically from the document itself.
  const level: StudentLevel | 'auto' = 'auto';
  const semester: SemesterType = 'First Semester';
  const categoryOverride: AcademicDocCategory | 'auto' = 'auto';
  const courseCodeOverride = '';
  const sessionOverride = '';

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewRecord, setPreviewRecord] = useState<AcademicDocumentRecord | null>(null);
  const [previewMode, setPreviewMode] = useState<'extracted' | 'optimized'>('extracted');
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Super Admin: where published documents go and who is alerted.
  const [publishOptions, setPublishOptions] = useState<DocumentPublishOptions>({
    destination: 'auto',
    notify: 'students',
  });
  const publishOptionsRef = useRef(publishOptions);
  useEffect(() => {
    publishOptionsRef.current = publishOptions;
  }, [publishOptions]);

  // Edit dialog + "Update" (replace file)
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const [replaceTargetId, setReplaceTargetId] = useState<string | null>(null);
  const [editingDoc, setEditingDoc] = useState<AcademicDocumentRecord | null>(null);
  const [editForm, setEditForm] = useState({
    title: '',
    courseCode: '',
    courseTitle: '',
    level: '100L' as StudentLevel,
    session: '',
    semester: 'First Semester' as SemesterType,
    category: 'past_question' as AcademicDocCategory,
  });

  const restricted = isRestrictedAccount(currentUser);

  // Failed uploads are reported to the Super Admin only (never to the uploader).
  const reportFailure = (fileName: string, reason: string) => {
    try {
      archiveRepository.reportUploadFailure(currentUser, { fileName, reason });
    } catch {
      /* reporting must never break the upload screen */
    }
  };

  const patchQueueItem = (id: string, patch: Partial<QueueItem>) => {
    setQueue((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const processSingleQueueItem = async (
    id: string,
    inputFile: ScanInputFile,
    replaceDocId?: string
  ) => {
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
      const effectiveCourseCode = artifact.courseCode;

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
        session: sessionOverride || artifact.session,
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
        replaceDocId,
      });

      // Super Admin uploads go live straight away (when the checks pass), routed to the
      // chosen destination and alerting only the chosen recipients.
      let finalRecord = saved;
      if (isSuperAdmin && saved.decision === 'auto_approved' && saved.publicationStatus === 'pending_review') {
        try {
          finalRecord = archiveRepository.reviewSubmittedDocument(currentUser, saved.id, 'approve', {
            publish: publishOptionsRef.current,
          });
          setNotice(`"${finalRecord.title}" published to ${destinationLabel(finalRecord.publishedTo)}.`);
        } catch {
          /* stays pending; the Publish button is still available */
        }
      }

      patchQueueItem(id, {
        status: 'completed',
        stage: 'completed',
        stageLabel: uploadStatus(finalRecord).label,
        record: finalRecord,
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

      const reason = err instanceof Error ? err.message : 'Unable to process this file.';
      reportFailure(inputFile.name, reason);
      patchQueueItem(id, {
        status: 'failed',
        stage: 'failed',
        stageLabel: 'Processing failed',
        error: reason,
        abortController: undefined,
      });
    }
  };

  const enqueueFiles = async (rawFiles: FileList | File[], replaceDocId?: string) => {
    setBannerError(null);
    if (restricted) {
      setBannerError(
        'Your account is currently in read-only mode. Contact support before uploading new documents.'
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

    if (replaceDocId && files.length !== 1) {
      setBannerError('Choose one file to update this document.');
      return;
    }

    const workQueue: Array<{ id: string; input: ScanInputFile; replaceDocId?: string }> = [];

    for (const file of files) {
      if (file.size === 0) {
        reportFailure(file.name, 'File has 0 bytes.');
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
        reportFailure(file.name, 'File is over the size limit.');
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
        reportFailure(input.name, quickCheck.error ?? 'Unsupported or unsafe file.');
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

      if (replaceDocId && quickCheck.format === 'zip') {
        setBannerError('Choose a single document (not a ZIP) to update this upload.');
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
          reportFailure(input.name, err instanceof Error ? err.message : 'ZIP archive rejected.');
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
            replaceDocId,
          },
          ...prev,
        ]);
        workQueue.push({ id, input, replaceDocId });
      }
    }

    // Process queue items sequentially so progress & OCR memory stay smooth
    for (const job of workQueue) {
      await processSingleQueueItem(job.id, job.input, job.replaceDocId);
    }
  };

  const handleRetryItem = (item: QueueItem) => {
    if (!item.inputFile || item.status === 'processing') return;
    void processSingleQueueItem(item.id, item.inputFile, item.replaceDocId);
  };

  const handleRemoveItem = (id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  };

  const pendingCount = useMemo(
    () => queue.filter((q) => q.status === 'processing' || q.status === 'queued').length,
    [queue]
  );

  const visibleQueue = queue.filter((q) => q.status !== 'completed');

  const uploads = useMemo(() => {
    const all = store.academicDocuments ?? [];
    return all
      .filter((d) =>
        isSuperAdmin ? true : currentUser.assignedSchoolId ? d.schoolId === currentUser.assignedSchoolId : d.submittedById === currentUser.id
      )
      .slice()
      .sort((x, y) => (y.submittedAt > x.submittedAt ? 1 : -1));
  }, [store.academicDocuments, isSuperAdmin, currentUser.assignedSchoolId, currentUser.id]);

  const runAction = (fn: () => string | void, success: string) => {
    setBannerError(null);
    setNotice(null);
    try {
      setNotice(fn() || success);
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'That action could not be completed.');
    }
  };

  const handlePublish = (doc: AcademicDocumentRecord) =>
    runAction(
      () => {
        const published = archiveRepository.reviewSubmittedDocument(currentUser, doc.id, 'approve', {
          publish: publishOptions,
        });
        return `"${doc.title}" published to ${destinationLabel(published.publishedTo)}.`;
      },
      `"${doc.title}" published.`
    );

  const handleDecline = (doc: AcademicDocumentRecord) =>
    runAction(() => {
      archiveRepository.reviewSubmittedDocument(currentUser, doc.id, 'reject', {
        rejectionReason: declineReason,
      });
      setDecliningId(null);
      setDeclineReason('');
    }, `"${doc.title}" declined and the uploader was notified.`);

  const handleDelete = (doc: AcademicDocumentRecord) =>
    runAction(() => {
      archiveRepository.deleteAcademicDocument(currentUser, doc.id);
      setConfirmDeleteId(null);
    }, `"${doc.title}" deleted.`);

  const openEdit = (doc: AcademicDocumentRecord) => {
    setEditForm({
      title: doc.title,
      courseCode: doc.courseCode,
      courseTitle: doc.courseTitle,
      level: doc.level,
      session: doc.session,
      semester: doc.semester,
      category: doc.category,
    });
    setEditingDoc(doc);
    setDecliningId(null);
    setConfirmDeleteId(null);
  };

  const handleSaveEdit = () => {
    if (!editingDoc) return;
    const doc = editingDoc;
    runAction(() => {
      archiveRepository.updateAcademicDocumentDetails(currentUser, doc.id, editForm);
      setEditingDoc(null);
      return isSuperAdmin
        ? `"${editForm.title}" updated${doc.submittedByRole === 'school_admin' ? '. Only its School Admin was alerted.' : '.'}`
        : `"${editForm.title}" updated. It is Pending until the Super Admin verifies it.`;
    }, 'Updated.');
  };

  const startReplace = (doc: AcademicDocumentRecord) => {
    setReplaceTargetId(doc.id);
    replaceInputRef.current?.click();
  };

  const canManage = (doc: AcademicDocumentRecord) =>
    isSuperAdmin || doc.submittedById === currentUser.id;

  return (
    <div className="space-y-6 page-enter">
      <SurfaceCard tone="white" className="p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#1D1E23] text-white">
            {pendingCount > 0 ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <UploadCloud className="w-5 h-5" />
            )}
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-base sm:text-lg font-bold text-[#1A1B20]">
              Upload Documents
            </h2>
            <p className="mt-1 text-xs sm:text-sm text-[#505460] max-w-2xl">
              Upload past questions, notes, DOCX files or ZIP archives. Each file shows as Pending
              while it is converted into a typed document and cross-checked in the background, then
              updates to Success.
              {isSuperAdmin
                ? ' Documents are sent to Past Questions or Materials automatically. Your own uploads go live straight away; choose where and who is alerted below.'
                : ' You can edit, update or delete your uploads. Everything stays Pending until the Super Admin publishes it.'}
            </p>
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

      {notice && (
        <div
          role="status"
          className="rounded-2xl bg-[#F0FDF4] border border-[#BBF7D0] px-4 py-3 text-xs font-semibold text-[#15803D] flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {isSuperAdmin && (
        <SurfaceCard tone="white" className="p-5 space-y-4">
          <div>
            <h3 className="font-display text-sm font-bold text-[#1A1B20]">Publish settings</h3>
            <p className="mt-0.5 text-xs text-[#505460]">
              Used for your own uploads and for every Publish / Force publish button below.
            </p>
          </div>
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#686C78]">Publish to</p>
            <div className="flex flex-wrap gap-2">
              {DESTINATION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={publishOptions.destination === opt.value}
                  onClick={() => setPublishOptions((prev) => ({ ...prev, destination: opt.value }))}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold cursor-pointer border ${
                    publishOptions.destination === opt.value
                      ? 'bg-[#1D1E23] text-white border-[#1D1E23]'
                      : 'bg-white text-[#505460] border-[#1A1B20]/10'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {publishOptions.destination === 'auto' && (
              <p className="text-[11px] text-[#686C78]">
                Past questions go to Past Questions; notes, materials and everything else go to Materials.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#686C78]">Send alert to</p>
            <div className="flex flex-wrap gap-2">
              {NOTIFY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={publishOptions.notify === opt.value}
                  onClick={() => setPublishOptions((prev) => ({ ...prev, notify: opt.value }))}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold cursor-pointer border ${
                    publishOptions.notify === opt.value
                      ? 'bg-[#1D1E23] text-white border-[#1D1E23]'
                      : 'bg-white text-[#505460] border-[#1A1B20]/10'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </SurfaceCard>
      )}

      <input
        ref={replaceInputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.txt,.md,.csv"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const target = replaceTargetId;
          e.target.value = '';
          setReplaceTargetId(null);
          if (file && target) void enqueueFiles([file], target);
        }}
        className="hidden"
      />

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
            isDragging ? 'border-[#1D1E23] bg-[#EFF1F5]' : 'border-[#1A1B20]/15 bg-[#F6F7F9]'
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
            <UploadCloud className="w-6 h-6" />
          </div>
          <h3 className="font-display text-base sm:text-lg font-bold text-[#1A1B20]">
            Drop documents here
          </h3>
          <p className="text-xs sm:text-sm text-[#505460] mt-1 max-w-lg mx-auto">
            PDF, PNG, JPG, WEBP, DOCX, ZIP, TXT, MD or CSV, up to 15 MB per file. Several files at once is fine.
          </p>
          <div className="mt-5 flex justify-center">
            <TactileButton
              variant="dark"
              size="md"
              icon={<UploadCloud className="w-4 h-4" />}
              disabled={restricted}
              onClick={() => fileInputRef.current?.click()}
            >
              Choose files
            </TactileButton>
          </div>
        </div>
      </SurfaceCard>

      {(visibleQueue.length > 0 || uploads.length > 0) && (
        <SurfaceCard tone="white" className="p-5 space-y-4">
          <SectionHeadingBar
            title={isSuperAdmin ? `All uploads (${visibleQueue.length + uploads.length})` : `Your uploads (${visibleQueue.length + uploads.length})`}
            subtitle={pendingCount > 0 ? `${pendingCount} pending` : 'Everything is up to date'}
            icon={<FileText className="w-4 h-4" />}
          />

          <div className="space-y-3">
            {visibleQueue.map((item) => {
              const isPending =
                item.status === 'processing' ||
                item.status === 'queued' ||
                (!isSuperAdmin && (item.status === 'failed' || item.status === 'cancelled'));
              return (
                <div
                  key={item.id}
                  className="rounded-2xl border border-[#1A1B20]/10 bg-[#F6F7F9] p-4 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="flex items-start gap-3 min-w-[220px] flex-1">
                    <div className="h-10 w-10 rounded-xl bg-white border border-[#1A1B20]/10 flex items-center justify-center shrink-0">
                      {isPending ? (
                        <Clock className="w-5 h-5 text-[#92400E]" />
                      ) : (
                        <XCircle className="w-5 h-5 text-[#B91C1C]" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-display text-sm font-bold text-[#1A1B20] truncate">
                          {item.fileName}
                        </p>
                        <span className="font-mono-tabular text-[11px] text-[#686C78]">
                          {formatBytes(item.sizeBytes)}
                        </span>
                        {item.parentZipName && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-[#ECEEF3] px-2 py-0.5 text-[10px] font-semibold text-[#505460]">
                            <Archive className="w-3 h-3" />
                            {item.parentZipName}
                          </span>
                        )}
                      </div>
                      {isSuperAdmin && item.error && (
                        <p className="mt-1 text-xs font-medium text-[#B91C1C]">{item.error}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold ${
                        isPending
                          ? 'bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]'
                          : 'bg-[#FEE2E2] text-[#B91C1C] border-[#FECACA]'
                      }`}
                    >
                      {isPending ? 'Pending' : 'Failed'}
                    </span>
                    {!isPending && item.inputFile && (
                      <TactileButton
                        variant="dark"
                        size="sm"
                        icon={<RotateCcw className="w-3.5 h-3.5" />}
                        onClick={() => handleRetryItem(item)}
                      >
                        Retry
                      </TactileButton>
                    )}
                    {!isPending && (
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
              );
            })}

            {uploads.map((doc) => {
              const status = uploadStatus(doc, isSuperAdmin);
              const canView = isSuperAdmin || status.label !== 'Pending';
              const isPublished = doc.publicationStatus === 'published';
              return (
                <div
                  key={doc.id}
                  className="rounded-2xl border border-[#1A1B20]/10 bg-[#F6F7F9] p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-[220px] flex-1">
                      <p className="font-display text-sm font-bold text-[#1A1B20] truncate">
                        {doc.title}
                      </p>
                      <p className="text-xs text-[#505460] mt-0.5">
                        {doc.courseCode} · {doc.schoolCode} · {doc.pageCount} page
                        {doc.pageCount === 1 ? '' : 's'}
                        {isSuperAdmin ? ` · by ${doc.submittedByName}` : ''}
                      </p>
                      <p className="text-xs text-[#686C78] mt-1">{status.note}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <span
                        className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold ${status.toneClass}`}
                      >
                        {status.label}
                      </span>
                      {canView && (
                        <TactileButton
                          variant="light"
                          size="sm"
                          icon={<Eye className="w-3.5 h-3.5" />}
                          onClick={() => {
                            setPreviewMode('extracted');
                            setPreviewRecord(doc);
                          }}
                        >
                          View
                        </TactileButton>
                      )}
                    </div>
                  </div>

                  {canManage(doc) && (
                    <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-[#1A1B20]/[0.07]">
                      {isSuperAdmin && !isPublished && (
                        <TactileButton
                          variant="dark"
                          size="sm"
                          icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                          onClick={() => handlePublish(doc)}
                        >
                          {doc.publicationStatus === 'flagged' || doc.publicationStatus === 'rejected'
                            ? 'Force publish'
                            : 'Publish'}
                        </TactileButton>
                      )}
                      {isSuperAdmin && doc.publicationStatus !== 'rejected' && (
                        <TactileButton
                          variant="light"
                          size="sm"
                          icon={<XCircle className="w-3.5 h-3.5 text-[#B91C1C]" />}
                          onClick={() => {
                            setDecliningId(decliningId === doc.id ? null : doc.id);
                            setDeclineReason('');
                            setConfirmDeleteId(null);
                          }}
                        >
                          Decline
                        </TactileButton>
                      )}
                      <TactileButton
                        variant="light"
                        size="sm"
                        icon={<Pencil className="w-3.5 h-3.5" />}
                        onClick={() => openEdit(doc)}
                      >
                        Edit
                      </TactileButton>
                      <TactileButton
                        variant="light"
                        size="sm"
                        icon={<UploadCloud className="w-3.5 h-3.5" />}
                        disabled={restricted}
                        onClick={() => startReplace(doc)}
                      >
                        Update
                      </TactileButton>
                      <TactileButton
                        variant="light"
                        size="sm"
                        icon={<Trash2 className="w-3.5 h-3.5 text-[#B91C1C]" />}
                        onClick={() => {
                          setConfirmDeleteId(confirmDeleteId === doc.id ? null : doc.id);
                          setDecliningId(null);
                        }}
                      >
                        Delete
                      </TactileButton>
                    </div>
                  )}

                  {isSuperAdmin && decliningId === doc.id && (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={declineReason}
                        onChange={(e) => setDeclineReason(e.target.value)}
                        placeholder="Reason sent to the uploader"
                        className="flex-1 min-w-[200px] min-h-[40px] rounded-xl bg-white border border-[#1A1B20]/10 px-3 text-sm"
                      />
                      <TactileButton variant="dark" size="sm" onClick={() => handleDecline(doc)}>
                        Confirm decline
                      </TactileButton>
                    </div>
                  )}

                  {canManage(doc) && confirmDeleteId === doc.id && (
                    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-[#FEF2F2] border border-[#FECACA] px-3 py-2">
                      <AlertTriangle className="w-4 h-4 text-[#B91C1C] shrink-0" />
                      <span className="text-xs font-semibold text-[#B91C1C] flex-1 min-w-[160px]">
                        Delete this document permanently?
                      </span>
                      <TactileButton variant="dark" size="sm" onClick={() => handleDelete(doc)}>
                        Yes, delete
                      </TactileButton>
                    </div>
                  )}
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
        title={previewRecord?.title ?? 'Document Preview'}
        subtitle={
          previewRecord
            ? `${previewRecord.courseCode} · ${previewRecord.detectedFormat.toUpperCase()} · ${previewRecord.pageCount} page(s)`
            : undefined
        }
        icon={<FileText className="w-4 h-4" />}
        maxWidthClass="max-w-3xl"
        footer={
          null
        }
      >
        {previewRecord && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-[#F6F7F9] p-3 border border-[#1A1B20]/10">
              <div className="space-y-0.5 text-xs">
                <p className="font-bold text-[#1A1B20]">{uploadStatus(previewRecord, isSuperAdmin).label}</p>
                {isSuperAdmin && (
                  <p className="text-[#505460]">
                    SHA-256: <span className="font-mono-tabular">{previewRecord.sha256.slice(0, 16)}...</span>
                  </p>
                )}
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
                    Original
                  </button>
                </div>
              )}
            </div>

            {previewMode === 'optimized' && sanitizeSafeUrl(previewRecord.optimizedPreviewUrl) ? (
              <div className="rounded-2xl border border-[#1A1B20]/10 bg-[#F6F7F9] p-3">
                <img
                  src={sanitizeSafeUrl(previewRecord.optimizedPreviewUrl)}
                  alt={`Original of ${previewRecord.title}`}
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

                {isSuperAdmin && (
                <AcademicBlocksRenderer
                  blocks={previewRecord.deterministicChecks
                    .filter((c) => !c.passed)
                    .map((c) => ({
                      type: 'paragraph' as const,
                      title: c.label,
                      text: c.detail,
                    }))}
                />
                )}

                {isSuperAdmin && previewRecord.aiFindings && (
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

      <DetailDialog
        open={Boolean(editingDoc)}
        onClose={() => setEditingDoc(null)}
        title="Edit document"
        subtitle={
          isSuperAdmin
            ? 'Changes apply right away. Only the School Admin who uploaded it is alerted.'
            : 'After you update, this document shows Pending until the Super Admin verifies it.'
        }
        icon={<Pencil className="w-5 h-5" />}
        footer={
          <div className="flex justify-end gap-2">
            <TactileButton variant="light" size="md" onClick={() => setEditingDoc(null)}>
              Cancel
            </TactileButton>
            <TactileButton variant="dark" size="md" onClick={handleSaveEdit}>
              Update
            </TactileButton>
          </div>
        }
      >
        <div className="space-y-3">
          {(
            [
              ['Title', 'title'],
              ['Course code', 'courseCode'],
              ['Course title', 'courseTitle'],
              ['Session (e.g. 2023/2024)', 'session'],
            ] as const
          ).map(([label, key]) => (
            <label key={key} className="block text-xs font-semibold text-[#505460]">
              {label}
              <input
                type="text"
                value={editForm[key]}
                onChange={(e) => setEditForm((prev) => ({ ...prev, [key]: e.target.value }))}
                className="mt-1 w-full min-h-[40px] rounded-xl bg-white border border-[#1A1B20]/10 px-3 text-sm text-[#1A1B20]"
              />
            </label>
          ))}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block text-xs font-semibold text-[#505460]">
              Level
              <select
                value={editForm.level}
                onChange={(e) => setEditForm((prev) => ({ ...prev, level: e.target.value as StudentLevel }))}
                className="mt-1 w-full min-h-[40px] rounded-xl bg-white border border-[#1A1B20]/10 px-2 text-sm text-[#1A1B20]"
              >
                {LEVEL_OPTIONS.map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {lvl}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-semibold text-[#505460]">
              Semester
              <select
                value={editForm.semester}
                onChange={(e) =>
                  setEditForm((prev) => ({ ...prev, semester: e.target.value as SemesterType }))
                }
                className="mt-1 w-full min-h-[40px] rounded-xl bg-white border border-[#1A1B20]/10 px-2 text-sm text-[#1A1B20]"
              >
                {SEMESTER_OPTIONS.map((sem) => (
                  <option key={sem} value={sem}>
                    {sem}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-semibold text-[#505460]">
              Type
              <select
                value={editForm.category}
                onChange={(e) =>
                  setEditForm((prev) => ({ ...prev, category: e.target.value as AcademicDocCategory }))
                }
                className="mt-1 w-full min-h-[40px] rounded-xl bg-white border border-[#1A1B20]/10 px-2 text-sm text-[#1A1B20]"
              >
                {(Object.keys(CATEGORY_LABELS) as AcademicDocCategory[]).map((cat) => (
                  <option key={cat} value={cat}>
                    {CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </DetailDialog>
    </div>
  );
};
