import React, { useState } from 'react';
import {
  CheckCircle2,
  FileText,
  ScanLine,
  UploadCloud,
} from 'lucide-react';
import type { PastQuestionDoc, SemesterType } from '../core/types';
import { useArchiveStore } from '../hooks/useArchiveStore';
import { archiveRepository } from '../services/archiveRepository';
import {
  processUploadedDocument,
  type ProcessedDocumentResult,
} from '../services/documentProcessor';
import { CustomSelect, SurfaceCard, TactileButton } from '../components/ui';

export const SchoolAdminScreen: React.FC = () => {
  const store = useArchiveStore();

  const [schoolId, setSchoolId] = useState(store.selectedSchoolId || 'sch-aaua');
  const [courseCode, setCourseCode] = useState('');
  const [courseTitle, setCourseTitle] = useState('');
  const [department, setDepartment] = useState('Computer Science');
  const [faculty, setFaculty] = useState('Science');
  const [level, setLevel] = useState<PastQuestionDoc['level']>('200L');
  const [session, setSession] = useState('2024/2025');
  const [semester, setSemester] = useState<SemesterType>('First Semester');

  const [processing, setProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [processed, setProcessed] = useState<ProcessedDocumentResult | null>(null);
  const [editableText, setEditableText] = useState('');
  const [publishNotice, setPublishNotice] = useState<string | null>(null);

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
      setErrorMsg(
        err instanceof Error ? err.message : 'Could not process uploaded file.'
      );
    } finally {
      setProcessing(false);
      e.target.value = '';
    }
  };

  const handlePublish = (e: React.FormEvent) => {
    e.preventDefault();
    if (!processed) return;

    const selectedSchool =
      store.schools.find((s) => s.id === schoolId) ?? store.schools[0];

    const questionLines = editableText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    const parsedYear = parseInt(session.split('/')[1] ?? '2025', 10) || 2025;

    const newDoc: PastQuestionDoc = {
      id: `doc-${Date.now()}`,
      schoolId: selectedSchool.id,
      schoolCode: selectedSchool.code,
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
      uploadedBy: `${selectedSchool.code} School Admin`,
      uploadedAt: new Date().toISOString(),
      viewsCount: 0,
      status: 'published',
    };

    archiveRepository.addDocument(newDoc);
    setPublishNotice(
      `${newDoc.courseCode} (${newDoc.session} · ${newDoc.semester}) indexed and published to student archive.`
    );
    setProcessed(null);
    setCourseCode('');
    setCourseTitle('');
    setEditableText('');
  };

  const recentUploads = store.documents.slice(0, 6);

  return (
    <div className="space-y-6 page-enter">
      {/* Header Banner */}
      <SurfaceCard tone="ash" withWaves className="p-6">
        <p className="text-xs font-medium text-[#A5AAB8]">
          School Admin Panel · Ingestion Desk
        </p>
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-white mt-1.5">
          Upload & Auto-Index Past Questions
        </h1>
        <p className="text-sm text-[#B8BCC8] mt-2 max-w-2xl">
          Drop any image scan or typed document. Images convert automatically to high-contrast Scan-to-PDF sheets; typed files extract questions into the searchable student database.
        </p>
      </SurfaceCard>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Upload & Pipeline Form */}
        <SurfaceCard tone="white" className="lg:col-span-7 p-5 sm:p-6 space-y-5">
          <div>
            <h2 className="font-display text-lg font-bold text-[#1A1B20]">
              1. Upload File (Image or Document)
            </h2>
            <p className="text-xs text-[#686C78] mt-0.5">
              Accepts JPG, PNG, WEBP, PDF, DOCX, TXT, or Markdown
            </p>
          </div>

          <label className="block rounded-2xl border-2 border-dashed border-[#1A1B20]/15 bg-[#F6F7F9] hover:bg-[#EFF1F5] transition-colors p-6 text-center cursor-pointer">
            <input
              type="file"
              accept="image/*,.pdf,.doc,.docx,.txt,.md,.csv"
              onChange={handleFilePicked}
              className="sr-only"
            />
            <div className="h-12 w-12 rounded-2xl tactile-dark text-white flex items-center justify-center mx-auto mb-3">
              <UploadCloud className="w-5 h-5" />
            </div>
            <p className="font-display text-sm font-bold text-[#1A1B20]">
              {processing
                ? 'Processing file...'
                : 'Tap to select past question image or document'}
            </p>
            <p className="text-xs text-[#686C78] mt-1">
              Auto-detects Scan-to-PDF vs Text Extraction pipeline
            </p>
          </label>

          {errorMsg && (
            <div className="rounded-xl bg-[#FEF2F2] border border-[#FECACA] px-4 py-3 text-xs font-medium text-[#B91C1C]">
              {errorMsg}
            </div>
          )}

          {publishNotice && (
            <div className="rounded-xl bg-[#F0FDF4] border border-[#BBF7D0] px-4 py-3 text-xs font-medium text-[#15803D] flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{publishNotice}</span>
            </div>
          )}

          {processed && (
            <form onSubmit={handlePublish} className="space-y-4 pt-3 border-t border-[#1A1B20]/[0.07]">
              <div className="rounded-2xl bg-[#F6F7F9] p-4 flex items-start gap-3">
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
                  <p className="text-xs text-[#505460] mt-0.5">
                    {processed.processingSummary}
                  </p>
                </div>
              </div>

              {processed.scannedPagePreviewUrl && (
                <div className="rounded-2xl border border-[#1A1B20]/10 bg-[#F6F7F9] p-3">
                  <p className="text-xs font-semibold text-[#686C78] mb-2">
                    Scan-to-PDF Normalized Output Preview
                  </p>
                  <img
                    src={processed.scannedPagePreviewUrl}
                    alt="Normalized scan preview"
                    referrerPolicy="no-referrer"
                    className="max-h-56 mx-auto rounded-lg shadow-xs bg-white"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <CustomSelect
                  label="School"
                  value={schoolId}
                  options={store.schools.map((s) => ({
                    value: s.id,
                    label: `${s.code} — ${s.shortName}`,
                    hint: s.location,
                  }))}
                  onChange={setSchoolId}
                />

                <div>
                  <label className="block text-xs font-medium text-[#686C78] mb-1">
                    Course Code
                  </label>
                  <input
                    type="text"
                    required
                    value={courseCode}
                    onChange={(e) => setCourseCode(e.target.value)}
                    placeholder="e.g. CSC 201"
                    className="w-full min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-sm font-semibold"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-[#686C78] mb-1">
                    Course Title (optional)
                  </label>
                  <input
                    type="text"
                    value={courseTitle}
                    onChange={(e) => setCourseTitle(e.target.value)}
                    placeholder="e.g. Computer Programming I"
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
                  Extracted & Indexed Questions (one per line)
                </label>
                <textarea
                  rows={4}
                  value={editableText}
                  onChange={(e) => setEditableText(e.target.value)}
                  className="w-full rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 p-3 text-xs sm:text-sm text-[#1A1B20] leading-relaxed"
                />
              </div>

              <TactileButton type="submit" variant="dark" size="lg" fullWidth>
                Publish & Index to Archive
              </TactileButton>
            </form>
          )}
        </SurfaceCard>

        {/* Recent Uploads Feed */}
        <SurfaceCard tone="white" className="lg:col-span-5 p-5 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-display text-lg font-bold text-[#1A1B20]">
                Recent Uploads
              </h2>
              <p className="text-xs text-[#686C78]">
                Latest indexed past questions from school uploaders
              </p>
            </div>
            <span className="font-mono-tabular text-xs font-semibold text-[#1A1B20]">
              {store.documents.length} total
            </span>
          </div>

          <div className="divide-y divide-[#1A1B20]/[0.06]">
            {recentUploads.map((doc) => (
              <div
                key={doc.id}
                className="py-3.5 first:pt-1 last:pb-1 flex items-center justify-between gap-3"
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
                      {doc.semester} ·{' '}
                      {doc.sourceType === 'scanned_image'
                        ? 'Scan-to-PDF'
                        : 'Text Extracted'}
                    </p>
                  </div>
                </div>
                <span className="font-mono-tabular text-[11px] text-[#686C78] shrink-0">
                  {new Date(doc.uploadedAt).toLocaleDateString('en-NG', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </div>
            ))}
          </div>
        </SurfaceCard>
      </div>
    </div>
  );
};
