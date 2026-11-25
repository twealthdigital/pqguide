import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Search } from 'lucide-react';
import type { StudyMaterial } from '../core/types';
import { STUDY_MATERIALS } from '../data/materials';
import {
  CustomSelect,
  DocumentListSkeleton,
  SurfaceCard,
  TactileButton,
  WaveHeader,
} from '../components/ui';
import type { SearchActionPhase } from '../components/ui/WaveHeader';
import { MaterialDownloadButton } from '../components/ui/MaterialDownloadButton';

interface MaterialsScreenProps {
  onOpenMaterial: (material: StudyMaterial) => void;
}

const COURSES = Array.from(
  new Map(STUDY_MATERIALS.map((m) => [m.courseCode, m.courseTitle])).entries()
);
const MATERIAL_LEVELS = Array.from(new Set(STUDY_MATERIALS.map((m) => m.level))).sort();

const searchableText = (m: StudyMaterial): string =>
  [
    m.courseCode,
    m.courseTitle,
    m.title,
    m.summary,
    ...m.sections.flatMap((s) => [s.heading, ...(s.paragraphs ?? []), ...(s.points ?? [])]),
  ]
    .join(' ')
    .toLowerCase();

export const MaterialsScreen: React.FC<MaterialsScreenProps> = ({ onOpenMaterial }) => {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const resultsRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number | null>(null);

  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [appliedCourse, setAppliedCourse] = useState('All');
  const [appliedLevel, setAppliedLevel] = useState('All');

  const [showFilters, setShowFilters] = useState(false);
  const [draftCourse, setDraftCourse] = useState('All');
  const [draftLevel, setDraftLevel] = useState('All');

  const [searchPhase, setSearchPhase] = useState<SearchActionPhase>('idle');
  const [isSkeleton, setIsSkeleton] = useState(false);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => clearTimer, []);

  const results = useMemo(() => {
    const needle = appliedQuery.trim().toLowerCase();
    return STUDY_MATERIALS.filter((m) => {
      if (appliedCourse !== 'All' && m.courseCode !== appliedCourse) return false;
      if (appliedLevel !== 'All' && m.level !== appliedLevel) return false;
      return needle ? searchableText(m).includes(needle) : true;
    });
  }, [appliedQuery, appliedCourse, appliedLevel]);

  const hasActiveCriteria =
    appliedCourse !== 'All' || appliedLevel !== 'All' || Boolean(appliedQuery.trim());
  const hasDraftChanges = draftCourse !== 'All' || draftLevel !== 'All';

  /** Spinner, then check mark, then the results show. */
  const runSearch = (nextQuery: string) => {
    clearTimer();
    setShowFilters(false);
    setSearchPhase('loading');
    setIsSkeleton(true);
    timerRef.current = window.setTimeout(() => {
      setAppliedQuery(nextQuery);
      setIsSkeleton(false);
      setSearchPhase('done');
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 520);
  };

  const handleSearchChange = (value: string) => {
    clearTimer();
    setQuery(value);
    setSearchPhase('idle');
    setIsSkeleton(false);
    if (!value.trim()) setAppliedQuery('');
  };

  const handleSearchSubmit = () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    if (searchPhase === 'done' && appliedQuery.trim() === trimmed && !showFilters) {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (showFilters) {
      setAppliedCourse(draftCourse);
      setAppliedLevel(draftLevel);
    }
    runSearch(trimmed);
  };

  const handleFilterToggle = () => {
    if (searchPhase === 'loading') return;
    if (searchPhase === 'done' && !query.trim()) setSearchPhase('idle');
    setShowFilters((prev) => {
      const next = !prev;
      if (next) {
        setDraftCourse(appliedCourse);
        setDraftLevel(appliedLevel);
      }
      return next;
    });
  };

  // Materials can be filtered by course and level alone, no text needed.
  const handleFilterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setAppliedCourse(draftCourse);
    setAppliedLevel(draftLevel);
    runSearch(query.trim());
  };

  const resetFilters = () => {
    clearTimer();
    setQuery('');
    setAppliedQuery('');
    setAppliedCourse('All');
    setAppliedLevel('All');
    setDraftCourse('All');
    setDraftLevel('All');
    setSearchPhase('idle');
    setShowFilters(false);
    setIsSkeleton(true);
    timerRef.current = window.setTimeout(() => setIsSkeleton(false), 140);
  };

  const filterForm = (
    <form
      onSubmit={handleFilterSubmit}
      className="rounded-2xl bg-white p-4 sm:p-5 text-[#1A1B20] border border-[#1A1B20]/10 shadow-[0_24px_52px_-12px_rgba(14,15,20,0.34)] page-enter"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <CustomSelect
          id="material-course-select"
          label="Course"
          mono
          value={draftCourse}
          options={[
            { value: 'All', label: 'All Courses' },
            ...COURSES.map(([code, title]) => ({ value: code, label: code, hint: title })),
          ]}
          onChange={setDraftCourse}
        />
        <CustomSelect
          id="material-level-select"
          label="Level"
          mono
          value={draftLevel}
          options={[
            { value: 'All', label: 'All Levels' },
            ...MATERIAL_LEVELS.map((lvl) => ({ value: lvl, label: lvl })),
          ]}
          onChange={setDraftLevel}
        />
      </div>

      <div className="mt-4 flex items-center gap-3">
        {hasDraftChanges && (
          <button
            type="button"
            onClick={() => {
              setDraftCourse('All');
              setDraftLevel('All');
            }}
            className="min-h-[44px] px-3 text-xs font-semibold text-[#686C78] hover:text-[#1A1B20] underline underline-offset-4 cursor-pointer shrink-0"
          >
            Reset
          </button>
        )}
        <TactileButton
          type="submit"
          variant="dark"
          size="md"
          fullWidth
          icon={<Search className="w-4 h-4" />}
        >
          Search Materials
        </TactileButton>
      </div>
    </form>
  );

  return (
    <div className="space-y-6 page-enter">
      <WaveHeader
        title="Materials"
        noun="materials"
        placeholder="Search a course or topic..."
        searchValue={query}
        onSearchChange={handleSearchChange}
        onSearchSubmit={handleSearchSubmit}
        searchPhase={searchPhase}
        onFilterToggle={handleFilterToggle}
        onFilterClose={() => setShowFilters(false)}
        filterActive={showFilters}
        filterDropdown={filterForm}
        searchInputRef={searchInputRef}
      />

      <section ref={resultsRef} aria-label="Reading guides">
        <div className="flex items-center justify-between mb-3.5">
          <div>
            <h2 className="font-display text-lg font-bold text-[#1A1B20]">Reading guides</h2>
            <p className="mt-0.5 text-xs text-[#686C78]">
              Read here or download to study offline
              {appliedCourse !== 'All' ? ` · ${appliedCourse}` : ''}
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

        {isSkeleton ? (
          <DocumentListSkeleton rows={3} />
        ) : results.length === 0 ? (
          <SurfaceCard tone="white" className="text-center py-10 px-6">
            <p className="font-display text-base font-bold text-[#1A1B20]">
              No matching guides found
            </p>
            <p className="text-sm text-[#686C78] mt-1 max-w-md mx-auto">
              Try another course code or topic, or clear your filter.
            </p>
            <div className="mt-5 flex justify-center">
              <TactileButton variant="dark" size="sm" onClick={resetFilters}>
                Show All Guides
              </TactileButton>
            </div>
          </SurfaceCard>
        ) : (
          <div className="space-y-3">
            {results.map((m) => (
              <div
                key={m.id}
                className="relative rounded-2xl bg-white p-4 border border-[#1A1B20]/[0.06] shadow-[0_2px_10px_-4px_rgba(24,25,30,0.06)] hover:shadow-[0_8px_20px_-6px_rgba(24,25,30,0.1)] transition-all duration-150 flex items-center justify-between gap-4 active:scale-[0.995]"
              >
                {/* Whole card opens the guide; the download button sits above it */}
                <button
                  type="button"
                  onClick={() => onOpenMaterial(m)}
                  aria-label={`Read ${m.title}`}
                  className="absolute inset-0 rounded-2xl cursor-pointer"
                />

                <div className="pointer-events-none flex items-center gap-3.5 min-w-0 flex-1">
                  <div className="h-11 w-11 rounded-xl bg-[#1D1E23] text-white flex items-center justify-center shrink-0">
                    <BookOpen className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-display text-sm sm:text-base font-bold text-[#1A1B20] whitespace-nowrap">
                        {m.courseCode}
                      </span>
                      <span className="text-xs font-mono-tabular text-[#686C78]">
                        {m.level} · {m.readMinutes} min read
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs sm:text-sm text-[#3A3D47] line-clamp-2">
                      {m.title}
                    </p>
                  </div>
                </div>

                <div className="pointer-events-none flex items-center gap-2 shrink-0">
                  <span className="hidden sm:flex min-h-[40px] px-3.5 rounded-xl bg-[#F6F7F9] text-xs font-semibold text-[#1A1B20] items-center gap-1.5 whitespace-nowrap">
                    Read
                    <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                  <MaterialDownloadButton material={m} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
