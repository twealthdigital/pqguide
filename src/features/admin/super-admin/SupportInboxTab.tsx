import React, { useMemo, useState } from 'react';
import { CheckCircle2, Inbox, Send } from 'lucide-react';
import type { AuthenticatedUser, SupportTicket } from '../../../core/types';
import { archiveRepository, type AppStoreState } from '../../../services/archiveRepository';
import { SurfaceCard, TactileButton } from '../../../components/ui';

interface SupportInboxTabProps {
  currentUser: AuthenticatedUser;
  store: AppStoreState;
  onNotice: (msg: string) => void;
  onError: (msg: string) => void;
}

export const SupportInboxTab: React.FC<SupportInboxTabProps> = ({
  currentUser,
  store,
  onNotice,
  onError,
}) => {
  const [statusFilter, setStatusFilter] = useState<'all' | SupportTicket['status']>('all');
  const [replyingTicketId, setReplyingTicketId] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});

  const filteredTickets = useMemo(() => {
    return store.supportTickets.filter((t) =>
      statusFilter === 'all' ? true : t.status === statusFilter
    );
  }, [store.supportTickets, statusFilter]);

  const counts = useMemo(
    () => ({
      new: store.supportTickets.filter((t) => t.status === 'new').length,
      reviewed: store.supportTickets.filter((t) => t.status === 'reviewed').length,
      resolved: store.supportTickets.filter((t) => t.status === 'resolved').length,
    }),
    [store.supportTickets]
  );

  const handleReplySubmit = (ticket: SupportTicket, e: React.FormEvent) => {
    e.preventDefault();
    const text = (replyDrafts[ticket.id] ?? '').trim();
    if (!text) {
      onError('Write a response message first.');
      return;
    }

    try {
      archiveRepository.replyToSupportTicket(currentUser, ticket.id, text, 'resolved');
      setReplyDrafts((prev) => ({ ...prev, [ticket.id]: '' }));
      setReplyingTicketId(null);
      onNotice(
        ticket.senderUserId
          ? `Sent response to ${ticket.senderName} and marked ticket resolved.`
          : `Saved response for ${ticket.senderName} and marked ticket resolved.`
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unable to send support reply.');
    }
  };

  const handleStatusChange = (ticketId: string, status: SupportTicket['status']) => {
    try {
      archiveRepository.setSupportTicketStatus(currentUser, ticketId, status);
      onNotice(`Support ticket marked as ${status}.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unable to update status.');
    }
  };

  return (
    <SurfaceCard tone="white" className="p-5 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Inbox className="w-5 h-5 text-[#1D1E23]" />
          <div>
            <h2 className="font-display text-lg font-bold text-[#1A1B20]">
              Customer Support Inbox ({store.supportTickets.length})
            </h2>
            <p className="text-xs text-[#686C78]">
              Messages sent from Customer Support arrive here with sender details and direct notification reply
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { id: 'all', label: `All (${store.supportTickets.length})` },
              { id: 'new', label: `New (${counts.new})` },
              { id: 'reviewed', label: `Reviewed (${counts.reviewed})` },
              { id: 'resolved', label: `Resolved (${counts.resolved})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`min-h-[36px] px-3 rounded-xl text-xs font-semibold cursor-pointer transition-colors ${
                statusFilter === tab.id
                  ? 'bg-[#1D1E23] text-white'
                  : 'bg-[#F6F7F9] text-[#505460] hover:bg-[#ECEEF3]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {filteredTickets.length === 0 ? (
        <div className="py-12 text-center space-y-1">
          <p className="text-sm font-semibold text-[#1A1B20]">
            No customer support messages in this view
          </p>
          <p className="text-xs text-[#686C78]">
            Any feedback, missing paper request, or issue sent on the Customer Support page appears here immediately.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTickets.map((ticket) => {
            const isReplying = replyingTicketId === ticket.id;
            return (
              <div
                key={ticket.id}
                className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/[0.07] p-4 space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#1A1B20]">
                      {ticket.senderName}
                      {ticket.senderMatric ? ` · ${ticket.senderMatric}` : ''}
                      {ticket.senderLevel ? ` (${ticket.senderLevel})` : ''}
                    </p>
                    <p className="text-[11px] text-[#686C78]">
                      {ticket.kind} · {ticket.senderRole.replace('_', ' ')} · {ticket.senderEmail}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[11px] font-mono-tabular font-semibold uppercase ${
                        ticket.status === 'resolved'
                          ? 'text-[#15803D]'
                          : ticket.status === 'reviewed'
                            ? 'text-[#1D1E23]'
                            : 'text-[#B91C1C]'
                      }`}
                    >
                      {ticket.status}
                    </span>
                    <span className="text-[11px] font-mono-tabular text-[#686C78]">
                      {new Date(ticket.createdAt).toLocaleString([], {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </span>
                  </div>
                </div>

                <p className="text-xs sm:text-sm text-[#1A1B20] bg-white rounded-xl border border-[#1A1B20]/[0.06] p-3 leading-relaxed">
                  {ticket.message}
                </p>

                {ticket.adminReply && (
                  <div className="rounded-xl bg-[#F0FDF4] border border-[#BBF7D0] px-3.5 py-2.5 text-xs text-[#14532D] space-y-1">
                    <p className="font-bold flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#15803D]" />
                      <span>Response by {ticket.repliedBy ?? 'Super Admin'}</span>
                    </p>
                    <p>{ticket.adminReply}</p>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setReplyingTicketId((prev) => (prev === ticket.id ? null : ticket.id))
                      }
                      className="min-h-[36px] px-3 rounded-xl bg-[#1D1E23] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>{ticket.adminReply ? 'Update Reply' : 'Reply & Resolve'}</span>
                    </button>

                    {ticket.status === 'new' && (
                      <button
                        type="button"
                        onClick={() => handleStatusChange(ticket.id, 'reviewed')}
                        className="min-h-[36px] px-3 rounded-xl bg-white border border-[#1A1B20]/10 text-xs font-semibold text-[#1A1B20] cursor-pointer"
                      >
                        Mark Reviewed
                      </button>
                    )}

                    {ticket.status !== 'resolved' && (
                      <button
                        type="button"
                        onClick={() => handleStatusChange(ticket.id, 'resolved')}
                        className="min-h-[36px] px-3 rounded-xl bg-white border border-[#1A1B20]/10 text-xs font-semibold text-[#15803D] cursor-pointer"
                      >
                        Mark Resolved
                      </button>
                    )}
                  </div>
                </div>

                {isReplying && (
                  <form
                    onSubmit={(e) => handleReplySubmit(ticket, e)}
                    className="pt-2 border-t border-[#1A1B20]/[0.07] space-y-2.5"
                  >
                    <textarea
                      rows={3}
                      required
                      value={replyDrafts[ticket.id] ?? ''}
                      onChange={(e) =>
                        setReplyDrafts((prev) => ({ ...prev, [ticket.id]: e.target.value }))
                      }
                      placeholder={
                        ticket.senderUserId
                          ? 'Write your reply (automatically sent to this user Notifications screen)...'
                          : 'Write your reply note for this guest ticket...'
                      }
                      className="w-full rounded-xl bg-white border border-[#1A1B20]/12 p-3 text-xs resize-none"
                    />
                    <div className="flex justify-end gap-2">
                      <TactileButton
                        type="button"
                        variant="light"
                        size="sm"
                        onClick={() => setReplyingTicketId(null)}
                      >
                        Cancel
                      </TactileButton>
                      <TactileButton type="submit" variant="dark" size="sm">
                        Send Response
                      </TactileButton>
                    </div>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SurfaceCard>
  );
};
