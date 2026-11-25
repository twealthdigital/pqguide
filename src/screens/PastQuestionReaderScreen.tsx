import React, { useCallback, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Lightbulb,
  Lock,
  Search,
} from 'lucide-react';
import type { AppScreen, PastQuestionDoc } from '../core/types';
import { hasArchiveAccess } from '../core/pricing';
import { useArchiveStore } from '../hooks/useArchiveStore';
import { SurfaceCard } from '../components/ui/SurfaceCard';
import { TactileButton } from '../components/ui/TactileButton';
import { AnswerSheet } from '../components/ui/AnswerSheet';
import bannerAshWaves from '../assets/images/banner_ash_waves.webp';

interface PastQuestionReaderScreenProps {
  doc: PastQuestionDoc | null;
  onBack: () => void;
  onNavigate: (screen: AppScreen) => void;
}

const stripLabel = (q: string) => q.replace(/^Q\d+\s*[:.)-]\s*/i, '');

interface QuestionRowProps {
  index: number;
  text: string;
  onOpen: (index: number) => void;
}

const QuestionRow: React.FC<QuestionRowProps> = React.memo(({ index, text, onOpen }) => (
  <li className="flex gap-3">
    <span className="w-6 shrink-0 pt-px font-serif text-[15px] font-bold tabular-nums text-[#1A1B20]">
      {index + 1}.
    </span>
    <div className="min-w-0 flex-1">
      <p className="font-serif text-[16px] leading-[1.7] text-[#1A1B20]">{text}</p>
      <button
        type="button"
        onClick={() => onOpen(index)}
        className="mt-3 inline-flex h-9 cursor-pointer items-center gap-2 rounded-full bg-[#1D1E23] px-4 text-xs font-semibold text-white transition-transform duration-150 active:scale-[0.96]"
      >
        <Lightbulb className="h-3.5 w-3.5" />
        View answer
      </button>
    </div>
  </li>
));
QuestionRow.displayName = 'QuestionRow';

export const PastQuestionReaderScreen: React.FC<PastQuestionReaderScreenProps> = ({
  doc,
  onBack,
  onNavigate,
}) => {
  const store = useArchiveStore();
  const [inlineQuery, setInlineQuery] = useState('');
  const [sheet, setSheet] = useState<{ index: number; open: boolean } | null>(null);

  const openAnswer = useCallback((index: number) => {
    setSheet({ index, open: true });
  }, []);
  const closeAnswer = useCallback(() => {
    setSheet((cur) => (cur ? { ...cur, open: false } : cur));
  }, []);
  const exitedAnswer = useCallback(() => {
    setSheet((cur) => (cur && !cur.open ? null : cur));
  }, []);

  const headerLines = useMemo(
    () => (doc ? doc.extractedText.split('\n').map((l) => l.trim()).filter(Boolean) : []),
    [doc]
  );

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

  const needle = inlineQuery.trim().toLowerCase();
  const matchingQuestions = doc.questions
    .map((q, index) => ({ index, text: stripLabel(q) }))
    .filter((q) => (needle ? q.text.toLowerCase().includes(needle) : true));

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
        <article className="rounded-3xl border border-[#1A1B20]/[0.08] bg-white px-5 py-6 shadow-[0_2px_12px_-6px_rgba(24,25,30,0.1)] sm:px-8 sm:py-8">
          {/* Exam paper heading */}
          {headerLines.length > 0 && (
            <header className="border-b-[3px] border-double border-[#1A1B20]/50 pb-4 text-center font-serif text-[#1A1B20]">
              <p className="text-balance text-[13px] font-bold leading-5 tracking-[0.04em]">
                {headerLines[0]}
              </p>
              {headerLines.slice(1).map((line, i) => (
                <p key={i} className="mt-0.5 text-balance text-[12px] leading-5 text-[#3A3D47]">
                  {line}
                </p>
              ))}
            </header>
          )}

          {matchingQuestions.length === 0 ? (
            <p className="py-8 text-center text-sm text-[#686C78]">
              No questions match "{inlineQuery}".
            </p>
          ) : (
            <ol className="mt-6 space-y-7">
              {matchingQuestions.map((q) => (
                <QuestionRow
                  key={q.index}
                  index={q.index}
                  text={q.text}
                  onOpen={openAnswer}
                />
              ))}
            </ol>
          )}
        </article>
      )}

      {sheet && (
        <AnswerSheet
          open={sheet.open}
          number={sheet.index + 1}
          question={stripLabel(doc.questions[sheet.index] ?? '')}
          solution={doc.solutions?.[sheet.index] ?? null}
          onClose={closeAnswer}
          onExited={exitedAnswer}
        />
      )}
    </div>
  );
};
