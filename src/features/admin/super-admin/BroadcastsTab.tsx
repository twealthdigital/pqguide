import React, { useMemo, useState } from 'react';
import { Bell, Megaphone, Send, VolumeX } from 'lucide-react';
import type {
  AppNotification,
  AuthenticatedUser,
  BroadcastAudience,
  HeaderMarqueeConfig,
} from '../../../core/types';
import { archiveRepository, type AppStoreState } from '../../../services/archiveRepository';
import {
  CustomSelect,
  SectionHeadingBar,
  SurfaceCard,
  TactileButton,
} from '../../../components/ui';

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
          ? `Header marquee published to ${updated.audience}.`
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
      onNotice(`Notification "${created.title}" sent.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unable to send notification.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <SurfaceCard tone="white" className="lg:col-span-6 p-5 sm:p-6 space-y-4">
          <SectionHeadingBar icon={<Megaphone className="w-4 h-4" />} title="Header Marquee" />

          <form onSubmit={handleSaveMarquee} className="space-y-3.5">
            <label className="flex items-center justify-between gap-3 rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-4 py-3 cursor-pointer">
              <span className="text-xs font-bold text-[#1A1B20]">Enable Top Header Marquee</span>
              <input
                type="checkbox"
                checked={marqueeEnabled}
                onChange={(e) => setMarqueeEnabled(e.target.checked)}
                className="h-4 w-4 accent-[#1D1E23] cursor-pointer"
              />
            </label>

            <div>
              <label className="block text-xs font-medium text-[#686C78] mb-1">
                Announcement Text
              </label>
              <textarea
                rows={3}
                value={marqueeMessage}
                onChange={(e) => setMarqueeMessage(e.target.value)}
                placeholder="Write top banner message..."
                className="w-full rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 p-3 text-xs sm:text-sm text-[#1A1B20]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <CustomSelect
                label="Audience"
                value={marqueeAudience}
                options={[
                  { value: 'all', label: 'Both Student & Admin' },
                  { value: 'students', label: 'Students Only' },
                  { value: 'admins', label: 'Admins Only' },
                ]}
                onChange={(v) => setMarqueeAudience(v as BroadcastAudience)}
              />

              <CustomSelect
                label="Style"
                value={marqueeTone}
                options={[
                  { value: 'neutral', label: 'Dark Ash' },
                  { value: 'important', label: 'Slate' },
                  { value: 'urgent', label: 'Urgent Red' },
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
                <p className="truncate">{marqueeMessage.trim()}</p>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <TactileButton type="submit" variant="dark" size="md">
                Save Marquee
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

        <SurfaceCard tone="white" className="lg:col-span-6 p-5 sm:p-6 space-y-4">
          <SectionHeadingBar icon={<Bell className="w-4 h-4" />} title="Send Notification" />

          <form onSubmit={handleSendNotification} className="space-y-3.5">
            <div>
              <label className="block text-xs font-medium text-[#686C78] mb-1">Title</label>
              <input
                type="text"
                required
                value={notifTitle}
                onChange={(e) => setNotifTitle(e.target.value)}
                placeholder="Notification title"
                className="w-full min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs sm:text-sm font-semibold"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#686C78] mb-1">Message</label>
              <textarea
                rows={3}
                required
                value={notifMessage}
                onChange={(e) => setNotifMessage(e.target.value)}
                placeholder="Write notification message..."
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
              Send Notification
            </TactileButton>
          </form>
        </SurfaceCard>
      </div>

      <SurfaceCard tone="white" className="p-5 sm:p-6 space-y-4">
        <SectionHeadingBar
          icon={<Bell className="w-4 h-4" />}
          title={`Sent Notifications (${store.notifications.length})`}
        />

        <div className="divide-y divide-[#1A1B20]/[0.06]">
          {recentBroadcasts.map((item) => (
            <div
              key={item.id}
              className="py-3 first:pt-1 last:pb-1 flex flex-wrap items-start justify-between gap-3"
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-sm font-bold text-[#1A1B20] truncate">{item.title}</p>
                <p className="text-xs text-[#505460]">{item.message}</p>
                <p className="text-[11px] text-[#686C78]">
                  <span className="capitalize font-semibold">{item.audience ?? 'all'}</span> ·{' '}
                  <span className="capitalize">{item.category}</span>
                  {item.createdBy ? ` · ${item.createdBy}` : ''}
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
