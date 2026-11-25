import React, { useMemo, useState } from 'react';
import { ArrowRight, FileText } from 'lucide-react';
import type { PastQuestionDoc } from '../core/types';
import { useArchiveStore } from '../hooks/useArchiveStore';
import { SearchField } from '../components/ui/SearchField';
import { DarkHeaderCard } from '../components/ui/DarkHeaderCard';

interface PastQuestionsScreenProps {
  onOpenDocument: (doc: PastQuestionDoc) => void;
}

const DocRow: React.FC<{ doc: PastQuestionDoc; onOpen: (doc: PastQuestionDoc) => void }> = ({
  doc,
  onOpen,
}) => (
  <button
    type="button"
    onClick={() => onOpen(doc)}
    className="w-full text-left rounded-2xl bg-white p-4 border border-[#1A1B20]/[0.06] shadow-[0_2px_10px_-4px_rgba(24,25,30,0.06)] hover:shadow-[0_8px_20px_-6px_rgba(24,25,30,0.1)] transition-all duration-150 flex items-center justify-between gap-4 cursor-pointer active:scale-[0.995]"
  >
    <div className="flex items-center gap-3.5 min-w-0 flex-1">
      <div className="h-11 w-11 rounded-xl bg-[#1D1E23] text-white flex items-center justify-center shrink-0">
        <FileText className="w-5 h-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-sm sm:text-base font-bold text-[#1A1B20] whitespace-nowrap">
            {doc.courseCode}
          </span>
          <span className="text-xs font-mono-tabular text-[#686C78]">{doc.level}</span>
        </div>
        <p className="mt-0.5 text-xs sm:text-sm text-[#3A3D47] line-clamp-2">{doc.courseTitle}</p>
      </div>
    </div>

    <div className="flex flex-col items-end gap-1.5 shrink-0 self-stretch justify-between">
      <span className="min-h-[36px] px-3.5 rounded-xl bg-[#F6F7F9] text-xs font-semibold text-[#1A1B20] flex items-center gap-1.5 whitespace-nowrap">
        Open
        <ArrowRight className="w-3.5 h-3.5" />
      </span>
      <span className="text-[11px] font-mono-tabular text-[#686C78]">{doc.session}</span>
    </div>
  </button>
);

export const PastQuestionsScreen: React.FC<PastQuestionsScreenProps> = ({ onOpenDocument }) => {
  const store = useArchiveStore();
  const [query, setQuery] = useState('');

  const published = useMemo(
    () =>
      store.documents
        .filter((d) => d.status === 'published' && d.schoolId === store.selectedSchoolId)
        .sort((a, b) => b.year - a.year || a.courseCode.localeCompare(b.courseCode)),
    [store.documents, store.selectedSchoolId]
  );

  const recent = useMemo(() => {
    const byId = new Map(published.map((d) => [d.id, d]));
    return store.recentDocIds
      .map((id) => byId.get(id))
      .filter((d): d is PastQuestionDoc => Boolean(d))
      .slice(0, 6);
  }, [published, store.recentDocIds]);

  const needle = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!needle) return [];
    return published.filter((d) =>
      `${d.courseCode} ${d.courseTitle} ${d.session} ${d.level}`.toLowerCase().includes(needle)
    );
  }, [published, needle]);

  return (
    <div className="space-y-5 page-enter">
      <DarkHeaderCard>
        <h1 className="font-display text-xl sm:text-2xl font-bold leading-snug">Past Questions</h1>
        <p className="mt-1.5 text-xs text-[#C3C7D2]">Pick up where you left off</p>

        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search a course code or title..."
        />
      </DarkHeaderCard>

      {needle ? (
        <section aria-label="Search results">
          {results.length === 0 ? (
            <p className="py-10 text-center text-sm text-[#686C78]">
              No past questions match &ldquo;{query}&rdquo;.
            </p>
          ) : (
            <div className="space-y-3">
              {results.map((doc) => (
                <DocRow key={doc.id} doc={doc} onOpen={onOpenDocument} />
              ))}
            </div>
          )}
        </section>
      ) : (
        <>
          {recent.length > 0 && (
            <section aria-label="Recently opened">
              <h2 className="font-display text-lg font-bold text-[#1A1B20]">Recently opened</h2>
              <div className="mt-3 space-y-3">
                {recent.map((doc) => (
                  <DocRow key={doc.id} doc={doc} onOpen={onOpenDocument} />
                ))}
              </div>
            </section>
          )}

          <section aria-label="All past questions">
            <h2 className="font-display text-lg font-bold text-[#1A1B20]">All past questions</h2>
            {published.length === 0 ? (
              <p className="py-10 text-center text-sm text-[#686C78]">
                No past questions have been added yet.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {published.map((doc) => (
                  <DocRow key={doc.id} doc={doc} onOpen={onOpenDocument} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};
