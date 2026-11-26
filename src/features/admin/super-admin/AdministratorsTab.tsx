import React, { useMemo, useState } from 'react';
import {
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Edit3,
  KeyRound,
  Lock,
  Mail,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import type { AuthenticatedUser, ManagedAccount } from '../../../core/types';
import type { AppStoreState } from '../../../services/archiveRepository';
import { authService } from '../../../services/authService';
import {
  CustomSelect,
  DetailDialog,
  SectionHeadingBar,
  SurfaceCard,
  TactileButton,
} from '../../../components/ui';

interface AdministratorsTabProps {
  currentUser: AuthenticatedUser;
  store: AppStoreState;
  onNotice: (msg: string) => void;
  onError: (msg: string) => void;
}

export const AdministratorsTab: React.FC<AdministratorsTabProps> = ({
  currentUser,
  store,
  onNotice,
  onError,
}) => {
  const [adminCategory, setAdminCategory] = useState<'university' | 'company'>('university');
  const [companyNotice, setCompanyNotice] = useState(false);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [schoolId, setSchoolId] = useState(store.schools[0]?.id ?? 'sch-aaua');
  const [grantMode, setGrantMode] = useState<'email_invite' | 'with_password'>('email_invite');
  const [password, setPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [copiedPortal, setCopiedPortal] = useState<'admin' | 'super' | null>(null);

  const [selectedAdminId, setSelectedAdminId] = useState<string | null>(null);
  const [editingInDialog, setEditingInDialog] = useState(false);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editSchoolId, setEditSchoolId] = useState('');

  const schoolAdmins = useMemo(
    () => store.accounts.filter((a) => a.role === 'school_admin'),
    [store.accounts]
  );

  const selectedAdmin = useMemo(
    () => schoolAdmins.find((a) => a.id === selectedAdminId) ?? null,
    [schoolAdmins, selectedAdminId]
  );

  const selectedAdminPosts = useMemo(() => {
    if (!selectedAdmin) return [];
    return store.documents.filter(
      (doc) =>
        doc.uploadedById === selectedAdmin.id ||
        doc.uploadedBy.toLowerCase() === selectedAdmin.fullName.toLowerCase()
    );
  }, [store.documents, selectedAdmin]);

  const selectedAdminLogs = useMemo(() => {
    if (!selectedAdmin) return [];
    return store.auditLogs.filter(
      (log) =>
        log.actorId === selectedAdmin.id ||
        log.actorEmail.toLowerCase() === selectedAdmin.email.toLowerCase()
    );
  }, [store.auditLogs, selectedAdmin]);

  const openAdminDialog = (acc: ManagedAccount) => {
    setSelectedAdminId(acc.id);
    setEditingInDialog(false);
    setEditName(acc.fullName);
    setEditEmail(acc.email);
    setEditSchoolId(
      acc.schoolId ??
        store.schools.find((s) => s.code === acc.schoolCode)?.id ??
        store.schools[0]?.id ??
        'sch-aaua'
    );
  };

  const closeAdminDialog = () => {
    setSelectedAdminId(null);
    setEditingInDialog(false);
  };

  const copyPortalLink = async (type: 'admin' | 'super') => {
    const hashPath = type === 'admin' ? '#/admin-login' : '#/super-admin-login';
    const full =
      typeof window !== 'undefined'
        ? `${window.location.origin}${window.location.pathname}${hashPath}`
        : hashPath;
    try {
      await navigator.clipboard.writeText(full);
      setCopiedPortal(type);
      window.setTimeout(() => setCopiedPortal(null), 1800);
    } catch {
      onNotice(`Portal URL: ${hashPath}`);
    }
  };

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    const res = await authService.createSchoolAdminAccount(currentUser, {
      fullName,
      email,
      schoolId,
      grantEmailAccessOnly: grantMode === 'email_invite',
      password: grantMode === 'with_password' ? password : '',
    });
    setCreating(false);

    if (!res.ok || !res.data) {
      onError(res.error ?? 'Failed to grant School Admin access.');
      return;
    }

    setFullName('');
    setEmail('');
    setPassword('');
    onNotice(
      grantMode === 'email_invite'
        ? `Granted School Admin email access to ${res.data.account.email} (${res.data.account.assignedSchoolCode}).`
        : `Created School Admin ${res.data.account.fullName} for ${res.data.account.assignedSchoolCode}.`
    );
  };

  const handleSaveAdminEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAdmin) return;
    const res = authService.updateSchoolAdminDetails(currentUser, selectedAdmin.id, {
      fullName: editName,
      email: editEmail,
      schoolId: editSchoolId,
    });
    if (!res.ok) {
      onError(res.error ?? 'Failed to update administrator.');
      return;
    }
    setEditingInDialog(false);
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
    if (nextStatus === 'revoked') {
      closeAdminDialog();
    }
    onNotice(
      nextStatus === 'revoked'
        ? `Revoked administrator access for ${acc.fullName}.`
        : `${acc.fullName} is now ${nextStatus}.`
    );
  };

  const handleToggleVerification = (acc: ManagedAccount) => {
    const nextVerified = acc.adminVerified === false;
    const res = authService.setAccountVerification(currentUser, acc.id, nextVerified);
    if (!res.ok) {
      onError(res.error ?? 'Could not update verification status.');
      return;
    }
    onNotice(
      nextVerified
        ? `Verified login access for ${acc.fullName}.`
        : `Sign-in paused for ${acc.fullName} until re-verified.`
    );
  };

  return (
    <>
      <div className="space-y-6">
        <SurfaceCard tone="white" className="p-4 sm:p-5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => {
                setAdminCategory('university');
                setCompanyNotice(false);
              }}
              className={`min-h-[60px] rounded-2xl border p-4 text-left transition-colors cursor-pointer flex items-center justify-between gap-3 ${
                adminCategory === 'university'
                  ? 'border-[#1D1E23] bg-[#1D1E23] text-white'
                  : 'border-[#1A1B20]/10 bg-[#F6F7F9] text-[#1A1B20] hover:bg-[#ECEEF3]'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <Building2 className="w-5 h-5 shrink-0" />
                <div className="min-w-0">
                  <p className="font-display text-sm font-bold truncate">
                    University Administrators
                  </p>
                  <p
                    className={`text-xs truncate ${
                      adminCategory === 'university' ? 'text-[#C3C7D2]' : 'text-[#686C78]'
                    }`}
                  >
                    {schoolAdmins.length} active school admins
                  </p>
                </div>
              </div>
              <ShieldCheck className="w-4 h-4 shrink-0" />
            </button>

            <button
              type="button"
              aria-disabled="true"
              onClick={() => setCompanyNotice(true)}
              className="min-h-[60px] rounded-2xl border border-dashed border-[#1A1B20]/18 bg-[#F6F7F9] p-4 text-left text-[#505460] hover:bg-[#ECEEF3] transition-colors cursor-pointer flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Lock className="w-5 h-5 shrink-0 text-[#686C78]" />
                <div className="min-w-0">
                  <p className="font-display text-sm font-bold text-[#1A1B20] truncate">
                    Company Administrators
                  </p>
                  <p className="text-xs text-[#686C78] truncate">Coming later</p>
                </div>
              </div>
              <span className="font-mono-tabular text-xs font-semibold text-[#686C78] shrink-0">
                Locked
              </span>
            </button>
          </div>

          {companyNotice && (
            <div
              role="status"
              className="rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3.5 py-2.5 text-xs text-[#505460]"
            >
              <strong className="text-[#1A1B20]">Company Administrators</strong> is reserved for internal staff later. Manage University Administrators below.
            </div>
          )}
        </SurfaceCard>

        <SurfaceCard tone="white" className="p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="h-9 w-9 rounded-xl bg-[#1D1E23] text-white flex items-center justify-center shrink-0">
              <KeyRound className="w-4 h-4" />
            </span>
            <div>
              <p className="text-sm font-bold text-[#1A1B20]">Admin Login Links</p>
              <p className="text-xs text-[#686C78] font-mono-tabular">
                #/admin-login · #/super-admin-login
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => copyPortalLink('admin')}
              className="min-h-[38px] px-3 rounded-xl bg-[#F6F7F9] hover:bg-[#ECEEF3] text-xs font-semibold text-[#1A1B20] inline-flex items-center gap-1.5 cursor-pointer"
            >
              {copiedPortal === 'admin' ? (
                <Check className="w-3.5 h-3.5 text-[#15803D]" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>Copy School Admin URL</span>
            </button>
            <button
              type="button"
              onClick={() => copyPortalLink('super')}
              className="min-h-[38px] px-3 rounded-xl bg-[#1D1E23] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              {copiedPortal === 'super' ? (
                <Check className="w-3.5 h-3.5 text-[#BBF7D0]" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>Copy Super Admin URL</span>
            </button>
          </div>
        </SurfaceCard>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <SurfaceCard tone="white" className="lg:col-span-5 p-5 sm:p-6 space-y-4">
            <SectionHeadingBar
              icon={<UserPlus className="w-4 h-4" />}
              title="Grant School Admin Access"
            />

            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/[0.06]">
              <button
                type="button"
                onClick={() => setGrantMode('email_invite')}
                className={`min-h-[38px] rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                  grantMode === 'email_invite'
                    ? 'bg-[#1D1E23] text-white'
                    : 'text-[#505460] hover:text-[#1A1B20]'
                }`}
              >
                <Mail className="w-3.5 h-3.5" />
                <span>Email Access</span>
              </button>
              <button
                type="button"
                onClick={() => setGrantMode('with_password')}
                className={`min-h-[38px] rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                  grantMode === 'with_password'
                    ? 'bg-[#1D1E23] text-white'
                    : 'text-[#505460] hover:text-[#1A1B20]'
                }`}
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Set Password</span>
              </button>
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
                  placeholder="Full name"
                  className="w-full min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-semibold"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#686C78] mb-1">
                  Admin Email
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@school.edu.ng"
                  className="w-full min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-semibold"
                />
              </div>

              <CustomSelect
                label="University"
                value={schoolId}
                options={store.schools.map((s) => ({
                  value: s.id,
                  label: `${s.code} — ${s.shortName}`,
                  hint: s.location,
                }))}
                onChange={setSchoolId}
              />

              {grantMode === 'with_password' && (
                <div>
                  <label className="block text-xs font-medium text-[#686C78] mb-1">
                    Initial Password
                  </label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 8 characters"
                    className="w-full min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-semibold"
                  />
                </div>
              )}

              <TactileButton
                type="submit"
                variant="dark"
                size="md"
                fullWidth
                loading={creating}
              >
                {grantMode === 'email_invite'
                  ? 'Grant School Admin Access'
                  : 'Create School Admin'}
              </TactileButton>
            </form>
          </SurfaceCard>

          <SurfaceCard tone="white" className="lg:col-span-7 p-5 sm:p-6 space-y-4">
            <SectionHeadingBar
              icon={<ShieldCheck className="w-4 h-4" />}
              title={`University Administrators (${schoolAdmins.length})`}
            />

            <div className="divide-y divide-[#1A1B20]/[0.06]">
              {schoolAdmins.length === 0 ? (
                <p className="py-8 text-center text-xs text-[#686C78]">
                  No University Administrators created yet.
                </p>
              ) : (
                schoolAdmins.map((acc) => {
                  const postCount = store.documents.filter(
                    (d) =>
                      d.uploadedById === acc.id ||
                      d.uploadedBy.toLowerCase() === acc.fullName.toLowerCase()
                  ).length;
                  const isVerified = acc.adminVerified !== false;

                  return (
                    <button
                      key={acc.id}
                      type="button"
                      onClick={() => openAdminDialog(acc)}
                      className="w-full py-3.5 first:pt-1 last:pb-1 flex items-center justify-between gap-3 text-left hover:bg-[#F6F7F9] rounded-xl px-2 -mx-2 transition-colors cursor-pointer"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-sm font-bold text-[#1A1B20] truncate">
                          {acc.fullName}
                        </p>
                        <p className="text-xs text-[#505460] truncate">
                          {acc.email} · <strong className="text-[#1A1B20]">{acc.schoolCode}</strong> ·{' '}
                          <span className="font-mono-tabular">{postCount} uploads</span>
                        </p>
                        <p className="text-xs text-[#686C78]">
                          <span className={isVerified ? 'text-[#15803D] font-semibold' : 'text-[#B91C1C] font-semibold'}>
                            {isVerified ? 'Verified' : 'Unverified'}
                          </span>
                          {' · '}
                          <span className="capitalize">{acc.status}</span>
                        </p>
                      </div>

                      <span className="min-h-[36px] px-3 rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 text-xs font-semibold text-[#1A1B20] inline-flex items-center gap-1 shrink-0">
                        <span>Manage</span>
                        <ChevronRight className="w-3.5 h-3.5 text-[#686C78]" />
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </SurfaceCard>
        </div>
      </div>

      <DetailDialog
        open={Boolean(selectedAdmin)}
        onClose={closeAdminDialog}
        title={selectedAdmin ? selectedAdmin.fullName : 'Administrator'}
        subtitle={
          selectedAdmin
            ? `${selectedAdmin.email} · ${selectedAdmin.schoolCode ?? 'N/A'}`
            : undefined
        }
        icon={<ShieldCheck className="w-4 h-4" />}
        maxWidthClass="max-w-2xl"
      >
        {selectedAdmin && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
              <div className="rounded-xl bg-[#F6F7F9] p-3">
                <p className="text-[#686C78]">Verification</p>
                <p
                  className={`font-bold mt-0.5 ${
                    selectedAdmin.adminVerified !== false ? 'text-[#15803D]' : 'text-[#B91C1C]'
                  }`}
                >
                  {selectedAdmin.adminVerified !== false ? 'Verified' : 'Pending'}
                </p>
              </div>
              <div className="rounded-xl bg-[#F6F7F9] p-3">
                <p className="text-[#686C78]">Account Status</p>
                <p className="font-bold text-[#1A1B20] capitalize mt-0.5">
                  {selectedAdmin.status}
                </p>
              </div>
              <div className="rounded-xl bg-[#F6F7F9] p-3 col-span-2 sm:col-span-1">
                <p className="text-[#686C78]">Session</p>
                <p className="font-bold text-[#1A1B20] mt-0.5">
                  {selectedAdmin.sessionState === 'logged_in' ? 'Signed In' : 'Signed Out'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleToggleVerification(selectedAdmin)}
                className="min-h-[38px] px-3 rounded-xl bg-[#F6F7F9] hover:bg-[#ECEEF3] text-xs font-semibold text-[#1A1B20] inline-flex items-center gap-1.5 cursor-pointer"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>
                  {selectedAdmin.adminVerified !== false ? 'Unverify Login' : 'Verify Login'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setEditingInDialog((v) => !v)}
                className="min-h-[38px] px-3 rounded-xl bg-[#F6F7F9] hover:bg-[#ECEEF3] text-xs font-semibold text-[#1A1B20] inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>{editingInDialog ? 'Close Edit' : 'Edit / Reassign'}</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  handleStatusChange(
                    selectedAdmin,
                    selectedAdmin.status === 'active' ? 'suspended' : 'active'
                  )
                }
                className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold cursor-pointer ${
                  selectedAdmin.status === 'active'
                    ? 'bg-[#EEF0F4] text-[#1A1B20]'
                    : 'bg-[#1D1E23] text-white'
                }`}
              >
                {selectedAdmin.status === 'active' ? 'Suspend' : 'Reactivate'}
              </button>

              <button
                type="button"
                onClick={() => handleStatusChange(selectedAdmin, 'revoked')}
                className="min-h-[38px] px-3 rounded-xl bg-[#FEF2F2] hover:bg-[#FEE2E2] text-xs font-semibold text-[#B91C1C] inline-flex items-center gap-1.5 cursor-pointer"
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>Revoke</span>
              </button>
            </div>

            {editingInDialog && (
              <form
                onSubmit={handleSaveAdminEdit}
                className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/10 p-4 space-y-3"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Full name"
                    className="min-h-[40px] rounded-xl bg-white border border-[#1A1B20]/10 px-3 text-xs font-semibold"
                  />
                  <input
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    placeholder="Email address"
                    className="min-h-[40px] rounded-xl bg-white border border-[#1A1B20]/10 px-3 text-xs font-semibold"
                  />
                  <div className="sm:col-span-2">
                    <CustomSelect
                      label="University"
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
                    onClick={() => setEditingInDialog(false)}
                  >
                    Cancel
                  </TactileButton>
                  <TactileButton type="submit" variant="dark" size="sm">
                    Save Changes
                  </TactileButton>
                </div>
              </form>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/[0.06] p-3.5 space-y-2 max-h-56 overflow-y-auto">
                <p className="text-xs font-bold text-[#1A1B20]">
                  Uploaded Past Questions ({selectedAdminPosts.length})
                </p>
                {selectedAdminPosts.length === 0 ? (
                  <p className="text-xs text-[#686C78]">No uploads yet.</p>
                ) : (
                  selectedAdminPosts.map((doc) => (
                    <div
                      key={doc.id}
                      className="text-xs border-b border-[#1A1B20]/[0.06] pb-1.5 last:border-0"
                    >
                      <p className="font-bold text-[#1A1B20]">
                        {doc.courseCode} · {doc.session} ({doc.level})
                      </p>
                      <p className="text-[11px] text-[#686C78]">
                        {doc.status === 'published' ? 'Published' : 'Draft'} · {doc.questions.length} Qs
                      </p>
                    </div>
                  ))
                )}
              </div>

              <div className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/[0.06] p-3.5 space-y-2 max-h-56 overflow-y-auto">
                <p className="text-xs font-bold text-[#1A1B20]">
                  Action Trail ({selectedAdminLogs.length})
                </p>
                {selectedAdminLogs.length === 0 ? (
                  <p className="text-xs text-[#686C78]">No logged actions yet.</p>
                ) : (
                  selectedAdminLogs.map((log) => (
                    <div
                      key={log.id}
                      className="text-xs border-b border-[#1A1B20]/[0.06] pb-1.5 last:border-0"
                    >
                      <p className="font-semibold text-[#1A1B20]">{log.summary}</p>
                      <p className="text-[11px] font-mono-tabular text-[#686C78]">
                        {new Date(log.timestamp).toLocaleString([], {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </DetailDialog>
    </>
  );
};
