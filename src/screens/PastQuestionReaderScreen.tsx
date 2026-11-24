import React, { useState } from 'react';
import {
  ArrowLeft,
  FileText,
  Lock,
  ScanLine,
  Search,
} from 'lucide-react';
import type { AppScreen, PastQuestionDoc } from '../core/types';
import { hasArchiveAccess } from '../core/pricing';
import { useArchiveStore } from '../hooks/useArchiveStore';
import { SurfaceCard } from '../components/ui/SurfaceCard';
import { TactileButton } from '../components/ui/TactileButton';

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
  const [viewMode, setViewMode] = useState<'typed' | 'scan'>('typed');
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
      {/* Top Reader Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TactileButton
          variant="light"
          size="sm"
          icon={<ArrowLeft className="w-4 h-4" />}
          onClick={onBack}
        >
          Back to Archive
        </TactileButton>

        {doc.sourceType === 'scanned_image' && isUnlocked && (
          <div className="flex items-center gap-1 p-1 rounded-xl bg-[#EAECEF]">
            <button
              type="button"
              onClick={() => setViewMode('typed')}
              className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors ${
                viewMode === 'typed'
                  ? 'bg-white text-[#1A1B20] shadow-sm'
                  : 'text-[#686C78]'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Typed Index
            </button>
            <button
              type="button"
              onClick={() => setViewMode('scan')}
              className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors ${
                viewMode === 'scan'
                  ? 'bg-white text-[#1A1B20] shadow-sm'
                  : 'text-[#686C78]'
              }`}
            >
              <ScanLine className="w-3.5 h-3.5" />
              Scan-to-PDF
            </button>
          </div>
        )}
      </div>

      {/* Document Header Card */}
      <SurfaceCard tone="ash" withWaves className="p-6">
        <div className="flex flex-wrap items-center gap-2 text-xs text-[#A5AAB8] font-mono-tabular">
          <span>{doc.schoolCode}</span>
          <span aria-hidden="true">·</span>
          <span>{doc.session}</span>
          <span aria-hidden="true">·</span>
          <span>{doc.semester}</span>
          <span aria-hidden="true">·</span>
          <span>{doc.level}</span>
        </div>

        <h1 className="font-display text-2xl sm:text-3xl font-bold text-white mt-2">
          {doc.courseCode} — {doc.courseTitle}
        </h1>
        <p className="text-sm text-[#B8BCC8] mt-1">
          Department of {doc.department} · Faculty of {doc.faculty}
        </p>
      </SurfaceCard>

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
      ) : viewMode === 'scan' && doc.sourceType === 'scanned_image' ? (
        <SurfaceCard tone="white" className="p-4 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-display text-base font-bold text-[#1A1B20]">
                Digital Scan-to-PDF View
              </h2>
              <p className="text-xs text-[#686C78]">
                Normalized high-contrast document sheet ({doc.originalFileName})
              </p>
            </div>
          </div>

          {doc.scannedPagePreviewUrl ? (
            <div className="rounded-2xl overflow-hidden border border-[#1A1B20]/10 bg-[#F2F4F7] p-2">
              <img
                src={doc.scannedPagePreviewUrl}
                alt={`Scanned exam sheet for ${doc.courseCode}`}
                referrerPolicy="no-referrer"
                className="w-full max-w-2xl mx-auto rounded-xl shadow-sm bg-white"
              />
            </div>
          ) : (
            <div className="rounded-2xl border border-[#1A1B20]/10 bg-white p-6 sm:p-8 max-w-2xl mx-auto shadow-inner font-serif text-[#1A1B20] space-y-4">
              <div className="border-b border-[#1A1B20]/20 pb-3 text-center">
                <p className="text-xs font-bold tracking-wider">
                  ADEKUNLE AJASIN UNIVERSITY, AKUNGBA-AKOKO
                </p>
                <p className="text-sm font-bold mt-1">
                  {doc.session} · {doc.semester.toUpperCase()}
                </p>
                <p className="text-base font-bold mt-1">
                  {doc.courseCode}: {doc.courseTitle}
                </p>
              </div>
              <div className="space-y-3 text-sm leading-relaxed">
                {doc.questions.map((q, idx) => (
                  <p key={idx}>{q}</p>
                ))}
              </div>
            </div>
          )}
        </SurfaceCard>
      ) : (
        <SurfaceCard tone="white" className="p-5 sm:p-7 space-y-5">
          {/* In-paper search bar */}
          <div className="flex items-center gap-2 rounded-xl bg-[#F6F7F9] px-3.5 py-2 border border-[#1A1B20]/[0.06]">
            <Search className="w-4 h-4 text-[#686C78] shrink-0" />
            <input
              type="search"
              value={inlineQuery}
              onChange={(e) => setInlineQuery(e.target.value)}
              placeholder={`Search inside ${doc.courseCode}...`}
              className="w-full bg-transparent text-sm text-[#1A1B20] placeholder:text-[#8E93A2] focus:outline-none"
            />
          </div>

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
