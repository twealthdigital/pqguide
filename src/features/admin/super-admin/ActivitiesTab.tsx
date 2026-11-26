import React, { useMemo, useState } from 'react';
import { Activity, ChevronRight, Eye, LogIn, LogOut, Users } from 'lucide-react';
import type { UserActivityEvent } from '../../../core/types';
import type { AppStoreState } from '../../../services/archiveRepository';
import { DetailDialog, SectionHeadingBar, SurfaceCard } from '../../../components/ui';
import { AuditLogsTab } from './AuditLogsTab';

interface ActivitiesTabProps {
  store: AppStoreState;
}

export const ActivitiesTab: React.FC<ActivitiesTabProps> = ({ store }) => {
  const [roleFilter, setRoleFilter] = useState<'all' | 'student' | 'school_admin'>('all');
  const [selectedActivity, setSelectedActivity] = useState<UserActivityEvent | null>(null);

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
    <>
      <div className="space-y-6">
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
              {stats.uniqueVisitors} unique visitors
            </p>
          </SurfaceCard>

          <SurfaceCard tone="white" className="p-4 sm:p-5">
            <div className="flex items-center justify-between text-[#15803D]">
              <span className="text-xs font-medium text-[#686C78]">Signed-In Accounts</span>
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
              <span className="text-xs font-medium">Signed-Out Accounts</span>
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
                : 'No recent visits'}
            </p>
          </SurfaceCard>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <SurfaceCard tone="white" className="lg:col-span-5 p-5 sm:p-6 space-y-4">
            <SectionHeadingBar
              icon={<Users className="w-4 h-4" />}
              title="Signed-In & Signed-Out Roster"
            />

            <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
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
            <SectionHeadingBar
              icon={<Activity className="w-4 h-4" />}
              title={`Live Activity (${filteredActivities.length})`}
              right={
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
                      className={`min-h-[30px] px-2.5 rounded-lg text-[11px] font-semibold cursor-pointer transition-colors ${
                        roleFilter === tab.id
                          ? 'bg-white text-[#1D1E23]'
                          : 'bg-white/10 text-white/85 hover:bg-white/20'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              }
            />

            {filteredActivities.length === 0 ? (
              <p className="py-8 text-center text-xs text-[#686C78]">
                No user activity recorded yet.
              </p>
            ) : (
              <div className="divide-y divide-[#1A1B20]/[0.06] max-h-80 overflow-y-auto pr-1">
                {filteredActivities.slice(0, 40).map((act) => (
                  <button
                    key={act.id}
                    type="button"
                    onClick={() => setSelectedActivity(act)}
                    className="w-full py-2.5 first:pt-1 last:pb-1 flex items-center justify-between gap-3 text-left hover:bg-[#F6F7F9] rounded-xl px-2 -mx-2 transition-colors cursor-pointer"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[#1A1B20] truncate">
                        {act.userName}
                        {act.matricNumber ? ` · ${act.matricNumber}` : ''}
                        {act.level ? ` (${act.level})` : ''}
                      </p>
                      <p className="text-xs text-[#505460] truncate">{act.detail}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[11px] font-mono-tabular text-[#686C78]">
                        {new Date(act.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-[#8E93A2]" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </SurfaceCard>
        </div>

        <AuditLogsTab store={store} />
      </div>

      <DetailDialog
        open={Boolean(selectedActivity)}
        onClose={() => setSelectedActivity(null)}
        title={selectedActivity ? selectedActivity.userName : 'User Activity'}
        subtitle={
          selectedActivity
            ? new Date(selectedActivity.timestamp).toLocaleString()
            : undefined
        }
        icon={<Activity className="w-4 h-4" />}
      >
        {selectedActivity && (
          <div className="space-y-3.5">
            <div className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/[0.07] p-4 space-y-1">
              <p className="text-xs font-semibold text-[#686C78]">Activity Detail</p>
              <p className="text-sm font-bold text-[#1A1B20]">{selectedActivity.detail}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl bg-[#F6F7F9] p-3">
                <p className="text-[#686C78]">User</p>
                <p className="font-bold text-[#1A1B20] mt-0.5">
                  {selectedActivity.userName}
                  {selectedActivity.level ? ` · ${selectedActivity.level}` : ''}
                </p>
              </div>
              <div className="rounded-xl bg-[#F6F7F9] p-3">
                <p className="text-[#686C78]">Matric / Role</p>
                <p className="font-semibold text-[#1A1B20] mt-0.5 capitalize">
                  {selectedActivity.matricNumber || selectedActivity.userRole.replace('_', ' ')}
                </p>
              </div>
              <div className="rounded-xl bg-[#F6F7F9] p-3 sm:col-span-2">
                <p className="text-[#686C78]">Email</p>
                <p className="font-semibold text-[#1A1B20] mt-0.5 break-all">
                  {selectedActivity.userEmail}
                </p>
              </div>
            </div>
          </div>
        )}
      </DetailDialog>
    </>
  );
};
