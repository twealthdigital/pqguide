import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  FileText,
  Lock,
  Search,
  Sparkles,
} from 'lucide-react';
import type { AppScreen, PastQuestionDoc, SemesterType } from '../core/types';
import { hasArchiveAccess } from '../core/pricing';
import { useArchiveStore } from '../hooks/useArchiveStore';
import { archiveRepository } from '../services/archiveRepository';
import {
  CustomSelect,
  DocumentListSkeleton,
  SurfaceCard,
  TactileButton,
  WaveHeader,
} from '../components/ui';
import type { SearchActionPhase } from '../components/ui/WaveHeader';

interface HomeScreenProps {
  onNavigate: (screen: AppScreen) => void;
  onOpenDocument: (doc: PastQuestionDoc) => void;
  focusSearchSignal: number;
}

const LEVELS = ['All', '100L', '200L', '300L', '400L', '500L'];
const SEMESTERS: Array<SemesterType | 'All'> = [
  'All',
  'First Semester',
  'Second Semester',
];

export const HomeScreen: React.FC<HomeScreenProps> = ({
  onNavigate,
  onOpenDocument,
  focusSearchSignal,
}) => {
  const store = useArchiveStore();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const resultsRef = useRef<HTMLElement | null>(null);
  const filterSubmitTimerRef = useRef<number | null>(null);
  const searchTimerRef = useRef<number | null>(null);
  const doneResetTimerRef = useRef<number | null>(null);

  // Active applied filters
  const [appliedSession, setAppliedSession] = useState<string>('All');
  const [appliedSemester, setAppliedSemester] = useState<SemesterType | 'All'>('All');
  const [appliedLevel, setAppliedLevel] = useState<string>('All');
  const [query, setQuery] = useState<string>('');
  const [appliedQuery, setAppliedQuery] = useState<string>('');

  // Floating dropdown draft state
  const [showFilters, setShowFilters] = useState<boolean>(false);
  const [draftSchoolId, setDraftSchoolId] = useState<string>(store.selectedSchoolId);
  const [draftSession, setDraftSession] = useState<string>('All');
  const [draftSemester, setDraftSemester] = useState<SemesterType | 'All'>('All');
  const [draftLevel, setDraftLevel] = useState<string>('All');
  const [filterError, setFilterError] = useState<string>('');
  const [isFilterSubmitting, setIsFilterSubmitting] = useState<boolean>(false);

  const [searchPhase, setSearchPhase] = useState<SearchActionPhase>('idle');
  const [isFilteringSkeleton, setIsFilteringSkeleton] = useState<boolean>(false);

  const clearTimers = () => {
    if (filterSubmitTimerRef.current !== null) {
      window.clearTimeout(filterSubmitTimerRef.current);
      filterSubmitTimerRef.current = null;
    }
    if (searchTimerRef.current !== null) {
      window.clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
    if (doneResetTimerRef.current !== null) {
      window.clearTimeout(doneResetTimerRef.current);
      doneResetTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => clearTimers();
  }, []);

  useEffect(() => {
    setDraftSchoolId(store.selectedSchoolId);
  }, [store.selectedSchoolId]);

  // Focus search when user taps the raised center Quick Find button
  useEffect(() => {
    if (focusSearchSignal > 0 && searchInputRef.current) {
      searchInputRef.current.focus();
      searchInputRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [focusSearchSignal]);

  const activeSchool = useMemo(
    () =>
      store.schools.find((s) => s.id === store.selectedSchoolId) ??
      store.schools[0],
    [store.schools, store.selectedSchoolId]
  );

  const filteredDocs = useMemo(() => {
    const q = appliedQuery.trim().toLowerCase();
    return store.documents.filter((doc) => {
      if (doc.status !== 'published') return false;
      if (doc.schoolId !== activeSchool.id) return false;
      if (
        appliedSession !== 'All' &&
        appliedSession.trim() &&
        !doc.session.toLowerCase().includes(appliedSession.trim().toLowerCase())
      ) {
        return false;
      }
      if (appliedSemester !== 'All' && doc.semester !== appliedSemester) return false;
      if (appliedLevel !== 'All' && doc.level !== appliedLevel) return false;
      if (!q) return true;
      return (
        doc.courseCode.toLowerCase().includes(q) ||
        doc.courseTitle.toLowerCase().includes(q) ||
        doc.department.toLowerCase().includes(q) ||
        doc.extractedText.toLowerCase().includes(q) ||
        doc.questions.some((item) => item.toLowerCase().includes(q))
      );
    });
  }, [
    store.documents,
    activeSchool.id,
    appliedSession,
    appliedSemester,
    appliedLevel,
    appliedQuery,
  ]);

  const userHasFullAccess = hasArchiveAccess(store.activeTierId);

  const handleSearchInputChange = (nextValue: string) => {
    clearTimers();
    setQuery(nextValue);
    setSearchPhase('idle');
    setIsFilteringSkeleton(false);
    if (nextValue.trim() && filterError) {
      setFilterError('');
    }
    if (!nextValue.trim()) {
      setAppliedQuery('');
    }
  };

  const handleFilterToggle = () => {
    if (searchPhase === 'loading') return;
    if (doneResetTimerRef.current !== null) {
      window.clearTimeout(doneResetTimerRef.current);
      doneResetTimerRef.current = null;
    }
    if (searchPhase === 'done' && !query.trim()) {
      setSearchPhase('idle');
    }
    setFilterError('');
    setShowFilters((prev) => {
      const next = !prev;
      if (next) {
        setDraftSchoolId(activeSchool.id);
        setDraftSession(appliedSession);
        setDraftSemester(appliedSemester);
        setDraftLevel(appliedLevel);
      }
      return next;
    });
  };

  const applyDraftFiltersToArchive = () => {
    const normalizedSession = draftSession.trim() || 'All';
    if (draftSchoolId && draftSchoolId !== activeSchool.id) {
      archiveRepository.setSelectedSchool(draftSchoolId);
    }
    setAppliedSession(normalizedSession);
    setDraftSession(normalizedSession);
    setAppliedSemester(draftSemester);
    setAppliedLevel(draftLevel);
  };

  const handleSearchSubmit = () => {
    const trimmed = query.trim();
    if (!trimmed) return;

    if (searchPhase === 'done' && appliedQuery.trim() === trimmed && !showFilters) {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    clearTimers();
    if (showFilters) {
      applyDraftFiltersToArchive();
    }
    setFilterError('');
    setShowFilters(false);
    setSearchPhase('loading');
    setIsFilteringSkeleton(true);

    searchTimerRef.current = window.setTimeout(() => {
      setAppliedQuery(trimmed);
      setIsFilteringSkeleton(false);
      setSearchPhase('done');
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 520);
  };

  const handleFilterSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isFilterSubmitting) return;

    const resolvedCourse = query.trim();
    if (!resolvedCourse) {
      setFilterError('Enter a course code or topic in the search bar first.');
      searchInputRef.current?.focus();
      return;
    }

    setFilterError('');
    clearTimers();
    setIsFilterSubmitting(true);

    filterSubmitTimerRef.current = window.setTimeout(() => {
      applyDraftFiltersToArchive();
      setAppliedQuery(resolvedCourse);

      setIsFilterSubmitting(false);
      setShowFilters(false);

      // Trigger main search bar loading -> checkmark animation while preparing past questions
      setSearchPhase('loading');
      setIsFilteringSkeleton(true);

      searchTimerRef.current = window.setTimeout(() => {
        setIsFilteringSkeleton(false);
        setSearchPhase('done');
        resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 520);
    }, 240);
  };

  const resetFilters = () => {
    clearTimers();
    setAppliedSession('All');
    setAppliedSemester('All');
    setAppliedLevel('All');
    setDraftSchoolId(activeSchool.id);
    setDraftSession('All');
    setDraftSemester('All');
    setDraftLevel('All');
    setQuery('');
    setAppliedQuery('');
    setFilterError('');
    setSearchPhase('idle');
    setIsFilterSubmitting(false);
    setShowFilters(false);
    setIsFilteringSkeleton(true);
    window.setTimeout(() => setIsFilteringSkeleton(false), 140);
  };

  const heroFeaturedDoc = filteredDocs[0] ?? store.documents[0];
  const secondaryHighlightDoc = filteredDocs[1] ?? store.documents[1];
  const hasActiveCriteria =
    appliedSession !== 'All' ||
    appliedSemester !== 'All' ||
    appliedLevel !== 'All' ||
    Boolean(appliedQuery.trim());
  const hasDraftChanges =
    draftSession !== 'All' || draftSemester !== 'All' || draftLevel !== 'All';

  const filterDropdownContent = (
    <form
      onSubmit={handleFilterSearchSubmit}
      className="rounded-2xl bg-white p-4 sm:p-5 text-[#1A1B20] border border-[#1A1B20]/10 shadow-[0_24px_52px_-12px_rgba(14,15,20,0.34)] page-enter"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <CustomSelect
          id="school-select"
          label="University"
          value={draftSchoolId}
          options={store.schools.map((school) => ({
            value: school.id,
            label: `${school.code} — ${school.shortName}`,
            hint: !school.isActive ? 'Coming Soon' : school.location,
            disabled: !school.isActive,
          }))}
          onChange={setDraftSchoolId}
        />

        <CustomSelect
          id="session-select"
          label="Academic Session"
          mono
          allowCustomInput
          emptyValueFallback="All"
          inputPlaceholder="All Sessions (type e.g. 2024/2025)"
          value={draftSession}
          options={[
            { value: 'All', label: 'All Sessions' },
            ...store.sessions.map((s) => ({ value: s, label: s })),
          ]}
          onChange={setDraftSession}
        />

        <CustomSelect
          id="semester-select"
          label="Semester"
          value={draftSemester}
          options={SEMESTERS.map((sem) => ({
            value: sem,
            label: sem === 'All' ? 'All Semesters' : sem,
          }))}
          onChange={(val) => setDraftSemester(val as SemesterType | 'All')}
        />

        <CustomSelect
          id="level-select"
          label="Level"
          mono
          value={draftLevel}
          options={LEVELS.map((lvl) => ({
            value: lvl,
            label: lvl === 'All' ? 'All Levels (100L–500L)' : lvl,
          }))}
          onChange={setDraftLevel}
        />
      </div>

      {filterError && (
        <p role="alert" className="mt-3 text-xs font-medium text-[#B42318]">
          {filterError}
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        {hasDraftChanges && (
          <button
            type="button"
            onClick={() => {
              setDraftSession('All');
              setDraftSemester('All');
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
          loading={isFilterSubmitting}
          icon={<Search className="w-4 h-4" />}
        >
          Search Past Questions
        </TactileButton>
      </div>
    </form>
  );

  return (
    <div className="space-y-6 page-enter">
      {/* Sculpted Dark Ash Header Banner + Morphing Search & Anchored Filter Dropdown */}
      <WaveHeader
        title="Find past questions in seconds"
        searchValue={query}
        onSearchChange={handleSearchInputChange}
        onSearchSubmit={handleSearchSubmit}
        searchPhase={searchPhase}
        onFilterToggle={handleFilterToggle}
        onFilterClose={() => {
          if (!isFilterSubmitting) setShowFilters(false);
        }}
        filterActive={showFilters}
        filterDropdown={filterDropdownContent}
        searchInputRef={searchInputRef}
      />

      {/* Featured Cards Row (Dark Ash Wave Card + Soft Ash Card matching Master Task Management UI) */}
      <section aria-label="Quick actions and featured papers">
        <div className="flex items-center justify-between mb-3.5">
          <h2 className="font-display text-lg font-bold text-[#1A1B20]">
            Featured & Quick Actions
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch">
          {/* Primary Dark Ash Wave Card */}
          {heroFeaturedDoc && (
            <SurfaceCard
              tone="ash"
              withWaves
              interactive
              onClick={() => onOpenDocument(heroFeaturedDoc)}
              className="flex flex-col justify-between min-h-[184px]"
            >
              <div className="flex items-center justify-between">
                <div className="h-10 w-10 rounded-full bg-white text-[#1D1E23] flex items-center justify-center">
                  <FileText className="w-5 h-5" />
                </div>
                <span className="font-mono-tabular text-xs text-[#A5AAB8]">
                  {heroFeaturedDoc.session}
                </span>
              </div>

              <div className="mt-5">
                <h3 className="font-display text-lg font-bold text-white leading-snug">
                  {heroFeaturedDoc.courseCode} · {heroFeaturedDoc.level}
                </h3>
                <p className="text-xs text-[#B6BAC6] mt-1 line-clamp-2">
                  {heroFeaturedDoc.courseTitle}
                </p>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <span className="text-xs text-[#A5AAB8]">
                  {heroFeaturedDoc.isFreePreview || userHasFullAccess
                    ? 'Ready to read'
                    : 'Pass required'}
                </span>
                <span className="h-9 w-9 rounded-full bg-white text-[#1D1E23] flex items-center justify-center shadow-sm">
                  <ArrowRight className="w-4 h-4" />
                </span>
              </div>
            </SurfaceCard>
          )}

          {/* Secondary Pale Cool Ash Card */}
          {secondaryHighlightDoc && (
            <SurfaceCard
              tone="soft"
              interactive
              onClick={() => onOpenDocument(secondaryHighlightDoc)}
              className="flex flex-col justify-between min-h-[184px]"
            >
              <div className="flex items-center justify-between">
                <div className="h-10 w-10 rounded-full bg-[#1D1E23] text-white flex items-center justify-center">
                  <FileText className="w-5 h-5" />
                </div>
                <span className="font-mono-tabular text-xs text-[#686C78]">
                  {secondaryHighlightDoc.session}
                </span>
              </div>

              <div className="mt-5">
                <h3 className="font-display text-lg font-bold text-[#1A1B20] leading-snug">
                  {secondaryHighlightDoc.courseCode} · {secondaryHighlightDoc.level}
                </h3>
                <p className="text-xs text-[#5A5E6B] mt-1 line-clamp-2">
                  {secondaryHighlightDoc.courseTitle}
                </p>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <span className="text-xs text-[#5A5E6B]">
                  {secondaryHighlightDoc.semester}
                </span>
                <span className="h-9 w-9 rounded-full bg-white text-[#1D1E23] flex items-center justify-center shadow-sm">
                  <ArrowRight className="w-4 h-4" />
                </span>
              </div>
            </SurfaceCard>
          )}

          {/* New Student Quick Guide Card */}
          <SurfaceCard
            tone="white"
            className="flex flex-col justify-between min-h-[184px] md:col-span-2 lg:col-span-1"
          >
            <div>
              <h3 className="font-display text-base font-bold text-[#1A1B20]">
                New here? 3-Step Guide
              </h3>
              <ol className="mt-3 space-y-2 text-xs text-[#505460]">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#1D1E23] shrink-0 mt-0.5" />
                  <span>Select your Academic Session & Semester above.</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#1D1E23] shrink-0 mt-0.5" />
                  <span>Search any course code (e.g. GNS 101) or keyword.</span>
                </li>
                <li className="flex items-start gap-2">
                  <Sparkles className="w-4 h-4 text-[#1D1E23] shrink-0 mt-0.5" />
                  <span>
                    Read free previews or unlock full semester access from ₦500.
                  </span>
                </li>
              </ol>
            </div>

            <div className="mt-4">
              <TactileButton
                variant={userHasFullAccess ? 'light' : 'dark'}
                size="sm"
                fullWidth
                onClick={() => onNavigate('subscription')}
              >
                {userHasFullAccess ? 'View Active Pass' : 'Unlock Full Archive'}
              </TactileButton>
            </div>
          </SurfaceCard>
        </div>
      </section>

      {/* Searchable Past Questions List */}
      <section ref={resultsRef} aria-label="Past question papers">
        <div className="flex items-center justify-between mb-3.5">
          <div>
            <h2 className="font-display text-lg font-bold text-[#1A1B20]">
              Past Question Papers
            </h2>
            <p className="text-xs text-[#686C78] font-mono-tabular mt-0.5">
              GNS papers only · {filteredDocs.length} indexed for {activeSchool.code}
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
        ) : filteredDocs.length === 0 ? (
          <SurfaceCard tone="white" className="text-center py-10 px-6">
            <p className="font-display text-base font-bold text-[#1A1B20]">
              No matching papers found
            </p>
            <p className="text-sm text-[#686C78] mt-1 max-w-md mx-auto">
              Try clearing your session or semester filter, or search another course code.
            </p>
            <div className="mt-5 flex justify-center">
              <TactileButton variant="dark" size="sm" onClick={resetFilters}>
                Show All {activeSchool.code} Papers
              </TactileButton>
            </div>
          </SurfaceCard>
        ) : (
          <div className="space-y-3">
            {filteredDocs.map((doc) => {
              const unlocked = doc.isFreePreview || userHasFullAccess;
              return (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => onOpenDocument(doc)}
                  className="w-full text-left rounded-2xl bg-white p-4 border border-[#1A1B20]/[0.06] shadow-[0_2px_10px_-4px_rgba(24,25,30,0.06)] hover:shadow-[0_8px_20px_-6px_rgba(24,25,30,0.1)] transition-all duration-150 flex items-center justify-between gap-4 cursor-pointer active:scale-[0.995]"
                >
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    <div
                      className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 ${
                        unlocked
                          ? 'bg-[#1D1E23] text-white'
                          : 'bg-[#EFF1F5] text-[#686C78]'
                      }`}
                    >
                      {unlocked ? (
                        <FileText className="w-5 h-5" />
                      ) : (
                        <Lock className="w-4 h-4" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="font-display text-sm sm:text-base font-bold text-[#1A1B20] whitespace-nowrap">
                          {doc.courseCode}
                        </span>
                        <span className="text-xs font-mono-tabular text-[#686C78]">
                          {doc.level}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs sm:text-sm text-[#3A3D47] line-clamp-2">
                        {doc.courseTitle}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1.5 shrink-0 self-stretch justify-between">
                    <span className="min-h-[36px] px-3.5 rounded-xl bg-[#F6F7F9] text-xs font-semibold text-[#1A1B20] flex items-center gap-1.5 whitespace-nowrap">
                      {unlocked ? 'Open' : 'Unlock'}
                      <ArrowRight className="w-3.5 h-3.5" />
                    </span>
                    <span className="text-[11px] font-mono-tabular text-[#686C78]">
                      {doc.session}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
