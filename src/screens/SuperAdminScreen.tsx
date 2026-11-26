import React, { useState } from 'react';
import {
  Activity,
  BookOpen,
  Building2,
  CheckCircle2,
  CreditCard,
  FileText,
  Globe,
  LayoutDashboard,
  Megaphone,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { canAccessScreen } from '../core/permissions';
import type { AuthenticatedUser, WorkspaceViewMode } from '../core/types';
import { useArchiveStore } from '../hooks/useArchiveStore';
import { SurfaceCard } from '../components/ui';
import { SuperAdminOverviewTab } from '../features/admin/super-admin/SuperAdminOverviewTab';
import { UniversityManagementTab } from '../features/admin/super-admin/UniversityManagementTab';
import { AdminAccountsTab } from '../features/admin/super-admin/AdminAccountsTab';
import { PastQuestionsManagerTab } from '../features/admin/super-admin/PastQuestionsManagerTab';
import { StudyMaterialsManagerTab } from '../features/admin/super-admin/StudyMaterialsManagerTab';
import { AuditLogsTab } from '../features/admin/super-admin/AuditLogsTab';
import { PaymentsTab } from '../features/admin/super-admin/PaymentsTab';
import { BroadcastsTab } from '../features/admin/super-admin/BroadcastsTab';

type SuperAdminTabId =
  | 'overview'
  | 'universities'
  | 'accounts'
  | 'past_questions'
  | 'study_materials'
  | 'payments'
  | 'broadcasts'
  | 'audit_logs';

interface SuperAdminScreenProps {
  currentUser: AuthenticatedUser;
  onSignedOutReset: () => void;
  onSwitchWorkspace?: (mode: WorkspaceViewMode) => void;
}

const TABS: Array<{
  id: SuperAdminTabId;
  label: string;
  icon: React.FC<{ className?: string }>;
}> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'universities', label: 'Universities', icon: Building2 },
  { id: 'accounts', label: 'Admins & Users', icon: Users },
  { id: 'past_questions', label: 'Past Questions', icon: FileText },
  { id: 'study_materials', label: 'Study Materials', icon: BookOpen },
  { id: 'payments', label: 'Payments', icon: CreditCard },
  { id: 'broadcasts', label: 'Broadcasts & Marquee', icon: Megaphone },
  { id: 'audit_logs', label: 'Activity Logs', icon: Activity },
];

export const SuperAdminScreen: React.FC<SuperAdminScreenProps> = ({
  currentUser,
  onSignedOutReset,
  onSwitchWorkspace,
}) => {
  const store = useArchiveStore();
  const [activeTab, setActiveTab] = useState<SuperAdminTabId>('overview');
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!canAccessScreen(currentUser, 'super_admin')) {
    return (
      <SurfaceCard tone="white" className="p-6 text-center space-y-2">
        <ShieldAlert className="w-6 h-6 text-[#B91C1C] mx-auto" />
        <h1 className="font-display text-lg font-bold text-[#1A1B20]">
          Super Admin Authorization Required
        </h1>
        <p className="text-sm text-[#505460]">
          Only an active Super Administrator session can access platform administration.
        </p>
      </SurfaceCard>
    );
  }

  const handleNotice = (msg: string) => {
    setErrorMsg(null);
    setNotice(msg);
  };

  const handleError = (msg: string) => {
    setNotice(null);
    setErrorMsg(msg);
  };

  return (
    <div className="space-y-6 page-enter">
      {/* Control Banner */}
      <SurfaceCard tone="ash" withWaves className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-[#A5AAB8]">
              Super Admin Control Desk · {currentUser.fullName}
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-white mt-1.5">
              Platform Administration &amp; Governance
            </h1>
            <p className="text-sm text-[#B8BCC8] mt-1.5 max-w-2xl">
              Control universities, grant School Admin email access, verify accounts, monitor visitors and payments, push header marquees, and audit every action.
            </p>
          </div>

          {onSwitchWorkspace && (
            <div className="flex flex-wrap gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onSwitchWorkspace('school_admin')}
                className="min-h-[40px] px-3.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-semibold text-white inline-flex items-center gap-1.5 cursor-pointer"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>School Admin View</span>
              </button>
              <button
                type="button"
                onClick={() => onSwitchWorkspace('student')}
                className="min-h-[40px] px-3.5 rounded-xl bg-white text-[#1A1B20] hover:bg-[#F2F4F7] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Globe className="w-3.5 h-3.5" />
                <span>Student Website View</span>
              </button>
            </div>
          )}
        </div>
      </SurfaceCard>

      {/* Scrollable Sub-Navigation Tabs */}
      <div
        role="tablist"
        aria-label="Super Admin workspaces"
        className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar"
      >
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setActiveTab(tab.id);
                setNotice(null);
                setErrorMsg(null);
              }}
              className={`min-h-[44px] px-4 rounded-xl text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                active
                  ? 'bg-[#1D1E23] text-white'
                  : 'bg-white text-[#505460] border border-[#1A1B20]/[0.08] hover:bg-[#ECEEF3]'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-2xl bg-[#FEF2F2] border border-[#FECACA] px-4 py-3 text-xs font-medium text-[#B91C1C]"
        >
          {errorMsg}
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="rounded-2xl bg-[#F0FDF4] border border-[#BBF7D0] px-4 py-3 text-xs font-medium text-[#15803D] flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {activeTab === 'overview' && (
        <SuperAdminOverviewTab
          currentUser={currentUser}
          store={store}
          onNotice={handleNotice}
          onError={handleError}
          onSignedOutReset={onSignedOutReset}
        />
      )}

      {activeTab === 'universities' && (
        <UniversityManagementTab
          currentUser={currentUser}
          store={store}
          onNotice={handleNotice}
          onError={handleError}
        />
      )}

      {activeTab === 'accounts' && (
        <AdminAccountsTab
          currentUser={currentUser}
          store={store}
          onNotice={handleNotice}
          onError={handleError}
        />
      )}

      {activeTab === 'past_questions' && (
        <PastQuestionsManagerTab
          currentUser={currentUser}
          store={store}
          onNotice={handleNotice}
          onError={handleError}
        />
      )}

      {activeTab === 'study_materials' && (
        <StudyMaterialsManagerTab
          currentUser={currentUser}
          store={store}
          onNotice={handleNotice}
          onError={handleError}
        />
      )}

      {activeTab === 'payments' && <PaymentsTab store={store} />}

      {activeTab === 'broadcasts' && (
        <BroadcastsTab
          currentUser={currentUser}
          store={store}
          onNotice={handleNotice}
          onError={handleError}
        />
      )}

      {activeTab === 'audit_logs' && <AuditLogsTab store={store} />}
    </div>
  );
};

