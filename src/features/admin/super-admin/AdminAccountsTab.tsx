import React, { useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Edit3,
  Eye,
  FileText,
  KeyRound,
  Mail,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type { AuthenticatedUser, ManagedAccount, StudentLevel } from '../../../core/types';
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
  const [grantMode, setGrantMode] = useState<'email_invite' | 'with_password'>('email_invite');
  const [password, setPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [copiedPortal, setCopiedPortal] = useState<'admin' | 'super' | null>(null);

  const [editingAdmin, setEditingAdmin] = useState<ManagedAccount | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editSchoolId, setEditSchoolId] = useState('');
  const [inspectedAdminId, setInspectedAdminId] = useState<string | null>(null);

  const [studentQuery, setStudentQuery] = useState('');
  const [sessionFilter, setSessionFilter] = useState<'all' | 'logged_in' | 'logged_out'>('all');
  const [levelFilter, setLevelFilter] = useState<'all' | StudentLevel>('all');
  const [inspectedStudentId, setInspectedStudentId] = useState<string | null>(null);

  const schoolAdmins = useMemo(
    () => store.accounts.filter((a) => a.role === 'school_admin'),
    [store.accounts]
  );

  const studentAccounts = useMemo(() => {
    const q = studentQuery.trim().toLowerCase();
    return store.accounts.filter((a) => {
      if (a.role !== 'student') return false;
      if (sessionFilter === 'logged_in' && a.sessionState !== 'logged_in') return false;
      if (sessionFilter === 'logged_out' && a.sessionState === 'logged_in') return false;
      if (levelFilter !== 'all' && a.level !== levelFilter) return false;
      if (!q) return true;
      return (
        a.fullName.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q) ||
        (a.matricNumber ?? '').toLowerCase().includes(q) ||
        (a.department ?? '').toLowerCase().includes(q) ||
        (a.faculty ?? '').toLowerCase().includes(q) ||
        (a.level ?? '').toLowerCase().includes(q)
      );
    });
  }, [store.accounts, studentQuery, sessionFilter, levelFilter]);

  const inspectedAdmin = useMemo(
    () => schoolAdmins.find((a) => a.id === inspectedAdminId) ?? null,
    [schoolAdmins, inspectedAdminId]
  );

  const inspectedAdminPosts = useMemo(() => {
    if (!inspectedAdmin) return [];
    return store.documents.filter(
      (doc) =>
        doc.uploadedById === inspectedAdmin.id ||
        doc.uploadedBy.toLowerCase() === inspectedAdmin.fullName.toLowerCase()
    );
  }, [store.documents, inspectedAdmin]);

  const inspectedAdminLogs = useMemo(() => {
    if (!inspectedAdmin) return [];
    return store.auditLogs.filter(
      (log) =>
        log.actorId === inspectedAdmin.id ||
        log.actorEmail.toLowerCase() === inspectedAdmin.email.toLowerCase()
    );
  }, [store.auditLogs, inspectedAdmin]);

  const inspectedStudent = useMemo(
    () => studentAccounts.find((a) => a.id === inspectedStudentId) ?? null,
    [studentAccounts, inspectedStudentId]
  );

  const inspectedStudentActivities = useMemo(() => {
    if (!inspectedStudent) return [];
    return store.userActivities.filter(
      (ev) =>
        ev.userId === inspectedStudent.id ||
        ev.userEmail.toLowerCase() === inspectedStudent.email.toLowerCase()
    );
  }, [store.userActivities, inspectedStudent]);

  const inspectedStudentPayments = useMemo(() => {
    if (!inspectedStudent) return [];
    return store.payments.filter(
      (p) =>
        p.userId === inspectedStudent.id ||
        p.userEmail.toLowerCase() === inspectedStudent.email.toLowerCase()
    );
  }, [store.payments, inspectedStudent]);

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
        ? `Granted School Admin email access to ${res.data.account.email} (${res.data.account.assignedSchoolCode}). They can activate at #/admin-login.`
        : `Created School Admin ${res.data.account.fullName} (${res.data.account.email}) for ${res.data.account.assignedSchoolCode}.`
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
        : `Marked ${acc.fullName} as pending verification (sign-in paused).`
    );
  };

  return (
    <div className="space-y-6">
      {/* Separated Portal Paths Quick Reference */}
      <SurfaceCard tone="white" className="p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-[#1A1B20]">
            Separated Administrator Sign-In Portals (Hidden from Students)
          </p>
          <p className="text-[11px] text-[#686C78] mt-0.5">
            Share <span className="font-mono-tabular font-semibold text-[#1A1B20]">#/admin-login</span> with granted School Admins · Keep{' '}
            <span className="font-mono-tabular font-semibold text-[#1A1B20]">#/super-admin-login</span> strictly private.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => copyPortalLink('admin')}
            className="min-h-[38px] px-3 rounded-xl bg-[#F6F7F9] hover:bg-[#ECEEF3] text-xs font-semibold text-[#1A1B20] inline-flex items-center gap-1.5 cursor-pointer"
          >
            {copiedPortal === 'admin' ? <Check className="w-3.5 h-3.5 text-[#15803D]" /> : <Copy className="w-3.5 h-3.5" />}
            <span>Copy School Admin URL</span>
          </button>
          <button
            type="button"
            onClick={() => copyPortalLink('super')}
            className="min-h-[38px] px-3 rounded-xl bg-[#1D1E23] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
          >
            {copiedPortal === 'super' ? <Check className="w-3.5 h-3.5 text-[#BBF7D0]" /> : <Copy className="w-3.5 h-3.5" />}
            <span>Copy Super Admin URL</span>
          </button>
        </div>
      </SurfaceCard>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Grant / Create School Admin Form */}
        <SurfaceCard tone="white" className="lg:col-span-5 p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-lg font-bold text-[#1A1B20]">
                Grant School Admin Access
              </h2>
              <p className="text-xs text-[#686C78]">
                Approve an email for one university or set an initial password.
              </p>
            </div>
            <UserPlus className="w-5 h-5 text-[#1D1E23]" />
          </div>

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
                placeholder="e.g. Dr. Tunde Balogun"
                className="w-full min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-semibold"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#686C78] mb-1">
                Approved Administrator Email
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

            {grantMode === 'with_password' ? (
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
                  placeholder="Enter initial credential"
                  className="w-full min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-semibold"
                />
              </div>
            ) : (
              <div className="rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3.5 py-2.5 text-[11px] text-[#505460]">
                Only this email can open <span className="font-mono-tabular font-semibold text-[#1A1B20]">#/admin-login</span>, choose &ldquo;Activate approved email&rdquo;, verify a 6-digit code, and set their own password.
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
                ? 'Grant School Admin Email Access'
                : 'Create School Admin Account'}
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
                Verify logins, inspect every uploaded PQ &amp; action, reassign, suspend, or revoke
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

          {inspectedAdmin && (
            <div className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/12 p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-bold text-[#1A1B20]">
                    Core Inspection: {inspectedAdmin.fullName} ({inspectedAdmin.schoolCode})
                  </p>
                  <p className="text-[11px] text-[#686C78]">
                    {inspectedAdmin.email} · {inspectedAdminPosts.length} Past Questions uploaded ·{' '}
                    {inspectedAdminLogs.length} audited actions
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setInspectedAdminId(null)}
                  className="h-8 w-8 rounded-lg hover:bg-white flex items-center justify-center text-[#686C78] cursor-pointer"
                  aria-label="Close admin inspection"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-xl bg-white border border-[#1A1B20]/[0.08] p-3 space-y-2 max-h-56 overflow-y-auto">
                  <p className="text-[11px] font-bold text-[#1A1B20] uppercase tracking-wider">
                    Past Questions Uploaded ({inspectedAdminPosts.length})
                  </p>
                  {inspectedAdminPosts.length === 0 ? (
                    <p className="text-xs text-[#686C78]">No uploads from this admin yet.</p>
                  ) : (
                    inspectedAdminPosts.map((doc) => (
                      <div key={doc.id} className="text-xs border-b border-[#1A1B20]/[0.05] pb-1.5 last:border-0">
                        <p className="font-bold text-[#1A1B20]">
                          {doc.courseCode} · {doc.session} ({doc.level})
                        </p>
                        <p className="text-[11px] text-[#686C78]">
                          {doc.status === 'published' ? 'Published' : 'Draft'} · {doc.questions.length} Qs ·{' '}
                          {new Date(doc.uploadedAt).toLocaleDateString()}
                        </p>
                      </div>
                    ))
                  )}
                </div>

                <div className="rounded-xl bg-white border border-[#1A1B20]/[0.08] p-3 space-y-2 max-h-56 overflow-y-auto">
                  <p className="text-[11px] font-bold text-[#1A1B20] uppercase tracking-wider">
                    Action Trail ({inspectedAdminLogs.length})
                  </p>
                  {inspectedAdminLogs.length === 0 ? (
                    <p className="text-xs text-[#686C78]">No logged actions yet.</p>
                  ) : (
                    inspectedAdminLogs.map((log) => (
                      <div key={log.id} className="text-xs border-b border-[#1A1B20]/[0.05] pb-1.5 last:border-0">
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

          <div className="divide-y divide-[#1A1B20]/[0.06]">
            {schoolAdmins.length === 0 ? (
              <p className="py-8 text-center text-xs text-[#686C78]">
                No School Administrators created yet. Grant email access on the left to start.
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
                  <div key={acc.id} className="py-3.5 first:pt-1 last:pb-1 space-y-2.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-[#1A1B20]">
                          {acc.fullName}
                        </p>
                        <p className="text-xs text-[#505460]">
                          {acc.email} · <strong className="text-[#1A1B20]">{acc.schoolCode}</strong> ·{' '}
                          <span className="font-mono-tabular">{postCount} uploads</span>
                        </p>
                        <p className="text-[11px] text-[#686C78] mt-0.5">
                          <span className={isVerified ? 'text-[#15803D] font-semibold' : 'text-[#B91C1C] font-semibold'}>
                            {isVerified ? 'Login Verified' : 'Pending Verification'}
                          </span>
                          {' · '}
                          {acc.needsPasswordSetup ? 'Awaiting email activation' : 'Password ready'}
                          {' · '}
                          {acc.sessionState === 'logged_in' ? 'Currently Logged In' : 'Logged Out'}
                          {' · Status: '}
                          <span className="capitalize font-semibold">{acc.status}</span>
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setInspectedAdminId((prev) => (prev === acc.id ? null : acc.id))
                        }
                        className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold inline-flex items-center gap-1 cursor-pointer ${
                          inspectedAdminId === acc.id
                            ? 'bg-[#1D1E23] text-white'
                            : 'bg-[#F6F7F9] hover:bg-[#ECEEF3] text-[#1A1B20]'
                        }`}
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>Inspect Posts &amp; Activity</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleToggleVerification(acc)}
                        className="min-h-[38px] px-3 rounded-xl bg-[#F6F7F9] hover:bg-[#ECEEF3] text-xs font-semibold text-[#1A1B20] inline-flex items-center gap-1 cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{isVerified ? 'Unverify Login' : 'Verify Login'}</span>
                      </button>

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
                        <span>Revoke</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </SurfaceCard>
      </div>

      {/* Student Accounts Full Telemetry & Activity Inspector */}
      <SurfaceCard tone="white" className="p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Users className="w-5 h-5 text-[#1D1E23]" />
            <div>
              <h2 className="font-display text-lg font-bold text-[#1A1B20]">
                Student Accounts &amp; Telemetry ({studentAccounts.length})
              </h2>
              <p className="text-xs text-[#686C78]">
                Inspect full student profiles (matric number, level, department, login state), verify logins, and track all actions
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <input
              type="text"
              value={studentQuery}
              onChange={(e) => setStudentQuery(e.target.value)}
              placeholder="Search name, matric, email, dept..."
              className="flex-1 sm:w-64 min-h-[40px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-medium"
            />
            <div className="flex gap-1">
              {(['all', 'logged_in', 'logged_out'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSessionFilter(s)}
                  className={`min-h-[40px] px-2.5 rounded-xl text-xs font-semibold cursor-pointer ${
                    sessionFilter === s
                      ? 'bg-[#1D1E23] text-white'
                      : 'bg-[#F6F7F9] text-[#505460]'
                  }`}
                >
                  {s === 'all' ? 'All' : s === 'logged_in' ? 'Logged In' : 'Logged Out'}
                </button>
              ))}
            </div>
            <select
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value as 'all' | StudentLevel)}
              aria-label="Filter by student level"
              className="min-h-[40px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-2.5 text-xs font-semibold text-[#1A1B20]"
            >
              <option value="all">All Levels</option>
              <option value="100L">100L</option>
              <option value="200L">200L</option>
              <option value="300L">300L</option>
              <option value="400L">400L</option>
              <option value="500L">500L</option>
            </select>
          </div>
        </div>

        {inspectedStudent && (
          <div className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/12 p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-bold text-[#1A1B20]">
                  {inspectedStudent.fullName} · {inspectedStudent.matricNumber || 'No Matric'} ·{' '}
                  {inspectedStudent.level || '100L'}
                </p>
                <p className="text-xs text-[#505460]">
                  {inspectedStudent.faculty || 'Faculty N/A'} · {inspectedStudent.department || 'Department N/A'} ·{' '}
                  {inspectedStudent.email}
                </p>
                <p className="text-[11px] font-mono-tabular text-[#686C78] mt-0.5">
                  Session: {inspectedStudent.sessionState === 'logged_in' ? 'Logged In' : 'Logged Out'}
                  {inspectedStudent.lastLoginAt
                    ? ` · Last login ${new Date(inspectedStudent.lastLoginAt).toLocaleString([], {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}`
                    : ''}
                  {inspectedStudent.lastLogoutAt
                    ? ` · Last logout ${new Date(inspectedStudent.lastLogoutAt).toLocaleString([], {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}`
                    : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectedStudentId(null)}
                className="h-8 w-8 rounded-lg hover:bg-white flex items-center justify-center text-[#686C78] cursor-pointer"
                aria-label="Close student history"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-xl bg-white border border-[#1A1B20]/[0.08] p-3 space-y-2 max-h-56 overflow-y-auto">
                <p className="text-[11px] font-bold text-[#1A1B20] uppercase tracking-wider">
                  User Activity History ({inspectedStudentActivities.length})
                </p>
                {inspectedStudentActivities.length === 0 ? (
                  <p className="text-xs text-[#686C78]">No activity events recorded for this user yet.</p>
                ) : (
                  inspectedStudentActivities.map((ev) => (
                    <div key={ev.id} className="text-xs border-b border-[#1A1B20]/[0.05] pb-1.5 last:border-0">
                      <p className="font-semibold text-[#1A1B20]">{ev.detail}</p>
                      <p className="text-[11px] font-mono-tabular text-[#686C78]">
                        {ev.type.replace(/_/g, ' ')} ·{' '}
                        {new Date(ev.timestamp).toLocaleString([], {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </p>
                    </div>
                  ))
                )}
              </div>

              <div className="rounded-xl bg-white border border-[#1A1B20]/[0.08] p-3 space-y-2 max-h-56 overflow-y-auto">
                <p className="text-[11px] font-bold text-[#1A1B20] uppercase tracking-wider">
                  Payment Receipts ({inspectedStudentPayments.length})
                </p>
                {inspectedStudentPayments.length === 0 ? (
                  <p className="text-xs text-[#686C78]">No automatic payment confirmations recorded.</p>
                ) : (
                  inspectedStudentPayments.map((pay) => (
                    <div key={pay.id} className="text-xs border-b border-[#1A1B20]/[0.05] pb-1.5 last:border-0">
                      <p className="font-bold text-[#1A1B20]">
                        ₦{pay.amountNaira.toLocaleString()} · {pay.tierName} ({pay.provider})
                      </p>
                      <p className="text-[11px] font-mono-tabular text-[#686C78]">
                        Ref: {pay.reference} · Auto-Verified
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        <div className="divide-y divide-[#1A1B20]/[0.06]">
          {studentAccounts.length === 0 ? (
            <p className="py-6 text-center text-xs text-[#686C78]">
              No matching student accounts.
            </p>
          ) : (
            studentAccounts.map((acc) => {
              const isVerified = acc.adminVerified !== false;
              const isLoggedIn = acc.sessionState === 'logged_in';

              return (
                <div
                  key={acc.id}
                  className="py-3.5 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#1A1B20] truncate">
                      {acc.fullName}
                      {acc.level ? ` · ${acc.level}` : ''}
                    </p>
                    <p className="text-xs text-[#505460] truncate">
                      <span className="font-mono-tabular font-semibold text-[#1A1B20]">
                        {acc.matricNumber || 'NO MATRIC'}
                      </span>
                      {' · '}
                      {acc.department || acc.faculty || 'Department N/A'}
                      {' · '}
                      {acc.email}
                    </p>
                    <p className="text-[11px] text-[#686C78] mt-0.5">
                      <span className={isLoggedIn ? 'text-[#15803D] font-semibold' : 'text-[#686C78]'}>
                        {isLoggedIn ? 'Logged In' : 'Logged Out'}
                      </span>
                      {' · '}
                      <span>Plan: {acc.subscriptionTier ?? 'free'}</span>
                      {' · '}
                      <span className={isVerified ? 'text-[#15803D]' : 'text-[#B91C1C] font-semibold'}>
                        {isVerified ? 'Verified' : 'Pending Verification'}
                      </span>
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setInspectedStudentId((prev) => (prev === acc.id ? null : acc.id))
                      }
                      className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold inline-flex items-center gap-1 cursor-pointer ${
                        inspectedStudentId === acc.id
                          ? 'bg-[#1D1E23] text-white'
                          : 'bg-[#F6F7F9] hover:bg-[#ECEEF3] text-[#1A1B20]'
                      }`}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Inspect History</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleToggleVerification(acc)}
                      className="min-h-[38px] px-3 rounded-xl bg-[#F6F7F9] hover:bg-[#ECEEF3] text-xs font-semibold text-[#1A1B20] cursor-pointer"
                    >
                      {isVerified ? 'Unverify' : 'Verify'}
                    </button>

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
                </div>
              );
            })
          )}
        </div>
      </SurfaceCard>
    </div>
  );
};

