import React, { useMemo } from 'react';
import { ArrowRight, FileText } from 'lucide-react';
import type { PastQuestionDoc } from '../core/types';
import { useArchiveSearch } from '../hooks/useArchiveSearch';
import { DocumentListSkeleton, TactileButton, WaveHeader } from '../components/ui';
import { ArchiveFilterForm } from '../components/ui/ArchiveFilterForm';
import { SurfaceCard } from '../components/ui/SurfaceCard';
import { courseSubtitle } from '../core/docTitle';

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
        <p className="mt-0.5 text-xs sm:text-sm text-[#3A3D47] line-clamp-2">{courseSubtitle(doc)}</p>
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
  const search = useArchiveSearch();
  const {
    store,
    activeSchool,
    filteredDocs,
    resultsRef,
    searchInputRef,
    query,
    searchPhase,
    isFilteringSkeleton,
    showFilters,
    appliedSession,
    appliedSemester,
    appliedLevel,
    hasActiveCriteria,
    handleSearchInputChange,
    handleSearchSubmit,
    handleFilterToggle,
    handleFilterClose,
    resetFilters,
  } = search;

  const sortDocs = (docs: PastQuestionDoc[]) =>
    [...docs].sort((a, b) => b.year - a.year || a.courseCode.localeCompare(b.courseCode));

  const published = useMemo(
    () =>
      sortDocs(
        store.documents.filter(
          (d) => d.status === 'published' && d.schoolId === store.selectedSchoolId
        )
      ),
    [store.documents, store.selectedSchoolId]
  );

  const recent = useMemo(() => {
    const byId = new Map(published.map((d) => [d.id, d]));
    return store.recentDocIds
      .map((id) => byId.get(id))
      .filter((d): d is PastQuestionDoc => Boolean(d))
      .slice(0, 6);
  }, [published, store.recentDocIds]);

  const results = useMemo(() => sortDocs(filteredDocs), [filteredDocs]);

  const showResults = hasActiveCriteria || isFilteringSkeleton;

  return (
    <div className="space-y-6 page-enter">
      <WaveHeader
        title={store.siteCms.studentUi.pastQuestionsTitle}
        placeholder="Search course code or topic..."
        searchValue={query}
        onSearchChange={handleSearchInputChange}
        onSearchSubmit={handleSearchSubmit}
        searchPhase={searchPhase}
        onFilterToggle={handleFilterToggle}
        onFilterClose={handleFilterClose}
        filterActive={showFilters}
        filterDropdown={<ArchiveFilterForm search={search} />}
        searchInputRef={searchInputRef}
      />

      {showResults ? (
        <section ref={resultsRef} aria-label="Search results">
          <div className="flex items-center justify-between mb-3.5">
            <div>
              <h2 className="font-display text-lg font-bold text-[#1A1B20]">Search results</h2>
              <p className="text-xs text-[#686C78] font-mono-tabular mt-0.5">
                {isFilteringSkeleton
                  ? 'Searching...'
                  : `${results.length} found`}
                {appliedSession !== 'All' ? ` · ${appliedSession}` : ''}
                {appliedSemester !== 'All' ? ` · ${appliedSemester}` : ''}
                {appliedLevel !== 'All' ? ` · ${appliedLevel}` : ''}
              </p>
            </div>
            {hasActiveCriteria && (
              <button
                type="button"
                onClick={resetFilters}
                className="text-xs font-semibold text-[#686C78] hover:text-[#1A1B20] underline underline-offset-4 cursor-pointer whitespace-nowrap"
              >
                Clear filter
              </button>
            )}
          </div>

          {isFilteringSkeleton ? (
            <DocumentListSkeleton rows={4} />
          ) : results.length === 0 ? (
            <SurfaceCard tone="white" className="text-center py-10 px-6">
              <p className="font-display text-base font-bold text-[#1A1B20]">
                No matching past questions found
              </p>
              <p className="text-sm text-[#686C78] mt-1 max-w-md mx-auto">
                Try clearing your session or semester filter, or search another course code.
              </p>
              <div className="mt-5 flex justify-center">
                <TactileButton variant="dark" size="sm" onClick={resetFilters}>
                  Show All {activeSchool.code} Past Questions
                </TactileButton>
              </div>
            </SurfaceCard>
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
            <p className="mt-0.5 text-xs text-[#686C78]">
              {store.siteCms.studentUi.pastQuestionsSubtitle}
            </p>
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
