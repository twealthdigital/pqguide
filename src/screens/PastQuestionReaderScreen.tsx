import React, { useCallback, useMemo, useState } from 'react';
import { ArrowLeft, Lightbulb } from 'lucide-react';
import type { PastQuestionDoc } from '../core/types';
import { SearchField } from '../components/ui/SearchField';
import { SurfaceCard } from '../components/ui/SurfaceCard';
import { TactileButton } from '../components/ui/TactileButton';
import { AnswerSheet } from '../components/ui/AnswerSheet';
import {
  ReconstructedDocumentRenderer,
  RichInlineText,
} from '../components/academic/AcademicContentRenderer';
import bannerAshWaves from '../assets/images/banner_ash_waves.webp';
import { courseHeading } from '../core/docTitle';
import type { PaywallContext } from '../core/subscription';

interface PastQuestionReaderScreenProps {
  doc: PastQuestionDoc | null;
  onBack: () => void;
  onOpenPaywall?: (context?: PaywallContext) => void;
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
      <RichInlineText text={text} className="font-serif text-[16px] leading-[1.7] text-[#1A1B20]" />
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
}) => {
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

  const hasReconstructedPages = Boolean(
    doc?.reconstructedPages &&
      doc.reconstructedPages.some((pg) => (pg.blocks && pg.blocks.length > 0) || pg.text.trim())
  );

  const questionBlockKeyToIndex = useMemo(() => {
    const map = new Map<string, number>();
    if (!doc?.reconstructedPages || doc.reconstructedPages.length === 0 || doc.questions.length === 0) {
      return map;
    }
    const used = new Set<number>();
    const normalizePlain = (s: string) =>
      s
        .replace(/\$+/g, '')
        .replace(/[^a-z0-9]+/gi, ' ')
        .trim()
        .toLowerCase();
    const qNorms = doc.questions.map((q) => normalizePlain(stripLabel(q)));
    const orderedPages = [...doc.reconstructedPages].sort((a, b) => a.pageNumber - b.pageNumber);

    for (const pg of orderedPages) {
      const blocks = pg.blocks ?? [];
      blocks.forEach((blk, bIdx) => {
        if (blk.kind !== 'question' || !blk.text) return;
        const blkPlain = normalizePlain(blk.text);
        let bestIdx = -1;
        for (let i = 0; i < qNorms.length; i += 1) {
          if (used.has(i)) continue;
          const needleSlice = blkPlain.slice(0, 28);
          if (needleSlice && qNorms[i].includes(needleSlice)) {
            bestIdx = i;
            break;
          }
        }
        if (bestIdx === -1 && blk.label) {
          const numM = blk.label.match(/\d+/);
          if (numM) {
            const candidate = Number(numM[0]) - 1;
            if (candidate >= 0 && candidate < doc.questions.length && !used.has(candidate)) {
              bestIdx = candidate;
            }
          }
        }
        if (bestIdx === -1) {
          bestIdx = doc.questions.findIndex((_, i) => !used.has(i));
        }
        if (bestIdx >= 0) {
          used.add(bestIdx);
          map.set(`${pg.pageNumber}:${bIdx}`, bestIdx);
        }
      });
    }
    return map;
  }, [doc]);

  const reconstructedHasSearchMatch = useMemo(() => {
    const needle = inlineQuery.trim().toLowerCase();
    if (!needle || !doc?.reconstructedPages) return true;
    return doc.reconstructedPages.some((pg) => {
      if (pg.text.toLowerCase().includes(needle)) return true;
      return (pg.blocks ?? []).some(
        (b) =>
          (b.text && b.text.toLowerCase().includes(needle)) ||
          (b.latex && b.latex.toLowerCase().includes(needle)) ||
          (b.table &&
            (b.table.caption?.toLowerCase().includes(needle) ||
              b.table.headers.some((h) => h.toLowerCase().includes(needle)) ||
              b.table.rows.some((r) => r.some((c) => c.toLowerCase().includes(needle)))))
      );
    });
  }, [doc, inlineQuery]);

  if (!doc) {
    return (
      <SurfaceCard tone="white" className="text-center py-12 page-enter">
        <p className="font-display text-lg font-bold text-[#1A1B20]">
          Select a past question
        </p>
        <p className="text-sm text-[#686C78] mt-1">
          Choose any course from Home to open its indexed questions.
        </p>
        <div className="mt-5 flex justify-center">
          <TactileButton variant="dark" onClick={onBack}>
            Back
          </TactileButton>
        </div>
      </SurfaceCard>
    );
  }

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
            Back
          </TactileButton>

          <h1 className="mt-3.5 font-display text-[32px] sm:text-[40px] font-extrabold tracking-tight leading-[1.1]">
            {courseHeading(doc)}
          </h1>
          <p className="mt-1.5 text-xs text-[#C3C7D2] font-mono-tabular">
            {doc.session} · {doc.level}
          </p>

          <SearchField
            value={inlineQuery}
            onChange={setInlineQuery}
            placeholder={`Search inside ${doc.courseCode}...`}
          />
        </div>
      </div>

      <article className="rounded-3xl border border-[#1A1B20]/[0.08] bg-white px-5 py-6 shadow-[0_2px_12px_-6px_rgba(24,25,30,0.1)] sm:px-8 sm:py-8">
        {hasReconstructedPages && doc.reconstructedPages ? (
          !reconstructedHasSearchMatch ? (
            <p className="py-8 text-center text-sm text-[#686C78]">
              Nothing in this paper matches &ldquo;{inlineQuery}&rdquo;.
            </p>
          ) : (
            <ReconstructedDocumentRenderer
              pages={doc.reconstructedPages}
              variant="student"
              searchQuery={inlineQuery}
              renderQuestionAction={(_qText, _qLabel, blockIdx, pageNumber) => {
                const qIndex = questionBlockKeyToIndex.get(`${pageNumber}:${blockIdx}`);
                if (qIndex === undefined) return null;
                return (
                  <button
                    type="button"
                    onClick={() => openAnswer(qIndex)}
                    className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-[#1D1E23] px-3.5 text-xs font-semibold text-white transition-transform duration-150 active:scale-[0.96]"
                  >
                    <Lightbulb className="h-3.5 w-3.5" />
                    View answer
                  </button>
                );
              }}
            />
          )
        ) : (
          <>
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
          </>
        )}
      </article>

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

