import React, { useMemo, useState } from 'react';
import { ArrowLeft, Bell, CheckCheck, FileText } from 'lucide-react';
import type { AppNotification, PastQuestionDoc } from '../core/types';
import { useArchiveStore } from '../hooks/useArchiveStore';
import { archiveRepository } from '../services/archiveRepository';
import { SurfaceCard } from '../components/ui/SurfaceCard';
import { TactileButton } from '../components/ui/TactileButton';

interface NotificationsScreenProps {
  onBack: () => void;
  onOpenDocument: (doc: PastQuestionDoc) => void;
}

export const NotificationsScreen: React.FC<NotificationsScreenProps> = ({
  onBack,
  onOpenDocument,
}) => {
  const store = useArchiveStore();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const unreadCount = useMemo(
    () => store.notifications.filter((n) => !n.isRead).length,
    [store.notifications]
  );

  const visibleNotifications = useMemo(
    () =>
      filter === 'unread'
        ? store.notifications.filter((n) => !n.isRead)
        : store.notifications,
    [store.notifications, filter]
  );

  const handleOpenNotification = (notif: AppNotification) => {
    archiveRepository.markNotificationRead(notif.id);
    if (notif.targetDocId) {
      const targetDoc = store.documents.find((d) => d.id === notif.targetDocId);
      if (targetDoc) {
        onOpenDocument(targetDoc);
      }
    }
  };

  return (
    <div className="space-y-6 page-enter">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <TactileButton
            variant="light"
            size="sm"
            icon={<ArrowLeft className="w-4 h-4" />}
            onClick={onBack}
          >
            Back
          </TactileButton>
          <div>
            <h1 className="font-display text-2xl font-bold text-[#1A1B20]">
              Notifications
            </h1>
            <p className="text-xs text-[#686C78] font-mono-tabular">
              {unreadCount} unread update{unreadCount === 1 ? '' : 's'}
            </p>
          </div>
        </div>

        {unreadCount > 0 && (
          <TactileButton
            variant="dark"
            size="sm"
            icon={<CheckCheck className="w-4 h-4" />}
            onClick={() => archiveRepository.markAllNotificationsRead()}
          >
            Mark All Read
          </TactileButton>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#EAECEF]">
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={`min-h-[38px] px-4 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
            filter === 'all'
              ? 'bg-white text-[#1A1B20] shadow-sm'
              : 'text-[#686C78]'
          }`}
        >
          All Alerts ({store.notifications.length})
        </button>
        <button
          type="button"
          onClick={() => setFilter('unread')}
          className={`min-h-[38px] px-4 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
            filter === 'unread'
              ? 'bg-white text-[#1A1B20] shadow-sm'
              : 'text-[#686C78]'
          }`}
        >
          Unread ({unreadCount})
        </button>
      </div>

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
            New archive uploads and study material updates appear here.
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
              }`}
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
                  <div className="flex items-center gap-2">
                    <h2 className="font-display text-sm sm:text-base font-bold text-[#1A1B20]">
                      {notif.title}
                    </h2>
                    {!notif.isRead && (
                      <span className="text-[11px] font-semibold text-[#1D1E23]">
                        · New
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
                    })}{' '}
                    · {notif.category}
                  </p>
                </div>
              </div>

              {notif.targetDocId && (
                <span className="text-xs font-semibold text-[#1A1B20] underline underline-offset-4 shrink-0">
                  Open paper
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
