import React, { useMemo, useState } from 'react';
import { Bell, Megaphone, Send, VolumeX } from 'lucide-react';
import type {
  AppNotification,
  AuthenticatedUser,
  BroadcastAudience,
  HeaderMarqueeConfig,
} from '../../../core/types';
import { archiveRepository, type AppStoreState } from '../../../services/archiveRepository';
import { CustomSelect, SurfaceCard, TactileButton } from '../../../components/ui';

interface BroadcastsTabProps {
  currentUser: AuthenticatedUser;
  store: AppStoreState;
  onNotice: (msg: string) => void;
  onError: (msg: string) => void;
}

export const BroadcastsTab: React.FC<BroadcastsTabProps> = ({
  currentUser,
  store,
  onNotice,
  onError,
}) => {
  const [marqueeEnabled, setMarqueeEnabled] = useState(store.marquee.enabled);
  const [marqueeMessage, setMarqueeMessage] = useState(store.marquee.message);
  const [marqueeAudience, setMarqueeAudience] = useState<BroadcastAudience>(
    store.marquee.audience
  );
  const [marqueeTone, setMarqueeTone] = useState<HeaderMarqueeConfig['tone']>(
    store.marquee.tone
  );

  const [notifTitle, setNotifTitle] = useState('');
  const [notifMessage, setNotifMessage] = useState('');
  const [notifCategory, setNotifCategory] = useState<AppNotification['category']>('system');
  const [notifAudience, setNotifAudience] = useState<BroadcastAudience>('all');

  const recentBroadcasts = useMemo(
    () => store.notifications.slice(0, 12),
    [store.notifications]
  );

  const handleSaveMarquee = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const updated = archiveRepository.updateHeaderMarquee(currentUser, {
        enabled: marqueeEnabled,
        message: marqueeMessage,
        audience: marqueeAudience,
        tone: marqueeTone,
      });
      onNotice(
        updated.enabled
          ? `Live header marquee published to ${updated.audience}.`
          : 'Header marquee disabled.'
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unable to update header marquee.');
    }
  };

  const handleDisableMarquee = () => {
    try {
      archiveRepository.updateHeaderMarquee(currentUser, {
        enabled: false,
        message: marqueeMessage,
        audience: marqueeAudience,
        tone: marqueeTone,
      });
      setMarqueeEnabled(false);
      onNotice('Header marquee turned off.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unable to turn off marquee.');
    }
  };

  const handleSendNotification = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = archiveRepository.sendBroadcastNotification(currentUser, {
        title: notifTitle,
        message: notifMessage,
        category: notifCategory,
        audience: notifAudience,
      });
      setNotifTitle('');
      setNotifMessage('');
      onNotice(`Notification "${created.title}" pushed to ${created.audience}.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unable to send notification.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Header Marquee Configurator */}
        <SurfaceCard tone="white" className="lg:col-span-6 p-5 sm:p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold text-[#1A1B20]">
                Header Marquee Ticker
              </h2>
              <p className="text-xs text-[#686C78]">
                Drop a live scrolling header announcement across student website, admin desk, or both.
              </p>
            </div>
            <Megaphone className="w-5 h-5 text-[#1D1E23] shrink-0" />
          </div>

          <form onSubmit={handleSaveMarquee} className="space-y-3.5">
            <label className="flex items-center justify-between gap-3 rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-4 py-3 cursor-pointer">
              <div>
                <p className="text-xs font-bold text-[#1A1B20]">Enable Top Header Marquee</p>
                <p className="text-[11px] text-[#686C78]">
                  Displays at the top of matching interfaces immediately
                </p>
              </div>
              <input
                type="checkbox"
                checked={marqueeEnabled}
                onChange={(e) => setMarqueeEnabled(e.target.checked)}
                className="h-4 w-4 accent-[#1D1E23] cursor-pointer"
              />
            </label>

            <div>
              <label className="block text-xs font-medium text-[#686C78] mb-1">
                Marquee Announcement Text
              </label>
              <textarea
                rows={3}
                value={marqueeMessage}
                onChange={(e) => setMarqueeMessage(e.target.value)}
                placeholder="e.g. Second Semester 2024/2025 past questions uploaded across Science and Arts. Check Notifications for updates."
                className="w-full rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 p-3 text-xs sm:text-sm text-[#1A1B20]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <CustomSelect
                label="Target Interface"
                value={marqueeAudience}
                options={[
                  { value: 'all', label: 'Both Student & Admin' },
                  { value: 'students', label: 'Normal Student Website Only' },
                  { value: 'admins', label: 'Admin Interfaces Only' },
                ]}
                onChange={(v) => setMarqueeAudience(v as BroadcastAudience)}
              />

              <CustomSelect
                label="Banner Tone"
                value={marqueeTone}
                options={[
                  { value: 'neutral', label: 'Standard Dark Ash' },
                  { value: 'important', label: 'Elevated Slate' },
                  { value: 'urgent', label: 'Urgent Red Alert' },
                ]}
                onChange={(v) => setMarqueeTone(v as HeaderMarqueeConfig['tone'])}
              />
            </div>

            {marqueeMessage.trim() && (
              <div
                className={`rounded-xl px-3.5 py-2 text-xs font-medium text-white overflow-hidden ${
                  marqueeTone === 'urgent'
                    ? 'bg-[#7F1D1D]'
                    : marqueeTone === 'important'
                      ? 'bg-[#272930]'
                      : 'bg-[#1D1E23]'
                }`}
              >
                <p className="text-[10px] uppercase tracking-wider text-white/70 mb-0.5">
                  Live Preview ({marqueeAudience})
                </p>
                <p className="truncate">{marqueeMessage.trim()}</p>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <TactileButton type="submit" variant="dark" size="md">
                Save Marquee Banner
              </TactileButton>
              {store.marquee.enabled && (
                <TactileButton
                  type="button"
                  variant="light"
                  size="md"
                  onClick={handleDisableMarquee}
                  icon={<VolumeX className="w-4 h-4" />}
                >
                  Turn Off
                </TactileButton>
              )}
            </div>
          </form>
        </SurfaceCard>

        {/* Normal Notification Broadcaster */}
        <SurfaceCard tone="white" className="lg:col-span-6 p-5 sm:p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold text-[#1A1B20]">
                Send Notification Broadcast
              </h2>
              <p className="text-xs text-[#686C78]">
                Publish notices directly into the Notifications feed on student or admin views.
              </p>
            </div>
            <Bell className="w-5 h-5 text-[#1D1E23] shrink-0" />
          </div>

          <form onSubmit={handleSendNotification} className="space-y-3.5">
            <div>
              <label className="block text-xs font-medium text-[#686C78] mb-1">
                Notification Title
              </label>
              <input
                type="text"
                required
                value={notifTitle}
                onChange={(e) => setNotifTitle(e.target.value)}
                placeholder="e.g. Exam Timetable & PQ Update"
                className="w-full min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs sm:text-sm font-semibold"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#686C78] mb-1">
                Notification Body
              </label>
              <textarea
                rows={3}
                required
                value={notifMessage}
                onChange={(e) => setNotifMessage(e.target.value)}
                placeholder="Write the message students or admins will read in Notifications..."
                className="w-full rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 p-3 text-xs sm:text-sm text-[#1A1B20]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <CustomSelect
                label="Audience"
                value={notifAudience}
                options={[
                  { value: 'all', label: 'Both Student & Admin' },
                  { value: 'students', label: 'Students Only' },
                  { value: 'admins', label: 'Admins Only' },
                ]}
                onChange={(v) => setNotifAudience(v as BroadcastAudience)}
              />

              <CustomSelect
                label="Category"
                value={notifCategory}
                options={[
                  { value: 'system', label: 'System Notice' },
                  { value: 'upload', label: 'Upload Notice' },
                  { value: 'access', label: 'Access & Policy' },
                ]}
                onChange={(v) => setNotifCategory(v as AppNotification['category'])}
              />
            </div>

            <TactileButton
              type="submit"
              variant="dark"
              size="md"
              fullWidth
              icon={<Send className="w-4 h-4" />}
            >
              Publish Notification
            </TactileButton>
          </form>
        </SurfaceCard>
      </div>

      {/* Recent Broadcast Feed */}
      <SurfaceCard tone="white" className="p-5 sm:p-6 space-y-4">
        <div>
          <h2 className="font-display text-lg font-bold text-[#1A1B20]">
            Notification Ledger ({store.notifications.length})
          </h2>
          <p className="text-xs text-[#686C78]">
            Most recent alerts delivered across student and admin notification feeds
          </p>
        </div>

        <div className="divide-y divide-[#1A1B20]/[0.06]">
          {recentBroadcasts.map((item) => (
            <div
              key={item.id}
              className="py-3 first:pt-1 last:pb-1 flex flex-wrap items-start justify-between gap-3"
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-sm font-bold text-[#1A1B20] truncate">
                  {item.title}
                </p>
                <p className="text-xs text-[#505460]">{item.message}</p>
                <p className="text-[11px] text-[#686C78]">
                  Audience: <span className="capitalize font-semibold">{item.audience ?? 'all'}</span> · Category:{' '}
                  <span className="capitalize">{item.category}</span>
                  {item.createdBy ? ` · By ${item.createdBy}` : ''}
                </p>
              </div>
              <span className="text-[11px] font-mono-tabular text-[#686C78] shrink-0">
                {new Date(item.createdAt).toLocaleString([], {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
              </span>
            </div>
          ))}
        </div>
      </SurfaceCard>
    </div>
  );
};
