import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Bell,
  CheckCircle2,
  ChevronRight,
  Clock,
  Edit3,
  Eye,
  FileText,
  Lock,
  ScanLine,
  Send,
  ShieldCheck,
  Trash2,
  UploadCloud,
  Users,
} from 'lucide-react';
import { canAccessScreen, isRestrictedAccount } from '../core/permissions';
import { sanitizeSafeUrl } from '../core/security';
import type {
  AppNotification,
  AuthenticatedUser,
  ManagedAccount,
  PastQuestionDoc,
  SchoolAdminSectionId,
  SemesterType,
} from '../core/types';
import { useArchiveStore } from '../hooks/useArchiveStore';
import { archiveRepository } from '../services/archiveRepository';
import {
  CustomSelect,
  DetailDialog,
  SectionHeadingBar,
  SurfaceCard,
  TactileButton,
} from '../components/ui';

import { DocumentUploadScreen } from './DocumentUploadScreen';
import { DocumentLibraryScreen } from './DocumentLibraryScreen';

interface SchoolAdminScreenProps {
  currentUser: AuthenticatedUser;
  activeSection?: SchoolAdminSectionId;
  onSelectSection?: (section: SchoolAdminSectionId) => void;
  previewSchoolId?: string;
  onPreviewSchoolChange?: (schoolId: string) => void;
}

const SECTION_LABELS: Record<SchoolAdminSectionId, string> = {
  overview: 'Overview',
  students: 'Students',
  upload: 'Upload Documents',
  document_library: 'Document Library',
  catalog: 'Past Questions',
  notices: 'Student Notices',
};

export const SchoolAdminScreen: React.FC<SchoolAdminScreenProps> = ({
  currentUser,
  activeSection = 'overview',
  onSelectSection,
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


  const [errorMsg, setErrorMsg] = useState<string | null>(null);
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

  // Logged-In & Active Students Monitor
  const [studentFilter, setStudentFilter] = useState<'signed_in' | 'active' | 'all'>('all');
  const [studentSearch, setStudentSearch] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);

  // Student Website Notification Submission (Super Admin Verification Required)
  const [notifTitle, setNotifTitle] = useState('');
  const [notifMessage, setNotifMessage] = useState('');
  const [notifCategory, setNotifCategory] = useState<AppNotification['category']>('system');
  const [editingNotifId, setEditingNotifId] = useState<string | null>(null);
  const [editNotifTitle, setEditNotifTitle] = useState('');
  const [editNotifMessage, setEditNotifMessage] = useState('');
  const [editNotifCategory, setEditNotifCategory] =
    useState<AppNotification['category']>('system');

  const allSchoolDocs = useMemo(() => {
    if (!assignedSchool) return [];
    return store.documents.filter((doc) => doc.schoolId === assignedSchool.id);
  }, [store.documents, assignedSchool]);

  const publishedDocsCount = useMemo(
    () => allSchoolDocs.filter((doc) => doc.status === 'published').length,
    [allSchoolDocs]
  );

  const draftDocsCount = allSchoolDocs.length - publishedDocsCount;

  const schoolDocuments = useMemo(() => {
    if (!assignedSchool) return [];
    const q = searchQuery.trim().toLowerCase();
    return allSchoolDocs.filter((doc) => {
      if (historyFilter === 'published' && doc.status !== 'published') return false;
      if (historyFilter === 'draft' && doc.status === 'published') return false;
      if (!q) return true;
      return (
        doc.courseCode.toLowerCase().includes(q) ||
        doc.courseTitle.toLowerCase().includes(q) ||
        doc.session.toLowerCase().includes(q)
      );
    });
  }, [allSchoolDocs, assignedSchool, historyFilter, searchQuery]);

  const schoolStudents = useMemo(() => {
    if (!assignedSchool) return [];
    const codeUpper = assignedSchool.code.toUpperCase();
    return store.accounts.filter(
      (acc) =>
        acc.role === 'student' &&
        (acc.schoolId === assignedSchool.id ||
          (!acc.schoolId && acc.schoolCode.toUpperCase() === codeUpper))
    );
  }, [store.accounts, assignedSchool]);

  const signedInStudentsCount = useMemo(
    () => schoolStudents.filter((acc) => acc.sessionState === 'logged_in').length,
    [schoolStudents]
  );

  const activeStudentsCount = useMemo(
    () => schoolStudents.filter((acc) => acc.status === 'active').length,
    [schoolStudents]
  );

  const filteredStudents = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    return schoolStudents
      .filter((acc) => {
        if (studentFilter === 'signed_in' && acc.sessionState !== 'logged_in') return false;
        if (studentFilter === 'active' && acc.status !== 'active') return false;
        if (!q) return true;
        return (
          acc.fullName.toLowerCase().includes(q) ||
          acc.email.toLowerCase().includes(q) ||
          (acc.matricNumber ?? '').toLowerCase().includes(q) ||
          (acc.department ?? '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const aIn = a.sessionState === 'logged_in' ? 1 : 0;
        const bIn = b.sessionState === 'logged_in' ? 1 : 0;
        if (aIn !== bIn) return bIn - aIn;
        return (b.lastActiveAt ?? '').localeCompare(a.lastActiveAt ?? '');
      });
  }, [schoolStudents, studentFilter, studentSearch]);

  const selectedStudent: ManagedAccount | null = useMemo(
    () => schoolStudents.find((s) => s.id === selectedStudentId) ?? null,
    [schoolStudents, selectedStudentId]
  );

  const selectedStudentActivities = useMemo(() => {
    if (!selectedStudent) return [];
    return store.userActivities
      .filter((act) => act.userId === selectedStudent.id)
      .slice(0, 8);
  }, [store.userActivities, selectedStudent]);

  const schoolSubmittedNotifications = useMemo(() => {
    if (!assignedSchool) return [];
    return store.notifications.filter((n) => n.schoolId === assignedSchool.id);
  }, [store.notifications, assignedSchool]);

  const liveNoticesCount = useMemo(
    () =>
      schoolSubmittedNotifications.filter(
        (n) => (n.approvalStatus ?? 'approved') === 'approved'
      ).length,
    [schoolSubmittedNotifications]
  );

  const pendingNoticesCount = useMemo(
    () =>
      schoolSubmittedNotifications.filter(
        (n) => (n.approvalStatus ?? 'approved') === 'pending_verification'
      ).length,
    [schoolSubmittedNotifications]
  );

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

  const handleSubmitNotification = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setPublishNotice(null);
    try {
      const created = archiveRepository.submitSchoolAdminNotification(currentUser, {
        schoolId: assignedSchool.id,
        schoolCode: assignedSchool.code,
        title: notifTitle,
        message: notifMessage,
        category: notifCategory,
      });
      setNotifTitle('');
      setNotifMessage('');
      setPublishNotice(
        `Submitted "${created.title}" for Super Admin verification before going live to students.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not submit notification.');
    }
  };

  const startEditPendingNotif = (notif: AppNotification) => {
    setEditingNotifId(notif.id);
    setEditNotifTitle(notif.title);
    setEditNotifMessage(notif.message);
    setEditNotifCategory(notif.category);
  };

  const handleSaveNotifEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingNotifId) return;
    setErrorMsg(null);
    try {
      const updated = archiveRepository.updateNotification(currentUser, editingNotifId, {
        title: editNotifTitle,
        message: editNotifMessage,
        category: editNotifCategory,
      });
      setEditingNotifId(null);
      setPublishNotice(`Updated pending notification "${updated.title}".`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not update notification.');
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
                {activeSection !== 'overview' ? ` · ${SECTION_LABELS[activeSection]}` : ''}
              </p>
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-white mt-1.5">
                {activeSection === 'overview'
                  ? adminCms.deskHeadline.replace(/\{SCHOOL\}/g, assignedSchool.code)
                  : SECTION_LABELS[activeSection]}
              </h1>
              <p className="text-sm text-[#B8BCC8] mt-2 max-w-2xl">
                {activeSection === 'overview'
                  ? isSuperAdminPreview
                    ? `Viewing ${assignedSchool.name} desk as Super Admin.`
                    : adminCms.deskDescription
                  : activeSection === 'students'
                    ? `Track signed-in, active, and registered ${assignedSchool.code} student accounts.`
                    : activeSection === 'upload'
                      ? `Upload past questions and notes for ${assignedSchool.code}. They are converted to typed documents and cross-checked automatically.`
                      : activeSection === 'document_library'
                        ? 'Browse verified and published scanned documents, with extracted text, tables, formulas and diagrams.'
                        : activeSection === 'catalog'
                        ? `Search, preview, edit, publish, or remove ${assignedSchool.code} past question papers.`
                        : `Submit and monitor ${assignedSchool.code} student announcements pending Super Admin verification.`}
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

        {activeSection === 'overview' && (
          <div className="space-y-6">
            {/* Key University Indicators — Student Numbers Visible on Home Page */}
            <section
              aria-label="University overview indicators"
              className="rounded-3xl bg-[#1D1E23] p-4 sm:p-6 space-y-4 shadow-[0_14px_34px_-14px_rgba(20,21,28,0.45)]"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                <div className="flex items-center gap-2.5">
                  <span className="h-8 w-8 rounded-xl bg-white/10 text-white flex items-center justify-center shrink-0">
                    <Users className="w-4 h-4" />
                  </span>
                  <div>
                    <h2 className="font-display text-sm sm:text-base font-bold text-white">
                      {assignedSchool.code} Student &amp; Archive Overview
                    </h2>
                    <p className="text-[11px] text-[#A5AAB8]">
                      Live student numbers and content status for {assignedSchool.shortName}
                    </p>
                  </div>
                </div>
                <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-[#4ADE80]">
                  Live
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4">
                <div className="rounded-2xl bg-white p-4 sm:p-5 space-y-1.5">
                  <div className="flex items-center justify-between text-[#686C78]">
                    <span className="text-xs font-medium">Registered Students</span>
                    <Users className="w-4 h-4" />
                  </div>
                  <p className="font-display font-mono-tabular text-2xl sm:text-3xl font-extrabold text-[#1A1B20]">
                    {schoolStudents.length}
                  </p>
                  <p className="text-xs text-[#686C78] font-mono-tabular">
                    {assignedSchool.code} student accounts
                  </p>
                </div>

                <div className="rounded-2xl bg-white p-4 sm:p-5 space-y-1.5">
                  <div className="flex items-center justify-between text-[#686C78]">
                    <span className="text-xs font-medium">Signed In Now</span>
                    <span className="h-2.5 w-2.5 rounded-full bg-[#16A34A]" aria-hidden="true" />
                  </div>
                  <p className="font-display font-mono-tabular text-2xl sm:text-3xl font-extrabold text-[#15803D]">
                    {signedInStudentsCount}
                  </p>
                  <p className="text-xs text-[#686C78] font-mono-tabular">
                    Active sessions right now
                  </p>
                </div>

                <div className="rounded-2xl bg-white p-4 sm:p-5 space-y-1.5">
                  <div className="flex items-center justify-between text-[#686C78]">
                    <span className="text-xs font-medium">Active Students</span>
                    <CheckCircle2 className="w-4 h-4 text-[#1D1E23]" />
                  </div>
                  <p className="font-display font-mono-tabular text-2xl sm:text-3xl font-extrabold text-[#1A1B20]">
                    {activeStudentsCount}
                  </p>
                  <p className="text-xs text-[#686C78] font-mono-tabular">
                    Verified student access
                  </p>
                </div>

                <div className="rounded-2xl bg-white p-4 sm:p-5 space-y-1.5">
                  <div className="flex items-center justify-between text-[#686C78]">
                    <span className="text-xs font-medium">Past Questions</span>
                    <FileText className="w-4 h-4" />
                  </div>
                  <p className="font-display font-mono-tabular text-2xl sm:text-3xl font-extrabold text-[#1A1B20]">
                    {allSchoolDocs.length}
                  </p>
                  <p className="text-xs text-[#686C78] font-mono-tabular">
                    {publishedDocsCount} published · {draftDocsCount} drafts
                  </p>
                </div>
              </div>
            </section>

            {/* Quick Navigation Cards to Dedicated Side Panel Pages */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <SurfaceCard tone="white" className="p-5 flex flex-col justify-between gap-4">
                <div className="flex items-start gap-3.5">
                  <div className="h-10 w-10 rounded-2xl tactile-dark text-white flex items-center justify-center shrink-0">
                    <UploadCloud className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-display text-base font-bold text-[#1A1B20]">
                      Upload Documents
                    </h2>
                    <p className="text-xs text-[#505460] mt-1">
                      Select PDF, DOCX, TXT, or scanned images to extract and publish past
                      questions for {assignedSchool.code}.
                    </p>
                  </div>
                </div>
                <TactileButton
                  type="button"
                  variant="dark"
                  size="md"
                  onClick={() => onSelectSection?.('upload')}
                  icon={<ArrowRight className="w-4 h-4" />}
                >
                  Go to Upload Documents
                </TactileButton>
              </SurfaceCard>

              <SurfaceCard tone="white" className="p-5 flex flex-col justify-between gap-4">
                <div className="flex items-start gap-3.5">
                  <div className="h-10 w-10 rounded-2xl bg-[#F2F4F7] text-[#1D1E23] flex items-center justify-center shrink-0">
                    <Users className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-display text-base font-bold text-[#1A1B20]">
                      Students Monitor
                    </h2>
                    <p className="text-xs text-[#505460] mt-1">
                      Inspect all {schoolStudents.length} registered {assignedSchool.code} students,
                      filter signed-in accounts, and check recent activity.
                    </p>
                  </div>
                </div>
                <TactileButton
                  type="button"
                  variant="light"
                  size="md"
                  onClick={() => onSelectSection?.('students')}
                  icon={<ArrowRight className="w-4 h-4" />}
                >
                  Open Students ({schoolStudents.length})
                </TactileButton>
              </SurfaceCard>

              <SurfaceCard tone="white" className="p-5 flex flex-col justify-between gap-4">
                <div className="flex items-start gap-3.5">
                  <div className="h-10 w-10 rounded-2xl bg-[#F2F4F7] text-[#1D1E23] flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-display text-base font-bold text-[#1A1B20]">
                      Past Questions Catalog
                    </h2>
                    <p className="text-xs text-[#505460] mt-1">
                      Manage {publishedDocsCount} published papers and {draftDocsCount} saved drafts
                      in the {assignedSchool.code} archive.
                    </p>
                  </div>
                </div>
                <TactileButton
                  type="button"
                  variant="light"
                  size="md"
                  onClick={() => onSelectSection?.('catalog')}
                  icon={<ArrowRight className="w-4 h-4" />}
                >
                  View Catalog ({allSchoolDocs.length})
                </TactileButton>
              </SurfaceCard>

              <SurfaceCard tone="white" className="p-5 flex flex-col justify-between gap-4">
                <div className="flex items-start gap-3.5">
                  <div className="h-10 w-10 rounded-2xl bg-[#F2F4F7] text-[#1D1E23] flex items-center justify-center shrink-0">
                    <Bell className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-display text-base font-bold text-[#1A1B20]">
                      Student Notices
                    </h2>
                    <p className="text-xs text-[#505460] mt-1">
                      {liveNoticesCount} live · {pendingNoticesCount} pending Super Admin
                      verification for {assignedSchool.code} students.
                    </p>
                  </div>
                </div>
                <TactileButton
                  type="button"
                  variant="light"
                  size="md"
                  onClick={() => onSelectSection?.('notices')}
                  icon={<ArrowRight className="w-4 h-4" />}
                >
                  Open Student Notices ({schoolSubmittedNotifications.length})
                </TactileButton>
              </SurfaceCard>
            </div>
          </div>
        )}

        {activeSection === 'document_library' && (
          <DocumentLibraryScreen currentUser={currentUser} />
        )}

        {activeSection === 'upload' && <DocumentUploadScreen currentUser={currentUser} />}

        {activeSection === 'catalog' && (
          <SurfaceCard tone="white" className="p-5 sm:p-6 space-y-4">
            <SectionHeadingBar
              icon={<FileText className="w-4 h-4" />}
              title={adminCms.catalogPanelTitle.replace(/\{SCHOOL\}/g, assignedSchool.code)}
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

            {historyFilter === 'draft' && adminCms.draftNotice && (
              <p className="rounded-xl bg-[#F6F7F9] px-3 py-2 text-xs text-[#505460]">
                {adminCms.draftNotice}
              </p>
            )}

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
        )}

        {activeSection === 'students' && (
          <SurfaceCard tone="white" className="p-5 sm:p-6 space-y-4">
            <SectionHeadingBar
              icon={<Users className="w-4 h-4" />}
              title={`${assignedSchool.code} Students Monitor`}
              right={
                <span className="font-mono-tabular text-xs font-semibold text-[#C3C7D2]">
                  {signedInStudentsCount} signed in
                </span>
              }
            />

            <div className="grid grid-cols-3 gap-2.5">
              <div className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/[0.06] p-3">
                <p className="text-[11px] font-medium text-[#686C78]">Signed In Now</p>
                <p className="font-display text-xl font-bold text-[#15803D] font-mono-tabular mt-0.5">
                  {signedInStudentsCount}
                </p>
              </div>
              <div className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/[0.06] p-3">
                <p className="text-[11px] font-medium text-[#686C78]">Active Students</p>
                <p className="font-display text-xl font-bold text-[#1A1B20] font-mono-tabular mt-0.5">
                  {activeStudentsCount}
                </p>
              </div>
              <div className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/[0.06] p-3">
                <p className="text-[11px] font-medium text-[#686C78]">Registered</p>
                <p className="font-display text-xl font-bold text-[#1A1B20] font-mono-tabular mt-0.5">
                  {schoolStudents.length}
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                placeholder="Search name, matric, or email..."
                className="flex-1 min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-medium text-[#1A1B20]"
              />
              <div className="flex gap-1.5">
                {(
                  [
                    { id: 'signed_in', label: 'Signed In' },
                    { id: 'active', label: 'Active' },
                    { id: 'all', label: 'All' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setStudentFilter(tab.id)}
                    className={`min-h-[42px] px-3 rounded-xl text-xs font-semibold cursor-pointer transition-colors ${
                      studentFilter === tab.id
                        ? 'bg-[#1D1E23] text-white'
                        : 'bg-[#F6F7F9] text-[#505460] hover:bg-[#ECEEF3]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="divide-y divide-[#1A1B20]/[0.06] max-h-[380px] overflow-y-auto pr-1">
              {filteredStudents.length === 0 ? (
                <p className="py-8 text-center text-xs text-[#686C78]">
                  No students match this filter right now.
                </p>
              ) : (
                filteredStudents.map((student) => {
                  const isSignedIn = student.sessionState === 'logged_in';
                  return (
                    <button
                      key={student.id}
                      type="button"
                      onClick={() => setSelectedStudentId(student.id)}
                      className="w-full py-3 first:pt-1 last:pb-1 flex items-center justify-between gap-3 text-left hover:bg-[#F6F7F9] rounded-xl px-2 -mx-2 transition-colors cursor-pointer"
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className={`h-2 w-2 rounded-full shrink-0 ${
                              isSignedIn ? 'bg-[#16A34A]' : 'bg-[#C3C7D2]'
                            }`}
                          />
                          <p className="text-sm font-bold text-[#1A1B20] truncate">
                            {student.fullName}
                          </p>
                        </div>
                        <p className="text-xs text-[#686C78] truncate pl-4">
                          {student.matricNumber ? `${student.matricNumber} · ` : ''}
                          {student.email} · {student.level ?? '100L'}
                          {student.department ? ` · ${student.department}` : ''}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`rounded-lg px-2 py-1 text-[11px] font-semibold ${
                            isSignedIn
                              ? 'bg-[#DCFCE7] text-[#15803D]'
                              : student.status === 'active'
                                ? 'bg-[#F2F4F7] text-[#505460]'
                                : 'bg-[#FEE2E2] text-[#B91C1C]'
                          }`}
                        >
                          {isSignedIn
                            ? 'Signed In'
                            : student.status === 'active'
                              ? 'Active'
                              : student.status}
                        </span>
                        <ChevronRight className="w-3.5 h-3.5 text-[#8E93A2]" />
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </SurfaceCard>
        )}

        {activeSection === 'notices' && (
          <SurfaceCard tone="white" className="p-5 sm:p-6 space-y-4">
            <SectionHeadingBar
              icon={<Bell className="w-4 h-4" />}
              title="Student Website Notifications"
              right={
                <span className="font-mono-tabular text-xs font-semibold text-[#C3C7D2]">
                  Verified by Super Admin
                </span>
              }
            />

            <div className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/[0.07] px-3.5 py-2.5 flex items-start gap-2.5 text-xs text-[#505460]">
              <ShieldCheck className="w-4 h-4 text-[#1D1E23] shrink-0 mt-0.5" />
              <span>
                Messages submitted here stay hidden from students until a Super Admin verifies and
                approves them.
              </span>
            </div>

            <form onSubmit={handleSubmitNotification} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[#686C78] mb-1">
                  Notification Title
                </label>
                <input
                  type="text"
                  required
                  disabled={accountRestricted}
                  value={notifTitle}
                  onChange={(e) => setNotifTitle(e.target.value)}
                  placeholder="e.g. GNS 101 Past Questions Updated"
                  className="w-full min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs sm:text-sm font-semibold disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#686C78] mb-1">
                  Message to {assignedSchool.code} Students
                </label>
                <textarea
                  rows={3}
                  required
                  disabled={accountRestricted}
                  value={notifMessage}
                  onChange={(e) => setNotifMessage(e.target.value)}
                  placeholder="Write announcement for students..."
                  className="w-full rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 p-3 text-xs sm:text-sm text-[#1A1B20] disabled:opacity-50"
                />
              </div>

              <CustomSelect
                label="Category"
                value={notifCategory}
                options={[
                  { value: 'system', label: 'Announcement / Notice' },
                  { value: 'upload', label: 'Past Questions / Material Update' },
                  { value: 'access', label: 'Exam & Timetable Notice' },
                ]}
                onChange={(v) => setNotifCategory(v as AppNotification['category'])}
              />

              <TactileButton
                type="submit"
                variant="dark"
                size="md"
                fullWidth
                disabled={accountRestricted}
                icon={<Send className="w-4 h-4" />}
              >
                Submit for Super Admin Verification
              </TactileButton>
            </form>

            {schoolSubmittedNotifications.length > 0 && (
              <div className="pt-3 border-t border-[#1A1B20]/[0.07] space-y-2.5">
                <p className="text-xs font-bold text-[#1A1B20]">
                  Submitted Notifications ({schoolSubmittedNotifications.length})
                </p>
                <div className="divide-y divide-[#1A1B20]/[0.06] max-h-[240px] overflow-y-auto pr-1">
                  {schoolSubmittedNotifications.map((item) => {
                    const status = item.approvalStatus ?? 'approved';
                    const isEditingThis = editingNotifId === item.id;
                    return (
                      <div key={item.id} className="py-2.5 first:pt-1 last:pb-1 space-y-2">
                        {isEditingThis ? (
                          <form onSubmit={handleSaveNotifEdit} className="space-y-2 bg-[#F6F7F9] p-3 rounded-xl">
                            <input
                              type="text"
                              required
                              value={editNotifTitle}
                              onChange={(e) => setEditNotifTitle(e.target.value)}
                              className="w-full min-h-[38px] rounded-lg bg-white border border-[#1A1B20]/10 px-2.5 text-xs font-semibold"
                            />
                            <textarea
                              rows={2}
                              required
                              value={editNotifMessage}
                              onChange={(e) => setEditNotifMessage(e.target.value)}
                              className="w-full rounded-lg bg-white border border-[#1A1B20]/10 p-2.5 text-xs text-[#1A1B20]"
                            />
                            <div className="flex justify-end gap-2">
                              <TactileButton
                                type="button"
                                variant="light"
                                size="sm"
                                onClick={() => setEditingNotifId(null)}
                              >
                                Cancel
                              </TactileButton>
                              <TactileButton type="submit" variant="dark" size="sm">
                                Save Update
                              </TactileButton>
                            </div>
                          </form>
                        ) : (
                          <div className="flex items-start justify-between gap-2.5">
                            <div className="min-w-0 flex-1">
                              <p className="text-xs sm:text-sm font-bold text-[#1A1B20] truncate">
                                {item.title}
                              </p>
                              <p className="text-xs text-[#505460] mt-0.5 line-clamp-2">
                                {item.message}
                              </p>
                              {status === 'rejected' && item.reviewNote && (
                                <p className="text-[11px] text-[#B91C1C] mt-1 font-medium">
                                  Note: {item.reviewNote}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span
                                className={`rounded-lg px-2 py-1 text-[10px] font-semibold inline-flex items-center gap-1 ${
                                  status === 'approved'
                                    ? 'bg-[#DCFCE7] text-[#15803D]'
                                    : status === 'rejected'
                                      ? 'bg-[#FEE2E2] text-[#B91C1C]'
                                      : 'bg-[#FEF3C7] text-[#92400E]'
                                }`}
                              >
                                {status === 'pending_verification' && (
                                  <Clock className="w-3 h-3" />
                                )}
                                {status === 'approved'
                                  ? 'Live'
                                  : status === 'rejected'
                                    ? 'Declined'
                                    : 'Pending Verification'}
                              </span>
                              {status === 'pending_verification' && !accountRestricted && (
                                <button
                                  type="button"
                                  onClick={() => startEditPendingNotif(item)}
                                  className="h-7 px-2 rounded-lg bg-[#F2F4F7] hover:bg-[#E5E8EE] text-[11px] font-semibold text-[#1A1B20] cursor-pointer"
                                >
                                  Edit
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </SurfaceCard>
        )}
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

      <DetailDialog
        open={Boolean(selectedStudent)}
        onClose={() => setSelectedStudentId(null)}
        title={selectedStudent?.fullName ?? 'Student Details'}
        subtitle={
          selectedStudent
            ? `${selectedStudent.schoolCode} · ${selectedStudent.level ?? '100L'}${
                selectedStudent.matricNumber ? ` · ${selectedStudent.matricNumber}` : ''
              }`
            : undefined
        }
        icon={<Users className="w-4 h-4" />}
      >
        {selectedStudent && (
          <div className="space-y-4">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl bg-[#F6F7F9] p-3">
                <dt className="text-[#686C78]">Session State</dt>
                <dd
                  className={`font-bold mt-0.5 ${
                    selectedStudent.sessionState === 'logged_in'
                      ? 'text-[#15803D]'
                      : 'text-[#1A1B20]'
                  }`}
                >
                  {selectedStudent.sessionState === 'logged_in' ? 'Signed In Now' : 'Signed Out'}
                </dd>
              </div>
              <div className="rounded-xl bg-[#F6F7F9] p-3">
                <dt className="text-[#686C78]">Account Status</dt>
                <dd className="font-bold capitalize text-[#1A1B20] mt-0.5">
                  {selectedStudent.status}
                </dd>
              </div>
              <div className="rounded-xl bg-[#F6F7F9] p-3">
                <dt className="text-[#686C78]">Email</dt>
                <dd className="font-semibold text-[#1A1B20] mt-0.5 break-all">
                  {selectedStudent.email}
                </dd>
              </div>
              <div className="rounded-xl bg-[#F6F7F9] p-3">
                <dt className="text-[#686C78]">Role</dt>
                <dd className="font-bold text-[#1A1B20] mt-0.5">Student</dd>
              </div>
              <div className="rounded-xl bg-[#F6F7F9] p-3">
                <dt className="text-[#686C78]">Verification</dt>
                <dd
                  className={`font-bold mt-0.5 ${
                    selectedStudent.isEmailVerified !== false &&
                    selectedStudent.adminVerified !== false
                      ? 'text-[#15803D]'
                      : 'text-[#B91C1C]'
                  }`}
                >
                  {selectedStudent.isEmailVerified !== false ? 'Email Verified' : 'Pending Email'}
                  {' · '}
                  {selectedStudent.adminVerified !== false ? 'Login Verified' : 'Unverified'}
                </dd>
              </div>
              <div className="rounded-xl bg-[#F6F7F9] p-3">
                <dt className="text-[#686C78]">Registered</dt>
                <dd className="font-mono-tabular font-semibold text-[#1A1B20] mt-0.5">
                  {selectedStudent.createdAt
                    ? new Date(selectedStudent.createdAt).toLocaleString('en-NG', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })
                    : 'N/A'}
                </dd>
              </div>
              <div className="rounded-xl bg-[#F6F7F9] p-3">
                <dt className="text-[#686C78]">Last Active</dt>
                <dd className="font-mono-tabular font-semibold text-[#1A1B20] mt-0.5">
                  {new Date(selectedStudent.lastActiveAt).toLocaleString('en-NG', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </dd>
              </div>
            </dl>

            <div className="space-y-2">
              <p className="text-xs font-bold text-[#1A1B20]">Recent Activity</p>
              {selectedStudentActivities.length === 0 ? (
                <p className="text-xs text-[#686C78] rounded-xl bg-[#F6F7F9] p-3">
                  No recent activity recorded yet.
                </p>
              ) : (
                <div className="divide-y divide-[#1A1B20]/[0.06] rounded-xl bg-[#F6F7F9] px-3">
                  {selectedStudentActivities.map((act) => (
                    <div key={act.id} className="py-2.5 flex items-start justify-between gap-3 text-xs">
                      <span className="text-[#1A1B20] font-medium">{act.detail}</span>
                      <span className="font-mono-tabular text-[11px] text-[#686C78] shrink-0">
                        {new Date(act.timestamp).toLocaleTimeString('en-NG', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </DetailDialog>
    </>
  );
};
