import React, { useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import type { AuditLogEntry } from '../../../core/types';
import { type AppStoreState } from '../../../services/archiveRepository';
import { SurfaceCard } from '../../../components/ui';

interface AuditLogsTabProps {
  store: AppStoreState;
}

type AuditCategoryFilter =
  | 'all'
  | 'account'
  | 'school'
  | 'past_question'
  | 'study_material'
  | 'payment'
  | 'broadcast'
  | 'system';

const ACTION_LABELS: Record<AuditLogEntry['action'], string> = {
  super_admin_bootstrapped: 'Super Admin Initialized',
  admin_created: 'School Admin Created',
  admin_invited: 'School Admin Email Access Granted',
  admin_updated: 'School Admin Updated',
  admin_verified: 'Admin Login Verification Updated',
  admin_university_changed: 'Admin University Changed',
  admin_suspended: 'Admin Suspended',
  admin_reactivated: 'Admin Reactivated',
  admin_revoked: 'Admin Access Revoked',
  account_verified: 'Student Verification Updated',
  account_suspended: 'Account Suspended',
  account_reactivated: 'Account Reactivated',
  role_changed: 'Role Changed',
  university_created: 'University Added',
  university_updated: 'University Updated',
  university_status_changed: 'University Status Changed',
  pq_uploaded: 'Past Question Draft Uploaded',
  pq_updated: 'Past Question Updated',
  pq_published: 'Past Question Published',
  pq_unpublished: 'Past Question Unpublished',
  pq_deleted: 'Past Question Deleted',
  material_uploaded: 'Study Material Draft Saved',
  material_updated: 'Study Material Updated',
  material_published: 'Study Material Published',
  material_unpublished: 'Study Material Unpublished',
  material_deleted: 'Study Material Deleted',
  broadcast_sent: 'Notification Broadcast Sent',
  marquee_updated: 'Header Marquee Updated',
  payment_verified: 'Automatic Payment Verified',
  dev_data_reset: 'Dev Data Reset',
};

export const AuditLogsTab: React.FC<AuditLogsTabProps> = ({ store }) => {
  const [category, setCategory] = useState<AuditCategoryFilter>('all');
  const [query, setQuery] = useState('');

  const filteredLogs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return store.auditLogs.filter((entry) => {
      if (category !== 'all' && entry.targetType !== category) return false;
      if (!q) return true;
      return (
        entry.summary.toLowerCase().includes(q) ||
        entry.actorName.toLowerCase().includes(q) ||
        entry.actorEmail.toLowerCase().includes(q) ||
        ACTION_LABELS[entry.action].toLowerCase().includes(q)
      );
    });
  }, [store.auditLogs, category, query]);

  const categories: Array<{ id: AuditCategoryFilter; label: string }> = [
    { id: 'all', label: 'All Events' },
    { id: 'account', label: 'Admins & Accounts' },
    { id: 'school', label: 'Universities' },
    { id: 'past_question', label: 'Past Questions' },
    { id: 'study_material', label: 'Study Materials' },
    { id: 'payment', label: 'Payments' },
    { id: 'broadcast', label: 'Broadcasts' },
    { id: 'system', label: 'System' },
  ];

  return (
    <SurfaceCard tone="white" className="p-5 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Activity className="w-5 h-5 text-[#1D1E23]" />
          <div>
            <h2 className="font-display text-lg font-bold text-[#1A1B20]">
              Administrative Activity Logs
            </h2>
            <p className="text-xs text-[#686C78]">
              Records admin creations, suspensions, role/university updates, uploads, publications, and deletions
            </p>
          </div>
        </div>

        <span className="font-mono-tabular text-xs font-semibold text-[#686C78]">
          {filteredLogs.length} events
        </span>
      </div>

      <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setCategory(cat.id)}
              className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                category === cat.id
                  ? 'bg-[#1D1E23] text-white'
                  : 'bg-[#F6F7F9] text-[#505460] hover:bg-[#ECEEF3]'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search actor or summary..."
          className="w-full md:w-64 min-h-[40px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-medium"
        />
      </div>

      {filteredLogs.length === 0 ? (
        <div className="py-10 text-center space-y-1">
          <p className="text-sm font-semibold text-[#1A1B20]">
            No administrative activity matches this filter
          </p>
          <p className="text-xs text-[#686C78]">
            Actions performed across accounts, universities, past questions, and study materials appear here automatically.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[#1A1B20]/[0.06]">
          {filteredLogs.map((entry) => (
            <div
              key={entry.id}
              className="py-3.5 first:pt-1 last:pb-1 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
            >
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-bold text-[#1A1B20]">{entry.summary}</p>
                <p className="text-xs text-[#686C78]">
                  {ACTION_LABELS[entry.action]} · Acting Account: {entry.actorName} (
                  {entry.actorEmail} · {entry.actorRole.replace('_', ' ')})
                </p>
              </div>
              <span className="text-xs font-mono-tabular text-[#686C78] shrink-0">
                {new Date(entry.timestamp).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </SurfaceCard>
  );
};
