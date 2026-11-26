import React, { useMemo, useState } from 'react';
import { Eye, LogIn, LogOut, Users } from 'lucide-react';
import type { AppStoreState } from '../../../services/archiveRepository';
import { SurfaceCard } from '../../../components/ui';
import { AuditLogsTab } from './AuditLogsTab';

interface ActivitiesTabProps {
  store: AppStoreState;
}

export const ActivitiesTab: React.FC<ActivitiesTabProps> = ({ store }) => {
  const [roleFilter, setRoleFilter] = useState<'all' | 'student' | 'school_admin'>('all');

  const stats = useMemo(() => {
    const loggedIn = store.accounts.filter((a) => a.sessionState === 'logged_in');
    const loggedOut = store.accounts.filter((a) => a.sessionState !== 'logged_in');
    return {
      totalVisits: store.telemetry.totalVisits,
      uniqueVisitors: store.telemetry.uniqueVisitorIds.length,
      lastVisitAt: store.telemetry.lastVisitAt,
      loggedIn,
      loggedOut,
      loggedInStudents: loggedIn.filter((a) => a.role === 'student').length,
      loggedInAdmins: loggedIn.filter((a) => a.role !== 'student').length,
    };
  }, [store.accounts, store.telemetry]);

  const filteredActivities = useMemo(() => {
    return store.userActivities.filter((ev) => {
      if (roleFilter === 'student') return ev.userRole === 'student';
      if (roleFilter === 'school_admin') return ev.userRole !== 'student';
      return true;
    });
  }, [store.userActivities, roleFilter]);

  return (
    <div className="space-y-6">
      {/* Visitors & Session Telemetry Cards */}
      <section
        aria-label="Website visitors and active sessions"
        className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 sm:gap-4"
      >
        <SurfaceCard tone="white" className="p-4 sm:p-5">
          <div className="flex items-center justify-between text-[#686C78]">
            <span className="text-xs font-medium">Website Visitors</span>
            <Eye className="w-4 h-4" />
          </div>
          <p className="font-display font-mono-tabular text-2xl sm:text-3xl font-extrabold text-[#1A1B20] mt-2">
            {stats.totalVisits}
          </p>
          <p className="text-[11px] text-[#686C78] mt-1 font-mono-tabular">
            {stats.uniqueVisitors} unique visitor browsers
          </p>
        </SurfaceCard>

        <SurfaceCard tone="white" className="p-4 sm:p-5">
          <div className="flex items-center justify-between text-[#15803D]">
            <span className="text-xs font-medium text-[#686C78]">Logged-In Accounts</span>
            <LogIn className="w-4 h-4" />
          </div>
          <p className="font-display font-mono-tabular text-2xl sm:text-3xl font-extrabold text-[#1A1B20] mt-2">
            {stats.loggedIn.length}
          </p>
          <p className="text-[11px] text-[#686C78] mt-1 font-mono-tabular">
            {stats.loggedInStudents} Students · {stats.loggedInAdmins} Admins
          </p>
        </SurfaceCard>

        <SurfaceCard tone="white" className="p-4 sm:p-5">
          <div className="flex items-center justify-between text-[#686C78]">
            <span className="text-xs font-medium">Logged-Out Accounts</span>
            <LogOut className="w-4 h-4" />
          </div>
          <p className="font-display font-mono-tabular text-2xl sm:text-3xl font-extrabold text-[#1A1B20] mt-2">
            {stats.loggedOut.length}
          </p>
          <p className="text-[11px] text-[#686C78] mt-1">
            {stats.lastVisitAt
              ? `Last visit ${new Date(stats.lastVisitAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}`
              : 'Currently inactive or signed out'}
          </p>
        </SurfaceCard>
      </section>

      {/* Active Sessions Breakdown + Live Activity Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <SurfaceCard tone="white" className="lg:col-span-5 p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-base font-bold text-[#1A1B20]">
                Signed-In &amp; Signed-Out Roster
              </h2>
              <p className="text-xs text-[#686C78]">
                Every registered student and admin login status
              </p>
            </div>
            <Users className="w-4 h-4 text-[#686C78]" />
          </div>

          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
            {store.accounts.length === 0 ? (
              <p className="py-6 text-center text-xs text-[#686C78]">
                No accounts recorded yet.
              </p>
            ) : (
              store.accounts.map((acc) => {
                const online = acc.sessionState === 'logged_in';
                return (
                  <div
                    key={acc.id}
                    className="rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/[0.06] px-3.5 py-2.5 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[#1A1B20] truncate">
                        {acc.fullName}
                        {acc.matricNumber ? ` · ${acc.matricNumber}` : ''}
                        {acc.level ? ` (${acc.level})` : ''}
                      </p>
                      <p className="text-[11px] text-[#686C78] truncate">
                        {acc.role.replace('_', ' ')} · {acc.email}
                      </p>
                    </div>
                    <span
                      className={`text-[11px] font-mono-tabular font-semibold shrink-0 ${
                        online ? 'text-[#15803D]' : 'text-[#686C78]'
                      }`}
                    >
                      {online ? 'Online' : 'Offline'}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </SurfaceCard>

        <SurfaceCard tone="white" className="lg:col-span-7 p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-bold text-[#1A1B20]">
                Live Student &amp; Visitor Activity ({filteredActivities.length})
              </h2>
              <p className="text-xs text-[#686C78]">
                Signups, logins, opened papers, study materials, practice exams, and verified payments
              </p>
            </div>
            <div className="flex gap-1">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'student', label: 'Students' },
                  { id: 'school_admin', label: 'Admins' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setRoleFilter(tab.id)}
                  className={`min-h-[34px] px-2.5 rounded-xl text-xs font-semibold cursor-pointer ${
                    roleFilter === tab.id
                      ? 'bg-[#1D1E23] text-white'
                      : 'bg-[#F6F7F9] text-[#505460]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {filteredActivities.length === 0 ? (
            <p className="py-8 text-center text-xs text-[#686C78]">
              No matching user activity events recorded yet.
            </p>
          ) : (
            <div className="divide-y divide-[#1A1B20]/[0.06] max-h-80 overflow-y-auto pr-1">
              {filteredActivities.slice(0, 40).map((act) => (
                <div key={act.id} className="py-2.5 first:pt-1 last:pb-1 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-[#1A1B20] truncate">
                      {act.userName}
                      {act.matricNumber ? ` · ${act.matricNumber}` : ''}
                      {act.level ? ` (${act.level})` : ''}
                    </p>
                    <p className="text-xs text-[#505460]">{act.detail}</p>
                  </div>
                  <span className="text-[11px] font-mono-tabular text-[#686C78] shrink-0">
                    {new Date(act.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SurfaceCard>
      </div>

      {/* Full Administrative Audit Trail */}
      <AuditLogsTab store={store} />
    </div>
  );
};
