import React, { useMemo, useState } from 'react';
import { ChevronRight, Users } from 'lucide-react';
import type { AuthenticatedUser, StudentLevel } from '../../../core/types';
import type { AppStoreState } from '../../../services/archiveRepository';
import { authService } from '../../../services/authService';
import {
  CustomSelect,
  DetailDialog,
  SectionHeadingBar,
  SurfaceCard,
} from '../../../components/ui';

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

  const handleToggleVerification = (
    accountId: string,
    fullName: string,
    currentlyVerified: boolean
  ) => {
    const res = authService.setAccountVerification(currentUser, accountId, !currentlyVerified);
    if (!res.ok) {
      onError(res.error ?? 'Could not update verification status.');
      return;
    }
    onNotice(
      !currentlyVerified
        ? `Verified login access for ${fullName}.`
        : `Sign-in paused for ${fullName} until re-verified.`
    );
  };

  return (
    <>
      <SurfaceCard tone="white" className="p-5 sm:p-6 space-y-4">
        <SectionHeadingBar
          icon={<Users className="w-4 h-4" />}
          title={`Students (${studentAccounts.length})`}
        />

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={studentQuery}
            onChange={(e) => setStudentQuery(e.target.value)}
            placeholder="Search name, matric, dept..."
            className="flex-1 min-w-[200px] min-h-[40px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-medium"
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
                {s === 'all' ? 'All' : s === 'logged_in' ? 'Signed In' : 'Signed Out'}
              </button>
            ))}
          </div>
          <div className="w-36">
            <CustomSelect
              size="sm"
              mono
              ariaLabel="Filter by student level"
              value={levelFilter}
              options={[
                { value: 'all', label: 'All Levels' },
                { value: '100L', label: '100L' },
                { value: '200L', label: '200L' },
                { value: '300L', label: '300L' },
                { value: '400L', label: '400L' },
                { value: '500L', label: '500L' },
              ]}
              onChange={(val) => setLevelFilter(val as 'all' | StudentLevel)}
            />
          </div>
        </div>

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
                <button
                  key={acc.id}
                  type="button"
                  onClick={() => setInspectedStudentId(acc.id)}
                  className="w-full py-3.5 first:pt-1 last:pb-1 flex items-center justify-between gap-3 text-left hover:bg-[#F6F7F9] rounded-xl px-2 -mx-2 transition-colors cursor-pointer"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-bold text-[#1A1B20] truncate">
                      {acc.fullName}
                      {acc.level ? ` · ${acc.level}` : ''}
                    </p>
                    <p className="text-xs text-[#505460] truncate">
                      <span className="font-mono-tabular font-semibold text-[#1A1B20]">
                        {acc.matricNumber || 'No Matric'}
                      </span>
                      {' · '}
                      <span>{acc.email}</span>
                      {' · '}
                      {acc.department || acc.faculty || 'Department N/A'}
                    </p>
                    <p className="text-xs text-[#686C78]">
                      <span className={isLoggedIn ? 'text-[#15803D] font-semibold' : ''}>
                        {isLoggedIn ? 'Signed In' : 'Signed Out'}
                      </span>
                      {' · '}
                      <span className={isVerified ? 'text-[#15803D]' : 'text-[#B91C1C] font-semibold'}>
                        {isVerified ? 'Verified' : 'Unverified'}
                      </span>
                      {' · '}
                      <span className="capitalize">{acc.status}</span>
                    </p>
                  </div>

                  <span className="min-h-[36px] px-3 rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 text-xs font-semibold text-[#1A1B20] inline-flex items-center gap-1 shrink-0">
                    <span>Inspect</span>
                    <ChevronRight className="w-3.5 h-3.5 text-[#686C78]" />
                  </span>
                </button>
              );
            })
          )}
        </div>
      </SurfaceCard>

      <DetailDialog
        open={Boolean(inspectedStudent)}
        onClose={() => setInspectedStudentId(null)}
        title={inspectedStudent ? inspectedStudent.fullName : 'Student Details'}
        subtitle={
          inspectedStudent
            ? `${inspectedStudent.matricNumber || 'No Matric'} · ${inspectedStudent.level || '100L'}`
            : undefined
        }
        icon={<Users className="w-4 h-4" />}
        maxWidthClass="max-w-2xl"
      >
        {inspectedStudent && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/[0.07] p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5 text-xs">
                <p className="font-semibold text-[#1A1B20]">
                  {inspectedStudent.faculty || 'Faculty N/A'} ·{' '}
                  {inspectedStudent.department || 'Department N/A'}
                </p>
                <p className="text-[#505460]">
                  {inspectedStudent.email} · Role: <span className="font-semibold text-[#1A1B20]">Student</span>
                </p>
                <p className="text-[#686C78] font-mono-tabular">
                  Email:{' '}
                  <span
                    className={
                      inspectedStudent.isEmailVerified !== false
                        ? 'text-[#15803D] font-semibold'
                        : 'text-[#B91C1C] font-semibold'
                    }
                  >
                    {inspectedStudent.isEmailVerified !== false ? 'Verified' : 'Unverified'}
                  </span>
                  {' · '}Login:{' '}
                  <span
                    className={
                      inspectedStudent.adminVerified !== false
                        ? 'text-[#15803D] font-semibold'
                        : 'text-[#B91C1C] font-semibold'
                    }
                  >
                    {inspectedStudent.adminVerified !== false ? 'Verified' : 'Paused'}
                  </span>
                  {' · '}Status:{' '}
                  <span className="capitalize font-semibold">{inspectedStudent.status}</span>
                </p>
                <p className="text-[#686C78] font-mono-tabular">
                  Plan: {inspectedStudent.subscriptionTier ?? 'free'} · Registered:{' '}
                  {inspectedStudent.createdAt
                    ? new Date(inspectedStudent.createdAt).toLocaleString([], {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })
                    : 'N/A'}
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  handleToggleVerification(
                    inspectedStudent.id,
                    inspectedStudent.fullName,
                    inspectedStudent.adminVerified !== false
                  )
                }
                className="min-h-[38px] px-3.5 rounded-xl bg-[#1D1E23] text-white text-xs font-semibold cursor-pointer"
              >
                {inspectedStudent.adminVerified !== false ? 'Unverify Login' : 'Verify Login'}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/[0.06] p-3.5 space-y-2 max-h-56 overflow-y-auto">
                <p className="text-xs font-bold text-[#1A1B20]">
                  Activity History ({inspectedStudentActivities.length})
                </p>
                {inspectedStudentActivities.length === 0 ? (
                  <p className="text-xs text-[#686C78]">No activity recorded yet.</p>
                ) : (
                  inspectedStudentActivities.map((ev) => (
                    <div
                      key={ev.id}
                      className="text-xs border-b border-[#1A1B20]/[0.06] pb-1.5 last:border-0"
                    >
                      <p className="font-semibold text-[#1A1B20]">{ev.detail}</p>
                      <p className="text-[11px] font-mono-tabular text-[#686C78]">
                        {new Date(ev.timestamp).toLocaleString([], {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </p>
                    </div>
                  ))
                )}
              </div>

              <div className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/[0.06] p-3.5 space-y-2 max-h-56 overflow-y-auto">
                <p className="text-xs font-bold text-[#1A1B20]">
                  Payment Receipts ({inspectedStudentPayments.length})
                </p>
                {inspectedStudentPayments.length === 0 ? (
                  <p className="text-xs text-[#686C78]">No payment receipts recorded.</p>
                ) : (
                  inspectedStudentPayments.map((pay) => (
                    <div
                      key={pay.id}
                      className="text-xs border-b border-[#1A1B20]/[0.06] pb-1.5 last:border-0"
                    >
                      <p className="font-bold text-[#1A1B20]">
                        ₦{pay.amountNaira.toLocaleString()} · {pay.tierName} ({pay.provider})
                      </p>
                      <p className="text-[11px] font-mono-tabular text-[#686C78]">
                        Ref: {pay.reference}
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
