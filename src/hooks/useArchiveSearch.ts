import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type { PastQuestionDoc, SemesterType } from '../core/types';
import type { SearchActionPhase } from '../components/ui/WaveHeader';
import { archiveRepository } from '../services/archiveRepository';
import { useArchiveStore } from './useArchiveStore';

export const LEVELS = ['All', '100L', '200L', '300L', '400L', '500L'];
export const SEMESTERS: Array<SemesterType | 'All'> = [
  'All',
  'First Semester',
  'Second Semester',
];

/**
 * The past question search used on the Archive (home) and Past Questions
 * screens: a typed query that is applied on the search button / Enter (spinner,
 * then check mark), plus a filter dropdown for university, session, semester
 * and level. One place for the logic so both screens behave the same.
 */
export function useArchiveSearch() {
  const store = useArchiveStore();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const resultsRef = useRef<HTMLElement | null>(null);
  const filterSubmitTimerRef = useRef<number | null>(null);
  const searchTimerRef = useRef<number | null>(null);
  const doneResetTimerRef = useRef<number | null>(null);

  // Applied filters
  const [appliedSession, setAppliedSession] = useState<string>('All');
  const [appliedSemester, setAppliedSemester] = useState<SemesterType | 'All'>('All');
  const [appliedLevel, setAppliedLevel] = useState<string>('All');
  const [query, setQuery] = useState<string>('');
  const [appliedQuery, setAppliedQuery] = useState<string>('');

  // Dropdown draft state
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

  const activeSchool = useMemo(
    () =>
      store.schools.find((s) => s.id === store.selectedSchoolId) ??
      store.schools[0],
    [store.schools, store.selectedSchoolId]
  );

  const filteredDocs = useMemo<PastQuestionDoc[]>(() => {
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

  const handleFilterClose = () => {
    if (!isFilterSubmitting) setShowFilters(false);
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

      // Main search bar goes loading, then check mark, while results are prepared
      setSearchPhase('loading');
      setIsFilteringSkeleton(true);

      searchTimerRef.current = window.setTimeout(() => {
        setIsFilteringSkeleton(false);
        setSearchPhase('done');
        resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 520);
    }, 240);
  };

  const resetFilters = useCallback(() => {
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
  }, [activeSchool.id]);

  const hasActiveCriteria =
    appliedSession !== 'All' ||
    appliedSemester !== 'All' ||
    appliedLevel !== 'All' ||
    Boolean(appliedQuery.trim());

  const hasDraftChanges =
    draftSession !== 'All' || draftSemester !== 'All' || draftLevel !== 'All';

  return {
    store,
    activeSchool,
    filteredDocs,
    searchInputRef,
    resultsRef,

    query,
    searchPhase,
    isFilteringSkeleton,
    showFilters,
    filterError,
    isFilterSubmitting,
    hasActiveCriteria,
    hasDraftChanges,

    appliedSession,
    appliedSemester,
    appliedLevel,

    draftSchoolId,
    draftSession,
    draftSemester,
    draftLevel,
    setDraftSchoolId,
    setDraftSession,
    setDraftSemester,
    setDraftLevel,

    handleSearchInputChange,
    handleSearchSubmit,
    handleFilterToggle,
    handleFilterClose,
    handleFilterSearchSubmit,
    resetFilters,
  };
}

export type ArchiveSearch = ReturnType<typeof useArchiveSearch>;
