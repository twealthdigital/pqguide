import React, { useEffect } from 'react';
import { ArrowRight, CheckCircle2, FileText, FolderOpen, Lock, ScanLine } from 'lucide-react';
import type { AppScreen, PastQuestionDoc } from '../core/types';
import {
  subscriptionService,
  useSubscription,
  type PaywallContext,
} from '../core/subscription';
import { useArchiveSearch } from '../hooks/useArchiveSearch';
import {
  DocumentListSkeleton,
  PqGuideAiIcon,
  SurfaceCard,
  TactileButton,
  WaveHeader,
} from '../components/ui';
import { ArchiveFilterForm } from '../components/ui/ArchiveFilterForm';
import { courseSubtitle } from '../core/docTitle';

interface HomeScreenProps {
  onOpenDocument: (doc: PastQuestionDoc) => void;
  focusSearchSignal: number;
  onOpenPaywall?: (context?: PaywallContext) => void;
  onNavigate?: (screen: AppScreen) => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  onOpenDocument,
  focusSearchSignal,
  onOpenPaywall,
  onNavigate,
}) => {
  const search = useArchiveSearch();
  useSubscription();
  const aiUnlocked = subscriptionService.hasAiAccess();
  const {
    store,
    activeSchool,
    filteredDocs,
    searchInputRef,
    resultsRef,
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

  const cms = store.siteCms.studentUi;

  // Focus search when user taps the raised center Quick Find button
  useEffect(() => {
    if (focusSearchSignal > 0 && searchInputRef.current) {
      searchInputRef.current.focus();
      searchInputRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [focusSearchSignal, searchInputRef]);

  const publishedForSchool = store.documents.filter(
    (d) => d.status === 'published' && d.schoolId === activeSchool.id
  );
  const heroFeaturedDoc = filteredDocs[0] ?? publishedForSchool[0];
  const secondaryHighlightDoc = filteredDocs[1] ?? publishedForSchool[1];

  return (
    <div className="space-y-6 page-enter">
      {/* Sculpted Dark Ash Header Banner + Morphing Search & Anchored Filter Dropdown */}
      <WaveHeader
        title={cms.homeHeroTitle}
        placeholder={cms.homeSearchPlaceholder}
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

      {/* Featured Cards Row (Dark Ash Wave Card + Soft Ash Card matching Master Task Management UI) */}
      <section aria-label="Quick actions and featured past questions">
        <div className="flex items-center justify-between mb-3.5">
          <h2 className="font-display text-lg font-bold text-[#1A1B20]">
            {cms.featuredHeading}
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
                  {courseSubtitle(heroFeaturedDoc)}
                </p>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <span className="text-xs text-[#A5AAB8]">
                  Ready to read
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
                  {courseSubtitle(secondaryHighlightDoc)}
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
                {cms.guideTitle}
              </h3>
              <ol className="mt-3 space-y-2 text-xs text-[#505460]">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#1D1E23] shrink-0 mt-0.5" />
                  <span>{cms.guideStep1}</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#1D1E23] shrink-0 mt-0.5" />
                  <span>{cms.guideStep2}</span>
                </li>
                <li className="flex items-start gap-2">
                  <PqGuideAiIcon size="xs" className="text-[#1D1E23] shrink-0 mt-0.5" />
                  <span>{cms.guideStep3}</span>
                </li>
              </ol>
            </div>

            {onNavigate && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onNavigate('document_scanner')}
                  className="flex items-center justify-center gap-1.5 rounded-xl bg-[#F6F7F9] hover:bg-[#ECEEF3] border border-[#1A1B20]/10 px-2.5 py-2 text-xs font-semibold text-[#1A1B20] cursor-pointer transition-colors"
                >
                  <ScanLine className="w-3.5 h-3.5 shrink-0" />
                  <span>Scan Docs</span>
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('document_library')}
                  className="flex items-center justify-center gap-1.5 rounded-xl bg-[#F6F7F9] hover:bg-[#ECEEF3] border border-[#1A1B20]/10 px-2.5 py-2 text-xs font-semibold text-[#1A1B20] cursor-pointer transition-colors"
                >
                  <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                  <span>Doc Library</span>
                </button>
              </div>
            )}

            {aiUnlocked ? (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => onNavigate?.('ai_assistant')}
                  className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl bg-[#1D1E23] px-3.5 py-2.5 text-left text-white transition-colors hover:bg-[#2B2D35]"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <PqGuideAiIcon size="xs" className="text-white shrink-0" />
                    <span className="text-xs font-semibold truncate">
                      Open PQGuide AI Assistant
                    </span>
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[#C3C7D2]" />
                </button>
              </div>
            ) : (
              onOpenPaywall && (
                <button
                  type="button"
                  aria-disabled="true"
                  onClick={() =>
                    onOpenPaywall({
                      highlightTier: 'pro_ai',
                      featureLabel: 'AI Study Assistant',
                      reason:
                        'Standard unlocks everything the core webapp can do. Tier 3 (AI Scholar) adds an AI Study Assistant for instant question breakdowns and smart topic predictions.',
                    })
                  }
                  className="mt-3 flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-dashed border-[#1A1B20]/15 bg-[#F6F7F9] px-3.5 py-2.5 text-left transition-colors hover:bg-[#ECEEF3]"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <PqGuideAiIcon size="xs" className="text-[#505460] shrink-0" />
                    <span className="text-xs font-semibold text-[#3A3D47] truncate">
                      PQGuide AI Assistant (Tier 3)
                    </span>
                  </span>
                  <Lock className="h-3.5 w-3.5 shrink-0 text-[#686C78]" />
                </button>
              )
            )}
          </SurfaceCard>
        </div>
      </section>

      {/* Searchable Past Questions List */}
      <section ref={resultsRef} aria-label="Past questions">
        <div className="flex items-center justify-between mb-3.5">
          <div>
            <h2 className="font-display text-lg font-bold text-[#1A1B20]">
              {cms.pastQuestionsHeading}
            </h2>
            <p className="text-xs text-[#686C78] font-mono-tabular mt-0.5">
              Explore free past questions
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
            {filteredDocs.map((doc) => {
              return (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => onOpenDocument(doc)}
                  className="w-full text-left rounded-2xl bg-white p-4 border border-[#1A1B20]/[0.06] shadow-[0_2px_10px_-4px_rgba(24,25,30,0.06)] hover:shadow-[0_8px_20px_-6px_rgba(24,25,30,0.1)] transition-all duration-150 flex items-center justify-between gap-4 cursor-pointer active:scale-[0.995]"
                >
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    <div
                      className="h-11 w-11 rounded-xl bg-[#1D1E23] text-white flex items-center justify-center shrink-0"
                    >
                      <FileText className="w-5 h-5" />
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
                        {courseSubtitle(doc)}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1.5 shrink-0 self-stretch justify-between">
                    <span className="min-h-[36px] px-3.5 rounded-xl bg-[#F6F7F9] text-xs font-semibold text-[#1A1B20] flex items-center gap-1.5 whitespace-nowrap">
                      Open
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
