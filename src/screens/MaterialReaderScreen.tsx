import React, { useMemo, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import type { StudyMaterial } from '../core/types';
import {
  subscriptionService,
  useSubscription,
  type PaywallContext,
} from '../core/subscription';
import { DarkHeaderCard } from '../components/ui/DarkHeaderCard';
import { SearchField } from '../components/ui/SearchField';
import { TactileButton } from '../components/ui/TactileButton';
import { PqGuideAiIcon } from '../components/ui/PqGuideAiIcon';
import { RichInlineText } from '../components/academic/AcademicContentRenderer';
import { sanitizeSafeUrl } from '../core/security';
import { MaterialDownloadButton } from '../components/ui/MaterialDownloadButton';

interface MaterialReaderScreenProps {
  material: StudyMaterial | null;
  onBack: () => void;
  onOpenPaywall?: (context?: PaywallContext) => void;
}

export const MaterialReaderScreen: React.FC<MaterialReaderScreenProps> = ({
  material,
  onBack,
  onOpenPaywall,
}) => {
  const [query, setQuery] = useState('');
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [cardIndex, setCardIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  useSubscription();
  const aiUnlocked = subscriptionService.hasAiAccess();

  const flashcards = useMemo(() => {
    if (!material) return [];
    return material.sections.map((sec) => ({
      prompt: sec.heading,
      answer:
        sec.points && sec.points.length > 0
          ? sec.points.slice(0, 3).join(' · ')
          : sec.paragraphs?.[0] ?? material.summary,
    }));
  }, [material]);

  // Keep each section's original number even while filtering.
  const sections = useMemo(() => {
    if (!material) return [];
    const needle = query.trim().toLowerCase();
    return material.sections
      .map((section, index) => ({ section, index }))
      .filter(({ section }) =>
        needle
          ? [section.heading, ...(section.paragraphs ?? []), ...(section.points ?? [])]
              .join(' ')
              .toLowerCase()
              .includes(needle)
          : true
      );
  }, [material, query]);

  if (!material) {
    return (
      <div className="rounded-3xl bg-white p-8 text-center border border-[#1A1B20]/[0.06]">
        <p className="text-sm text-[#686C78]">This guide could not be found.</p>
        <div className="mt-4 flex justify-center">
          <TactileButton variant="dark" size="md" onClick={onBack}>
            Back
          </TactileButton>
        </div>
      </div>
    );
  }

  const activeCard = flashcards[cardIndex] ?? null;

  return (
    <div className="space-y-5 page-enter">
      <DarkHeaderCard>
        <div className="flex items-center justify-between gap-3">
          <TactileButton
            variant="light"
            size="sm"
            icon={<ArrowLeft className="w-4 h-4" />}
            onClick={onBack}
          >
            Back
          </TactileButton>
          <MaterialDownloadButton material={material} tone="light" />
        </div>

        <h1 className="mt-3.5 font-display text-xl sm:text-2xl font-bold leading-snug">
          {material.title}
        </h1>
        <p className="mt-1.5 text-xs text-[#C3C7D2] font-mono-tabular">
          {material.courseCode} · {material.level} · {material.readMinutes} min read
        </p>

        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search inside this guide..."
        />
      </DarkHeaderCard>

      <article className="rounded-3xl border border-[#1A1B20]/[0.08] bg-white px-5 py-6 shadow-[0_2px_12px_-6px_rgba(24,25,30,0.1)] sm:px-8 sm:py-8">
        <p className="text-[15px] leading-7 text-[#3A3D47]">{material.summary}</p>
        {sanitizeSafeUrl(material.attachmentPreviewUrl) && (
          <div className="mt-4 rounded-2xl border border-[#1A1B20]/10 bg-[#F6F7F9] p-3">
            <img
              src={sanitizeSafeUrl(material.attachmentPreviewUrl)}
              alt={`${material.courseCode} study sheet`}
              referrerPolicy="no-referrer"
              className="max-h-80 mx-auto rounded-lg bg-white"
            />
          </div>
        )}

        {aiUnlocked ? (
          <div className="mt-4 space-y-3">
            <button
              type="button"
              onClick={() => setAiPanelOpen((v) => !v)}
              className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-2xl bg-[#1D1E23] px-4 py-3 text-left text-white transition-colors hover:bg-[#2B2D35]"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white">
                  <PqGuideAiIcon size="xs" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-bold">
                    AI Guide Summary &amp; Flashcards · Infinity Active
                  </p>
                  <p className="text-[11px] text-[#C3C7D2] truncate">
                    {flashcards.length} topic flashcards extracted from this study guide
                  </p>
                </div>
              </div>
              <span className="font-mono-tabular text-xs font-semibold text-[#4ADE80] shrink-0">
                {aiPanelOpen ? 'Hide' : 'Open'}
              </span>
            </button>

            {aiPanelOpen && activeCard && (
              <div className="rounded-2xl border border-[#1A1B20]/10 bg-[#F6F7F9] p-4 space-y-3">
                <div className="flex items-center justify-between text-xs text-[#686C78] font-mono-tabular">
                  <span>
                    Flashcard {cardIndex + 1} / {flashcards.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => setFlipped((f) => !f)}
                    className="font-semibold text-[#1A1B20] underline underline-offset-4 cursor-pointer"
                  >
                    {flipped ? 'Show topic' : 'Reveal key notes'}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setFlipped((f) => !f)}
                  className="w-full rounded-xl bg-white border border-[#1A1B20]/10 p-4 text-left cursor-pointer"
                >
                  <p className="text-[11px] font-semibold text-[#686C78]">
                    {flipped ? 'Key Takeaways' : 'Topic Prompt'}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-[#1A1B20] leading-relaxed">
                    {flipped ? activeCard.answer : activeCard.prompt}
                  </p>
                </button>
                {flashcards.length > 1 && (
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setFlipped(false);
                        setCardIndex((i) => (i - 1 + flashcards.length) % flashcards.length);
                      }}
                      className="min-h-[36px] px-3 rounded-xl bg-white border border-[#1A1B20]/10 text-xs font-semibold text-[#1A1B20] inline-flex items-center gap-1 cursor-pointer"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      Prev
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFlipped(false);
                        setCardIndex((i) => (i + 1) % flashcards.length);
                      }}
                      className="min-h-[36px] px-3 rounded-xl bg-[#1D1E23] text-xs font-semibold text-white inline-flex items-center gap-1 cursor-pointer"
                    >
                      Next
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          onOpenPaywall && (
            <button
              type="button"
              aria-disabled="true"
              onClick={() =>
                onOpenPaywall({
                  highlightTier: 'pro_ai',
                  featureLabel: 'AI Guide Summarizer',
                  reason:
                    'Tier 2 includes full offline reading guides. Upgrade to Tier 3 (AI Scholar) to unlock instant AI summaries and key-point flashcards.',
                })
              }
              className="mt-4 flex w-full cursor-pointer items-center justify-between gap-3 rounded-2xl border border-dashed border-[#1A1B20]/15 bg-[#F6F7F9] px-4 py-3 text-left transition-colors hover:bg-[#ECEEF3]"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#1D1E23]/10 text-[#505460]">
                  <PqGuideAiIcon size="xs" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[#3A3D47]">
                    AI Guide Summary &amp; Flashcards
                  </p>
                  <p className="text-[11px] text-[#686C78] truncate">
                    Locked · Included in Tier 3 (AI Scholar)
                  </p>
                </div>
              </div>
              <Lock className="h-3.5 w-3.5 shrink-0 text-[#686C78]" />
            </button>
          )
        )}

        {sections.length === 0 ? (
          <p className="py-8 text-center text-sm text-[#686C78]">
            Nothing in this guide matches &ldquo;{query}&rdquo;.
          </p>
        ) : (
          <div className="mt-6 space-y-8">
            {sections.map(({ section, index }) => (
              <section key={index}>
                <h2 className="flex items-center gap-3 font-display text-base font-bold text-[#1A1B20]">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#1D1E23] font-mono-tabular text-xs font-semibold text-white">
                    {index + 1}
                  </span>
                  {section.heading}
                </h2>

                {section.paragraphs?.map((p, i) => (
                  <RichInlineText
                    key={i}
                    text={p}
                    className="mt-3 text-[15px] leading-7 text-[#3A3D47]"
                  />
                ))}

                {section.points && (
                  <ul className="mt-3 space-y-2.5">
                    {section.points.map((point, i) => (
                      <li key={i} className="flex gap-3 text-[15px] leading-7 text-[#3A3D47]">
                        <span
                          aria-hidden="true"
                          className="mt-[11px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#1D1E23]"
                        />
                        <span className="min-w-0 flex-1">{point}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        )}
      </article>
    </div>
  );
};
