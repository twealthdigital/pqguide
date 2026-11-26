import React, { useMemo, useState } from 'react';
import { Activity, ChevronRight } from 'lucide-react';
import {
  AUDIT_ACTION_META,
  formatAuditHeadline,
  formatRoleLabel,
  resolveSchoolCode,
} from '../../../core/auditMeta';
import type { AuditLogEntry } from '../../../core/types';
import { type AppStoreState } from '../../../services/archiveRepository';
import { DetailDialog, SectionHeadingBar, SurfaceCard } from '../../../components/ui';

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
  | 'support'
  | 'cms'
  | 'system';

export const AuditLogsTab: React.FC<AuditLogsTabProps> = ({ store }) => {
  const [category, setCategory] = useState<AuditCategoryFilter>('all');
  const [query, setQuery] = useState('');
  const [selectedEntry, setSelectedEntry] = useState<AuditLogEntry | null>(null);

  const filteredLogs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return store.auditLogs.filter((entry) => {
      if (category !== 'all' && entry.targetType !== category) return false;
      if (!q) return true;
      const meta = AUDIT_ACTION_META[entry.action];
      return (
        entry.summary.toLowerCase().includes(q) ||
        entry.actorName.toLowerCase().includes(q) ||
        entry.actorEmail.toLowerCase().includes(q) ||
        (meta?.label ?? entry.action).toLowerCase().includes(q)
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
    { id: 'support', label: 'Support' },
    { id: 'cms', label: 'UI Settings' },
    { id: 'system', label: 'System' },
  ];

  const selectedMeta = selectedEntry ? AUDIT_ACTION_META[selectedEntry.action] : null;
  const selectedSchoolCode = selectedEntry
    ? resolveSchoolCode(store.schools, selectedEntry.targetId)
    : undefined;

  return (
    <>
      <SurfaceCard tone="white" className="p-5 sm:p-6 space-y-5">
        <SectionHeadingBar
          icon={<Activity className="w-4 h-4" />}
          title="Administrative Activity Logs"
          right={
            <span className="font-mono-tabular text-xs font-semibold text-[#C3C7D2]">
              {filteredLogs.length} events
            </span>
          }
        />

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
            placeholder="Search logs..."
            className="w-full md:w-60 min-h-[40px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-medium"
          />
        </div>

        {filteredLogs.length === 0 ? (
          <div className="py-10 text-center space-y-1">
            <p className="text-sm font-semibold text-[#1A1B20]">
              No activity matches this filter
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#1A1B20]/[0.06]">
            {filteredLogs.map((entry) => {
              const meta = AUDIT_ACTION_META[entry.action];
              const schoolCode = resolveSchoolCode(store.schools, entry.targetId);
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setSelectedEntry(entry)}
                  className="w-full py-3.5 first:pt-1 last:pb-1 flex items-center justify-between gap-3 text-left hover:bg-[#F6F7F9] rounded-xl px-2 -mx-2 transition-colors cursor-pointer"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-bold text-[#1A1B20] truncate">
                      {formatAuditHeadline(entry, schoolCode)}
                    </p>
                    <p className="text-xs text-[#686C78] truncate">
                      {meta?.label ?? entry.action} · {entry.summary}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-mono-tabular text-[#686C78] hidden sm:inline">
                      {new Date(entry.timestamp).toLocaleString([], {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </span>
                    <ChevronRight className="w-4 h-4 text-[#8E93A2]" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </SurfaceCard>

      <DetailDialog
        open={Boolean(selectedEntry)}
        onClose={() => setSelectedEntry(null)}
        title={selectedMeta?.label ?? 'Activity Details'}
        subtitle={
          selectedEntry
            ? new Date(selectedEntry.timestamp).toLocaleString()
            : undefined
        }
        icon={<Activity className="w-4 h-4" />}
      >
        {selectedEntry && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/[0.07] p-4 space-y-1.5">
              <p className="text-xs font-semibold text-[#686C78]">Action Summary</p>
              <p className="text-sm font-bold text-[#1A1B20]">
                {formatAuditHeadline(selectedEntry, selectedSchoolCode)}
              </p>
              <p className="text-xs text-[#505460]">{selectedEntry.summary}</p>
            </div>

            {selectedMeta?.whatItDoes && (
              <div className="rounded-2xl bg-white border border-[#1A1B20]/[0.08] p-4 space-y-1">
                <p className="text-xs font-semibold text-[#686C78]">What This Does</p>
                <p className="text-sm text-[#1A1B20] leading-relaxed">
                  {selectedMeta.whatItDoes}
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl bg-[#F6F7F9] p-3">
                <p className="text-[#686C78]">Performed By</p>
                <p className="font-bold text-[#1A1B20] mt-0.5">{selectedEntry.actorName}</p>
              </div>
              <div className="rounded-xl bg-[#F6F7F9] p-3">
                <p className="text-[#686C78]">Role</p>
                <p className="font-bold text-[#1A1B20] mt-0.5">
                  {formatRoleLabel(selectedEntry.actorRole)}
                </p>
              </div>
              <div className="rounded-xl bg-[#F6F7F9] p-3">
                <p className="text-[#686C78]">Account Email</p>
                <p className="font-semibold text-[#1A1B20] mt-0.5 break-all">
                  {selectedEntry.actorEmail}
                </p>
              </div>
              <div className="rounded-xl bg-[#F6F7F9] p-3">
                <p className="text-[#686C78]">Target Area</p>
                <p className="font-mono-tabular font-semibold text-[#1A1B20] mt-0.5">
                  {selectedEntry.targetType.replace(/_/g, ' ')}
                  {selectedSchoolCode ? ` · ${selectedSchoolCode}` : ''}
                </p>
              </div>
            </div>
          </div>
        )}
      </DetailDialog>
    </>
  );
};
