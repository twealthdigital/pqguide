import React from 'react';
import { Search } from 'lucide-react';
import type { SemesterType } from '../../core/types';
import { LEVELS, SEMESTERS, type ArchiveSearch } from '../../hooks/useArchiveSearch';
import { CustomSelect } from './CustomSelect';
import { TactileButton } from './TactileButton';

interface ArchiveFilterFormProps {
  search: ArchiveSearch;
}

/** The filter dropdown under the search bar (university, session, semester, level). */
export const ArchiveFilterForm: React.FC<ArchiveFilterFormProps> = ({ search }) => {
  const {
    store,
    draftSchoolId,
    draftSession,
    draftSemester,
    draftLevel,
    setDraftSchoolId,
    setDraftSession,
    setDraftSemester,
    setDraftLevel,
    filterError,
    hasDraftChanges,
    isFilterSubmitting,
    handleFilterSearchSubmit,
  } = search;

  return (
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
};
