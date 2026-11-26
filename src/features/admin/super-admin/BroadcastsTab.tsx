import React, { useMemo, useState } from 'react';
import {
  Bell,
  CheckCircle2,
  Edit3,
  Megaphone,
  Send,
  ShieldCheck,
  VolumeX,
  XCircle,
} from 'lucide-react';
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

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editMessage, setEditMessage] = useState('');
  const [editCategory, setEditCategory] = useState<AppNotification['category']>('system');
  const [editAudience, setEditAudience] = useState<BroadcastAudience>('all');
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const pendingSubmissions = useMemo(
    () =>
      store.notifications.filter((n) => n.approvalStatus === 'pending_verification'),
    [store.notifications]
  );

  const sentNotifications = useMemo(
    () =>
      store.notifications.filter(
        (n) => (n.approvalStatus ?? 'approved') !== 'pending_verification'
      ),
    [store.notifications]
  );

  const recentBroadcasts = useMemo(
    () => sentNotifications.slice(0, 14),
    [sentNotifications]
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

  const handleApproveSubmission = (item: AppNotification) => {
    try {
      const approved = archiveRepository.verifySchoolAdminNotification(
        currentUser,
        item.id,
        'approve'
      );
      setEditingId((prev) => (prev === item.id ? null : prev));
      setRejectingId((prev) => (prev === item.id ? null : prev));
      onNotice(
        `Verified and published "${approved.title}"${approved.schoolCode ? ` (${approved.schoolCode})` : ''} to student website.`
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unable to approve notification.');
    }
  };

  const handleRejectSubmission = (item: AppNotification) => {
    try {
      archiveRepository.verifySchoolAdminNotification(
        currentUser,
        item.id,
        'reject',
        rejectNote.trim() || undefined
      );
      setRejectingId(null);
      setRejectNote('');
      onNotice(`Declined notification "${item.title}".`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unable to decline notification.');
    }
  };

  const startEditNotification = (item: AppNotification) => {
    setEditingId(item.id);
    setEditTitle(item.title);
    setEditMessage(item.message);
    setEditCategory(item.category);
    setEditAudience(item.audience ?? 'all');
  };

  const handleSaveUpdate = (e: React.FormEvent, alsoApprove = false) => {
    e.preventDefault();
    if (!editingId) return;
    try {
      const updated = archiveRepository.updateNotification(currentUser, editingId, {
        title: editTitle,
        message: editMessage,
        category: editCategory,
        audience: editAudience,
      });
      if (alsoApprove && updated.approvalStatus === 'pending_verification') {
        archiveRepository.verifySchoolAdminNotification(currentUser, editingId, 'approve');
        onNotice(`Updated and verified "${updated.title}" live on student website.`);
      } else {
        onNotice(`Updated notification "${updated.title}".`);
      }
      setEditingId(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unable to update notification.');
    }
  };

  return (
    <div className="space-y-6">
      <SurfaceCard tone="white" className="p-5 sm:p-6 space-y-4">
        <SectionHeadingBar
          icon={<ShieldCheck className="w-4 h-4" />}
          title={`Pending School Admin Notifications (${pendingSubmissions.length})`}
          right={
            <span className="font-mono-tabular text-xs font-semibold text-[#C3C7D2]">
              Verification Gate
            </span>
          }
        />

        {pendingSubmissions.length === 0 ? (
          <p className="py-4 text-xs text-[#686C78]">
            No School Admin student notifications are waiting for verification right now.
          </p>
        ) : (
          <div className="divide-y divide-[#1A1B20]/[0.06]">
            {pendingSubmissions.map((item) => {
              const isEditingThis = editingId === item.id;
              const isRejectingThis = rejectingId === item.id;
              return (
                <div key={item.id} className="py-3.5 first:pt-1 last:pb-1 space-y-3">
                  {isEditingThis ? (
                    <form
                      onSubmit={(e) => handleSaveUpdate(e, true)}
                      className="space-y-2.5 rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/10 p-3.5"
                    >
                      <input
                        type="text"
                        required
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        placeholder="Notification title"
                        className="w-full min-h-[40px] rounded-xl bg-white border border-[#1A1B20]/10 px-3 text-xs sm:text-sm font-semibold"
                      />
                      <textarea
                        rows={2}
                        required
                        value={editMessage}
                        onChange={(e) => setEditMessage(e.target.value)}
                        placeholder="Notification message"
                        className="w-full rounded-xl bg-white border border-[#1A1B20]/10 p-3 text-xs sm:text-sm text-[#1A1B20]"
                      />
                      <div className="flex flex-wrap justify-end gap-2">
                        <TactileButton
                          type="button"
                          variant="light"
                          size="sm"
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </TactileButton>
                        <TactileButton type="submit" variant="dark" size="sm">
                          Save & Verify Live
                        </TactileButton>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-bold text-[#1A1B20]">{item.title}</p>
                            <span className="rounded-lg bg-[#FEF3C7] text-[#92400E] px-2 py-0.5 text-[11px] font-semibold">
                              Pending Verification
                            </span>
                          </div>
                          <p className="text-xs sm:text-sm text-[#505460]">{item.message}</p>
                          <p className="text-[11px] text-[#686C78]">
                            From{' '}
                            <span className="font-semibold text-[#1A1B20]">
                              {item.submittedByName ?? item.createdBy ?? 'School Admin'}
                            </span>
                            {item.schoolCode ? ` · ${item.schoolCode}` : ''} · Students Website ·{' '}
                            {new Date(item.createdAt).toLocaleString('en-NG', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <TactileButton
                            type="button"
                            variant="dark"
                            size="sm"
                            icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                            onClick={() => handleApproveSubmission(item)}
                          >
                            Verify & Publish
                          </TactileButton>
                          <TactileButton
                            type="button"
                            variant="light"
                            size="sm"
                            icon={<Edit3 className="w-3.5 h-3.5" />}
                            onClick={() => startEditNotification(item)}
                          >
                            Edit
                          </TactileButton>
                          <button
                            type="button"
                            onClick={() => {
                              setRejectingId(isRejectingThis ? null : item.id);
                              setRejectNote('');
                            }}
                            className="min-h-[36px] px-3 rounded-xl bg-[#FEF2F2] hover:bg-[#FEE2E2] text-xs font-semibold text-[#B91C1C] inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Decline</span>
                          </button>
                        </div>
                      </div>

                      {isRejectingThis && (
                        <div className="rounded-xl bg-[#FEF2F2] border border-[#FECACA] p-3 flex flex-col sm:flex-row gap-2">
                          <input
                            type="text"
                            value={rejectNote}
                            onChange={(e) => setRejectNote(e.target.value)}
                            placeholder="Optional note for School Admin..."
                            className="flex-1 min-h-[38px] rounded-lg bg-white border border-[#FCA5A5] px-3 text-xs text-[#1A1B20]"
                          />
                          <div className="flex gap-2 justify-end">
                            <button
                              type="button"
                              onClick={() => setRejectingId(null)}
                              className="min-h-[38px] px-3 rounded-lg bg-white text-xs font-semibold text-[#505460] cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRejectSubmission(item)}
                              className="min-h-[38px] px-3 rounded-lg bg-[#B91C1C] text-white text-xs font-semibold cursor-pointer"
                            >
                              Confirm Decline
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SurfaceCard>

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
          title={`Sent Notifications (${sentNotifications.length})`}
        />

        <div className="divide-y divide-[#1A1B20]/[0.06]">
          {recentBroadcasts.map((item) => {
            const isEditingThis = editingId === item.id;
            return (
              <div key={item.id} className="py-3 first:pt-1 last:pb-1 space-y-2.5">
                {isEditingThis ? (
                  <form
                    onSubmit={(e) => handleSaveUpdate(e, false)}
                    className="space-y-2.5 rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/10 p-3.5"
                  >
                    <input
                      type="text"
                      required
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      placeholder="Notification title"
                      className="w-full min-h-[40px] rounded-xl bg-white border border-[#1A1B20]/10 px-3 text-xs sm:text-sm font-semibold"
                    />
                    <textarea
                      rows={2}
                      required
                      value={editMessage}
                      onChange={(e) => setEditMessage(e.target.value)}
                      placeholder="Notification message"
                      className="w-full rounded-xl bg-white border border-[#1A1B20]/10 p-3 text-xs sm:text-sm text-[#1A1B20]"
                    />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <CustomSelect
                        label="Audience"
                        size="sm"
                        value={editAudience}
                        options={[
                          { value: 'all', label: 'Both Student & Admin' },
                          { value: 'students', label: 'Students Only' },
                          { value: 'admins', label: 'Admins Only' },
                        ]}
                        onChange={(v) => setEditAudience(v as BroadcastAudience)}
                      />
                      <CustomSelect
                        label="Category"
                        size="sm"
                        value={editCategory}
                        options={[
                          { value: 'system', label: 'System Notice' },
                          { value: 'upload', label: 'Upload Notice' },
                          { value: 'access', label: 'Access & Policy' },
                        ]}
                        onChange={(v) => setEditCategory(v as AppNotification['category'])}
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <TactileButton
                        type="button"
                        variant="light"
                        size="sm"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </TactileButton>
                      <TactileButton type="submit" variant="dark" size="sm">
                        Save & Update Live
                      </TactileButton>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-bold text-[#1A1B20] truncate">{item.title}</p>
                        {item.approvalStatus === 'rejected' && (
                          <span className="rounded-lg bg-[#FEE2E2] text-[#B91C1C] px-2 py-0.5 text-[10px] font-semibold">
                            Declined
                          </span>
                        )}
                        {item.updatedAt && (
                          <span className="rounded-lg bg-[#EEF0F4] text-[#505460] px-2 py-0.5 text-[10px] font-semibold">
                            Updated
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#505460]">{item.message}</p>
                      <p className="text-[11px] text-[#686C78]">
                        <span className="capitalize font-semibold">{item.audience ?? 'all'}</span> ·{' '}
                        <span className="capitalize">{item.category}</span>
                        {item.schoolCode ? ` · ${item.schoolCode}` : ''}
                        {item.createdBy ? ` · ${item.createdBy}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] font-mono-tabular text-[#686C78]">
                        {new Date(item.updatedAt ?? item.createdAt).toLocaleString([], {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </span>
                      {item.approvalStatus !== 'rejected' && (
                        <button
                          type="button"
                          onClick={() => startEditNotification(item)}
                          className="h-8 px-2.5 rounded-lg bg-[#F6F7F9] hover:bg-[#ECEEF3] border border-[#1A1B20]/10 text-xs font-semibold text-[#1A1B20] inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>Update</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </SurfaceCard>
    </div>
  );
};
