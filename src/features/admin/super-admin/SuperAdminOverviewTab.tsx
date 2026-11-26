import React, { useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Building2,
  ChevronRight,
  CreditCard,
  Eye,
  Inbox,
  Megaphone,
  RotateCcw,
  ShieldAlert,
  Users,
  Wrench,
} from 'lucide-react';
import {
  AUDIT_ACTION_META,
  formatAuditHeadline,
  formatRoleLabel,
  resolveSchoolCode,
} from '../../../core/auditMeta';
import type {
  AuditLogEntry,
  AuthenticatedUser,
  SuperAdminSectionId,
} from '../../../core/types';
import { archiveRepository, type AppStoreState } from '../../../services/archiveRepository';
import { authService, IS_DEV_BOOTSTRAP_ENV } from '../../../services/authService';
import {
  DetailDialog,
  SectionHeadingBar,
  SurfaceCard,
  TactileButton,
} from '../../../components/ui';

interface SuperAdminOverviewTabProps {
  currentUser: AuthenticatedUser;
  store: AppStoreState;
  onNotice: (msg: string) => void;
  onError: (msg: string) => void;
  onSignedOutReset: () => void;
  onNavigateSection?: (section: SuperAdminSectionId) => void;
}

export const SuperAdminOverviewTab: React.FC<SuperAdminOverviewTabProps> = ({
  currentUser,
  store,
  onNotice,
  onError,
  onSignedOutReset,
  onNavigateSection,
}) => {
  const [devResetPhrase, setDevResetPhrase] = useState('');
  const [showDevReset, setShowDevReset] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<AuditLogEntry | null>(null);

  const metrics = useMemo(() => {
    const studentsCount = store.accounts.filter((a) => a.role === 'student').length;
    const schoolAdminsCount = store.accounts.filter((a) => a.role === 'school_admin').length;
    const activeSchools = store.schools.filter((s) => s.isActive).length;
    const loggedInCount = store.accounts.filter((a) => a.sessionState === 'logged_in').length;
    const openTicketsCount = store.supportTickets.filter((t) => t.status === 'new').length;
    const verifiedPayments = store.payments.filter((p) => p.status === 'verified_auto');
    const verifiedRevenueNaira = verifiedPayments.reduce((sum, p) => sum + p.amountNaira, 0);

    return {
      studentsCount,
      schoolAdminsCount,
      totalSchools: store.schools.length,
      activeSchools,
      totalVisits: store.telemetry.totalVisits,
      loggedInCount,
      openTicketsCount,
      totalUploads: store.documents.length + store.materials.length,
      verifiedPaymentsCount: verifiedPayments.length,
      verifiedRevenueNaira,
    };
  }, [
    store.accounts,
    store.schools,
    store.documents,
    store.materials,
    store.payments,
    store.supportTickets,
    store.telemetry,
  ]);

  const latestAudit = store.auditLogs.slice(0, 4);

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

  const selectedMeta = selectedEvent ? AUDIT_ACTION_META[selectedEvent.action] : null;
  const selectedSchoolCode = selectedEvent
    ? resolveSchoolCode(store.schools, selectedEvent.targetId)
    : undefined;

  return (
    <>
      <div className="space-y-6">
        <section
          aria-label="Key platform indicators"
          className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4"
        >
          <SurfaceCard tone="white" className="p-4 sm:p-5">
            <div className="flex items-center justify-between text-[#686C78]">
              <span className="text-xs font-medium">Students &amp; Admins</span>
              <Users className="w-4 h-4" />
            </div>
            <p className="font-display font-mono-tabular text-2xl sm:text-3xl font-extrabold text-[#1A1B20] mt-2">
              {metrics.studentsCount}
            </p>
            <p className="text-[11px] text-[#686C78] mt-1 font-mono-tabular">
              {metrics.schoolAdminsCount} School Admins
            </p>
          </SurfaceCard>

          <SurfaceCard tone="white" className="p-4 sm:p-5">
            <div className="flex items-center justify-between text-[#686C78]">
              <span className="text-xs font-medium">Universities &amp; Uploads</span>
              <Building2 className="w-4 h-4" />
            </div>
            <p className="font-display font-mono-tabular text-2xl sm:text-3xl font-extrabold text-[#1A1B20] mt-2">
              {metrics.activeSchools}/{metrics.totalSchools}
            </p>
            <p className="text-[11px] text-[#686C78] mt-1 font-mono-tabular">
              {metrics.totalUploads} total content items
            </p>
          </SurfaceCard>

          <SurfaceCard tone="white" className="p-4 sm:p-5">
            <div className="flex items-center justify-between text-[#686C78]">
              <span className="text-xs font-medium">Visitors &amp; Active</span>
              <Eye className="w-4 h-4" />
            </div>
            <p className="font-display font-mono-tabular text-2xl sm:text-3xl font-extrabold text-[#1A1B20] mt-2">
              {metrics.totalVisits}
            </p>
            <p className="text-[11px] text-[#686C78] mt-1 font-mono-tabular">
              {metrics.loggedInCount} currently signed in
            </p>
          </SurfaceCard>

          <SurfaceCard tone="white" className="p-4 sm:p-5">
            <div className="flex items-center justify-between text-[#686C78]">
              <span className="text-xs font-medium">Verified Revenue</span>
              <CreditCard className="w-4 h-4" />
            </div>
            <p className="font-display font-mono-tabular text-2xl sm:text-3xl font-extrabold text-[#1A1B20] mt-2">
              ₦{metrics.verifiedRevenueNaira.toLocaleString()}
            </p>
            <p className="text-[11px] text-[#686C78] mt-1 font-mono-tabular">
              {metrics.verifiedPaymentsCount} verified receipts
            </p>
          </SurfaceCard>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <SurfaceCard tone="white" className="lg:col-span-5 p-5 sm:p-6 space-y-4">
            <SectionHeadingBar
              icon={<ShieldAlert className="w-4 h-4" />}
              title="Priority Desks"
            />

            <div className="space-y-2">
              {onNavigateSection && (
                <>
                  <button
                    type="button"
                    onClick={() => onNavigateSection('support_inbox')}
                    className="w-full min-h-[46px] px-3.5 rounded-xl bg-[#F6F7F9] hover:bg-[#ECEEF3] flex items-center justify-between gap-2 text-left cursor-pointer transition-colors"
                  >
                    <span className="flex items-center gap-2.5 text-xs font-semibold text-[#1A1B20]">
                      <Inbox className="w-4 h-4 text-[#1D1E23]" />
                      <span>Customer Support Inbox</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-xs font-mono-tabular font-bold text-[#1A1B20]">
                      {metrics.openTicketsCount} new
                      <ArrowRight className="w-3.5 h-3.5 text-[#686C78]" />
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onNavigateSection('actions')}
                    className="w-full min-h-[46px] px-3.5 rounded-xl bg-[#F6F7F9] hover:bg-[#ECEEF3] flex items-center justify-between gap-2 text-left cursor-pointer transition-colors"
                  >
                    <span className="flex items-center gap-2.5 text-xs font-semibold text-[#1A1B20]">
                      <ShieldAlert className="w-4 h-4 text-[#1D1E23]" />
                      <span>Account Moderation &amp; Warnings</span>
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-[#686C78]" />
                  </button>

                  <button
                    type="button"
                    onClick={() => onNavigateSection('announcements')}
                    className="w-full min-h-[46px] px-3.5 rounded-xl bg-[#F6F7F9] hover:bg-[#ECEEF3] flex items-center justify-between gap-2 text-left cursor-pointer transition-colors"
                  >
                    <span className="flex items-center gap-2.5 text-xs font-semibold text-[#1A1B20]">
                      <Megaphone className="w-4 h-4 text-[#1D1E23]" />
                      <span>Header Marquee &amp; Broadcasts</span>
                    </span>
                    <span className="text-[11px] font-semibold text-[#686C78]">
                      {store.marquee.enabled ? 'Live' : 'Off'}
                    </span>
                  </button>
                </>
              )}
            </div>
          </SurfaceCard>

          <SurfaceCard tone="white" className="lg:col-span-7 p-5 sm:p-6 space-y-4">
            <SectionHeadingBar
              icon={<Activity className="w-4 h-4" />}
              title="Latest Governance Events"
              right={
                onNavigateSection ? (
                  <button
                    type="button"
                    onClick={() => onNavigateSection('activities')}
                    className="text-xs font-semibold text-white/90 hover:text-white underline underline-offset-4 cursor-pointer whitespace-nowrap"
                  >
                    View all
                  </button>
                ) : undefined
              }
            />

            {latestAudit.length === 0 ? (
              <p className="py-6 text-center text-xs text-[#686C78]">
                No governance events yet.
              </p>
            ) : (
              <div className="divide-y divide-[#1A1B20]/[0.06]">
                {latestAudit.map((log) => {
                  const meta = AUDIT_ACTION_META[log.action];
                  const schoolCode = resolveSchoolCode(store.schools, log.targetId);
                  return (
                    <button
                      key={log.id}
                      type="button"
                      onClick={() => setSelectedEvent(log)}
                      className="w-full py-2.5 first:pt-1 last:pb-1 flex items-center justify-between gap-3 text-left hover:bg-[#F6F7F9] rounded-xl px-2 -mx-2 transition-colors cursor-pointer"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-[#1A1B20] truncate">
                          {formatAuditHeadline(log, schoolCode)}
                        </p>
                        <p className="text-[11px] text-[#686C78] truncate">
                          {meta?.label ?? log.action}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[11px] font-mono-tabular text-[#686C78]">
                          {new Date(log.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        <ChevronRight className="w-3.5 h-3.5 text-[#8E93A2]" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </SurfaceCard>
        </div>

        <SurfaceCard tone="white" className="p-5 sm:p-6 space-y-4">
          <SectionHeadingBar
            icon={<Wrench className="w-4 h-4" />}
            title="Dataset &amp; Development Controls"
            right={
              <div className="flex flex-wrap gap-2">
                <TactileButton variant="light" size="sm" onClick={handleClearSamples}>
                  Clear Samples
                </TactileButton>
                <TactileButton variant="light" size="sm" onClick={handleRestoreSamples}>
                  Restore Catalog
                </TactileButton>
              </div>
            }
          />

          {IS_DEV_BOOTSTRAP_ENV && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold text-[#1A1B20]">
                  Reset Local Development Data
                </p>
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
                    Type <span className="font-mono-tabular font-bold text-[#1A1B20]">RESET DEV DATA</span> to confirm.
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

      <DetailDialog
        open={Boolean(selectedEvent)}
        onClose={() => setSelectedEvent(null)}
        title={selectedMeta?.label ?? 'Event Details'}
        subtitle={
          selectedEvent ? new Date(selectedEvent.timestamp).toLocaleString() : undefined
        }
        icon={<Activity className="w-4 h-4" />}
      >
        {selectedEvent && (
          <div className="space-y-3.5">
            <div className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/[0.07] p-4 space-y-1">
              <p className="text-sm font-bold text-[#1A1B20]">
                {formatAuditHeadline(selectedEvent, selectedSchoolCode)}
              </p>
              <p className="text-xs text-[#505460]">{selectedEvent.summary}</p>
            </div>
            {selectedMeta?.whatItDoes && (
              <div className="rounded-2xl bg-white border border-[#1A1B20]/[0.08] p-4 space-y-1">
                <p className="text-xs font-semibold text-[#686C78]">What This Action Does</p>
                <p className="text-sm text-[#1A1B20]">{selectedMeta.whatItDoes}</p>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl bg-[#F6F7F9] p-3">
                <p className="text-[#686C78]">Actor</p>
                <p className="font-bold text-[#1A1B20] mt-0.5">{selectedEvent.actorName}</p>
              </div>
              <div className="rounded-xl bg-[#F6F7F9] p-3">
                <p className="text-[#686C78]">Role</p>
                <p className="font-bold text-[#1A1B20] mt-0.5">
                  {formatRoleLabel(selectedEvent.actorRole)}
                </p>
              </div>
              <div className="rounded-xl bg-[#F6F7F9] p-3 sm:col-span-2">
                <p className="text-[#686C78]">Email</p>
                <p className="font-semibold text-[#1A1B20] mt-0.5 break-all">
                  {selectedEvent.actorEmail}
                </p>
              </div>
            </div>
          </div>
        )}
      </DetailDialog>
    </>
  );
};
