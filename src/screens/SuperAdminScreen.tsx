import React, { useMemo, useState } from 'react';
import {
  Building2,
  Eye,
  FileText,
  Plus,
  ScanLine,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react';
import { useArchiveStore } from '../hooks/useArchiveStore';
import { archiveRepository } from '../services/archiveRepository';
import { CustomSelect, SurfaceCard, TactileButton } from '../components/ui';

export const SuperAdminScreen: React.FC = () => {
  const store = useArchiveStore();
  const [newSchoolCode, setNewSchoolCode] = useState('');
  const [newSchoolName, setNewSchoolName] = useState('');
  const [newSchoolLocation, setNewSchoolLocation] = useState('');

  const analytics = useMemo(() => {
    const totalDocs = store.documents.length;
    const scannedCount = store.documents.filter(
      (d) => d.sourceType === 'scanned_image'
    ).length;
    const typedCount = totalDocs - scannedCount;
    const totalReads = store.documents.reduce((sum, d) => sum + d.viewsCount, 0);
    const activeSchools = store.schools.filter((s) => s.isActive).length;

    return {
      totalDocs,
      scannedCount,
      typedCount,
      totalReads,
      activeSchools,
    };
  }, [store.documents, store.schools, store.accounts]);

  const handleAddSchool = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSchoolCode.trim() || !newSchoolName.trim()) return;
    archiveRepository.addSchool({
      code: newSchoolCode.trim().toUpperCase(),
      name: newSchoolName.trim(),
      shortName: newSchoolCode.trim().toUpperCase(),
      location: newSchoolLocation.trim() || 'Nigeria',
      isActive: true,
      isPrimaryLaunch: false,
    });
    setNewSchoolCode('');
    setNewSchoolName('');
    setNewSchoolLocation('');
  };

  return (
    <div className="space-y-6 page-enter">
      {/* Control Banner */}
      <SurfaceCard tone="ash" withWaves className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-[#A5AAB8]">
              Super Admin Control Desk
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-white mt-1.5">
              Access, Accounts & Platform Analytics
            </h1>
            <p className="text-sm text-[#B8BCC8] mt-1.5 max-w-xl">
              Control school activation, student/admin account access, recent uploads across campuses, and starter dataset management.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <TactileButton
              variant="light"
              size="sm"
              onClick={() => archiveRepository.clearSeedSamples()}
            >
              Clear Starter Samples
            </TactileButton>
            <TactileButton
              variant="light"
              size="sm"
              onClick={() => archiveRepository.restoreDefaultCatalog()}
            >
              Restore Samples
            </TactileButton>
          </div>
        </div>
      </SurfaceCard>

      {/* Usage & Analytics Grid (Tabular Numerals) */}
      <section
        aria-label="Platform usage analytics"
        className="grid grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <SurfaceCard tone="white" className="p-4 sm:p-5">
          <div className="flex items-center justify-between text-[#686C78]">
            <span className="text-xs font-medium">Indexed Papers</span>
            <FileText className="w-4 h-4" />
          </div>
          <p className="font-display font-mono-tabular text-2xl sm:text-3xl font-extrabold text-[#1A1B20] mt-2">
            {analytics.totalDocs}
          </p>
          <p className="text-xs text-[#686C78] mt-1 font-mono-tabular">
            {analytics.scannedCount} scan · {analytics.typedCount} typed
          </p>
        </SurfaceCard>

        <SurfaceCard tone="white" className="p-4 sm:p-5">
          <div className="flex items-center justify-between text-[#686C78]">
            <span className="text-xs font-medium">Paper Opens</span>
            <Eye className="w-4 h-4" />
          </div>
          <p className="font-display font-mono-tabular text-2xl sm:text-3xl font-extrabold text-[#1A1B20] mt-2">
            {analytics.totalReads.toLocaleString()}
          </p>
          <p className="text-xs text-[#686C78] mt-1">Total student reads</p>
        </SurfaceCard>

        <SurfaceCard tone="white" className="p-4 sm:p-5">
          <div className="flex items-center justify-between text-[#686C78]">
            <span className="text-xs font-medium">Active Accounts</span>
            <Users className="w-4 h-4" />
          </div>
          <p className="font-display font-mono-tabular text-2xl sm:text-3xl font-extrabold text-[#1A1B20] mt-2">
            {store.accounts.length}
          </p>
          <p className="text-xs text-[#686C78] mt-1">Registered students and admins</p>
        </SurfaceCard>

        <SurfaceCard tone="white" className="p-4 sm:p-5">
          <div className="flex items-center justify-between text-[#686C78]">
            <span className="text-xs font-medium">Live Universities</span>
            <Building2 className="w-4 h-4" />
          </div>
          <p className="font-display font-mono-tabular text-2xl sm:text-3xl font-extrabold text-[#1A1B20] mt-2">
            {analytics.activeSchools}/{store.schools.length}
          </p>
          <p className="text-xs text-[#686C78] mt-1">Open to AAUA students</p>
        </SurfaceCard>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Account Access Control */}
        <SurfaceCard tone="white" className="lg:col-span-7 p-5 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-display text-lg font-bold text-[#1A1B20]">
                Account & Access Control
              </h2>
              <p className="text-xs text-[#686C78]">
                Manage student & school admin accounts
              </p>
            </div>
            <ShieldCheck className="w-5 h-5 text-[#1D1E23]" />
          </div>

          <div className="divide-y divide-[#1A1B20]/[0.06]">
            {store.accounts.map((acc) => {
              return (
                <div
                  key={acc.id}
                  className="py-3.5 first:pt-1 last:pb-1 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#1A1B20]">
                      {acc.fullName}
                    </p>
                    <p className="text-xs text-[#686C78] mt-0.5">
                      {acc.email} · {acc.schoolCode}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <CustomSelect
                      ariaLabel={`Change role for ${acc.fullName}`}
                      size="sm"
                      className="w-36"
                      value={acc.role}
                      options={[
                        { value: 'student', label: 'Student' },
                        { value: 'school_admin', label: 'School Admin' },
                        { value: 'super_admin', label: 'Super Admin' },
                      ]}
                      onChange={(val) =>
                        archiveRepository.updateAccountRole(
                          acc.id,
                          val as typeof acc.role
                        )
                      }
                    />

                    <button
                      type="button"
                      onClick={() => archiveRepository.toggleAccountStatus(acc.id)}
                      className={`min-h-[36px] px-3 rounded-xl text-xs font-semibold cursor-pointer transition-colors ${
                        acc.status === 'active'
                          ? 'bg-[#1D1E23] text-white'
                          : 'bg-[#FEF2F2] text-[#B91C1C]'
                      }`}
                    >
                      {acc.status === 'active' ? 'Active' : 'Suspended'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </SurfaceCard>

        {/* University Onboarding & Toggle */}
        <SurfaceCard tone="white" className="lg:col-span-5 p-5 sm:p-6 space-y-5">
          <div>
            <h2 className="font-display text-lg font-bold text-[#1A1B20]">
              Universities Rollout
            </h2>
            <p className="text-xs text-[#686C78]">
              Activate schools as new archives are verified
            </p>
          </div>

          <div className="space-y-2.5">
            {store.schools.map((school) => (
              <div
                key={school.id}
                className="flex items-center justify-between gap-3 rounded-2xl bg-[#F6F7F9] p-3.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[#1A1B20] truncate">
                    {school.code} — {school.shortName}
                  </p>
                  <p className="text-xs text-[#686C78] truncate">
                    {school.location}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => archiveRepository.toggleSchoolStatus(school.id)}
                  className={`min-h-[36px] px-3 rounded-xl text-xs font-semibold cursor-pointer shrink-0 ${
                    school.isActive
                      ? 'bg-[#1D1E23] text-white'
                      : 'bg-white text-[#686C78] border border-[#1A1B20]/10'
                  }`}
                >
                  {school.isActive ? 'Live' : 'Locked'}
                </button>
              </div>
            ))}
          </div>

          <form
            onSubmit={handleAddSchool}
            className="pt-4 border-t border-[#1A1B20]/[0.07] space-y-2.5"
          >
            <p className="text-xs font-semibold text-[#1A1B20]">
              Add New School
            </p>
            <div className="grid grid-cols-3 gap-2">
              <input
                type="text"
                value={newSchoolCode}
                onChange={(e) => setNewSchoolCode(e.target.value)}
                placeholder="UNILAG"
                className="col-span-1 min-h-[40px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-semibold"
              />
              <input
                type="text"
                value={newSchoolName}
                onChange={(e) => setNewSchoolName(e.target.value)}
                placeholder="University Name"
                className="col-span-2 min-h-[40px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-semibold"
              />
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newSchoolLocation}
                onChange={(e) => setNewSchoolLocation(e.target.value)}
                placeholder="State / City"
                className="flex-1 min-h-[40px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-semibold"
              />
              <TactileButton
                type="submit"
                variant="dark"
                size="sm"
                icon={<Plus className="w-3.5 h-3.5" />}
              >
                Add
              </TactileButton>
            </div>
          </form>
        </SurfaceCard>
      </div>

      {/* Global Recent Uploads Table */}
      <SurfaceCard tone="white" className="p-5 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-display text-lg font-bold text-[#1A1B20]">
              Recent Uploads Across Schools
            </h2>
            <p className="text-xs text-[#686C78]">
              Remove unverified documents
            </p>
          </div>
          <span className="font-mono-tabular text-xs font-semibold text-[#686C78]">
            {store.documents.length} documents
          </span>
        </div>

        <div className="divide-y divide-[#1A1B20]/[0.06]">
          {store.documents.map((doc) => (
            <div
              key={doc.id}
              className="py-3.5 first:pt-1 last:pb-1 flex flex-wrap items-center justify-between gap-3"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="h-9 w-9 rounded-xl bg-[#F2F4F7] text-[#1D1E23] flex items-center justify-center shrink-0">
                  {doc.sourceType === 'scanned_image' ? (
                    <ScanLine className="w-4 h-4" />
                  ) : (
                    <FileText className="w-4 h-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[#1A1B20] truncate">
                    {doc.schoolCode} · {doc.courseCode} — {doc.courseTitle}
                  </p>
                  <p className="text-xs text-[#686C78] font-mono-tabular truncate">
                    {doc.session} · {doc.semester} · Uploaded by {doc.uploadedBy} ·{' '}
                    {doc.viewsCount} reads
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  aria-label={`Remove ${doc.courseCode}`}
                  onClick={() => archiveRepository.deleteDocument(doc.id)}
                  className="min-h-[36px] min-w-[36px] rounded-xl bg-[#F6F7F9] hover:bg-[#FEF2F2] text-[#686C78] hover:text-[#B91C1C] flex items-center justify-center cursor-pointer transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </SurfaceCard>
    </div>
  );
};
