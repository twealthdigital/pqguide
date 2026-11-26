import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Edit3,
  Eye,
  FileText,
  Lock,
  ScanLine,
  Trash2,
  UploadCloud,
  X,
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
import { CustomSelect, SurfaceCard, TactileButton } from '../components/ui';

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
  const [previewDoc, setPreviewDoc] = useState<PastQuestionDoc | null>(null);
  const [editingDoc, setEditingDoc] = useState<PastQuestionDoc | null>(null);
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
        questions:
          questionLines.length > 0 ? questionLines : processed.suggestedQuestions,
        uploadedBy: currentUser.fullName,
        uploadedAt: new Date().toISOString(),
        viewsCount: 0,
        status: targetStatus,
      });

      setPublishNotice(
        targetStatus === 'published'
          ? `${created.courseCode} (${created.session} · ${assignedSchool.code}) published to student Home.`
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

  const startEditing = (doc: PastQuestionDoc) => {
    setEditingDoc(doc);
    setEditCourseCode(doc.courseCode);
    setEditCourseTitle(doc.courseTitle);
    setEditSession(doc.session);
    setEditSemester(doc.semester);
    setEditDepartment(doc.department);
    setEditLevel(doc.level);
    setEditQuestionsText(doc.questions.join('\n'));
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDoc) return;
    setErrorMsg(null);
    try {
      const lines = editQuestionsText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const parsedYear = parseInt(editSession.split('/')[1] ?? String(editingDoc.year), 10) || editingDoc.year;
      archiveRepository.updateDocument(currentUser, editingDoc.id, {
        courseCode: editCourseCode,
        courseTitle: editCourseTitle,
        session: editSession,
        year: parsedYear,
        semester: editSemester,
        department: editDepartment,
        level: editLevel,
        questions: lines.length > 0 ? lines : editingDoc.questions,
      });
      setPublishNotice(`Updated ${editCourseCode.toUpperCase()} (${assignedSchool.code}).`);
      setEditingDoc(null);
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
        `${doc.courseCode} is now ${nextStatus === 'published' ? 'published' : 'unpublished (draft)'}.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not change publication status.');
    }
  };

  const handleDelete = (doc: PastQuestionDoc) => {
    setErrorMsg(null);
    try {
      archiveRepository.deleteDocument(currentUser, doc.id);
      if (previewDoc?.id === doc.id) setPreviewDoc(null);
      if (editingDoc?.id === doc.id) setEditingDoc(null);
      setPublishNotice(`Deleted ${doc.courseCode} (${doc.session}).`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not delete past question.');
    }
  };

  return (
    <div className="space-y-6 page-enter">
      {/* Header Banner */}
      <SurfaceCard tone="ash" withWaves className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-[#A5AAB8]">
              {isSuperAdminPreview
                ? `Super Admin View · Inspecting ${assignedSchool.code} School Desk`
                : `${adminCms.deskLabel} · ${assignedSchool.code}`}
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-white mt-1.5">
              {adminCms.deskHeadline.replace(/\{SCHOOL\}/g, assignedSchool.code)}
            </h1>
            <p className="text-sm text-[#B8BCC8] mt-2 max-w-2xl">
              {isSuperAdminPreview
                ? `You are viewing the School Admin experience for ${assignedSchool.name} while keeping full Super Admin privileges.`
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
                <p className="font-bold leading-tight">{assignedSchool.code} · {assignedSchool.shortName}</p>
                <p className="text-[11px] text-[#C3C7D2]">Locked by account policy</p>
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
          Your administrator account is currently restricted (read-only). Uploading, editing, publishing, and deleting are disabled until lifted by a Super Admin.
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
        {/* Upload & Pipeline Form */}
        <SurfaceCard tone="white" className="lg:col-span-6 p-5 sm:p-6 space-y-5">
          <div>
            <h2 className="font-display text-lg font-bold text-[#1A1B20]">
              {adminCms.uploadPanelTitle}
            </h2>
            <p className="text-xs text-[#686C78] mt-0.5">
              {adminCms.uploadPanelHint}
            </p>
          </div>

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
                ? 'Uploads locked (read-only restriction)'
                : processing
                  ? 'Validating & processing file...'
                  : 'Tap to select past question image or document'}
            </p>
            <p className="text-xs text-[#686C78] mt-1">
              Runs strict file signature check and Scan-to-PDF / text extraction
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
                  <p className="text-xs font-semibold text-[#686C78] mb-2">
                    Scan-to-PDF Normalized Output Preview
                  </p>
                  <img
                    src={sanitizeSafeUrl(processed.scannedPagePreviewUrl)}
                    alt="Normalized scan preview"
                    referrerPolicy="no-referrer"
                    className="max-h-56 mx-auto rounded-lg shadow-xs bg-white"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Read-only Assigned University */}
                <div>
                  <label className="block text-xs font-medium text-[#686C78] mb-1">
                    Assigned University (Locked)
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
                    placeholder="e.g. GNS 101"
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
                    placeholder="e.g. Use of English & Communication Skills"
                    className="w-full min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-sm font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#686C78] mb-1">
                    Academic Session
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
                  Extracted Questions (one per line)
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

        {/* University Scoped Uploads & Management */}
        <SurfaceCard tone="white" className="lg:col-span-6 p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-lg font-bold text-[#1A1B20]">
                {assignedSchool.code} Past Questions
              </h2>
              <p className="text-xs text-[#686C78]">
                Manage only past questions belonging to {assignedSchool.shortName}
              </p>
            </div>
            <span className="font-mono-tabular text-xs font-semibold text-[#1A1B20]">
              {schoolDocuments.length} shown
            </span>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter course code or session..."
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

          {editingDoc && (
            <form
              onSubmit={handleSaveEdit}
              className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/12 p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-[#1A1B20]">
                  Editing {editingDoc.courseCode} ({assignedSchool.code})
                </p>
                <button
                  type="button"
                  onClick={() => setEditingDoc(null)}
                  className="h-8 w-8 rounded-lg hover:bg-white flex items-center justify-center text-[#686C78] cursor-pointer"
                  aria-label="Close editor"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={editCourseCode}
                  onChange={(e) => setEditCourseCode(e.target.value)}
                  placeholder="Course Code"
                  className="min-h-[40px] rounded-xl bg-white border border-[#1A1B20]/10 px-3 text-xs font-semibold"
                />
                <input
                  type="text"
                  value={editSession}
                  onChange={(e) => setEditSession(e.target.value)}
                  placeholder="Session"
                  className="min-h-[40px] rounded-xl bg-white border border-[#1A1B20]/10 px-3 text-xs font-mono-tabular font-semibold"
                />
                <input
                  type="text"
                  value={editCourseTitle}
                  onChange={(e) => setEditCourseTitle(e.target.value)}
                  placeholder="Course Title"
                  className="col-span-2 min-h-[40px] rounded-xl bg-white border border-[#1A1B20]/10 px-3 text-xs font-semibold"
                />
                <input
                  type="text"
                  value={editDepartment}
                  onChange={(e) => setEditDepartment(e.target.value)}
                  placeholder="Department"
                  className="min-h-[40px] rounded-xl bg-white border border-[#1A1B20]/10 px-3 text-xs font-semibold"
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
                rows={4}
                value={editQuestionsText}
                onChange={(e) => setEditQuestionsText(e.target.value)}
                className="w-full rounded-xl bg-white border border-[#1A1B20]/10 p-2.5 text-xs text-[#1A1B20]"
              />
              <div className="flex gap-2 justify-end">
                <TactileButton
                  type="button"
                  variant="light"
                  size="sm"
                  onClick={() => setEditingDoc(null)}
                >
                  Cancel
                </TactileButton>
                <TactileButton type="submit" variant="dark" size="sm">
                  Save Changes
                </TactileButton>
              </div>
            </form>
          )}

          {previewDoc && (
            <div className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/12 p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold text-[#1A1B20]">
                  Preview: {previewDoc.courseCode} · {previewDoc.session}
                </p>
                <button
                  type="button"
                  onClick={() => setPreviewDoc(null)}
                  className="h-8 w-8 rounded-lg hover:bg-white flex items-center justify-center text-[#686C78] cursor-pointer"
                  aria-label="Close preview"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {sanitizeSafeUrl(previewDoc.scannedPagePreviewUrl) && (
                <img
                  src={sanitizeSafeUrl(previewDoc.scannedPagePreviewUrl)}
                  alt={`${previewDoc.courseCode} scan`}
                  referrerPolicy="no-referrer"
                  className="max-h-48 mx-auto rounded-lg bg-white"
                />
              )}
              <ol className="space-y-1 text-xs text-[#3A3D47] list-decimal pl-4">
                {previewDoc.questions.map((q, idx) => (
                  <li key={idx}>{q}</li>
                ))}
              </ol>
            </div>
          )}

          <div className="divide-y divide-[#1A1B20]/[0.06]">
            {schoolDocuments.length === 0 ? (
              <p className="py-8 text-center text-xs text-[#686C78]">
                No {assignedSchool.code} past questions match this filter yet.
              </p>
            ) : (
              schoolDocuments.map((doc) => (
                <div
                  key={doc.id}
                  className="py-3.5 first:pt-1 last:pb-1 space-y-2"
                >
                  <div className="flex items-start justify-between gap-3">
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
                          {doc.level} · {doc.semester} · {doc.status === 'published' ? 'Published' : 'Draft'}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 pl-12">
                    <button
                      type="button"
                      onClick={() => setPreviewDoc(doc)}
                      className="min-h-[36px] px-2.5 rounded-lg bg-[#F6F7F9] hover:bg-[#ECEEF3] text-xs font-semibold text-[#1A1B20] inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Preview</span>
                    </button>
                    <button
                      type="button"
                      disabled={accountRestricted}
                      onClick={() => startEditing(doc)}
                      className="min-h-[36px] px-2.5 rounded-lg bg-[#F6F7F9] hover:bg-[#ECEEF3] text-xs font-semibold text-[#1A1B20] inline-flex items-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Edit</span>
                    </button>
                    <button
                      type="button"
                      disabled={accountRestricted}
                      onClick={() => handleToggleStatus(doc)}
                      className={`min-h-[36px] px-2.5 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                        doc.status === 'published'
                          ? 'bg-[#EEF0F4] text-[#1A1B20]'
                          : 'bg-[#1D1E23] text-white'
                      }`}
                    >
                      {doc.status === 'published' ? 'Unpublish' : 'Publish'}
                    </button>
                    <button
                      type="button"
                      disabled={accountRestricted}
                      onClick={() => handleDelete(doc)}
                      aria-label={`Delete ${doc.courseCode}`}
                      className="min-h-[36px] px-2.5 rounded-lg bg-[#FEF2F2] hover:bg-[#FEE2E2] text-xs font-semibold text-[#B91C1C] inline-flex items-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </SurfaceCard>
      </div>
    </div>
  );
};
