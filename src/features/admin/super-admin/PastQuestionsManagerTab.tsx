import React, { useMemo, useState } from 'react';
import {
  ChevronRight,
  Edit3,
  Eye,
  FileText,
  ScanLine,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { courseHeading } from '../../../core/docTitle';
import { sanitizeSafeUrl } from '../../../core/security';
import type {
  AuthenticatedUser,
  ContentStatus,
  PastQuestionDoc,
  SemesterType,
} from '../../../core/types';
import { archiveRepository, type AppStoreState } from '../../../services/archiveRepository';
import {
  processUploadedDocument,
  type ProcessedDocumentResult,
} from '../../../services/documentProcessor';
import {
  CustomSelect,
  DetailDialog,
  SectionHeadingBar,
  SurfaceCard,
  TactileButton,
} from '../../../components/ui';

interface PastQuestionsManagerTabProps {
  currentUser: AuthenticatedUser;
  store: AppStoreState;
  onNotice: (msg: string) => void;
  onError: (msg: string) => void;
}

export const PastQuestionsManagerTab: React.FC<PastQuestionsManagerTabProps> = ({
  currentUser,
  store,
  onNotice,
  onError,
}) => {
  const [schoolId, setSchoolId] = useState(store.schools[0]?.id ?? 'sch-aaua');
  const [courseCode, setCourseCode] = useState('');
  const [courseTitle, setCourseTitle] = useState('');
  const [faculty, setFaculty] = useState('General Studies Unit');
  const [department, setDepartment] = useState('General Studies');
  const [level, setLevel] = useState<PastQuestionDoc['level']>('100L');
  const [session, setSession] = useState('2024/2025');
  const [semester, setSemester] = useState<SemesterType>('First Semester');

  const [processing, setProcessing] = useState(false);
  const [processed, setProcessed] = useState<ProcessedDocumentResult | null>(null);
  const [questionsText, setQuestionsText] = useState('');

  const [filterSchoolId, setFilterSchoolId] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | ContentStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [editingInDialog, setEditingInDialog] = useState(false);
  const [editSchoolId, setEditSchoolId] = useState('');
  const [editCourseCode, setEditCourseCode] = useState('');
  const [editCourseTitle, setEditCourseTitle] = useState('');
  const [editFaculty, setEditFaculty] = useState('');
  const [editDepartment, setEditDepartment] = useState('');
  const [editLevel, setEditLevel] = useState<PastQuestionDoc['level']>('100L');
  const [editSession, setEditSession] = useState('');
  const [editSemester, setEditSemester] = useState<SemesterType>('First Semester');
  const [editQuestionsText, setEditQuestionsText] = useState('');

  const filteredDocs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return store.documents.filter((doc) => {
      if (filterSchoolId !== 'all' && doc.schoolId !== filterSchoolId) return false;
      if (filterStatus !== 'all' && doc.status !== filterStatus) return false;
      if (!q) return true;
      return (
        doc.courseCode.toLowerCase().includes(q) ||
        doc.courseTitle.toLowerCase().includes(q) ||
        doc.schoolCode.toLowerCase().includes(q) ||
        doc.department.toLowerCase().includes(q) ||
        doc.session.toLowerCase().includes(q) ||
        doc.originalFileName.toLowerCase().includes(q)
      );
    });
  }, [store.documents, filterSchoolId, filterStatus, searchQuery]);

  const selectedDoc = useMemo(
    () => store.documents.find((d) => d.id === selectedDocId) ?? null,
    [store.documents, selectedDocId]
  );

  const openDocDialog = (doc: PastQuestionDoc, startInEdit = false) => {
    setSelectedDocId(doc.id);
    setEditingInDialog(startInEdit);
    setEditSchoolId(doc.schoolId);
    setEditCourseCode(doc.courseCode);
    setEditCourseTitle(doc.courseTitle);
    setEditFaculty(doc.faculty);
    setEditDepartment(doc.department);
    setEditLevel(doc.level);
    setEditSession(doc.session);
    setEditSemester(doc.semester);
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
    try {
      const result = await processUploadedDocument(file);
      setProcessed(result);
      setCourseCode(result.suggestedCourseCode);
      setSession(result.suggestedSession);
      setSemester(result.suggestedSemester);
      setQuestionsText(result.suggestedQuestions.join('\n'));
      onNotice(`Processed ${result.originalFileName}.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unable to process past question file.');
    } finally {
      setProcessing(false);
      e.target.value = '';
    }
  };

  const handleCreate = (targetStatus: 'draft' | 'published') => {
    if (!processed) {
      onError('Select a past question file first.');
      return;
    }
    const targetSchool = store.schools.find((s) => s.id === schoolId) ?? store.schools[0];
    if (!targetSchool) {
      onError('Create a university before uploading past questions.');
      return;
    }

    const lines = questionsText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const parsedYear = parseInt(session.split('/')[1] ?? '2025', 10) || 2025;

    try {
      const created = archiveRepository.addDocument(currentUser, {
        id: `doc-${Date.now()}`,
        schoolId: targetSchool.id,
        schoolCode: targetSchool.code,
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
        questions: lines.length > 0 ? lines : processed.suggestedQuestions,
        uploadedBy: currentUser.fullName,
        uploadedAt: new Date().toISOString(),
        viewsCount: 0,
        status: targetStatus,
      });

      onNotice(
        targetStatus === 'published'
          ? `Published ${created.courseCode} (${created.session}) to ${targetSchool.code}.`
          : `Saved draft ${created.courseCode} (${created.session}).`
      );
      setProcessed(null);
      setCourseCode('');
      setCourseTitle('');
      setQuestionsText('');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save past question.');
    }
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDoc) return;
    try {
      const lines = editQuestionsText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const parsedYear =
        parseInt(editSession.split('/')[1] ?? String(selectedDoc.year), 10) || selectedDoc.year;

      archiveRepository.updateDocument(currentUser, selectedDoc.id, {
        schoolId: editSchoolId,
        courseCode: editCourseCode,
        courseTitle: editCourseTitle,
        faculty: editFaculty,
        department: editDepartment,
        level: editLevel,
        session: editSession,
        year: parsedYear,
        semester: editSemester,
        questions: lines.length > 0 ? lines : selectedDoc.questions,
      });
      setEditingInDialog(false);
      onNotice(`Updated past question ${editCourseCode.toUpperCase()}.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not update past question.');
    }
  };

  const handleToggleStatus = (doc: PastQuestionDoc) => {
    try {
      const nextStatus: ContentStatus = doc.status === 'published' ? 'draft' : 'published';
      archiveRepository.setDocumentStatus(currentUser, doc.id, nextStatus);
      onNotice(
        `${doc.courseCode} is now ${nextStatus === 'published' ? 'published' : 'draft'}.`
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Action denied.');
    }
  };

  const handleDelete = (doc: PastQuestionDoc) => {
    try {
      archiveRepository.deleteDocument(currentUser, doc.id);
      if (selectedDocId === doc.id) closeDocDialog();
      onNotice(`Deleted ${doc.courseCode} (${doc.session}).`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not delete past question.');
    }
  };

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <SurfaceCard tone="white" className="lg:col-span-5 p-5 sm:p-6 space-y-4">
          <SectionHeadingBar
            icon={<UploadCloud className="w-4 h-4" />}
            title="Upload Past Question"
          />

          <label className="block rounded-2xl border-2 border-dashed border-[#1A1B20]/15 bg-[#F6F7F9] hover:bg-[#EFF1F5] transition-colors p-5 text-center cursor-pointer">
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.txt,.md,.csv"
              onChange={handleFilePicked}
              className="sr-only"
            />
            <div className="h-11 w-11 rounded-2xl tactile-dark text-white flex items-center justify-center mx-auto mb-2.5">
              <UploadCloud className="w-5 h-5" />
            </div>
            <p className="font-display text-sm font-bold text-[#1A1B20]">
              {processing ? 'Extracting...' : 'Select PDF, DOCX, TXT, or Image'}
            </p>
            <p className="text-xs text-[#686C78] mt-0.5">Max 10 MB</p>
          </label>

          {processed && (
            <div className="space-y-3 pt-3 border-t border-[#1A1B20]/[0.07]">
              <div className="rounded-2xl bg-[#F6F7F9] p-3.5 flex items-start gap-3">
                <div className="h-9 w-9 rounded-xl bg-[#1D1E23] text-white flex items-center justify-center shrink-0">
                  {processed.sourceType === 'scanned_image' ? (
                    <ScanLine className="w-4 h-4" />
                  ) : (
                    <FileText className="w-4 h-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[#1A1B20] truncate">
                    {processed.originalFileName}
                  </p>
                  <p className="text-[11px] text-[#505460]">{processed.processingSummary}</p>
                </div>
              </div>

              {sanitizeSafeUrl(processed.scannedPagePreviewUrl) && (
                <div className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/10 p-3">
                  <img
                    src={sanitizeSafeUrl(processed.scannedPagePreviewUrl)}
                    alt="Past question preview"
                    referrerPolicy="no-referrer"
                    className="max-h-48 mx-auto rounded-lg bg-white"
                  />
                </div>
              )}

              <CustomSelect
                label="University"
                value={schoolId}
                options={store.schools.map((s) => ({
                  value: s.id,
                  label: `${s.code} — ${s.shortName}`,
                }))}
                onChange={setSchoolId}
              />

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-medium text-[#686C78] mb-1">
                    Course Code
                  </label>
                  <input
                    type="text"
                    value={courseCode}
                    onChange={(e) => setCourseCode(e.target.value)}
                    placeholder="CSC 201"
                    className="w-full min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-semibold uppercase"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#686C78] mb-1">
                    Session
                  </label>
                  <input
                    type="text"
                    value={session}
                    onChange={(e) => setSession(e.target.value)}
                    placeholder="2024/2025"
                    className="w-full min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-mono-tabular font-semibold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#686C78] mb-1">
                  Course Title
                </label>
                <input
                  type="text"
                  value={courseTitle}
                  onChange={(e) => setCourseTitle(e.target.value)}
                  placeholder="Course title"
                  className="w-full min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-semibold"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-medium text-[#686C78] mb-1">
                    Faculty
                  </label>
                  <input
                    type="text"
                    value={faculty}
                    onChange={(e) => setFaculty(e.target.value)}
                    className="w-full min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-semibold"
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
                    className="w-full min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-semibold"
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
                  onChange={(v) => setLevel(v as PastQuestionDoc['level'])}
                />
                <CustomSelect
                  label="Semester"
                  value={semester}
                  options={[
                    { value: 'First Semester', label: 'First Semester' },
                    { value: 'Second Semester', label: 'Second Semester' },
                  ]}
                  onChange={(v) => setSemester(v as SemesterType)}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#686C78] mb-1">
                  Questions (one per line)
                </label>
                <textarea
                  rows={4}
                  value={questionsText}
                  onChange={(e) => setQuestionsText(e.target.value)}
                  className="w-full rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 p-3 text-xs text-[#1A1B20]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <TactileButton
                  type="button"
                  variant="light"
                  size="md"
                  fullWidth
                  onClick={() => handleCreate('draft')}
                >
                  Save Draft
                </TactileButton>
                <TactileButton
                  type="button"
                  variant="dark"
                  size="md"
                  fullWidth
                  onClick={() => handleCreate('published')}
                >
                  Publish
                </TactileButton>
              </div>
            </div>
          )}
        </SurfaceCard>

        <SurfaceCard tone="white" className="lg:col-span-7 p-5 sm:p-6 space-y-4">
          <SectionHeadingBar
            icon={<FileText className="w-4 h-4" />}
            title="Past Questions Catalog"
            right={
              <span className="font-mono-tabular text-xs font-semibold text-[#C3C7D2]">
                {filteredDocs.length} / {store.documents.length}
              </span>
            }
          />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search course or file..."
              className="min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-medium"
            />
            <CustomSelect
              size="sm"
              ariaLabel="Filter by university"
              value={filterSchoolId}
              options={[
                { value: 'all', label: 'All Universities' },
                ...store.schools.map((s) => ({
                  value: s.id,
                  label: s.code,
                })),
              ]}
              onChange={setFilterSchoolId}
            />
            <CustomSelect
              size="sm"
              ariaLabel="Filter by publication status"
              value={filterStatus}
              options={[
                { value: 'all', label: 'All Statuses' },
                { value: 'published', label: 'Published' },
                { value: 'draft', label: 'Draft' },
                { value: 'review', label: 'In Review' },
              ]}
              onChange={(v) => setFilterStatus(v as 'all' | ContentStatus)}
            />
          </div>

          <div className="divide-y divide-[#1A1B20]/[0.06]">
            {filteredDocs.length === 0 ? (
              <p className="py-10 text-center text-xs text-[#686C78]">
                No past questions match these filters.
              </p>
            ) : (
              filteredDocs.map((doc) => (
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
                        {doc.schoolCode} · {courseHeading(doc)}
                      </p>
                      <p className="text-xs text-[#686C78] font-mono-tabular truncate">
                        {doc.session} · {doc.level} ·{' '}
                        {doc.status === 'published'
                          ? 'Published'
                          : doc.status === 'draft'
                            ? 'Draft'
                            : 'Review'}{' '}
                        · {doc.uploadedBy}
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

      <DetailDialog
        open={Boolean(selectedDoc)}
        onClose={closeDocDialog}
        title={selectedDoc ? `${selectedDoc.schoolCode} · ${courseHeading(selectedDoc)}` : 'Past Question'}
        subtitle={
          selectedDoc
            ? `${selectedDoc.session} · ${selectedDoc.level} · Uploaded by ${selectedDoc.uploadedBy}`
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
                onClick={() => setEditingInDialog((v) => !v)}
                className="min-h-[38px] px-3 rounded-xl bg-[#F6F7F9] hover:bg-[#ECEEF3] text-xs font-semibold text-[#1A1B20] inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>{editingInDialog ? 'View Questions' : 'Edit'}</span>
              </button>
              <button
                type="button"
                onClick={() => handleToggleStatus(selectedDoc)}
                className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold cursor-pointer ${
                  selectedDoc.status === 'published'
                    ? 'bg-[#EEF0F4] text-[#1A1B20]'
                    : 'bg-[#1D1E23] text-white'
                }`}
              >
                {selectedDoc.status === 'published' ? 'Unpublish' : 'Publish'}
              </button>
              <button
                type="button"
                onClick={() => handleDelete(selectedDoc)}
                className="min-h-[38px] px-3 rounded-xl bg-[#FEF2F2] hover:bg-[#FEE2E2] text-xs font-semibold text-[#B91C1C] inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
            </div>

            {editingInDialog ? (
              <form onSubmit={handleSaveEdit} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <CustomSelect
                    size="sm"
                    label="University"
                    value={editSchoolId}
                    options={store.schools.map((s) => ({
                      value: s.id,
                      label: `${s.code} — ${s.shortName}`,
                    }))}
                    onChange={setEditSchoolId}
                  />
                  <div>
                    <label className="block text-[11px] font-medium text-[#686C78] mb-1">
                      Course Code
                    </label>
                    <input
                      type="text"
                      value={editCourseCode}
                      onChange={(e) => setEditCourseCode(e.target.value)}
                      className="w-full min-h-[38px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-semibold"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <input
                      type="text"
                      value={editCourseTitle}
                      onChange={(e) => setEditCourseTitle(e.target.value)}
                      placeholder="Course title"
                      className="w-full min-h-[38px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-semibold"
                    />
                  </div>
                  <input
                    type="text"
                    value={editFaculty}
                    onChange={(e) => setEditFaculty(e.target.value)}
                    placeholder="Faculty"
                    className="min-h-[38px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-semibold"
                  />
                  <input
                    type="text"
                    value={editDepartment}
                    onChange={(e) => setEditDepartment(e.target.value)}
                    placeholder="Department"
                    className="min-h-[38px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-semibold"
                  />
                  <input
                    type="text"
                    value={editSession}
                    onChange={(e) => setEditSession(e.target.value)}
                    placeholder="2024/2025"
                    className="min-h-[38px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-mono-tabular font-semibold"
                  />
                  <div className="grid grid-cols-2 gap-2">
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
                    <CustomSelect
                      size="sm"
                      value={editSemester}
                      options={[
                        { value: 'First Semester', label: '1st Sem' },
                        { value: 'Second Semester', label: '2nd Sem' },
                      ]}
                      onChange={(v) => setEditSemester(v as SemesterType)}
                    />
                  </div>
                </div>
                <textarea
                  rows={5}
                  value={editQuestionsText}
                  onChange={(e) => setEditQuestionsText(e.target.value)}
                  className="w-full rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 p-2.5 text-xs text-[#1A1B20]"
                />
                <div className="flex justify-end gap-2">
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
                <p className="text-xs text-[#686C78] font-mono-tabular">
                  File: {selectedDoc.originalFileName} ·{' '}
                  {new Date(selectedDoc.uploadedAt).toLocaleDateString()}
                </p>
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
