import React, { useMemo, useState } from 'react';
import { Eye, Users, X } from 'lucide-react';
import type { AuthenticatedUser, StudentLevel } from '../../../core/types';
import type { AppStoreState } from '../../../services/archiveRepository';
import { authService } from '../../../services/authService';
import { SurfaceCard } from '../../../components/ui';

interface StudentsTabProps {
  currentUser: AuthenticatedUser;
  store: AppStoreState;
  onNotice: (msg: string) => void;
  onError: (msg: string) => void;
}

export const StudentsTab: React.FC<StudentsTabProps> = ({
  currentUser,
  store,
  onNotice,
  onError,
}) => {
  const [studentQuery, setStudentQuery] = useState('');
  const [sessionFilter, setSessionFilter] = useState<'all' | 'logged_in' | 'logged_out'>('all');
  const [levelFilter, setLevelFilter] = useState<'all' | StudentLevel>('all');
  const [inspectedStudentId, setInspectedStudentId] = useState<string | null>(null);

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

  const handleToggleVerification = (accountId: string, fullName: string, currentlyVerified: boolean) => {
    const res = authService.setAccountVerification(currentUser, accountId, !currentlyVerified);
    if (!res.ok) {
      onError(res.error ?? 'Could not update verification status.');
      return;
    }
    onNotice(
      !currentlyVerified
        ? `Verified login access for ${fullName}.`
        : `Marked ${fullName} as pending verification (sign-in paused).`
    );
  };

  return (
    <SurfaceCard tone="white" className="p-5 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Users className="w-5 h-5 text-[#1D1E23]" />
          <div>
            <h2 className="font-display text-lg font-bold text-[#1A1B20]">
              Students Directory ({studentAccounts.length})
            </h2>
            <p className="text-xs text-[#686C78]">
              Search by name, matric number, level, faculty, or department, verify logins, and inspect activity
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
                Status: <span className="capitalize font-semibold">{inspectedStudent.status}</span> ·{' '}
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
          <p className="py-8 text-center text-xs text-[#686C78]">
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
                    <span className="capitalize">Status: {acc.status}</span>
                    {acc.warningsCount ? ` · ${acc.warningsCount} warning(s)` : ''}
                    {' · '}
                    <span className={isVerified ? 'text-[#15803D]' : 'text-[#B91C1C] font-semibold'}>
                      {isVerified ? 'Login Verified' : 'Pending Verification'}
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
                    onClick={() => handleToggleVerification(acc.id, acc.fullName, isVerified)}
                    className="min-h-[38px] px-3 rounded-xl bg-[#F6F7F9] hover:bg-[#ECEEF3] text-xs font-semibold text-[#1A1B20] cursor-pointer"
                  >
                    {isVerified ? 'Unverify Login' : 'Verify Login'}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </SurfaceCard>
  );
};
