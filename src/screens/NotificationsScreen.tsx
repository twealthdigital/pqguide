import React, { useMemo, useState } from 'react';
import { ArrowLeft, Bell, CheckCheck, ChevronRight, FileText, ShieldCheck } from 'lucide-react';
import type {
  AppNotification,
  PastQuestionDoc,
  SuperAdminNotification,
  WorkspaceViewMode,
} from '../core/types';
import { useArchiveStore } from '../hooks/useArchiveStore';
import { archiveRepository } from '../services/archiveRepository';
import { SurfaceCard } from '../components/ui/SurfaceCard';
import { TactileButton } from '../components/ui/TactileButton';
import { DarkHeaderCard } from '../components/ui/DarkHeaderCard';
import { DetailDialog } from '../components/ui/DetailDialog';

interface NotificationsScreenProps {
  workspaceMode?: WorkspaceViewMode;
  userId?: string;
  restrictedAdminView?: boolean;
  onBack: () => void;
  onOpenDocument: (doc: PastQuestionDoc) => void;
}

export const NotificationsScreen: React.FC<NotificationsScreenProps> = ({
  workspaceMode = 'student',
  userId,
  restrictedAdminView = false,
  onBack,
  onOpenDocument,
}) => {
  const store = useArchiveStore();
  const notifCms = store.siteCms.notificationsPage;
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [selectedGovernanceNotif, setSelectedGovernanceNotif] =
    useState<SuperAdminNotification | null>(null);

  const isSuperAdminFeed = workspaceMode === 'super_admin';

  const scopedNotifications = useMemo(
    () =>
      isSuperAdminFeed
        ? []
        : archiveRepository.getNotificationsForWorkspace(workspaceMode, userId),
    [isSuperAdminFeed, store.notifications, workspaceMode, userId]
  );

  const governanceNotifications = useMemo(
    () =>
      isSuperAdminFeed
        ? archiveRepository.getSuperAdminGovernanceNotifications()
        : [],
    [
      isSuperAdminFeed,
      store.auditLogs,
      store.userActivities,
      store.supportTickets,
      store.documents,
      store.readSuperAdminNotifIds,
    ]
  );

  const unreadCount = useMemo(
    () =>
      isSuperAdminFeed
        ? governanceNotifications.filter((n) => !n.isRead).length
        : scopedNotifications.filter((n) => !n.isRead).length,
    [isSuperAdminFeed, governanceNotifications, scopedNotifications]
  );

  const visibleStandard = useMemo(
    () =>
      filter === 'unread'
        ? scopedNotifications.filter((n) => !n.isRead)
        : scopedNotifications,
    [scopedNotifications, filter]
  );

  const visibleGovernance = useMemo(
    () =>
      filter === 'unread'
        ? governanceNotifications.filter((n) => !n.isRead)
        : governanceNotifications,
    [governanceNotifications, filter]
  );

  const handleOpenNotification = (notif: AppNotification) => {
    setFilter('all');
    setOpenedId(notif.id);
    archiveRepository.markNotificationRead(notif.id);
    if (!restrictedAdminView && notif.targetDocId) {
      const targetDoc = store.documents.find((d) => d.id === notif.targetDocId);
      if (targetDoc) {
        onOpenDocument(targetDoc);
      }
    }
  };

  const handleOpenGovernanceNotification = (item: SuperAdminNotification) => {
    setOpenedId(item.id);
    archiveRepository.markSuperAdminNotificationRead(item.id);
    setSelectedGovernanceNotif({ ...item, isRead: true });
  };

  const isEmpty = isSuperAdminFeed
    ? visibleGovernance.length === 0
    : visibleStandard.length === 0;

  return (
    <div className="space-y-5 page-enter">
      {/* Dark header: back + mark all read, title, filter */}
      <DarkHeaderCard>
        <div className="flex items-center justify-between gap-3">
          <TactileButton
            variant="light"
            size="sm"
            icon={<ArrowLeft className="w-4 h-4" />}
            onClick={onBack}
          >
            Back
          </TactileButton>

          {unreadCount > 0 && (
            <TactileButton
              variant="light"
              size="sm"
              icon={<CheckCheck className="w-4 h-4" />}
              onClick={() => {
                if (isSuperAdminFeed) {
                  archiveRepository.markAllSuperAdminNotificationsRead();
                } else {
                  archiveRepository.markAllNotificationsReadForWorkspace(workspaceMode, userId);
                }
              }}
            >
              Mark all read
            </TactileButton>
          )}
        </div>

        <h1 className="mt-3.5 font-display text-[32px] sm:text-[40px] font-extrabold tracking-tight leading-[1.1]">
          {isSuperAdminFeed ? 'Platform Activity Alerts' : notifCms.heading}
        </h1>

        <div className="mt-3.5 grid grid-cols-2 gap-1 rounded-xl bg-white/10 p-1">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`min-h-[38px] rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
              filter === 'all' ? 'bg-white text-[#1A1B20]' : 'text-[#C3C7D2]'
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setFilter('unread')}
            className={`min-h-[38px] rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
              filter === 'unread' ? 'bg-white text-[#1A1B20]' : 'text-[#C3C7D2]'
            }`}
          >
            Unread{unreadCount > 0 ? ` (${unreadCount})` : ''}
          </button>
        </div>
      </DarkHeaderCard>

      {/* Notifications List */}
      {isEmpty ? (
        <SurfaceCard tone="white" className="text-center py-12">
          <div className="h-12 w-12 rounded-2xl bg-[#F2F4F7] text-[#686C78] flex items-center justify-center mx-auto mb-3">
            <Bell className="w-5 h-5" />
          </div>
          <p className="font-display text-base font-bold text-[#1A1B20]">
            {notifCms.emptyTitle}
          </p>
          <p className="text-xs text-[#686C78] mt-1">
            {isSuperAdminFeed
              ? 'Admin actions, university updates, uploads, signups, and support messages show here.'
              : notifCms.emptyBody}
          </p>
        </SurfaceCard>
      ) : isSuperAdminFeed ? (
        <div className="space-y-2.5">
          {visibleGovernance.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleOpenGovernanceNotification(item)}
              className={`w-full text-left rounded-2xl p-4 sm:p-5 border transition-colors cursor-pointer flex items-center justify-between gap-4 ${
                item.isRead
                  ? 'bg-white border-[#1A1B20]/[0.06] hover:bg-[#FAFAFC]'
                  : 'bg-white border-[#1D1E23]/25 shadow-[0_6px_18px_-8px_rgba(24,25,30,0.14)]'
              } ${openedId === item.id ? 'ring-2 ring-[#1D1E23]/20' : ''}`}
            >
              <div className="flex items-start gap-3.5 min-w-0 flex-1">
                <div
                  className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
                    item.isRead
                      ? 'bg-[#F2F4F7] text-[#686C78]'
                      : 'bg-[#1D1E23] text-white'
                  }`}
                >
                  <ShieldCheck className="w-4 h-4" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h2 className="font-display text-sm sm:text-base font-bold text-[#1A1B20]">
                      {item.title}
                    </h2>
                    {!item.isRead && (
                      <span className="font-mono-tabular text-[11px] font-semibold text-[#1D1E23]">
                        · New
                      </span>
                    )}
                  </div>
                  <p className="text-xs sm:text-sm text-[#505460] mt-0.5 line-clamp-2">
                    {item.message}
                  </p>
                  <p className="text-[11px] text-[#686C78] mt-1.5 font-mono-tabular">
                    {item.categoryLabel}
                    {item.schoolCode ? ` · ${item.schoolCode}` : ''} ·{' '}
                    {new Date(item.createdAt).toLocaleString('en-NG', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>

              <ChevronRight className="w-4 h-4 text-[#8E93A2] shrink-0" />
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {visibleStandard.map((notif) => (
            <button
              key={notif.id}
              type="button"
              onClick={() => handleOpenNotification(notif)}
              className={`w-full text-left rounded-2xl p-4 sm:p-5 border transition-colors cursor-pointer flex items-start justify-between gap-4 ${
                notif.isRead
                  ? 'bg-white border-[#1A1B20]/[0.06]'
                  : 'bg-white border-[#1D1E23]/25 shadow-[0_6px_18px_-8px_rgba(24,25,30,0.14)]'
              } ${openedId === notif.id ? 'ring-2 ring-[#1D1E23]/20' : ''}`}
            >
              <div className="flex items-start gap-3.5 min-w-0">
                <div
                  className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
                    notif.isRead
                      ? 'bg-[#F2F4F7] text-[#686C78]'
                      : 'bg-[#1D1E23] text-white'
                  }`}
                >
                  {notif.targetDocId ? (
                    <FileText className="w-4 h-4" />
                  ) : (
                    <Bell className="w-4 h-4" />
                  )}
                </div>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h2 className="font-display text-sm sm:text-base font-bold text-[#1A1B20]">
                      {notif.title}
                    </h2>
                    {!notif.isRead && (
                      <span className="font-mono-tabular text-[11px] font-semibold text-[#1D1E23]">
                        · Unread
                      </span>
                    )}
                    {notif.updatedAt && (
                      <span className="font-mono-tabular text-[11px] font-medium text-[#505460]">
                        · Updated
                      </span>
                    )}
                    {notif.targetUserId && (
                      <span className="font-mono-tabular text-[11px] font-medium text-[#505460]">
                        · Direct message
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-[#505460] mt-1 leading-relaxed">
                    {notif.message}
                  </p>
                  <p className="text-xs text-[#8E93A2] mt-2 font-mono-tabular">
                    {new Date(notif.createdAt).toLocaleDateString('en-NG', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <DetailDialog
        open={Boolean(selectedGovernanceNotif)}
        onClose={() => setSelectedGovernanceNotif(null)}
        title={selectedGovernanceNotif?.title ?? 'Platform Activity'}
        subtitle={selectedGovernanceNotif?.categoryLabel}
        icon={<ShieldCheck className="w-4 h-4" />}
      >
        {selectedGovernanceNotif && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/[0.07] p-4 space-y-1.5">
              <p className="text-xs font-semibold text-[#686C78]">Summary</p>
              <p className="text-sm font-semibold text-[#1A1B20]">
                {selectedGovernanceNotif.message}
              </p>
              {selectedGovernanceNotif.detail !== selectedGovernanceNotif.message && (
                <p className="text-xs text-[#505460] pt-1">
                  {selectedGovernanceNotif.detail}
                </p>
              )}
            </div>

            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl bg-[#F6F7F9] p-3">
                <dt className="text-[#686C78]">Performed By</dt>
                <dd className="font-bold text-[#1A1B20] mt-0.5">
                  {selectedGovernanceNotif.actorName}
                </dd>
              </div>
              <div className="rounded-xl bg-[#F6F7F9] p-3">
                <dt className="text-[#686C78]">Role</dt>
                <dd className="font-bold text-[#1A1B20] mt-0.5">
                  {selectedGovernanceNotif.actorRoleLabel}
                  {selectedGovernanceNotif.schoolCode
                    ? ` · ${selectedGovernanceNotif.schoolCode}`
                    : ''}
                </dd>
              </div>
              <div className="rounded-xl bg-[#F6F7F9] p-3 sm:col-span-2">
                <dt className="text-[#686C78]">Recorded At</dt>
                <dd className="font-mono-tabular font-semibold text-[#1A1B20] mt-0.5">
                  {new Date(selectedGovernanceNotif.createdAt).toLocaleString('en-NG', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </DetailDialog>
    </div>
  );
};
