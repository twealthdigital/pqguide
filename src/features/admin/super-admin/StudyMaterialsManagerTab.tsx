import React, { useMemo, useState } from 'react';
import {
  BookOpen,
  Edit3,
  Eye,
  Plus,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { sanitizeSafeUrl } from '../../../core/security';
import type {
  AuthenticatedUser,
  MaterialSection,
  StudyMaterial,
} from '../../../core/types';
import { archiveRepository, type AppStoreState } from '../../../services/archiveRepository';
import {
  processUploadedStudyMaterial,
  type ProcessedStudyMaterialResult,
} from '../../../services/documentProcessor';
import { CustomSelect, SurfaceCard, TactileButton } from '../../../components/ui';

interface StudyMaterialsManagerTabProps {
  currentUser: AuthenticatedUser;
  store: AppStoreState;
  onNotice: (msg: string) => void;
  onError: (msg: string) => void;
}

export const StudyMaterialsManagerTab: React.FC<StudyMaterialsManagerTabProps> = ({
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
  const [level, setLevel] = useState('100L');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [readMinutes, setReadMinutes] = useState('6');
  const [sectionHeading, setSectionHeading] = useState('Core Study Notes');
  const [sectionBody, setSectionBody] = useState('');
  const [sectionPoints, setSectionPoints] = useState('');

  const [processing, setProcessing] = useState(false);
  const [uploadedFileMeta, setUploadedFileMeta] =
    useState<ProcessedStudyMaterialResult | null>(null);

  const [filterSchoolId, setFilterSchoolId] = useState('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'published' | 'draft'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [previewMaterial, setPreviewMaterial] = useState<StudyMaterial | null>(null);
  const [editingMaterial, setEditingMaterial] = useState<StudyMaterial | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editCourseCode, setEditCourseCode] = useState('');
  const [editCourseTitle, setEditCourseTitle] = useState('');
  const [editLevel, setEditLevel] = useState('100L');
  const [editSummary, setEditSummary] = useState('');
  const [editReadMinutes, setEditReadMinutes] = useState('6');
  const [editSchoolId, setEditSchoolId] = useState('sch-aaua');
  const [editFirstSectionBody, setEditFirstSectionBody] = useState('');

  const filteredMaterials = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return store.materials.filter((m) => {
      const mStatus = m.status ?? 'published';
      if (filterSchoolId !== 'all' && (m.schoolId ?? 'sch-aaua') !== filterSchoolId) {
        return false;
      }
      if (filterStatus !== 'all' && mStatus !== filterStatus) return false;
      if (!q) return true;
      return (
        m.title.toLowerCase().includes(q) ||
        m.courseCode.toLowerCase().includes(q) ||
        m.courseTitle.toLowerCase().includes(q) ||
        (m.schoolCode ?? '').toLowerCase().includes(q)
      );
    });
  }, [store.materials, filterSchoolId, filterStatus, searchQuery]);

  const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProcessing(true);
    try {
      const result = await processUploadedStudyMaterial(file);
      setUploadedFileMeta(result);
      setCourseCode(result.suggestedCourseCode);
      setTitle(result.suggestedTitle);
      setSummary(result.suggestedSummary);
      setReadMinutes(String(result.suggestedReadMinutes));
      const firstSec = result.suggestedSections[0];
      if (firstSec) {
        setSectionHeading(firstSec.heading);
        setSectionBody((firstSec.paragraphs ?? []).join('\n\n'));
        setSectionPoints((firstSec.points ?? []).join('\n'));
      }
      onNotice(`Processed study file ${result.originalFileName}.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unable to process study material file.');
    } finally {
      setProcessing(false);
      e.target.value = '';
    }
  };

  const handleSaveMaterial = (targetStatus: 'draft' | 'published') => {
    if (!title.trim() || !courseCode.trim()) {
      onError('Course code and study material title are required.');
      return;
    }

    const paragraphs = sectionBody
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);
    const points = sectionPoints
      .split(/\r?\n/)
      .map((p) => p.trim())
      .filter(Boolean);

    const sections: MaterialSection[] =
      uploadedFileMeta && paragraphs.length === 0 && points.length === 0
        ? uploadedFileMeta.suggestedSections
        : [
            {
              heading: sectionHeading.trim() || 'Key Concepts',
              paragraphs: paragraphs.length > 0 ? paragraphs : [summary.trim() || title.trim()],
              points: points.length > 0 ? points : undefined,
            },
          ];

    const school = store.schools.find((s) => s.id === schoolId) ?? store.schools[0];

    try {
      const created = archiveRepository.addMaterial(currentUser, {
        id: `mat-${Date.now()}`,
        schoolId: school?.id ?? 'sch-aaua',
        schoolCode: school?.code ?? 'AAUA',
        faculty,
        department,
        courseCode: courseCode.trim().toUpperCase(),
        courseTitle: courseTitle.trim() || title.trim(),
        level,
        title: title.trim(),
        summary: summary.trim() || `Study material for ${courseCode.trim().toUpperCase()}.`,
        readMinutes: Math.max(1, parseInt(readMinutes, 10) || 6),
        sections,
        sourceType: uploadedFileMeta?.sourceType ?? 'typed_document',
        originalFileName: uploadedFileMeta?.originalFileName,
        extractedText: uploadedFileMeta?.extractedText,
        attachmentPreviewUrl: uploadedFileMeta?.attachmentPreviewUrl,
        status: targetStatus,
        uploadedBy: currentUser.fullName,
        uploadedAt: new Date().toISOString(),
      });

      onNotice(
        targetStatus === 'published'
          ? `Published study material "${created.title}" (${created.courseCode}).`
          : `Saved study material draft "${created.title}".`
      );
      setUploadedFileMeta(null);
      setTitle('');
      setCourseCode('');
      setCourseTitle('');
      setSummary('');
      setSectionBody('');
      setSectionPoints('');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save study material.');
    }
  };

  const beginEdit = (mat: StudyMaterial) => {
    setEditingMaterial(mat);
    setEditSchoolId(mat.schoolId ?? 'sch-aaua');
    setEditTitle(mat.title);
    setEditCourseCode(mat.courseCode);
    setEditCourseTitle(mat.courseTitle);
    setEditLevel(mat.level);
    setEditSummary(mat.summary);
    setEditReadMinutes(String(mat.readMinutes));
    setEditFirstSectionBody((mat.sections[0]?.paragraphs ?? []).join('\n\n'));
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMaterial) return;
    try {
      const paragraphs = editFirstSectionBody
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean);

      const updatedSections =
        editingMaterial.sections.length > 0
          ? editingMaterial.sections.map((s, idx) =>
              idx === 0
                ? {
                    ...s,
                    paragraphs: paragraphs.length > 0 ? paragraphs : s.paragraphs,
                  }
                : s
            )
          : [
              {
                heading: 'Overview',
                paragraphs,
              },
            ];

      archiveRepository.updateMaterial(currentUser, editingMaterial.id, {
        schoolId: editSchoolId,
        title: editTitle,
        courseCode: editCourseCode,
        courseTitle: editCourseTitle,
        level: editLevel,
        summary: editSummary,
        readMinutes: Math.max(1, parseInt(editReadMinutes, 10) || 5),
        sections: updatedSections,
      });

      setEditingMaterial(null);
      onNotice(`Updated study material "${editTitle}".`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not update study material.');
    }
  };

  const handleToggleStatus = (mat: StudyMaterial) => {
    try {
      const current = mat.status ?? 'published';
      const next = current === 'published' ? 'draft' : 'published';
      archiveRepository.setMaterialStatus(currentUser, mat.id, next);
      onNotice(
        `"${mat.title}" is now ${next === 'published' ? 'published' : 'unpublished (draft)'}.`
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Action denied.');
    }
  };

  const handleDelete = (mat: StudyMaterial) => {
    try {
      archiveRepository.deleteMaterial(currentUser, mat.id);
      if (previewMaterial?.id === mat.id) setPreviewMaterial(null);
      if (editingMaterial?.id === mat.id) setEditingMaterial(null);
      onNotice(`Deleted study material "${mat.title}".`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not delete study material.');
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Create / Upload Study Material */}
      <SurfaceCard tone="white" className="lg:col-span-5 p-5 sm:p-6 space-y-4">
        <div>
          <h2 className="font-display text-lg font-bold text-[#1A1B20]">
            Add Study Material
          </h2>
          <p className="text-xs text-[#686C78]">
            Dedicated Study Material model (separate from Past Questions). Upload PDF, DOCX, TXT, or image, or write sections directly.
          </p>
        </div>

        <label className="block rounded-2xl border-2 border-dashed border-[#1A1B20]/15 bg-[#F6F7F9] hover:bg-[#EFF1F5] transition-colors p-4 text-center cursor-pointer">
          <input
            type="file"
            accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.txt,.md,.csv"
            onChange={handleFilePicked}
            className="sr-only"
          />
          <div className="flex items-center justify-center gap-2 text-xs font-bold text-[#1A1B20]">
            <UploadCloud className="w-4 h-4" />
            <span>
              {processing
                ? 'Validating & extracting guide...'
                : uploadedFileMeta
                  ? `Loaded: ${uploadedFileMeta.originalFileName} (tap to replace)`
                  : 'Optional: Upload PDF, DOCX, TXT, or Sheet Image'}
            </span>
          </div>
        </label>

        {sanitizeSafeUrl(uploadedFileMeta?.attachmentPreviewUrl) && (
          <img
            src={sanitizeSafeUrl(uploadedFileMeta?.attachmentPreviewUrl)}
            alt="Study sheet preview"
            referrerPolicy="no-referrer"
            className="max-h-40 mx-auto rounded-lg border border-[#1A1B20]/10 bg-white"
          />
        )}

        <div className="space-y-3">
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
                placeholder="GNS 101"
                className="w-full min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-semibold uppercase"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#686C78] mb-1">
                Course Title
              </label>
              <input
                type="text"
                value={courseTitle}
                onChange={(e) => setCourseTitle(e.target.value)}
                placeholder="Use of English"
                className="w-full min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-semibold"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <CustomSelect
              size="sm"
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
              onChange={setLevel}
            />
            <div>
              <label className="block text-xs font-medium text-[#686C78] mb-1">
                Department
              </label>
              <input
                type="text"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full min-h-[38px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-2.5 text-xs font-semibold"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#686C78] mb-1">
                Read Mins
              </label>
              <input
                type="number"
                min={1}
                max={90}
                value={readMinutes}
                onChange={(e) => setReadMinutes(e.target.value)}
                className="w-full min-h-[38px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-2.5 text-xs font-mono-tabular font-semibold"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#686C78] mb-1">
              Material Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Essay Structure, Summary Writing & Concord"
              className="w-full min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-semibold"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#686C78] mb-1">
              Summary
            </label>
            <textarea
              rows={2}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Short description shown on Study Materials cards"
              className="w-full rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 p-2.5 text-xs text-[#1A1B20]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#686C78] mb-1">
              Section Heading &amp; Notes
            </label>
            <input
              type="text"
              value={sectionHeading}
              onChange={(e) => setSectionHeading(e.target.value)}
              placeholder="Section Heading"
              className="w-full min-h-[38px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-semibold mb-2"
            />
            <textarea
              rows={3}
              value={sectionBody}
              onChange={(e) => setSectionBody(e.target.value)}
              placeholder="Main study guide paragraphs..."
              className="w-full rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 p-2.5 text-xs text-[#1A1B20] mb-2"
            />
            <textarea
              rows={2}
              value={sectionPoints}
              onChange={(e) => setSectionPoints(e.target.value)}
              placeholder="Key bullet takeaways (one per line)"
              className="w-full rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 p-2.5 text-xs text-[#1A1B20]"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <TactileButton
              type="button"
              variant="light"
              size="md"
              fullWidth
              onClick={() => handleSaveMaterial('draft')}
            >
              Save Draft
            </TactileButton>
            <TactileButton
              type="button"
              variant="dark"
              size="md"
              fullWidth
              icon={<Plus className="w-4 h-4" />}
              onClick={() => handleSaveMaterial('published')}
            >
              Publish Guide
            </TactileButton>
          </div>
        </div>
      </SurfaceCard>

      {/* Study Materials Catalog & Upload History */}
      <SurfaceCard tone="white" className="lg:col-span-7 p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-lg font-bold text-[#1A1B20]">
              Study Materials Library
            </h2>
            <p className="text-xs text-[#686C78]">
              Preview, edit, publish, unpublish, or delete study guides
            </p>
          </div>
          <span className="font-mono-tabular text-xs font-semibold text-[#686C78]">
            {filteredMaterials.length} / {store.materials.length}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search material or course..."
            className="min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-medium"
          />
          <CustomSelect
            size="sm"
            ariaLabel="Filter materials by university"
            value={filterSchoolId}
            options={[
              { value: 'all', label: 'All Universities' },
              ...store.schools.map((s) => ({ value: s.id, label: s.code })),
            ]}
            onChange={setFilterSchoolId}
          />
          <CustomSelect
            size="sm"
            ariaLabel="Filter materials by status"
            value={filterStatus}
            options={[
              { value: 'all', label: 'All Statuses' },
              { value: 'published', label: 'Published' },
              { value: 'draft', label: 'Draft' },
            ]}
            onChange={(v) => setFilterStatus(v as 'all' | 'published' | 'draft')}
          />
        </div>

        {editingMaterial && (
          <form
            onSubmit={handleSaveEdit}
            className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/12 p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-[#1A1B20]">
                Editing Material: {editingMaterial.title}
              </p>
              <button
                type="button"
                onClick={() => setEditingMaterial(null)}
                aria-label="Close material editor"
                className="h-8 w-8 rounded-lg hover:bg-white flex items-center justify-center text-[#686C78] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
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
              <input
                type="text"
                value={editCourseCode}
                onChange={(e) => setEditCourseCode(e.target.value)}
                placeholder="Course Code"
                className="min-h-[38px] self-end rounded-xl bg-white border border-[#1A1B20]/10 px-3 text-xs font-semibold"
              />
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Material Title"
                className="sm:col-span-2 min-h-[38px] rounded-xl bg-white border border-[#1A1B20]/10 px-3 text-xs font-semibold"
              />
              <input
                type="text"
                value={editCourseTitle}
                onChange={(e) => setEditCourseTitle(e.target.value)}
                placeholder="Course Title"
                className="min-h-[38px] rounded-xl bg-white border border-[#1A1B20]/10 px-3 text-xs font-semibold"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={editLevel}
                  onChange={(e) => setEditLevel(e.target.value)}
                  placeholder="100L"
                  className="min-h-[38px] rounded-xl bg-white border border-[#1A1B20]/10 px-3 text-xs font-mono-tabular font-semibold"
                />
                <input
                  type="number"
                  min={1}
                  value={editReadMinutes}
                  onChange={(e) => setEditReadMinutes(e.target.value)}
                  placeholder="6"
                  className="min-h-[38px] rounded-xl bg-white border border-[#1A1B20]/10 px-3 text-xs font-mono-tabular font-semibold"
                />
              </div>
            </div>
            <textarea
              rows={2}
              value={editSummary}
              onChange={(e) => setEditSummary(e.target.value)}
              placeholder="Summary"
              className="w-full rounded-xl bg-white border border-[#1A1B20]/10 p-2.5 text-xs text-[#1A1B20]"
            />
            <textarea
              rows={3}
              value={editFirstSectionBody}
              onChange={(e) => setEditFirstSectionBody(e.target.value)}
              placeholder="First section paragraphs"
              className="w-full rounded-xl bg-white border border-[#1A1B20]/10 p-2.5 text-xs text-[#1A1B20]"
            />
            <div className="flex justify-end gap-2">
              <TactileButton
                type="button"
                variant="light"
                size="sm"
                onClick={() => setEditingMaterial(null)}
              >
                Cancel
              </TactileButton>
              <TactileButton type="submit" variant="dark" size="sm">
                Save Material
              </TactileButton>
            </div>
          </form>
        )}

        {previewMaterial && (
          <div className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/12 p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-bold text-[#1A1B20]">
                Preview: {previewMaterial.courseCode} · {previewMaterial.title}
              </p>
              <button
                type="button"
                onClick={() => setPreviewMaterial(null)}
                aria-label="Close material preview"
                className="h-8 w-8 rounded-lg hover:bg-white flex items-center justify-center text-[#686C78] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-[#505460]">{previewMaterial.summary}</p>
            {sanitizeSafeUrl(previewMaterial.attachmentPreviewUrl) && (
              <img
                src={sanitizeSafeUrl(previewMaterial.attachmentPreviewUrl)}
                alt={previewMaterial.title}
                referrerPolicy="no-referrer"
                className="max-h-44 mx-auto rounded-lg bg-white"
              />
            )}
            <div className="space-y-2 pt-1">
              {previewMaterial.sections.map((sec, i) => (
                <div key={i} className="space-y-1">
                  <p className="text-xs font-bold text-[#1A1B20]">{sec.heading}</p>
                  {sec.paragraphs?.map((p, j) => (
                    <p key={j} className="text-xs text-[#3A3D47]">
                      {p}
                    </p>
                  ))}
                  {sec.points && sec.points.length > 0 && (
                    <ul className="list-disc pl-4 text-xs text-[#3A3D47] space-y-0.5">
                      {sec.points.map((pt, k) => (
                        <li key={k}>{pt}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="divide-y divide-[#1A1B20]/[0.06]">
          {filteredMaterials.length === 0 ? (
            <p className="py-10 text-center text-xs text-[#686C78]">
              No study materials match the current filters.
            </p>
          ) : (
            filteredMaterials.map((mat) => {
              const status = mat.status ?? 'published';
              return (
                <div key={mat.id} className="py-3.5 first:pt-1 last:pb-1 space-y-2">
                  <div className="flex items-start gap-3">
                    <div className="h-9 w-9 rounded-xl bg-[#F2F4F7] text-[#1D1E23] flex items-center justify-center shrink-0">
                      <BookOpen className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-[#1A1B20] truncate">
                        {mat.schoolCode ?? 'AAUA'} · {mat.courseCode} — {mat.title}
                      </p>
                      <p className="text-xs text-[#686C78] font-mono-tabular truncate">
                        {mat.level} · {mat.readMinutes} min · {status === 'published' ? 'Published' : 'Draft'}
                        {mat.uploadedBy ? ` · ${mat.uploadedBy}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 pl-12">
                    <button
                      type="button"
                      onClick={() => setPreviewMaterial(mat)}
                      className="min-h-[38px] px-3 rounded-xl bg-[#F6F7F9] hover:bg-[#ECEEF3] text-xs font-semibold text-[#1A1B20] inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Preview</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => beginEdit(mat)}
                      className="min-h-[38px] px-3 rounded-xl bg-[#F6F7F9] hover:bg-[#ECEEF3] text-xs font-semibold text-[#1A1B20] inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Edit</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleStatus(mat)}
                      className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold cursor-pointer ${
                        status === 'published'
                          ? 'bg-[#EEF0F4] text-[#1A1B20]'
                          : 'bg-[#1D1E23] text-white'
                      }`}
                    >
                      {status === 'published' ? 'Unpublish' : 'Publish'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(mat)}
                      aria-label={`Delete ${mat.title}`}
                      className="min-h-[38px] px-3 rounded-xl bg-[#FEF2F2] hover:bg-[#FEE2E2] text-xs font-semibold text-[#B91C1C] inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </SurfaceCard>
    </div>
  );
};
