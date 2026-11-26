import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart2,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock3,
  CreditCard,
  Eye,
  Users,
  XCircle,
} from 'lucide-react';
import type { PaymentTransaction, SuperAdminSectionId } from '../../../core/types';
import type { AppStoreState } from '../../../services/archiveRepository';
import {
  CustomCalendar,
  TooltipBubble,
  parseDateKey,
  toLocalDateKey,
  type CalendarDayStat,
} from '../../../components/ui';
import { OverviewPerformanceChart } from './OverviewPerformanceChart';

interface SuperAdminOverviewTabProps {
  store: AppStoreState;
  onNavigateSection?: (section: SuperAdminSectionId) => void;
}

interface RollingWindowSummary {
  id: '24h' | '7d' | '30d' | '1y';
  label: string;
  totalRevenueNaira: number;
  totalTransactions: number;
  successCount: number;
  successNaira: number;
  pendingCount: number;
  pendingNaira: number;
  failedCount: number;
  failedNaira: number;
}

const WINDOW_DEFS: Array<{
  id: RollingWindowSummary['id'];
  label: string;
  durationMs: number;
}> = [
  { id: '24h', label: 'Last 24 Hours', durationMs: 24 * 60 * 60 * 1000 },
  { id: '7d', label: 'Last 7 Days', durationMs: 7 * 24 * 60 * 60 * 1000 },
  { id: '30d', label: 'Last 30 Days', durationMs: 30 * 24 * 60 * 60 * 1000 },
  { id: '1y', label: 'Last 1 Year', durationMs: 365 * 24 * 60 * 60 * 1000 },
];

function getTxTimestampMs(tx: PaymentTransaction): number {
  const iso = tx.verifiedAt ?? tx.createdAt;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

export const SuperAdminOverviewTab: React.FC<SuperAdminOverviewTabProps> = ({
  store,
  onNavigateSection,
}) => {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const todayDateKey = useMemo(() => toLocalDateKey(new Date(nowMs)), [nowMs]);
  const [selectedDateKey, setSelectedDateKey] = useState<string>(() =>
    toLocalDateKey(new Date())
  );

  // Keep rolling window timestamps & "today" live as time advances or payments arrive
  useEffect(() => {
    setNowMs(Date.now());
  }, [store.payments.length]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const metrics = useMemo(() => {
    const studentsCount = store.accounts.filter((a) => a.role === 'student').length;
    const schoolAdminsCount = store.accounts.filter(
      (a) => a.role === 'school_admin'
    ).length;
    const activeSchools = store.schools.filter((s) => s.isActive).length;
    const loggedInCount = store.accounts.filter(
      (a) => a.sessionState === 'logged_in'
    ).length;
    const verifiedPayments = store.payments.filter(
      (p) => p.status === 'verified_auto'
    );
    const verifiedRevenueNaira = verifiedPayments.reduce(
      (sum, p) => sum + p.amountNaira,
      0
    );

    return {
      studentsCount,
      schoolAdminsCount,
      totalSchools: store.schools.length,
      activeSchools,
      totalVisits: store.telemetry.totalVisits,
      loggedInCount,
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
    store.telemetry,
  ]);

  const rollingWindows = useMemo<RollingWindowSummary[]>(() => {
    return WINDOW_DEFS.map((def) => {
      const cutoff = nowMs - def.durationMs;
      let successCount = 0;
      let successNaira = 0;
      let pendingCount = 0;
      let pendingNaira = 0;
      let failedCount = 0;
      let failedNaira = 0;

      for (const tx of store.payments) {
        const ts = getTxTimestampMs(tx);
        if (ts < cutoff || ts > nowMs) continue;
        if (tx.status === 'verified_auto') {
          successCount += 1;
          successNaira += tx.amountNaira;
        } else if (tx.status === 'pending') {
          pendingCount += 1;
          pendingNaira += tx.amountNaira;
        } else {
          failedCount += 1;
          failedNaira += tx.amountNaira;
        }
      }

      return {
        id: def.id,
        label: def.label,
        totalRevenueNaira: successNaira,
        totalTransactions: successCount + pendingCount + failedCount,
        successCount,
        successNaira,
        pendingCount,
        pendingNaira,
        failedCount,
        failedNaira,
      };
    });
  }, [store.payments, nowMs]);

  const calendarStats = useMemo<Record<string, CalendarDayStat>>(() => {
    const map: Record<string, CalendarDayStat> = {};
    for (const tx of store.payments) {
      const dt = new Date(tx.verifiedAt ?? tx.createdAt);
      if (Number.isNaN(dt.getTime())) continue;
      const key = toLocalDateKey(dt);
      if (!map[key]) {
        map[key] = {
          successCount: 0,
          pendingCount: 0,
          failedCount: 0,
          totalAmount: 0,
        };
      }
      if (tx.status === 'verified_auto') {
        map[key].successCount += 1;
        map[key].totalAmount += tx.amountNaira;
      } else if (tx.status === 'pending') {
        map[key].pendingCount += 1;
      } else {
        map[key].failedCount += 1;
      }
    }
    return map;
  }, [store.payments]);

  const selectedDayDetails = useMemo(() => {
    const items = store.payments.filter((tx) => {
      const dt = new Date(tx.verifiedAt ?? tx.createdAt);
      if (Number.isNaN(dt.getTime())) return false;
      return toLocalDateKey(dt) === selectedDateKey;
    });

    let successCount = 0;
    let successNaira = 0;
    let pendingCount = 0;
    let pendingNaira = 0;
    let failedCount = 0;
    let failedNaira = 0;

    for (const tx of items) {
      if (tx.status === 'verified_auto') {
        successCount += 1;
        successNaira += tx.amountNaira;
      } else if (tx.status === 'pending') {
        pendingCount += 1;
        pendingNaira += tx.amountNaira;
      } else {
        failedCount += 1;
        failedNaira += tx.amountNaira;
      }
    }

    return {
      items,
      successCount,
      successNaira,
      pendingCount,
      pendingNaira,
      failedCount,
      failedNaira,
    };
  }, [store.payments, selectedDateKey]);

  const formattedSelectedDate = useMemo(() => {
    return parseDateKey(selectedDateKey).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }, [selectedDateKey]);

  const isViewingToday = selectedDateKey === todayDateKey;

  return (
    <div className="space-y-6">
      {/* 1. Dark Rounded Container — 4 Key Platform Overview Cards */}
      <section
        aria-label="Key platform indicators"
        className="rounded-3xl bg-[#1D1E23] p-4 sm:p-6 space-y-4 shadow-[0_14px_34px_-14px_rgba(20,21,28,0.45)]"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2.5">
            <span className="h-8 w-8 rounded-xl bg-white/10 text-white flex items-center justify-center shrink-0">
              <Users className="w-4 h-4" />
            </span>
            <div>
              <h2 className="font-display text-sm sm:text-base font-bold text-white">
                Platform Overview
              </h2>
              <p className="text-[11px] text-[#A5AAB8]">
                Accounts, institutions, live sessions, and verified revenue
              </p>
            </div>
          </div>
          <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-[#4ADE80]">
            Live
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4">
          <div className="rounded-2xl bg-white p-4 sm:p-5 space-y-1.5">
            <div className="flex items-center justify-between text-[#686C78]">
              <span className="text-xs font-medium">Students &amp; Admins</span>
              <Users className="w-4 h-4" />
            </div>
            <p className="font-display font-mono-tabular text-2xl sm:text-3xl font-extrabold text-[#1A1B20]">
              {metrics.studentsCount}
            </p>
            <p className="text-xs text-[#686C78] font-mono-tabular">
              {metrics.schoolAdminsCount} School Admins
            </p>
          </div>

          <div className="rounded-2xl bg-white p-4 sm:p-5 space-y-1.5">
            <div className="flex items-center justify-between text-[#686C78]">
              <span className="text-xs font-medium">Universities &amp; Uploads</span>
              <Building2 className="w-4 h-4" />
            </div>
            <p className="font-display font-mono-tabular text-2xl sm:text-3xl font-extrabold text-[#1A1B20]">
              {metrics.activeSchools}/{metrics.totalSchools}
            </p>
            <p className="text-xs text-[#686C78] font-mono-tabular">
              {metrics.totalUploads} total content items
            </p>
          </div>

          <div className="rounded-2xl bg-white p-4 sm:p-5 space-y-1.5">
            <div className="flex items-center justify-between text-[#686C78]">
              <span className="text-xs font-medium">Visitors &amp; Active</span>
              <Eye className="w-4 h-4" />
            </div>
            <p className="font-display font-mono-tabular text-2xl sm:text-3xl font-extrabold text-[#1A1B20]">
              {metrics.totalVisits}
            </p>
            <p className="text-xs text-[#686C78] font-mono-tabular">
              {metrics.loggedInCount} currently signed in
            </p>
          </div>

          <div className="rounded-2xl bg-white p-4 sm:p-5 space-y-1.5">
            <div className="flex items-center justify-between text-[#686C78]">
              <span className="text-xs font-medium">Verified Revenue</span>
              <CreditCard className="w-4 h-4" />
            </div>
            <p className="font-display font-mono-tabular text-2xl sm:text-3xl font-extrabold text-[#1A1B20]">
              ₦{metrics.verifiedRevenueNaira.toLocaleString()}
            </p>
            <p className="text-xs text-[#686C78] font-mono-tabular">
              {metrics.verifiedPaymentsCount} verified receipts
            </p>
          </div>
        </div>
      </section>

      {/* 2. Dark Rounded Container — Rolling Live Payment Windows */}
      <section
        aria-label="Rolling payment windows"
        className="rounded-3xl bg-[#1D1E23] p-4 sm:p-6 space-y-4 shadow-[0_14px_34px_-14px_rgba(20,21,28,0.45)]"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <div className="flex items-center gap-2.5">
            <span className="h-8 w-8 rounded-xl bg-white/10 text-white flex items-center justify-center shrink-0">
              <CreditCard className="w-4 h-4" />
            </span>
            <div>
              <h2 className="font-display text-sm sm:text-base font-bold text-white">
                Payment Windows
              </h2>
              <p className="text-[11px] text-[#A5AAB8]">
                Live rolling totals across 24 hours, 7 days, month, and year
              </p>
            </div>
          </div>

          {onNavigateSection && (
            <TooltipBubble label="Open full Payment Verifications ledger">
              <button
                type="button"
                onClick={() => onNavigateSection('payments')}
                className="min-h-[34px] px-3 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white inline-flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <span>View Payments</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </TooltipBubble>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4">
          {rollingWindows.map((win) => (
            <div key={win.id} className="rounded-2xl bg-white p-4 sm:p-5 space-y-3">
              <div>
                <p className="text-xs font-semibold text-[#686C78]">{win.label}</p>
                <p className="font-display font-mono-tabular text-xl sm:text-2xl font-extrabold text-[#1A1B20] mt-1">
                  ₦{win.totalRevenueNaira.toLocaleString()}
                </p>
                <p className="text-[11px] font-mono-tabular text-[#686C78]">
                  {win.totalTransactions} total attempts
                </p>
              </div>

              <div className="space-y-1.5 pt-2 border-t border-[#1A1B20]/[0.07] text-xs font-mono-tabular">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[#15803D] font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Successful</span>
                  </span>
                  <span className="font-bold text-[#1A1B20]">
                    {win.successCount} · ₦{win.successNaira.toLocaleString()}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[#D97706] font-semibold">
                    <Clock3 className="w-3.5 h-3.5" />
                    <span>Pending</span>
                  </span>
                  <span className="font-bold text-[#1A1B20]">
                    {win.pendingCount} · ₦{win.pendingNaira.toLocaleString()}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[#B91C1C] font-semibold">
                    <XCircle className="w-3.5 h-3.5" />
                    <span>Declined</span>
                  </span>
                  <span className="font-bold text-[#1A1B20]">
                    {win.failedCount} · ₦{win.failedNaira.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 3. Dark Rounded Container — Custom Calendar & Daily Payment Breakdown */}
      <section
        aria-label="Daily payment status calendar"
        className="rounded-3xl bg-[#1D1E23] p-4 sm:p-6 space-y-4 shadow-[0_14px_34px_-14px_rgba(20,21,28,0.45)]"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <div className="flex items-center gap-2.5">
            <span className="h-8 w-8 rounded-xl bg-white/10 text-white flex items-center justify-center shrink-0">
              <CalendarDays className="w-4 h-4" />
            </span>
            <div>
              <h2 className="font-display text-sm sm:text-base font-bold text-white">
                Daily Payment Calendar
              </h2>
              <p className="text-[11px] text-[#A5AAB8]">
                Pick any date to check Successful, Pending, and Declined records
              </p>
            </div>
          </div>

          {!isViewingToday && (
            <button
              type="button"
              onClick={() => setSelectedDateKey(todayDateKey)}
              className="min-h-[34px] px-3 rounded-xl bg-white text-[#1A1B20] hover:bg-[#F3F4F6] text-xs font-bold cursor-pointer transition-colors"
            >
              Return to Today
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          <div className="lg:col-span-5">
            <CustomCalendar
              selectedDateKey={selectedDateKey}
              todayDateKey={todayDateKey}
              onSelectDate={setSelectedDateKey}
              dayStats={calendarStats}
            />
          </div>

          <div className="lg:col-span-7 rounded-2xl bg-white p-4 sm:p-5 space-y-4">
            {!isViewingToday ? (
              <div
                role="status"
                className="rounded-xl bg-[#FEF3C7] border border-[#F59E0B]/40 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2 text-xs font-semibold text-[#92400E]">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-[#D97706]" />
                  <span>
                    Viewing {formattedSelectedDate} — These payment records are not today&apos;s.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedDateKey(todayDateKey)}
                  className="text-xs font-bold text-[#92400E] underline underline-offset-4 hover:text-[#78350F] cursor-pointer"
                >
                  Jump to Today
                </button>
              </div>
            ) : (
              <div className="rounded-xl bg-[#F0FDF4] border border-[#BBF7D0] px-3.5 py-2 flex items-center justify-between gap-2 text-xs font-semibold text-[#15803D]">
                <span>Today&apos;s Payment Records</span>
                <span className="font-mono-tabular">{formattedSelectedDate}</span>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2.5">
              <div className="rounded-xl bg-[#F6F7F9] p-3 space-y-0.5">
                <p className="text-[11px] font-semibold text-[#15803D]">Successful</p>
                <p className="font-display font-mono-tabular text-lg font-extrabold text-[#1A1B20]">
                  {selectedDayDetails.successCount}
                </p>
                <p className="text-[11px] font-mono-tabular text-[#686C78]">
                  ₦{selectedDayDetails.successNaira.toLocaleString()}
                </p>
              </div>

              <div className="rounded-xl bg-[#F6F7F9] p-3 space-y-0.5">
                <p className="text-[11px] font-semibold text-[#D97706]">Pending</p>
                <p className="font-display font-mono-tabular text-lg font-extrabold text-[#1A1B20]">
                  {selectedDayDetails.pendingCount}
                </p>
                <p className="text-[11px] font-mono-tabular text-[#686C78]">
                  ₦{selectedDayDetails.pendingNaira.toLocaleString()}
                </p>
              </div>

              <div className="rounded-xl bg-[#F6F7F9] p-3 space-y-0.5">
                <p className="text-[11px] font-semibold text-[#B91C1C]">Declined</p>
                <p className="font-display font-mono-tabular text-lg font-extrabold text-[#1A1B20]">
                  {selectedDayDetails.failedCount}
                </p>
                <p className="text-[11px] font-mono-tabular text-[#686C78]">
                  ₦{selectedDayDetails.failedNaira.toLocaleString()}
                </p>
              </div>
            </div>

            {selectedDayDetails.items.length === 0 ? (
              <p className="py-6 text-center text-xs text-[#686C78]">
                No payment transactions recorded on {formattedSelectedDate}.
              </p>
            ) : (
              <div className="divide-y divide-[#1A1B20]/[0.06] max-h-[250px] overflow-y-auto pr-1">
                {selectedDayDetails.items.map((tx) => {
                  const statusMeta =
                    tx.status === 'verified_auto'
                      ? { label: 'Successful', cls: 'bg-[#DCFCE7] text-[#15803D]' }
                      : tx.status === 'pending'
                        ? { label: 'Pending', cls: 'bg-[#FEF3C7] text-[#B45309]' }
                        : { label: 'Declined', cls: 'bg-[#FEE2E2] text-[#B91C1C]' };

                  return (
                    <div
                      key={tx.id}
                      className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-xs font-bold text-[#1A1B20] truncate">
                            {tx.userName}
                          </p>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusMeta.cls}`}
                          >
                            {statusMeta.label}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#686C78] truncate">
                          {tx.tierName} · {tx.provider === 'paystack' ? 'Paystack' : 'Flutterwave'} · {tx.reference}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-mono-tabular font-extrabold text-[#1A1B20]">
                          ₦{tx.amountNaira.toLocaleString()}
                        </p>
                        <p className="text-[10px] font-mono-tabular text-[#686C78]">
                          {new Date(tx.verifiedAt ?? tx.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 4. Dark Rounded Container — Performance Data Analytics (Bar & Line Charts) */}
      <section
        aria-label="Platform performance analytics charts"
        className="rounded-3xl bg-[#1D1E23] p-4 sm:p-6 space-y-4 shadow-[0_14px_34px_-14px_rgba(20,21,28,0.45)]"
      >
        <div className="flex items-center gap-2.5 px-1">
          <span className="h-8 w-8 rounded-xl bg-white/10 text-white flex items-center justify-center shrink-0">
            <BarChart2 className="w-4 h-4" />
          </span>
          <div>
            <h2 className="font-display text-sm sm:text-base font-bold text-white">
              Performance Analytics
            </h2>
            <p className="text-[11px] text-[#A5AAB8]">
              Switch between Bar &amp; Line charts across 7 days, Month (30 days), and Year
            </p>
          </div>
        </div>

        <OverviewPerformanceChart store={store} />
      </section>
    </div>
  );
};
