import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronRight,
  Edit3,
  Eye,
  FileText,
  Lock,
  ScanLine,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { canAccessScreen, isRestrictedAccount } from '../core/permissions';
import { sanitizeSafeUrl } from '../core/security';
import type { AuthenticatedUser, PastQuestionDoc, SemesterType } from '../core/types';
import { useArchiveStore } from '../hooks/useArchiveStore';
import { archiveRepository } from '../services/archiveRepository';
import {
  processUploadedDocument,
  type ProcessedDocumentResult,
} from '../services/documentProcessor';
import {
  CustomSelect,
  DetailDialog,
  SectionHeadingBar,
  SurfaceCard,
  TactileButton,
} from '../components/ui';

interface SchoolAdminScreenProps {
  currentUser: AuthenticatedUser;
  previewSchoolId?: string;
  onPreviewSchoolChange?: (schoolId: string) => void;
}

export const SchoolAdminScreen: React.FC<SchoolAdminScreenProps> = ({
  currentUser,
  previewSchoolId,
  onPreviewSchoolChange,
}) => {
  const store = useArchiveStore();
  const isSuperAdminPreview = currentUser.role === 'super_admin';
  const accountRestricted = !isSuperAdminPreview && isRestrictedAccount(currentUser);
  const adminCms = store.siteCms.schoolAdminUi;

  const assignedSchool = useMemo(() => {
    if (isSuperAdminPreview) {
      return (
        (previewSchoolId
          ? store.schools.find((s) => s.id === previewSchoolId)
          : undefined) ??
        store.schools[0] ??
        null
      );
    }
    return currentUser.assignedSchoolId
      ? store.schools.find((s) => s.id === currentUser.assignedSchoolId) ?? null
      : null;
  }, [store.schools, currentUser.assignedSchoolId, isSuperAdminPreview, previewSchoolId]);

  const [courseCode, setCourseCode] = useState('');
  const [courseTitle, setCourseTitle] = useState('');
  const [department, setDepartment] = useState('General Studies');
  const [faculty, setFaculty] = useState('General Studies Unit');
  const [level, setLevel] = useState<PastQuestionDoc['level']>('100L');
  const [session, setSession] = useState('2024/2025');
  const [semester, setSemester] = useState<SemesterType>('First Semester');

  const [processing, setProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [processed, setProcessed] = useState<ProcessedDocumentResult | null>(null);
  const [editableText, setEditableText] = useState('');
  const [publishNotice, setPublishNotice] = useState<string | null>(null);

  const [historyFilter, setHistoryFilter] = useState<'all' | 'published' | 'draft'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [editingInDialog, setEditingInDialog] = useState(false);
  const [editCourseCode, setEditCourseCode] = useState('');
  const [editCourseTitle, setEditCourseTitle] = useState('');
  const [editSession, setEditSession] = useState('');
  const [editSemester, setEditSemester] = useState<SemesterType>('First Semester');
  const [editDepartment, setEditDepartment] = useState('');
  const [editLevel, setEditLevel] = useState<PastQuestionDoc['level']>('100L');
  const [editQuestionsText, setEditQuestionsText] = useState('');

  const schoolDocuments = useMemo(() => {
    if (!assignedSchool) return [];
    const q = searchQuery.trim().toLowerCase();
    return store.documents.filter((doc) => {
      if (doc.schoolId !== assignedSchool.id) return false;
      if (historyFilter === 'published' && doc.status !== 'published') return false;
      if (historyFilter === 'draft' && doc.status === 'published') return false;
      if (!q) return true;
      return (
        doc.courseCode.toLowerCase().includes(q) ||
        doc.courseTitle.toLowerCase().includes(q) ||
        doc.session.toLowerCase().includes(q)
      );
    });
  }, [store.documents, assignedSchool, historyFilter, searchQuery]);

  const selectedDoc = useMemo(
    () => schoolDocuments.find((d) => d.id === selectedDocId) ?? null,
    [schoolDocuments, selectedDocId]
  );

  if (!canAccessScreen(currentUser, 'school_admin') || !assignedSchool) {
    return (
      <SurfaceCard tone="white" className="p-6 text-center space-y-2">
        <h1 className="font-display text-lg font-bold text-[#1A1B20]">
          School Admin Assignment Required
        </h1>
        <p className="text-sm text-[#505460]">
          Your account is not assigned to an active university or lacks School Admin permissions.
        </p>
      </SurfaceCard>
    );
  }

  const openDocDialog = (doc: PastQuestionDoc, startInEdit = false) => {
    setSelectedDocId(doc.id);
    setEditingInDialog(startInEdit);
    setEditCourseCode(doc.courseCode);
    setEditCourseTitle(doc.courseTitle);
    setEditSession(doc.session);
    setEditSemester(doc.semester);
    setEditDepartment(doc.department);
    setEditLevel(doc.level);
    setEditQuestionsText(doc.questions.join('\n'));
  };

  const closeDocDialog = () => {
    setSelectedDocId(null);
    setEditingInDialog(false);
  };

  const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setProcessing(true);
    setErrorMsg(null);
    setPublishNotice(null);

    try {
      const result = await processUploadedDocument(file);
      setProcessed(result);
      setCourseCode(result.suggestedCourseCode);
      setSession(result.suggestedSession);
      setSemester(result.suggestedSemester);
      setEditableText(result.suggestedQuestions.join('\n'));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not process uploaded file.');
    } finally {
      setProcessing(false);
      e.target.value = '';
    }
  };

  const handleSaveUpload = (targetStatus: 'published' | 'draft') => {
    if (!processed) return;
    setErrorMsg(null);
    setPublishNotice(null);

    const questionLines = editableText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const parsedYear = parseInt(session.split('/')[1] ?? '2025', 10) || 2025;

    try {
      const created = archiveRepository.addDocument(currentUser, {
        id: `doc-${Date.now()}`,
        schoolId: assignedSchool.id,
        schoolCode: assignedSchool.code,
        courseCode: courseCode.trim().toUpperCase() || 'CSC 101',
        courseTitle: courseTitle.trim() || 'Past Question',
        department: department.trim() || 'General Studies',
        faculty: faculty.trim() || 'Academic Affairs',
        level,
        session,
        year: parsedYear,
        semester,
        sourceType: processed.sourceType,
        originalFileName: processed.originalFileName,
        scannedPagePreviewUrl: processed.scannedPagePreviewUrl,
        extractedText: processed.extractedText,
        questions: questionLines.length > 0 ? questionLines : processed.suggestedQuestions,
        uploadedBy: currentUser.fullName,
        uploadedAt: new Date().toISOString(),
        viewsCount: 0,
        status: targetStatus,
      });

      setPublishNotice(
        targetStatus === 'published'
          ? `${created.courseCode} (${created.session} · ${assignedSchool.code}) published.`
          : `${created.courseCode} (${created.session} · ${assignedSchool.code}) saved as draft.`
      );
      setProcessed(null);
      setCourseCode('');
      setCourseTitle('');
      setEditableText('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save past question.');
    }
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDoc) return;
    setErrorMsg(null);
    try {
      const lines = editQuestionsText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const parsedYear =
        parseInt(editSession.split('/')[1] ?? String(selectedDoc.year), 10) || selectedDoc.year;
      archiveRepository.updateDocument(currentUser, selectedDoc.id, {
        courseCode: editCourseCode,
        courseTitle: editCourseTitle,
        session: editSession,
        year: parsedYear,
        semester: editSemester,
        department: editDepartment,
        level: editLevel,
        questions: lines.length > 0 ? lines : selectedDoc.questions,
      });
      setPublishNotice(`Updated ${editCourseCode.toUpperCase()} (${assignedSchool.code}).`);
      setEditingInDialog(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not update past question.');
    }
  };

  const handleToggleStatus = (doc: PastQuestionDoc) => {
    setErrorMsg(null);
    try {
      const nextStatus = doc.status === 'published' ? 'draft' : 'published';
      archiveRepository.setDocumentStatus(currentUser, doc.id, nextStatus);
      setPublishNotice(
        `${doc.courseCode} is now ${nextStatus === 'published' ? 'published' : 'draft'}.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not change status.');
    }
  };

  const handleDelete = (doc: PastQuestionDoc) => {
    setErrorMsg(null);
    try {
      archiveRepository.deleteDocument(currentUser, doc.id);
      if (selectedDocId === doc.id) closeDocDialog();
      setPublishNotice(`Deleted ${doc.courseCode} (${doc.session}).`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not delete past question.');
    }
  };

  return (
    <>
      <div className="space-y-6 page-enter">
        <SurfaceCard tone="ash" withWaves className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-[#A5AAB8]">
                {isSuperAdminPreview
                  ? `Super Admin View · ${assignedSchool.code} School Desk`
                  : `${adminCms.deskLabel} · ${assignedSchool.code}`}
              </p>
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-white mt-1.5">
                {adminCms.deskHeadline.replace(/\{SCHOOL\}/g, assignedSchool.code)}
              </h1>
              <p className="text-sm text-[#B8BCC8] mt-2 max-w-2xl">
                {isSuperAdminPreview
                  ? `Viewing ${assignedSchool.name} desk as Super Admin.`
                  : adminCms.deskDescription}
              </p>
            </div>

            {isSuperAdminPreview && onPreviewSchoolChange ? (
              <div className="min-w-[230px] rounded-2xl bg-white p-2.5 text-[#1A1B20] shrink-0">
                <CustomSelect
                  label="Preview University"
                  size="sm"
                  value={assignedSchool.id}
                  options={store.schools.map((s) => ({
                    value: s.id,
                    label: `${s.code} — ${s.shortName}`,
                  }))}
                  onChange={onPreviewSchoolChange}
                />
              </div>
            ) : (
              <div className="rounded-2xl bg-white/10 border border-white/15 px-3.5 py-2.5 flex items-center gap-2.5 text-xs text-white shrink-0">
                <Lock className="w-4 h-4 text-[#C3C7D2] shrink-0" />
                <div>
                  <p className="font-bold leading-tight">
                    {assignedSchool.code} · {assignedSchool.shortName}
                  </p>
                  <p className="text-[11px] text-[#C3C7D2]">Assigned university</p>
                </div>
              </div>
            )}
          </div>
        </SurfaceCard>

        {accountRestricted && (
          <div
            role="alert"
            className="rounded-2xl bg-[#FFFBEB] border border-[#FDE68A] px-4 py-3 text-xs font-medium text-[#92400E]"
          >
            Your account is read-only until lifted by a Super Admin.
          </div>
        )}

        {errorMsg && (
          <div
            role="alert"
            className="rounded-2xl bg-[#FEF2F2] border border-[#FECACA] px-4 py-3 text-xs font-medium text-[#B91C1C]"
          >
            {errorMsg}
          </div>
        )}

        {publishNotice && (
          <div
            role="status"
            className="rounded-2xl bg-[#F0FDF4] border border-[#BBF7D0] px-4 py-3 text-xs font-medium text-[#15803D] flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{publishNotice}</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <SurfaceCard tone="white" className="lg:col-span-6 p-5 sm:p-6 space-y-5">
            <SectionHeadingBar
              icon={<UploadCloud className="w-4 h-4" />}
              title={adminCms.uploadPanelTitle}
            />

            <label
              className={`block rounded-2xl border-2 border-dashed border-[#1A1B20]/15 bg-[#F6F7F9] transition-colors p-6 text-center ${
                accountRestricted
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:bg-[#EFF1F5] cursor-pointer'
              }`}
            >
              <input
                type="file"
                disabled={accountRestricted}
                accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.txt,.md,.csv"
                onChange={handleFilePicked}
                className="sr-only"
              />
              <div className="h-12 w-12 rounded-2xl tactile-dark text-white flex items-center justify-center mx-auto mb-3">
                <UploadCloud className="w-5 h-5" />
              </div>
              <p className="font-display text-sm font-bold text-[#1A1B20]">
                {accountRestricted
                  ? 'Uploads locked'
                  : processing
                    ? 'Extracting file...'
                    : 'Select PDF, DOCX, TXT, or Image'}
              </p>
            </label>

            {processed && (
              <div className="space-y-4 pt-3 border-t border-[#1A1B20]/[0.07]">
                <div className="rounded-2xl bg-[#F6F7F9] p-4 flex items-start gap-3">
                  <div className="h-9 w-9 rounded-xl bg-[#1D1E23] text-white flex items-center justify-center shrink-0">
                    {processed.sourceType === 'scanned_image' ? (
                      <ScanLine className="w-4 h-4" />
                    ) : (
                      <FileText className="w-4 h-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-[#1A1B20] truncate">
                      {processed.originalFileName}
                    </p>
                    <p className="text-xs text-[#505460] mt-0.5">
                      {processed.processingSummary}
                    </p>
                  </div>
                </div>

                {sanitizeSafeUrl(processed.scannedPagePreviewUrl) && (
                  <div className="rounded-2xl border border-[#1A1B20]/10 bg-[#F6F7F9] p-3">
                    <img
                      src={sanitizeSafeUrl(processed.scannedPagePreviewUrl)}
                      alt="Normalized scan preview"
                      referrerPolicy="no-referrer"
                      className="max-h-56 mx-auto rounded-lg shadow-xs bg-white"
                    />
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[#686C78] mb-1">
                      University
                    </label>
                    <div className="min-h-[42px] rounded-xl bg-[#EEF0F4] border border-[#1A1B20]/10 px-3 flex items-center justify-between gap-2 text-xs font-semibold text-[#1A1B20]">
                      <span className="truncate">
                        {assignedSchool.code} — {assignedSchool.shortName}
                      </span>
                      <Lock className="w-3.5 h-3.5 text-[#686C78] shrink-0" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#686C78] mb-1">
                      Course Code
                    </label>
                    <input
                      type="text"
                      required
                      value={courseCode}
                      onChange={(e) => setCourseCode(e.target.value)}
                      placeholder="GNS 101"
                      className="w-full min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-sm font-semibold"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-[#686C78] mb-1">
                      Course Title
                    </label>
                    <input
                      type="text"
                      value={courseTitle}
                      onChange={(e) => setCourseTitle(e.target.value)}
                      placeholder="Use of English"
                      className="w-full min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-sm font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#686C78] mb-1">
                      Session
                    </label>
                    <input
                      type="text"
                      required
                      value={session}
                      onChange={(e) => setSession(e.target.value)}
                      placeholder="2024/2025"
                      className="w-full min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-sm font-mono-tabular font-semibold"
                    />
                  </div>

                  <CustomSelect
                    label="Semester"
                    value={semester}
                    options={[
                      { value: 'First Semester', label: 'First Semester' },
                      { value: 'Second Semester', label: 'Second Semester' },
                    ]}
                    onChange={(val) => setSemester(val as SemesterType)}
                  />

                  <div>
                    <label className="block text-xs font-medium text-[#686C78] mb-1">
                      Faculty
                    </label>
                    <input
                      type="text"
                      value={faculty}
                      onChange={(e) => setFaculty(e.target.value)}
                      className="w-full min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-sm font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#686C78] mb-1">
                      Department
                    </label>
                    <input
                      type="text"
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      className="w-full min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-sm font-semibold"
                    />
                  </div>

                  <CustomSelect
                    label="Level"
                    mono
                    value={level}
                    options={[
                      { value: '100L', label: '100L' },
                      { value: '200L', label: '200L' },
                      { value: '300L', label: '300L' },
                      { value: '400L', label: '400L' },
                      { value: '500L', label: '500L' },
                    ]}
                    onChange={(val) => setLevel(val as PastQuestionDoc['level'])}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#686C78] mb-1">
                    Questions (one per line)
                  </label>
                  <textarea
                    rows={4}
                    value={editableText}
                    onChange={(e) => setEditableText(e.target.value)}
                    className="w-full rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 p-3 text-xs sm:text-sm text-[#1A1B20] leading-relaxed"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <TactileButton
                    type="button"
                    variant="light"
                    size="lg"
                    fullWidth
                    onClick={() => handleSaveUpload('draft')}
                  >
                    Save as Draft
                  </TactileButton>
                  <TactileButton
                    type="button"
                    variant="dark"
                    size="lg"
                    fullWidth
                    onClick={() => handleSaveUpload('published')}
                  >
                    Publish to {assignedSchool.code}
                  </TactileButton>
                </div>
              </div>
            )}
          </SurfaceCard>

          <SurfaceCard tone="white" className="lg:col-span-6 p-5 sm:p-6 space-y-4">
            <SectionHeadingBar
              icon={<FileText className="w-4 h-4" />}
              title={`${assignedSchool.code} Past Questions`}
              right={
                <span className="font-mono-tabular text-xs font-semibold text-[#C3C7D2]">
                  {schoolDocuments.length} shown
                </span>
              }
            />

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search course or session..."
                className="flex-1 min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-medium text-[#1A1B20]"
              />
              <div className="flex gap-1.5">
                {(['all', 'published', 'draft'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setHistoryFilter(tab)}
                    className={`min-h-[42px] px-3 rounded-xl text-xs font-semibold capitalize cursor-pointer transition-colors ${
                      historyFilter === tab
                        ? 'bg-[#1D1E23] text-white'
                        : 'bg-[#F6F7F9] text-[#505460] hover:bg-[#ECEEF3]'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            <div className="divide-y divide-[#1A1B20]/[0.06]">
              {schoolDocuments.length === 0 ? (
                <p className="py-8 text-center text-xs text-[#686C78]">
                  No {assignedSchool.code} past questions match this filter yet.
                </p>
              ) : (
                schoolDocuments.map((doc) => (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => openDocDialog(doc)}
                    className="w-full py-3.5 first:pt-1 last:pb-1 flex items-center justify-between gap-3 text-left hover:bg-[#F6F7F9] rounded-xl px-2 -mx-2 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-xl bg-[#F2F4F7] text-[#1D1E23] flex items-center justify-center shrink-0">
                        {doc.sourceType === 'scanned_image' ? (
                          <ScanLine className="w-4 h-4" />
                        ) : (
                          <FileText className="w-4 h-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-[#1A1B20] truncate">
                          {doc.courseCode} · {doc.session}
                        </p>
                        <p className="text-xs text-[#686C78] truncate">
                          {doc.level} · {doc.semester} ·{' '}
                          {doc.status === 'published' ? 'Published' : 'Draft'}
                        </p>
                      </div>
                    </div>

                    <span className="min-h-[34px] px-2.5 rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 text-xs font-semibold text-[#1A1B20] inline-flex items-center gap-1 shrink-0">
                      <Eye className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Open</span>
                      <ChevronRight className="w-3.5 h-3.5 text-[#686C78]" />
                    </span>
                  </button>
                ))
              )}
            </div>
          </SurfaceCard>
        </div>
      </div>

      <DetailDialog
        open={Boolean(selectedDoc)}
        onClose={closeDocDialog}
        title={
          selectedDoc ? `${selectedDoc.courseCode} · ${selectedDoc.session}` : 'Past Question'
        }
        subtitle={
          selectedDoc
            ? `${assignedSchool.code} · ${selectedDoc.level} · ${selectedDoc.semester}`
            : undefined
        }
        icon={<FileText className="w-4 h-4" />}
        maxWidthClass="max-w-2xl"
      >
        {selectedDoc && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={accountRestricted}
                onClick={() => setEditingInDialog((v) => !v)}
                className="min-h-[38px] px-3 rounded-xl bg-[#F6F7F9] hover:bg-[#ECEEF3] text-xs font-semibold text-[#1A1B20] inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>{editingInDialog ? 'Preview Questions' : 'Edit'}</span>
              </button>
              <button
                type="button"
                disabled={accountRestricted}
                onClick={() => handleToggleStatus(selectedDoc)}
                className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  selectedDoc.status === 'published'
                    ? 'bg-[#EEF0F4] text-[#1A1B20]'
                    : 'bg-[#1D1E23] text-white'
                }`}
              >
                {selectedDoc.status === 'published' ? 'Unpublish' : 'Publish'}
              </button>
              <button
                type="button"
                disabled={accountRestricted}
                onClick={() => handleDelete(selectedDoc)}
                className="min-h-[38px] px-3 rounded-xl bg-[#FEF2F2] hover:bg-[#FEE2E2] text-xs font-semibold text-[#B91C1C] inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
            </div>

            {editingInDialog ? (
              <form onSubmit={handleSaveEdit} className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={editCourseCode}
                    onChange={(e) => setEditCourseCode(e.target.value)}
                    placeholder="Course code"
                    className="min-h-[40px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-semibold"
                  />
                  <input
                    type="text"
                    value={editSession}
                    onChange={(e) => setEditSession(e.target.value)}
                    placeholder="2024/2025"
                    className="min-h-[40px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-mono-tabular font-semibold"
                  />
                  <input
                    type="text"
                    value={editCourseTitle}
                    onChange={(e) => setEditCourseTitle(e.target.value)}
                    placeholder="Course title"
                    className="col-span-2 min-h-[40px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-semibold"
                  />
                  <input
                    type="text"
                    value={editDepartment}
                    onChange={(e) => setEditDepartment(e.target.value)}
                    placeholder="Department"
                    className="min-h-[40px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-semibold"
                  />
                  <CustomSelect
                    size="sm"
                    value={editLevel}
                    options={[
                      { value: '100L', label: '100L' },
                      { value: '200L', label: '200L' },
                      { value: '300L', label: '300L' },
                      { value: '400L', label: '400L' },
                      { value: '500L', label: '500L' },
                    ]}
                    onChange={(v) => setEditLevel(v as PastQuestionDoc['level'])}
                  />
                </div>
                <textarea
                  rows={5}
                  value={editQuestionsText}
                  onChange={(e) => setEditQuestionsText(e.target.value)}
                  className="w-full rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 p-2.5 text-xs text-[#1A1B20]"
                />
                <div className="flex gap-2 justify-end">
                  <TactileButton
                    type="button"
                    variant="light"
                    size="sm"
                    onClick={() => setEditingInDialog(false)}
                  >
                    Cancel
                  </TactileButton>
                  <TactileButton type="submit" variant="dark" size="sm">
                    Save Changes
                  </TactileButton>
                </div>
              </form>
            ) : (
              <div className="space-y-3">
                {sanitizeSafeUrl(selectedDoc.scannedPagePreviewUrl) && (
                  <img
                    src={sanitizeSafeUrl(selectedDoc.scannedPagePreviewUrl)}
                    alt={`${selectedDoc.courseCode} scan`}
                    referrerPolicy="no-referrer"
                    className="max-h-52 mx-auto rounded-xl border border-[#1A1B20]/10 bg-[#F6F7F9]"
                  />
                )}
                <ol className="space-y-2 text-xs sm:text-sm text-[#3A3D47] list-decimal pl-5">
                  {selectedDoc.questions.map((q, idx) => (
                    <li key={idx}>{q}</li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
      </DetailDialog>
    </>
  );
};
