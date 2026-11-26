import React, { useMemo, useState } from 'react';
import {
  Activity,
  BookOpen,
  Building2,
  CreditCard,
  Eye,
  FileText,
  LogIn,
  LogOut,
  RotateCcw,
  UploadCloud,
  Users,
} from 'lucide-react';
import type { AuthenticatedUser } from '../../../core/types';
import { archiveRepository, type AppStoreState } from '../../../services/archiveRepository';
import { authService, IS_DEV_BOOTSTRAP_ENV } from '../../../services/authService';
import { SurfaceCard, TactileButton } from '../../../components/ui';

interface SuperAdminOverviewTabProps {
  currentUser: AuthenticatedUser;
  store: AppStoreState;
  onNotice: (msg: string) => void;
  onError: (msg: string) => void;
  onSignedOutReset: () => void;
}

export const SuperAdminOverviewTab: React.FC<SuperAdminOverviewTabProps> = ({
  currentUser,
  store,
  onNotice,
  onError,
  onSignedOutReset,
}) => {
  const [devResetPhrase, setDevResetPhrase] = useState('');
  const [showDevReset, setShowDevReset] = useState(false);

  const metrics = useMemo(() => {
    const totalAccounts = store.accounts.length;
    const totalSchools = store.schools.length;
    const activeSchools = store.schools.filter((s) => s.isActive).length;
    const totalPQs = store.documents.length;
    const publishedPQs = store.documents.filter((d) => d.status === 'published').length;
    const totalMaterials = store.materials.length;
    const publishedMaterials = store.materials.filter(
      (m) => (m.status ?? 'published') === 'published'
    ).length;
    const totalUploads = totalPQs + totalMaterials;
    const schoolAdmins = store.accounts.filter((a) => a.role === 'school_admin').length;
    const studentsCount = store.accounts.filter((a) => a.role === 'student').length;

    const loggedInAccounts = store.accounts.filter((a) => a.sessionState === 'logged_in');
    const loggedOutAccounts = store.accounts.filter((a) => a.sessionState !== 'logged_in');
    const loggedInStudents = loggedInAccounts.filter((a) => a.role === 'student').length;
    const loggedInAdmins = loggedInAccounts.filter((a) => a.role !== 'student').length;

    const verifiedPayments = store.payments.filter((p) => p.status === 'verified_auto');
    const verifiedRevenueNaira = verifiedPayments.reduce((sum, p) => sum + p.amountNaira, 0);

    return {
      totalAccounts,
      totalSchools,
      activeSchools,
      totalPQs,
      publishedPQs,
      totalMaterials,
      publishedMaterials,
      totalUploads,
      schoolAdmins,
      studentsCount,
      loggedInCount: loggedInAccounts.length,
      loggedOutCount: loggedOutAccounts.length,
      loggedInStudents,
      loggedInAdmins,
      totalVisits: store.telemetry.totalVisits,
      uniqueVisitors: store.telemetry.uniqueVisitorIds.length,
      verifiedPaymentsCount: verifiedPayments.length,
      verifiedRevenueNaira,
    };
  }, [
    store.accounts,
    store.schools,
    store.documents,
    store.materials,
    store.payments,
    store.telemetry,
  ]);

  const recentLogs = store.auditLogs.slice(0, 8);
  const recentActivities = store.userActivities.slice(0, 10);

  const handleClearSamples = () => {
    try {
      archiveRepository.clearSeedSamples(currentUser);
      onNotice('Starter demo samples cleared from archive.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Action denied.');
    }
  };

  const handleRestoreSamples = () => {
    try {
      archiveRepository.restoreDefaultCatalog(currentUser);
      onNotice('Default past questions and study materials catalog restored.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Action denied.');
    }
  };

  const handleDevReset = (e: React.FormEvent) => {
    e.preventDefault();
    const res = authService.resetLocalDevData(devResetPhrase, currentUser);
    if (!res.ok) {
      onError(res.error ?? 'Could not reset local dev data.');
      return;
    }
    setDevResetPhrase('');
    setShowDevReset(false);
    onSignedOutReset();
  };

  return (
    <div className="space-y-6">
      <section
        aria-label="Platform overview metrics"
        className="grid grid-cols-2 lg:grid-cols-5 gap-3.5 sm:gap-4"
      >
        <SurfaceCard tone="white" className="p-4 sm:p-5">
          <div className="flex items-center justify-between text-[#686C78]">
            <span className="text-xs font-medium">Registered Accounts</span>
            <Users className="w-4 h-4" />
          </div>
          <p className="font-display font-mono-tabular text-2xl sm:text-3xl font-extrabold text-[#1A1B20] mt-2">
            {metrics.totalAccounts}
          </p>
          <p className="text-[11px] text-[#686C78] mt-1 font-mono-tabular">
            {metrics.studentsCount} Students · {metrics.schoolAdmins} Admins
          </p>
        </SurfaceCard>

        <SurfaceCard tone="white" className="p-4 sm:p-5">
          <div className="flex items-center justify-between text-[#686C78]">
            <span className="text-xs font-medium">Universities</span>
            <Building2 className="w-4 h-4" />
          </div>
          <p className="font-display font-mono-tabular text-2xl sm:text-3xl font-extrabold text-[#1A1B20] mt-2">
            {metrics.totalSchools}
          </p>
          <p className="text-[11px] text-[#686C78] mt-1 font-mono-tabular">
            {metrics.activeSchools} active
          </p>
        </SurfaceCard>

        <SurfaceCard tone="white" className="p-4 sm:p-5">
          <div className="flex items-center justify-between text-[#686C78]">
            <span className="text-xs font-medium">Past Questions</span>
            <FileText className="w-4 h-4" />
          </div>
          <p className="font-display font-mono-tabular text-2xl sm:text-3xl font-extrabold text-[#1A1B20] mt-2">
            {metrics.totalPQs}
          </p>
          <p className="text-[11px] text-[#686C78] mt-1 font-mono-tabular">
            {metrics.publishedPQs} published
          </p>
        </SurfaceCard>

        <SurfaceCard tone="white" className="p-4 sm:p-5">
          <div className="flex items-center justify-between text-[#686C78]">
            <span className="text-xs font-medium">Study Materials</span>
            <BookOpen className="w-4 h-4" />
          </div>
          <p className="font-display font-mono-tabular text-2xl sm:text-3xl font-extrabold text-[#1A1B20] mt-2">
            {metrics.totalMaterials}
          </p>
          <p className="text-[11px] text-[#686C78] mt-1 font-mono-tabular">
            {metrics.publishedMaterials} published
          </p>
        </SurfaceCard>

        <SurfaceCard tone="white" className="p-4 sm:p-5 col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between text-[#686C78]">
            <span className="text-xs font-medium">Total Uploads</span>
            <UploadCloud className="w-4 h-4" />
          </div>
          <p className="font-display font-mono-tabular text-2xl sm:text-3xl font-extrabold text-[#1A1B20] mt-2">
            {metrics.totalUploads}
          </p>
          <p className="text-[11px] text-[#686C78] mt-1">PQs + Study Guides</p>
        </SurfaceCard>
      </section>

      {/* Visitors, Sessions & Automatic Payment Confirmations */}
      <section
        aria-label="Website visitors, logged sessions, and verified payments"
        className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4"
      >
        <SurfaceCard tone="white" className="p-4 sm:p-5">
          <div className="flex items-center justify-between text-[#686C78]">
            <span className="text-xs font-medium">Website Visitors</span>
            <Eye className="w-4 h-4" />
          </div>
          <p className="font-display font-mono-tabular text-2xl sm:text-3xl font-extrabold text-[#1A1B20] mt-2">
            {metrics.totalVisits}
          </p>
          <p className="text-[11px] text-[#686C78] mt-1 font-mono-tabular">
            {metrics.uniqueVisitors} unique visitors
          </p>
        </SurfaceCard>

        <SurfaceCard tone="white" className="p-4 sm:p-5">
          <div className="flex items-center justify-between text-[#15803D]">
            <span className="text-xs font-medium text-[#686C78]">Logged-In Users</span>
            <LogIn className="w-4 h-4" />
          </div>
          <p className="font-display font-mono-tabular text-2xl sm:text-3xl font-extrabold text-[#1A1B20] mt-2">
            {metrics.loggedInCount}
          </p>
          <p className="text-[11px] text-[#686C78] mt-1 font-mono-tabular">
            {metrics.loggedInStudents} Students · {metrics.loggedInAdmins} Admins
          </p>
        </SurfaceCard>

        <SurfaceCard tone="white" className="p-4 sm:p-5">
          <div className="flex items-center justify-between text-[#686C78]">
            <span className="text-xs font-medium">Logged-Out Users</span>
            <LogOut className="w-4 h-4" />
          </div>
          <p className="font-display font-mono-tabular text-2xl sm:text-3xl font-extrabold text-[#1A1B20] mt-2">
            {metrics.loggedOutCount}
          </p>
          <p className="text-[11px] text-[#686C78] mt-1">Inactive or signed out</p>
        </SurfaceCard>

        <SurfaceCard tone="white" className="p-4 sm:p-5">
          <div className="flex items-center justify-between text-[#686C78]">
            <span className="text-xs font-medium">Verified Payments</span>
            <CreditCard className="w-4 h-4" />
          </div>
          <p className="font-display font-mono-tabular text-2xl sm:text-3xl font-extrabold text-[#1A1B20] mt-2">
            ₦{metrics.verifiedRevenueNaira.toLocaleString()}
          </p>
          <p className="text-[11px] text-[#686C78] mt-1 font-mono-tabular">
            {metrics.verifiedPaymentsCount} auto-verified receipts
          </p>
        </SurfaceCard>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <SurfaceCard tone="white" className="lg:col-span-6 p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-lg font-bold text-[#1A1B20]">
                Live User Activity &amp; Sessions
              </h2>
              <p className="text-xs text-[#686C78]">
                Signups, logins, logouts, opened papers, mock exams, and verified payments
              </p>
            </div>
            <Users className="w-4 h-4 text-[#686C78]" />
          </div>

          {recentActivities.length === 0 ? (
            <p className="py-8 text-center text-xs text-[#686C78]">
              No user activity events captured yet.
            </p>
          ) : (
            <div className="divide-y divide-[#1A1B20]/[0.06]">
              {recentActivities.map((act) => (
                <div key={act.id} className="py-3 first:pt-1 last:pb-1 space-y-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold text-[#1A1B20] truncate">
                      {act.userName}
                      {act.matricNumber ? ` · ${act.matricNumber}` : ''}
                      {act.level ? ` (${act.level})` : ''}
                    </p>
                    <span className="text-[11px] font-mono-tabular text-[#686C78] shrink-0">
                      {new Date(act.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#505460]">
                    {act.detail}
                  </p>
                </div>
              ))}
            </div>
          )}
        </SurfaceCard>

        <SurfaceCard tone="white" className="lg:col-span-6 p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-lg font-bold text-[#1A1B20]">
                Recent Administrative Activity
              </h2>
              <p className="text-xs text-[#686C78]">
                Audited actions across accounts, universities, broadcasts, and uploads
              </p>
            </div>
            <Activity className="w-4 h-4 text-[#686C78]" />
          </div>

          {recentLogs.length === 0 ? (
            <p className="py-8 text-center text-xs text-[#686C78]">
              No administrative actions recorded yet in this session.
            </p>
          ) : (
            <div className="divide-y divide-[#1A1B20]/[0.06]">
              {recentLogs.map((log) => (
                <div key={log.id} className="py-3 first:pt-1 last:pb-1 space-y-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold text-[#1A1B20] truncate">
                      {log.summary}
                    </p>
                    <span className="text-[11px] font-mono-tabular text-[#686C78] shrink-0">
                      {new Date(log.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#686C78]">
                    {log.actorName} ({log.actorRole.replace('_', ' ')}) · {log.action.replace(/_/g, ' ')}
                  </p>
                </div>
              ))}
            </div>
          )}
        </SurfaceCard>
      </div>

      <SurfaceCard tone="white" className="p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-[#1A1B20]">
              Dataset &amp; Development Controls
            </h2>
            <p className="text-xs text-[#686C78]">
              Manage starter catalog entries and local development state
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <TactileButton variant="light" size="sm" onClick={handleClearSamples}>
              Clear Starter Samples
            </TactileButton>
            <TactileButton variant="light" size="sm" onClick={handleRestoreSamples}>
              Restore Default Catalog
            </TactileButton>
          </div>
        </div>

        {IS_DEV_BOOTSTRAP_ENV && (
          <div className="pt-4 border-t border-[#1A1B20]/[0.07] space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-bold text-[#1A1B20]">
                  Reset Local Development Data
                </p>
                <p className="text-[11px] text-[#686C78]">
                  Dev-only reset wipes local accounts, bootstrap lock, and uploads.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowDevReset((v) => !v)}
                className="min-h-[36px] px-3 rounded-xl bg-[#FEF2F2] text-[#B91C1C] text-xs font-semibold inline-flex items-center gap-1 cursor-pointer shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{showDevReset ? 'Cancel' : 'Reset Dev'}</span>
              </button>
            </div>

            {showDevReset && (
              <form
                onSubmit={handleDevReset}
                className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/10 p-3.5 space-y-2.5"
              >
                <p className="text-[11px] text-[#505460]">
                  Type <span className="font-mono-tabular font-bold text-[#1A1B20]">RESET DEV DATA</span> to confirm. You will be signed out to re-test bootstrap.
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={devResetPhrase}
                    onChange={(e) => setDevResetPhrase(e.target.value)}
                    placeholder="RESET DEV DATA"
                    className="flex-1 min-h-[38px] rounded-xl bg-white border border-[#1A1B20]/15 px-3 text-xs font-mono-tabular"
                  />
                  <TactileButton type="submit" variant="dark" size="sm">
                    Confirm
                  </TactileButton>
                </div>
              </form>
            )}
          </div>
        )}
      </SurfaceCard>
    </div>
  );
};

