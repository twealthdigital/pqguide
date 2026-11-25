import React, { useState } from 'react';
import {
  ArrowLeft,
  Lock,
  Search,
} from 'lucide-react';
import type { AppScreen, PastQuestionDoc } from '../core/types';
import { hasArchiveAccess } from '../core/pricing';
import { useArchiveStore } from '../hooks/useArchiveStore';
import { SurfaceCard } from '../components/ui/SurfaceCard';
import { TactileButton } from '../components/ui/TactileButton';
import bannerAshWaves from '../assets/images/banner_ash_waves.webp';

interface PastQuestionReaderScreenProps {
  doc: PastQuestionDoc | null;
  onBack: () => void;
  onNavigate: (screen: AppScreen) => void;
}

export const PastQuestionReaderScreen: React.FC<PastQuestionReaderScreenProps> = ({
  doc,
  onBack,
  onNavigate,
}) => {
  const store = useArchiveStore();
  const [inlineQuery, setInlineQuery] = useState('');

  if (!doc) {
    return (
      <SurfaceCard tone="white" className="text-center py-12 page-enter">
        <p className="font-display text-lg font-bold text-[#1A1B20]">
          Select a past question paper
        </p>
        <p className="text-sm text-[#686C78] mt-1">
          Choose any course from the archive to open its indexed questions.
        </p>
        <div className="mt-5 flex justify-center">
          <TactileButton variant="dark" onClick={onBack}>
            Back to Archive
          </TactileButton>
        </div>
      </SurfaceCard>
    );
  }

  const isUnlocked = doc.isFreePreview || hasArchiveAccess(store.activeTierId);

  const matchingQuestions = doc.questions.filter((q) =>
    inlineQuery.trim()
      ? q.toLowerCase().includes(inlineQuery.trim().toLowerCase())
      : true
  );

  return (
    <div className="space-y-5 page-enter">
      {/* Document Header: same dark ash wave look as the home banner, kept compact */}
      <div className="relative overflow-hidden rounded-3xl bg-[#1D1E23] px-5 py-5 text-white shadow-[0_12px_28px_-10px_rgba(24,25,30,0.36)]">
        <img
          src={bannerAshWaves}
          alt=""
          aria-hidden="true"
          width={1200}
          height={670}
          decoding="async"
          className="pointer-events-none select-none absolute inset-0 h-full w-full object-cover object-center opacity-85"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(18,19,24,0.72) 0%, rgba(22,23,29,0.48) 52%, rgba(24,25,30,0.78) 100%)',
          }}
        />
        <div className="relative">
          <TactileButton
            variant="light"
            size="sm"
            icon={<ArrowLeft className="w-4 h-4" />}
            onClick={onBack}
          >
            Back to Archive
          </TactileButton>

          <h1 className="mt-3.5 font-display text-xl sm:text-2xl font-bold leading-snug">
            {doc.courseCode} — {doc.courseTitle}
          </h1>
          <p className="mt-1.5 text-xs text-[#C3C7D2] font-mono-tabular">
            {doc.session} · {doc.level}
          </p>

          {isUnlocked && (
            <div className="mt-3.5 flex items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-[#1A1B20]">
              <Search className="w-4 h-4 text-[#686C78] shrink-0" />
              <input
                type="search"
                value={inlineQuery}
                onChange={(e) => setInlineQuery(e.target.value)}
                placeholder={`Search inside ${doc.courseCode}...`}
                className="w-full bg-transparent text-sm text-[#1A1B20] placeholder:text-[#8E93A2] focus:outline-none"
              />
            </div>
          )}
        </div>
      </div>

      {/* Paywall Gate when locked */}
      {!isUnlocked ? (
        <SurfaceCard tone="white" className="p-6 sm:p-8 text-center">
          <div className="h-12 w-12 rounded-2xl bg-[#EFF1F5] text-[#1D1E23] flex items-center justify-center mx-auto mb-4">
            <Lock className="w-5 h-5" />
          </div>
          <h2 className="font-display text-xl font-bold text-[#1A1B20]">
            Unlock Full {doc.schoolCode} Past Questions
          </h2>
          <p className="text-sm text-[#5A5E6B] mt-2 max-w-md mx-auto leading-relaxed">
            You are currently on the Free Starter tier. Activate a Student Pass starting at{' '}
            <strong className="font-mono-tabular text-[#1A1B20]">₦500/month</strong> or{' '}
            <strong className="font-mono-tabular text-[#1A1B20]">₦2,000/semester</strong> to
            read {doc.courseCode} and every indexed paper.
          </p>

          {/* Teaser Snippet */}
          <div className="mt-6 rounded-2xl bg-[#F6F7F9] p-4 text-left max-w-xl mx-auto border border-[#1A1B20]/[0.06]">
            <p className="text-xs font-semibold text-[#686C78] mb-1.5">
              First Line Preview
            </p>
            <p className="text-sm text-[#1A1B20] line-clamp-2">
              {doc.questions[0] ?? doc.extractedText}
            </p>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <TactileButton
              variant="dark"
              size="lg"
              onClick={() => onNavigate('subscription')}
            >
              Choose a Student Pass
            </TactileButton>
            <TactileButton variant="light" size="lg" onClick={onBack}>
              Browse Free Previews
            </TactileButton>
          </div>
        </SurfaceCard>
      ) : (
        <SurfaceCard tone="white" className="p-5 sm:p-7 space-y-5">
          {/* Exam Header Rubric */}
          <div className="rounded-2xl bg-[#F6F7F9] p-4 text-xs sm:text-sm text-[#3A3D47] whitespace-pre-line leading-relaxed font-mono-tabular">
            {doc.extractedText}
          </div>

          {/* Extracted Indexed Questions */}
          <div className="divide-y divide-[#1A1B20]/[0.06]">
            {matchingQuestions.length === 0 ? (
              <p className="py-6 text-sm text-[#686C78] text-center">
                No question lines match "{inlineQuery}".
              </p>
            ) : (
              matchingQuestions.map((question, idx) => (
                <div key={idx} className="py-4 first:pt-1 last:pb-1">
                  <p className="text-sm sm:text-base text-[#1A1B20] leading-relaxed">
                    {question}
                  </p>
                </div>
              ))
            )}
          </div>
        </SurfaceCard>
      )}
    </div>
  );
};
