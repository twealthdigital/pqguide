import React, { useState } from 'react';
import { Building2, Edit3, Plus, Users, X } from 'lucide-react';
import type { AuthenticatedUser, School } from '../../../core/types';
import { archiveRepository, type AppStoreState } from '../../../services/archiveRepository';
import { SurfaceCard, TactileButton } from '../../../components/ui';

interface UniversityManagementTabProps {
  currentUser: AuthenticatedUser;
  store: AppStoreState;
  onNotice: (msg: string) => void;
  onError: (msg: string) => void;
}

export const UniversityManagementTab: React.FC<UniversityManagementTabProps> = ({
  currentUser,
  store,
  onNotice,
  onError,
}) => {
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newShortName, setNewShortName] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [newActive, setNewActive] = useState(true);

  const [editingSchoolId, setEditingSchoolId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState('');
  const [editName, setEditName] = useState('');
  const [editShortName, setEditShortName] = useState('');
  const [editLocation, setEditLocation] = useState('');

  const handleAddSchool = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = archiveRepository.addSchool(currentUser, {
        code: newCode,
        name: newName,
        shortName: newShortName || newCode,
        location: newLocation || 'Nigeria',
        isActive: newActive,
        isPrimaryLaunch: false,
      });
      setNewCode('');
      setNewName('');
      setNewShortName('');
      setNewLocation('');
      onNotice(`Added university ${created.code} (${created.name}).`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to add university.');
    }
  };

  const startEdit = (school: School) => {
    setEditingSchoolId(school.id);
    setEditCode(school.code);
    setEditName(school.name);
    setEditShortName(school.shortName);
    setEditLocation(school.location);
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSchoolId) return;
    try {
      const updated = archiveRepository.updateSchool(currentUser, editingSchoolId, {
        code: editCode,
        name: editName,
        shortName: editShortName,
        location: editLocation,
      });
      setEditingSchoolId(null);
      onNotice(`Updated university ${updated.code}.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to update university.');
    }
  };

  const handleToggle = (school: School) => {
    try {
      archiveRepository.toggleSchoolStatus(currentUser, school.id);
      onNotice(
        `${school.code} is now ${school.isActive ? 'deactivated' : 'active'}.`
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to change status.');
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* University List & Assigned Admins */}
      <SurfaceCard tone="white" className="lg:col-span-7 p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-bold text-[#1A1B20]">
              Registered Universities
            </h2>
            <p className="text-xs text-[#686C78]">
              Edit university metadata, activate or lock access, and inspect assigned admins
            </p>
          </div>
          <Building2 className="w-5 h-5 text-[#1D1E23]" />
        </div>

        <div className="space-y-3">
          {store.schools.map((school) => {
            const assignedAdmins = store.accounts.filter(
              (a) =>
                a.role === 'school_admin' &&
                (a.schoolId === school.id || a.schoolCode === school.code)
            );
            const isEditing = editingSchoolId === school.id;

            return (
              <div
                key={school.id}
                className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/[0.06] p-4 space-y-3"
              >
                {isEditing ? (
                  <form onSubmit={handleSaveEdit} className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-[#1A1B20]">
                        Edit {school.code}
                      </p>
                      <button
                        type="button"
                        onClick={() => setEditingSchoolId(null)}
                        className="h-8 w-8 rounded-lg hover:bg-white flex items-center justify-center text-[#686C78] cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={editCode}
                        onChange={(e) => setEditCode(e.target.value)}
                        placeholder="Code (e.g. AAUA)"
                        className="min-h-[40px] rounded-xl bg-white border border-[#1A1B20]/10 px-3 text-xs font-semibold"
                      />
                      <input
                        type="text"
                        value={editShortName}
                        onChange={(e) => setEditShortName(e.target.value)}
                        placeholder="Short Name"
                        className="min-h-[40px] rounded-xl bg-white border border-[#1A1B20]/10 px-3 text-xs font-semibold"
                      />
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="Full University Name"
                        className="sm:col-span-2 min-h-[40px] rounded-xl bg-white border border-[#1A1B20]/10 px-3 text-xs font-semibold"
                      />
                      <input
                        type="text"
                        value={editLocation}
                        onChange={(e) => setEditLocation(e.target.value)}
                        placeholder="State / City"
                        className="sm:col-span-2 min-h-[40px] rounded-xl bg-white border border-[#1A1B20]/10 px-3 text-xs font-semibold"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <TactileButton
                        type="button"
                        variant="light"
                        size="sm"
                        onClick={() => setEditingSchoolId(null)}
                      >
                        Cancel
                      </TactileButton>
                      <TactileButton type="submit" variant="dark" size="sm">
                        Save
                      </TactileButton>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-[#1A1B20]">
                          {school.code} — {school.shortName}
                        </p>
                        <p className="text-xs text-[#505460]">{school.name}</p>
                        <p className="text-[11px] text-[#686C78] mt-0.5">
                          {school.location}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => startEdit(school)}
                          className="min-h-[38px] px-3 rounded-xl bg-white border border-[#1A1B20]/10 text-xs font-semibold text-[#1A1B20] inline-flex items-center gap-1 cursor-pointer hover:bg-[#ECEEF3]"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggle(school)}
                          className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold cursor-pointer ${
                            school.isActive
                              ? 'bg-[#1D1E23] text-white'
                              : 'bg-white text-[#686C78] border border-[#1A1B20]/10'
                          }`}
                        >
                          {school.isActive ? 'Active' : 'Inactive'}
                        </button>
                      </div>
                    </div>

                    <div className="pt-2.5 border-t border-[#1A1B20]/[0.06] flex items-start gap-2 text-xs text-[#505460]">
                      <Users className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[#686C78]" />
                      <div className="min-w-0">
                        {assignedAdmins.length === 0 ? (
                          <span className="text-[#686C78]">
                            No School Admins assigned yet
                          </span>
                        ) : (
                          <span>
                            Assigned Admins:{' '}
                            <strong className="text-[#1A1B20]">
                              {assignedAdmins
                                .map((a) => `${a.fullName} (${a.status})`)
                                .join(', ')}
                            </strong>
                          </span>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </SurfaceCard>

      {/* Add University Form */}
      <SurfaceCard tone="white" className="lg:col-span-5 p-5 sm:p-6 space-y-4">
        <div>
          <h2 className="font-display text-lg font-bold text-[#1A1B20]">
            Add University
          </h2>
          <p className="text-xs text-[#686C78]">
            Register a new university before assigning School Administrators
          </p>
        </div>

        <form onSubmit={handleAddSchool} className="space-y-3">
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-xs font-medium text-[#686C78] mb-1">
                Code
              </label>
              <input
                type="text"
                required
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
                placeholder="UNILAG"
                className="w-full min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-semibold uppercase"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#686C78] mb-1">
                Short Name
              </label>
              <input
                type="text"
                value={newShortName}
                onChange={(e) => setNewShortName(e.target.value)}
                placeholder="UNILAG Akoka"
                className="w-full min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-semibold"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#686C78] mb-1">
              Full University Name
            </label>
            <input
              type="text"
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="University of Lagos"
              className="w-full min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-semibold"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#686C78] mb-1">
              Location (State / City)
            </label>
            <input
              type="text"
              value={newLocation}
              onChange={(e) => setNewLocation(e.target.value)}
              placeholder="Lagos State, Nigeria"
              className="w-full min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-semibold"
            />
          </div>

          <label className="flex items-center gap-2.5 min-h-[38px] text-xs font-medium text-[#1A1B20] cursor-pointer">
            <input
              type="checkbox"
              checked={newActive}
              onChange={(e) => setNewActive(e.target.checked)}
              className="h-4 w-4 rounded accent-[#1D1E23]"
            />
            <span>Activate immediately for students</span>
          </label>

          <TactileButton
            type="submit"
            variant="dark"
            size="md"
            fullWidth
            icon={<Plus className="w-4 h-4" />}
          >
            Add University
          </TactileButton>
        </form>
      </SurfaceCard>
    </div>
  );
};
