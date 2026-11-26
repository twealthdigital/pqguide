import React, { useMemo, useState } from 'react';
import { Edit3, ShieldAlert, ShieldCheck, UserPlus, Users, X } from 'lucide-react';
import type { AuthenticatedUser, ManagedAccount } from '../../../core/types';
import { type AppStoreState } from '../../../services/archiveRepository';
import { authService } from '../../../services/authService';
import { CustomSelect, SurfaceCard, TactileButton } from '../../../components/ui';

interface AdminAccountsTabProps {
  currentUser: AuthenticatedUser;
  store: AppStoreState;
  onNotice: (msg: string) => void;
  onError: (msg: string) => void;
}

export const AdminAccountsTab: React.FC<AdminAccountsTabProps> = ({
  currentUser,
  store,
  onNotice,
  onError,
}) => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [schoolId, setSchoolId] = useState(store.schools[0]?.id ?? 'sch-aaua');
  const [password, setPassword] = useState('');
  const [creating, setCreating] = useState(false);

  const [editingAdmin, setEditingAdmin] = useState<ManagedAccount | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editSchoolId, setEditSchoolId] = useState('');
  const [studentQuery, setStudentQuery] = useState('');

  const schoolAdmins = useMemo(
    () => store.accounts.filter((a) => a.role === 'school_admin'),
    [store.accounts]
  );

  const studentAccounts = useMemo(() => {
    const q = studentQuery.trim().toLowerCase();
    return store.accounts.filter((a) => {
      if (a.role !== 'student') return false;
      if (!q) return true;
      return (
        a.fullName.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q) ||
        (a.matricNumber ?? '').toLowerCase().includes(q)
      );
    });
  }, [store.accounts, studentQuery]);

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    const res = await authService.createSchoolAdminAccount(currentUser, {
      fullName,
      email,
      schoolId,
      password,
    });
    setCreating(false);

    if (!res.ok || !res.data) {
      onError(res.error ?? 'Failed to create School Admin.');
      return;
    }

    setFullName('');
    setEmail('');
    setPassword('');
    onNotice(
      `Created School Admin ${res.data.account.fullName} (${res.data.account.email}) assigned to ${res.data.account.assignedSchoolCode}. They can now sign in with email & password.`
    );
  };

  const beginEditAdmin = (acc: ManagedAccount) => {
    setEditingAdmin(acc);
    setEditName(acc.fullName);
    setEditEmail(acc.email);
    setEditSchoolId(
      acc.schoolId ??
        store.schools.find((s) => s.code === acc.schoolCode)?.id ??
        store.schools[0]?.id ??
        'sch-aaua'
    );
  };

  const handleSaveAdminEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAdmin) return;
    const res = authService.updateSchoolAdminDetails(currentUser, editingAdmin.id, {
      fullName: editName,
      email: editEmail,
      schoolId: editSchoolId,
    });
    if (!res.ok) {
      onError(res.error ?? 'Failed to update administrator.');
      return;
    }
    setEditingAdmin(null);
    onNotice('School Administrator details updated.');
  };

  const handleStatusChange = (
    acc: ManagedAccount,
    nextStatus: 'active' | 'suspended' | 'revoked'
  ) => {
    const res = authService.setAccountStatus(currentUser, acc.id, nextStatus);
    if (!res.ok) {
      onError(res.error ?? 'Action denied.');
      return;
    }
    onNotice(
      nextStatus === 'revoked'
        ? `Revoked administrator access for ${acc.fullName}.`
        : `${acc.fullName} is now ${nextStatus}.`
    );
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Create School Admin Form */}
        <SurfaceCard tone="white" className="lg:col-span-5 p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-lg font-bold text-[#1A1B20]">
                Create School Admin
              </h2>
              <p className="text-xs text-[#686C78]">
                Assign exactly one university. School Admins cannot promote roles or create other admins.
              </p>
            </div>
            <UserPlus className="w-5 h-5 text-[#1D1E23]" />
          </div>

          <form onSubmit={handleCreateAdmin} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-[#686C78] mb-1">
                Full Name
              </label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Dr. Tunde Balogun"
                className="w-full min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-semibold"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#686C78] mb-1">
                Administrator Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@university.edu.ng"
                className="w-full min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-semibold"
              />
            </div>

            <CustomSelect
              label="Assigned University"
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
                Initial Password (min 8 chars)
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter initial dev credential"
                className="w-full min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-semibold"
              />
            </div>

            <TactileButton
              type="submit"
              variant="dark"
              size="md"
              fullWidth
              loading={creating}
            >
              Create School Admin Account
            </TactileButton>
          </form>
        </SurfaceCard>

        {/* School Admins Directory */}
        <SurfaceCard tone="white" className="lg:col-span-7 p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-lg font-bold text-[#1A1B20]">
                School Administrators ({schoolAdmins.length})
              </h2>
              <p className="text-xs text-[#686C78]">
                Edit details, reassign university, suspend/reactivate, or revoke access
              </p>
            </div>
            <ShieldCheck className="w-5 h-5 text-[#1D1E23]" />
          </div>

          {editingAdmin && (
            <form
              onSubmit={handleSaveAdminEdit}
              className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/12 p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-[#1A1B20]">
                  Edit School Admin: {editingAdmin.fullName}
                </p>
                <button
                  type="button"
                  onClick={() => setEditingAdmin(null)}
                  className="h-8 w-8 rounded-lg hover:bg-white flex items-center justify-center text-[#686C78] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Full Name"
                  className="min-h-[40px] rounded-xl bg-white border border-[#1A1B20]/10 px-3 text-xs font-semibold"
                />
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="Email"
                  className="min-h-[40px] rounded-xl bg-white border border-[#1A1B20]/10 px-3 text-xs font-semibold"
                />
                <div className="sm:col-span-2">
                  <CustomSelect
                    label="Assigned University"
                    size="sm"
                    value={editSchoolId}
                    options={store.schools.map((s) => ({
                      value: s.id,
                      label: `${s.code} — ${s.shortName}`,
                    }))}
                    onChange={setEditSchoolId}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <TactileButton
                  type="button"
                  variant="light"
                  size="sm"
                  onClick={() => setEditingAdmin(null)}
                >
                  Cancel
                </TactileButton>
                <TactileButton type="submit" variant="dark" size="sm">
                  Save Admin Changes
                </TactileButton>
              </div>
            </form>
          )}

          <div className="divide-y divide-[#1A1B20]/[0.06]">
            {schoolAdmins.length === 0 ? (
              <p className="py-8 text-center text-xs text-[#686C78]">
                No School Administrators created yet. Use the form to invite/create one.
              </p>
            ) : (
              schoolAdmins.map((acc) => (
                <div key={acc.id} className="py-3.5 first:pt-1 last:pb-1 space-y-2.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-[#1A1B20]">
                        {acc.fullName}
                      </p>
                      <p className="text-xs text-[#686C78]">
                        {acc.email} · University: <strong className="text-[#1A1B20]">{acc.schoolCode}</strong> · Status:{' '}
                        <span className="capitalize font-semibold">{acc.status}</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => beginEditAdmin(acc)}
                      className="min-h-[38px] px-3 rounded-xl bg-[#F6F7F9] hover:bg-[#ECEEF3] text-xs font-semibold text-[#1A1B20] inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Edit / Reassign</span>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        handleStatusChange(
                          acc,
                          acc.status === 'active' ? 'suspended' : 'active'
                        )
                      }
                      className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold cursor-pointer ${
                        acc.status === 'active'
                          ? 'bg-[#EEF0F4] text-[#1A1B20]'
                          : 'bg-[#1D1E23] text-white'
                      }`}
                    >
                      {acc.status === 'active' ? 'Suspend' : 'Reactivate'}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleStatusChange(acc, 'revoked')}
                      className="min-h-[38px] px-3 rounded-xl bg-[#FEF2F2] hover:bg-[#FEE2E2] text-xs font-semibold text-[#B91C1C] inline-flex items-center gap-1 cursor-pointer"
                    >
                      <ShieldAlert className="w-3.5 h-3.5" />
                      <span>Revoke Access</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </SurfaceCard>
      </div>

      {/* Student Accounts Management */}
      <SurfaceCard tone="white" className="p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Users className="w-5 h-5 text-[#1D1E23]" />
            <div>
              <h2 className="font-display text-lg font-bold text-[#1A1B20]">
                Student Accounts ({studentAccounts.length})
              </h2>
              <p className="text-xs text-[#686C78]">
                Suspend or reactivate student access cleanly
              </p>
            </div>
          </div>

          <input
            type="text"
            value={studentQuery}
            onChange={(e) => setStudentQuery(e.target.value)}
            placeholder="Search name, email, or matric..."
            className="w-full sm:w-64 min-h-[40px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-medium"
          />
        </div>

        <div className="divide-y divide-[#1A1B20]/[0.06]">
          {studentAccounts.length === 0 ? (
            <p className="py-6 text-center text-xs text-[#686C78]">
              No matching student accounts.
            </p>
          ) : (
            studentAccounts.map((acc) => (
              <div
                key={acc.id}
                className="py-3 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[#1A1B20] truncate">
                    {acc.fullName}
                  </p>
                  <p className="text-xs text-[#686C78] truncate">
                    {acc.email}
                    {acc.matricNumber ? ` · ${acc.matricNumber}` : ''} · {acc.schoolCode}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    handleStatusChange(
                      acc,
                      acc.status === 'active' ? 'suspended' : 'active'
                    )
                  }
                  className={`min-h-[38px] px-3.5 rounded-xl text-xs font-semibold cursor-pointer ${
                    acc.status === 'active'
                      ? 'bg-[#1D1E23] text-white'
                      : 'bg-[#FEF2F2] text-[#B91C1C]'
                  }`}
                >
                  {acc.status === 'active' ? 'Active · Suspend' : 'Suspended · Reactivate'}
                </button>
              </div>
            ))
          )}
        </div>
      </SurfaceCard>
    </div>
  );
};
