import React, { useMemo, useState } from 'react';
import { ArrowLeft, Bell, CheckCheck, FileText } from 'lucide-react';
import type {
  AppNotification,
  PastQuestionDoc,
  WorkspaceViewMode,
} from '../core/types';
import { useArchiveStore } from '../hooks/useArchiveStore';
import { archiveRepository } from '../services/archiveRepository';
import { SurfaceCard } from '../components/ui/SurfaceCard';
import { TactileButton } from '../components/ui/TactileButton';
import { DarkHeaderCard } from '../components/ui/DarkHeaderCard';

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
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [openedId, setOpenedId] = useState<string | null>(null);

  const scopedNotifications = useMemo(
    () => archiveRepository.getNotificationsForWorkspace(workspaceMode, userId),
    [store.notifications, workspaceMode, userId]
  );

  const unreadCount = useMemo(
    () => scopedNotifications.filter((n) => !n.isRead).length,
    [scopedNotifications]
  );

  const visibleNotifications = useMemo(
    () =>
      filter === 'unread'
        ? scopedNotifications.filter((n) => !n.isRead)
        : scopedNotifications,
    [scopedNotifications, filter]
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
              onClick={() =>
                archiveRepository.markAllNotificationsReadForWorkspace(workspaceMode, userId)
              }
            >
              Mark all read
            </TactileButton>
          )}
        </div>

        <h1 className="mt-3.5 font-display text-xl sm:text-2xl font-bold leading-snug">
          Notifications
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
      {visibleNotifications.length === 0 ? (
        <SurfaceCard tone="white" className="text-center py-12">
          <div className="h-12 w-12 rounded-2xl bg-[#F2F4F7] text-[#686C78] flex items-center justify-center mx-auto mb-3">
            <Bell className="w-5 h-5" />
          </div>
          <p className="font-display text-base font-bold text-[#1A1B20]">
            You are all caught up
          </p>
          <p className="text-xs text-[#686C78] mt-1">
            New past question uploads, system notices, and direct replies appear here.
          </p>
        </SurfaceCard>
      ) : (
        <div className="space-y-3">
          {visibleNotifications.map((notif) => (
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
    </div>
  );
};
