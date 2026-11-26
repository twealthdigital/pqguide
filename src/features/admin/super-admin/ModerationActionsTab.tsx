import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  Bell,
  CheckCircle2,
  ShieldAlert,
  ShieldOff,
  UserX,
} from 'lucide-react';
import type { AuthenticatedUser, ManagedAccount } from '../../../core/types';
import type { AppStoreState } from '../../../services/archiveRepository';
import { authService } from '../../../services/authService';
import { SurfaceCard, TactileButton } from '../../../components/ui';

interface ModerationActionsTabProps {
  currentUser: AuthenticatedUser;
  store: AppStoreState;
  onNotice: (msg: string) => void;
  onError: (msg: string) => void;
}

type ModerationMode = 'warn' | 'notify' | 'restrict' | 'suspend' | 'ban' | 'activate';

const STATUS_LABELS: Record<ManagedAccount['status'], string> = {
  active: 'Active',
  restricted: 'Restricted (Read-Only)',
  suspended: 'Suspended',
  banned: 'Banned',
  revoked: 'Revoked',
};

export const ModerationActionsTab: React.FC<ModerationActionsTabProps> = ({
  currentUser,
  store,
  onNotice,
  onError,
}) => {
  const [roleFilter, setRoleFilter] = useState<'all' | 'student' | 'school_admin'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionMode, setActionMode] = useState<ModerationMode>('warn');
  const [customTitle, setCustomTitle] = useState('');
  const [reason, setReason] = useState('');

  const candidateAccounts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return store.accounts.filter((a) => {
      if (a.role === 'super_admin' || a.id === currentUser.id) return false;
      if (roleFilter === 'student' && a.role !== 'student') return false;
      if (roleFilter === 'school_admin' && a.role !== 'school_admin') return false;
      if (!q) return true;
      return (
        a.fullName.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q) ||
        (a.matricNumber ?? '').toLowerCase().includes(q) ||
        (a.schoolCode ?? '').toLowerCase().includes(q)
      );
    });
  }, [store.accounts, currentUser.id, roleFilter, searchQuery]);

  const selectedAccount = useMemo(
    () => candidateAccounts.find((a) => a.id === selectedId) ?? candidateAccounts[0] ?? null,
    [candidateAccounts, selectedId]
  );

  const actionMeta: Array<{
    id: ModerationMode;
    label: string;
    description: string;
    icon: React.ReactNode;
    danger?: boolean;
  }> = [
    {
      id: 'warn',
      label: 'Send Warning',
      description: 'Increments warning count and sends a personal warning alert.',
      icon: <AlertTriangle className="w-4 h-4" />,
    },
    {
      id: 'notify',
      label: 'Direct Notification',
      description: 'Sends a private notification straight to this user only.',
      icon: <Bell className="w-4 h-4" />,
    },
    {
      id: 'restrict',
      label: 'Restrict Account',
      description: 'Allows read-only browsing while blocking interactive actions/uploads.',
      icon: <ShieldOff className="w-4 h-4" />,
    },
    {
      id: 'suspend',
      label: 'Suspend',
      description: 'Signs user out immediately and blocks login until restored.',
      icon: <UserX className="w-4 h-4" />,
      danger: true,
    },
    {
      id: 'ban',
      label: 'Ban',
      description: 'Permanently blocks account access across the platform.',
      icon: <Ban className="w-4 h-4" />,
      danger: true,
    },
    {
      id: 'activate',
      label: 'Restore Active',
      description: 'Clears restrictions/suspensions/bans and restores full access.',
      icon: <CheckCircle2 className="w-4 h-4" />,
    },
  ];

  const activeModeSpec = actionMeta.find((m) => m.id === actionMode) ?? actionMeta[0];

  const handleApplyAction = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccount) {
      onError('Select a student or school administrator account first.');
      return;
    }

    const res = authService.moderateAccount(
      currentUser,
      selectedAccount.id,
      actionMode,
      reason,
      customTitle.trim() || undefined
    );

    if (!res.ok) {
      onError(res.error ?? 'Could not apply moderation action.');
      return;
    }

    setReason('');
    setCustomTitle('');
    onNotice(
      `Applied "${activeModeSpec.label}" to ${selectedAccount.fullName} (${selectedAccount.email}).`
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left: Uniform Account Selector */}
      <SurfaceCard tone="white" className="lg:col-span-5 p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-bold text-[#1A1B20]">
              1. Pick Student or Admin
            </h2>
            <p className="text-xs text-[#686C78]">
              Search any account across universities to take action
            </p>
          </div>
          <ShieldAlert className="w-5 h-5 text-[#1D1E23]" />
        </div>

        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search name, matric, email, or school..."
          className="w-full min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-medium"
        />

        <div className="flex gap-1">
          {(
            [
              { id: 'all', label: 'All Accounts' },
              { id: 'student', label: 'Students' },
              { id: 'school_admin', label: 'School Admins' },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setRoleFilter(f.id)}
              className={`min-h-[36px] flex-1 rounded-xl text-xs font-semibold cursor-pointer transition-colors ${
                roleFilter === f.id
                  ? 'bg-[#1D1E23] text-white'
                  : 'bg-[#F6F7F9] text-[#505460] hover:bg-[#ECEEF3]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {candidateAccounts.length === 0 ? (
            <p className="py-8 text-center text-xs text-[#686C78]">
              No matching student or administrator accounts.
            </p>
          ) : (
            candidateAccounts.map((acc) => {
              const selected = selectedAccount?.id === acc.id;
              return (
                <button
                  key={acc.id}
                  type="button"
                  onClick={() => setSelectedId(acc.id)}
                  className={`w-full rounded-2xl border p-3.5 text-left transition-colors cursor-pointer space-y-1 ${
                    selected
                      ? 'border-[#1D1E23] bg-[#1D1E23] text-white'
                      : 'border-[#1A1B20]/[0.08] bg-[#F6F7F9] text-[#1A1B20] hover:bg-[#ECEEF3]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold truncate">
                      {acc.fullName}
                      {acc.matricNumber ? ` · ${acc.matricNumber}` : ''}
                    </span>
                    <span
                      className={`text-[10px] font-mono-tabular font-semibold uppercase shrink-0 ${
                        selected ? 'text-[#C3C7D2]' : 'text-[#686C78]'
                      }`}
                    >
                      {acc.role.replace('_', ' ')}
                    </span>
                  </div>
                  <p
                    className={`text-[11px] truncate ${
                      selected ? 'text-[#C3C7D2]' : 'text-[#505460]'
                    }`}
                  >
                    {acc.email} · {STATUS_LABELS[acc.status]}
                    {acc.warningsCount ? ` · ${acc.warningsCount} warning(s)` : ''}
                  </p>
                </button>
              );
            })
          )}
        </div>
      </SurfaceCard>

      {/* Right: Uniform Moderation Control Form */}
      <SurfaceCard tone="white" className="lg:col-span-7 p-5 sm:p-6 space-y-5">
        {!selectedAccount ? (
          <div className="py-12 text-center text-xs text-[#686C78]">
            Select an account from the list on the left to warn, notify, restrict, suspend, or ban.
          </div>
        ) : (
          <form onSubmit={handleApplyAction} className="space-y-5">
            <div className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/[0.08] p-4 space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-bold text-[#1A1B20]">
                  {selectedAccount.fullName}
                  {selectedAccount.level ? ` · ${selectedAccount.level}` : ''}
                </p>
                <span className="text-xs font-mono-tabular font-semibold text-[#1A1B20]">
                  {STATUS_LABELS[selectedAccount.status]}
                </span>
              </div>
              <p className="text-xs text-[#505460]">
                {selectedAccount.role.replace('_', ' ')} · {selectedAccount.email} ·{' '}
                {selectedAccount.matricNumber || selectedAccount.schoolCode}
              </p>
              {(selectedAccount.warningsCount ?? 0) > 0 || selectedAccount.moderationNote ? (
                <p className="text-[11px] text-[#B91C1C] font-medium pt-1">
                  Warnings: {selectedAccount.warningsCount ?? 0}
                  {selectedAccount.moderationNote
                    ? ` · Latest note: "${selectedAccount.moderationNote}"`
                    : ''}
                </p>
              ) : null}
            </div>

            <div>
              <p className="text-xs font-bold text-[#1A1B20] mb-2">
                2. Choose Action
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {actionMeta.map((mode) => {
                  const active = actionMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setActionMode(mode.id)}
                      className={`min-h-[46px] px-3 py-2.5 rounded-xl border text-left text-xs font-semibold flex items-center gap-2 cursor-pointer transition-colors ${
                        active
                          ? mode.danger
                            ? 'bg-[#B91C1C] text-white border-[#B91C1C]'
                            : 'bg-[#1D1E23] text-white border-[#1D1E23]'
                          : mode.danger
                            ? 'bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA] hover:bg-[#FEE2E2]'
                            : 'bg-[#F6F7F9] text-[#1A1B20] border-[#1A1B20]/[0.08] hover:bg-[#ECEEF3]'
                      }`}
                    >
                      {mode.icon}
                      <span className="truncate">{mode.label}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-[#686C78] mt-2">
                {activeModeSpec.description}
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[#686C78] mb-1">
                  Alert Title (Optional)
                </label>
                <input
                  type="text"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder="Default title will be used if left blank"
                  className="w-full min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-semibold"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#686C78] mb-1">
                  {actionMode === 'notify'
                    ? 'Notification Message'
                    : actionMode === 'activate'
                      ? 'Restoration Note (Optional)'
                      : 'Reason / Notice Sent to User'}
                </label>
                <textarea
                  rows={3}
                  required={actionMode !== 'activate'}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={
                    actionMode === 'notify'
                      ? 'Write the message this user will receive in Notifications...'
                      : 'Explain clearly why this action is being taken...'
                  }
                  className="w-full rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 p-3 text-xs resize-none"
                />
              </div>
            </div>

            <TactileButton type="submit" variant="dark" size="md" fullWidth>
              Apply {activeModeSpec.label} to {selectedAccount.fullName}
            </TactileButton>
          </form>
        )}
      </SurfaceCard>
    </div>
  );
};
