import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Award,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock,
  XCircle,
} from 'lucide-react';
import { EXAM_TYPES } from '../core/mockExam';
import {
  computeOverallRating,
  updateTheoryMarks,
  useExamPerformances,
  type ExamPerformanceRecord,
  type TheoryMark,
} from '../core/performanceStore';
import { DarkHeaderCard } from '../components/ui/DarkHeaderCard';
import { TactileButton } from '../components/ui/TactileButton';
import { useArchiveStore } from '../hooks/useArchiveStore';

export type PerformanceSubView = 'list' | 'detail' | 'overall';

interface PerformanceScreenProps {
  onStartExam: () => void;
  initialAttemptId?: string | null;
  view?: PerformanceSubView;
  selectedId?: string | null;
  onOpenDetail?: (id: string) => void;
  onOpenOverall?: () => void;
  onBackView?: () => void;
  onViewList?: () => void;
}

type SubView = PerformanceSubView;
type DetailFilter = 'all' | 'missed' | 'correct';

const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const;

const card =
  'rounded-2xl bg-white p-4 sm:p-5 border border-[#1A1B20]/[0.06] shadow-[0_2px_10px_-4px_rgba(24,25,30,0.06)]';

const formatClock = (totalSeconds: number) => {
  const s = Math.max(0, totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

const formatDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
};

const examTypeBadge = (type: ExamPerformanceRecord['examType']) =>
  EXAM_TYPES.find((t) => t.id === type)?.badge ?? type.toUpperCase();

export const PerformanceScreen: React.FC<PerformanceScreenProps> = ({
  onStartExam,
  initialAttemptId = null,
  view: controlledView,
  selectedId: controlledSelectedId,
  onOpenDetail,
  onOpenOverall,
  onBackView,
  onViewList,
}) => {
  const { siteCms } = useArchiveStore();
  const perfCms = siteCms.performancePage;
  const records = useExamPerformances();
  const [localView, setLocalView] = useState<SubView>('list');
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(initialAttemptId);
  const [filter, setFilter] = useState<DetailFilter>('all');

  const view = controlledView ?? localView;
  const selectedId = controlledSelectedId !== undefined ? controlledSelectedId : localSelectedId;

  const selectedRecord = useMemo(
    () => records.find((r) => r.id === selectedId) ?? records[0] ?? null,
    [records, selectedId]
  );

  const overall = useMemo(() => computeOverallRating(records), [records]);

  const openDetail = (id: string) => {
    setFilter('all');
    if (onOpenDetail) {
      onOpenDetail(id);
    } else {
      setLocalSelectedId(id);
      setLocalView('detail');
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  };

  const openOverall = () => {
    if (onOpenOverall) {
      onOpenOverall();
    } else {
      setLocalView('overall');
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  };

  const goBackView = () => {
    if (onBackView) {
      onBackView();
    } else {
      setLocalView('list');
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  };

  const goListView = () => {
    if (onViewList) {
      onViewList();
    } else {
      setLocalView('list');
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  };

  // ------------------------------------------------------------------ Overall Rating Page
  if (view === 'overall') {
    const weakestCourse =
      overall.byCourse.length > 0 ? overall.byCourse[overall.byCourse.length - 1] : null;

    return (
      <div className="space-y-5 page-enter lg:mx-auto lg:max-w-3xl">
        <DarkHeaderCard>
          <TactileButton
            variant="light"
            size="sm"
            icon={<ArrowLeft className="w-4 h-4" />}
            onClick={goBackView}
          >
            Back
          </TactileButton>
          <h1 className="mt-3.5 font-display text-[32px] sm:text-[40px] font-extrabold tracking-tight leading-[1.1]">
            {perfCms.overallHeading}
          </h1>
          <p className="mt-1.5 text-xs text-[#C3C7D2]">
            {perfCms.overallSubtitle}
          </p>
        </DarkHeaderCard>

        <section aria-label="Overall percentage rating" className={`${card} space-y-4`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="h-14 w-14 rounded-2xl bg-[#1D1E23] text-white flex items-center justify-center shrink-0">
                <Award className="w-7 h-7" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#686C78]">
                  Overall rating
                </p>
                <div className="flex items-baseline gap-2.5">
                  <p className="font-display text-3xl sm:text-4xl font-bold text-[#1A1B20] font-mono-tabular">
                    {overall.gradedExams > 0 ? `${overall.overallPercent}%` : '—'}
                  </p>
                  <span className="rounded-full bg-[#F2F4F7] px-2.5 py-0.5 text-xs font-bold text-[#1A1B20]">
                    {overall.tierLabel}
                  </span>
                </div>
              </div>
            </div>
            <div className="text-left sm:text-right">
              <p className="text-xs font-semibold text-[#686C78]">Scale</p>
              <p className="font-mono-tabular text-sm font-bold text-[#1A1B20]">Out of 100%</p>
            </div>
          </div>

          <div className="h-2.5 rounded-full bg-[#ECEEF3] overflow-hidden" aria-hidden="true">
            <div
              className="h-full rounded-full bg-[#1D1E23] transition-[width] duration-300 ease-out"
              style={{ width: `${overall.gradedExams > 0 ? overall.overallPercent : 0}%` }}
            />
          </div>

          <p className="text-xs sm:text-sm text-[#505460] leading-relaxed">
            {overall.tierSummary}
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 text-center">
            <div className="rounded-xl bg-[#F6F7F9] p-3">
              <p className="font-display text-lg font-bold text-[#1A1B20] font-mono-tabular">
                {overall.gradedExams}
              </p>
              <p className="text-[11px] text-[#686C78]">Graded exams</p>
            </div>
            <div className="rounded-xl bg-[#F6F7F9] p-3">
              <p className="font-display text-lg font-bold text-[#1A1B20] font-mono-tabular">
                {overall.totalQuestions}
              </p>
              <p className="text-[11px] text-[#686C78]">Total questions</p>
            </div>
            <div className="rounded-xl bg-[#F6F7F9] p-3">
              <p className="font-display text-lg font-bold text-[#1A1B20] font-mono-tabular">
                {Number.isInteger(overall.totalEarnedPoints)
                  ? overall.totalEarnedPoints
                  : overall.totalEarnedPoints.toFixed(1)}
              </p>
              <p className="text-[11px] text-[#686C78]">Points earned</p>
            </div>
            <div className="rounded-xl bg-[#F6F7F9] p-3">
              <p className="font-display text-lg font-bold text-[#1A1B20] font-mono-tabular">
                {overall.totalMissed + overall.totalSkipped}
              </p>
              <p className="text-[11px] text-[#686C78]">Missed / skipped</p>
            </div>
          </div>
        </section>

        {overall.byCourse.length > 0 && (
          <section aria-label="Rating by course" className={`${card} space-y-3.5`}>
            <h2 className="font-display text-base font-bold text-[#1A1B20]">Rating by course</h2>
            <div className="space-y-3">
              {overall.byCourse.map((c) => (
                <div key={c.courseLabel} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold text-[#1A1B20]">{c.courseLabel}</span>
                    <span className="font-mono-tabular font-bold text-[#1A1B20]">
                      {c.percent}%{' '}
                      <span className="font-normal text-xs text-[#686C78]">
                        ({c.questions} q · {c.attempts} {c.attempts === 1 ? 'exam' : 'exams'})
                      </span>
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-[#ECEEF3] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#1D1E23]"
                      style={{ width: `${c.percent}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {overall.byType.length > 0 && (
          <section aria-label="Rating by exam type" className={`${card} space-y-3.5`}>
            <h2 className="font-display text-base font-bold text-[#1A1B20]">Rating by exam type</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {overall.byType.map((t) => (
                <div
                  key={t.examType}
                  className="rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/[0.06] p-3.5 flex items-center justify-between"
                >
                  <div>
                    <p className="text-sm font-bold text-[#1A1B20]">{examTypeBadge(t.examType)}</p>
                    <p className="text-xs text-[#686C78]">
                      {t.attempts} {t.attempts === 1 ? 'attempt' : 'attempts'} · {t.questions} q
                    </p>
                  </div>
                  <p className="font-display text-xl font-bold font-mono-tabular text-[#1A1B20]">
                    {t.percent}%
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {weakestCourse && weakestCourse.percent < 75 && (
          <div className={`${card} flex flex-col sm:flex-row sm:items-center justify-between gap-3`}>
            <div>
              <p className="text-sm font-bold text-[#1A1B20]">Recommended next focus</p>
              <p className="text-xs text-[#505460] mt-0.5">
                {weakestCourse.courseLabel} is currently at {weakestCourse.percent}%. Another short
                practice set will lift your overall rating.
              </p>
            </div>
            <TactileButton variant="dark" size="sm" onClick={onStartExam}>
              Practice now
            </TactileButton>
          </div>
        )}

        <div className="flex flex-wrap gap-2.5">
          <TactileButton variant="dark" onClick={onStartExam}>
            Take another exam
          </TactileButton>
          <TactileButton variant="light" onClick={goListView}>
            View all performances
          </TactileButton>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------ Detail View
  if (view === 'detail' && selectedRecord) {
    const rec = selectedRecord;
    const isTheory = rec.examType === 'theory';
    const perQuestionWeight =
      rec.totalQuestions > 0 ? (100 / rec.totalQuestions).toFixed(rec.totalQuestions <= 20 ? 1 : 2) : '0';

    const classifyQuestion = (qId: string): 'correct' | 'partly' | 'missed' | 'skipped' | 'unmarked' => {
      const q = rec.questions.find((item) => item.id === qId);
      if (!q) return 'skipped';
      const mine = (rec.answers[q.id] ?? '').trim();
      if (isTheory) {
        const m = rec.marks[q.id];
        if (!m) return mine ? 'unmarked' : 'skipped';
        return m === 'got' ? 'correct' : m === 'partly' ? 'partly' : 'missed';
      }
      if (!mine) return 'skipped';
      if (rec.examType === 'boolean') {
        return mine === (q.correctBoolean ? 'true' : 'false') ? 'correct' : 'missed';
      }
      return Number(mine) === q.correctIndex ? 'correct' : 'missed';
    };

    const filteredQuestions = rec.questions.filter((q) => {
      const status = classifyQuestion(q.id);
      if (filter === 'missed') return status === 'missed' || status === 'skipped' || status === 'partly';
      if (filter === 'correct') return status === 'correct';
      return true;
    });

    const correctOnlyCount = rec.questions.filter((q) => classifyQuestion(q.id) === 'correct').length;
    const missedOrSkippedCount = rec.questions.filter((q) => {
      const s = classifyQuestion(q.id);
      return s === 'missed' || s === 'skipped' || s === 'partly';
    }).length;

    return (
      <div className="space-y-5 page-enter lg:mx-auto lg:max-w-3xl">
        <DarkHeaderCard>
          <TactileButton
            variant="light"
            size="sm"
            icon={<ArrowLeft className="w-4 h-4" />}
            onClick={goBackView}
          >
            Back to performance
          </TactileButton>
          <h1 className="mt-3.5 font-display text-[32px] sm:text-[40px] font-extrabold tracking-tight leading-[1.1]">
            {rec.courseLabel} · {examTypeBadge(rec.examType)}
          </h1>
          <p className="mt-1.5 text-xs text-[#C3C7D2]">
            Taken {formatDate(rec.createdAt)} · {rec.totalQuestions} question
            {rec.totalQuestions === 1 ? '' : 's'} ({perQuestionWeight}% each)
          </p>
        </DarkHeaderCard>

        <section aria-label="Exam score summary" className={`${card} space-y-3`}>
          {rec.endedByTimer && (
            <p className="rounded-xl bg-[#FFF4D6] px-3.5 py-2.5 text-xs font-semibold text-[#6B4E00]">
              Time was up, so this exam was submitted automatically.
            </p>
          )}

          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="font-display text-xl font-bold text-[#1A1B20] font-mono-tabular">
                {isTheory && rec.isTheoryPendingMark && Object.keys(rec.marks).length === 0
                  ? '—'
                  : `${rec.scorePercent}%`}
              </p>
              <p className="text-[11px] text-[#686C78]">Total score (100%)</p>
            </div>
            <div>
              <p className="font-display text-xl font-bold text-[#1A1B20] font-mono-tabular">
                {rec.answeredCount}/{rec.totalQuestions}
              </p>
              <p className="text-[11px] text-[#686C78]">Answered</p>
            </div>
            <div>
              <p className="font-display text-xl font-bold text-[#1A1B20] font-mono-tabular">
                {formatClock(rec.usedSeconds)}
              </p>
              <p className="text-[11px] text-[#686C78]">Time used</p>
            </div>
          </div>

          <p className="text-xs text-[#686C78] leading-relaxed">
            {isTheory
              ? `100% is shared equally across all ${rec.totalQuestions} questions (${perQuestionWeight}% each). Compare with the model answers and mark yourself below to lock in your score.`
              : `Each question carries ${perQuestionWeight}% out of 100%. You got ${correctOnlyCount} right and missed or skipped ${missedOrSkippedCount}.`}
          </p>

          <div className="pt-1 flex flex-wrap gap-2">
            <TactileButton variant="dark" size="sm" icon={<Award className="w-4 h-4" />} onClick={openOverall}>
              Check overall rating
            </TactileButton>
            <TactileButton variant="light" size="sm" onClick={onStartExam}>
              New practice exam
            </TactileButton>
          </div>
        </section>

        {/* Filter Tabs */}
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter questions">
          {(
            [
              ['all', `All (${rec.totalQuestions})`],
              ['missed', `Missed / skipped (${missedOrSkippedCount})`],
              ['correct', `Correct (${correctOnlyCount})`],
            ] as Array<[DetailFilter, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={filter === id}
              onClick={() => setFilter(id)}
              className={`min-h-[38px] rounded-xl px-3.5 text-xs font-semibold border transition-colors cursor-pointer ${
                filter === id
                  ? 'bg-[#1D1E23] text-white border-transparent'
                  : 'bg-white text-[#1A1B20] border-[#1A1B20]/[0.08] hover:bg-[#ECEEF3]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {filteredQuestions.length === 0 ? (
          <div className={`${card} text-center py-8`}>
            <p className="text-sm font-semibold text-[#1A1B20]">No questions in this filter</p>
            <p className="mt-1 text-xs text-[#686C78]">
              Switch back to All to inspect every question you took.
            </p>
          </div>
        ) : (
          <ol className="space-y-4">
            {filteredQuestions.map((q) => {
              const rawAns = rec.answers[q.id] ?? '';
              const mine = rawAns.trim();
              const status = classifyQuestion(q.id);

              if (!isTheory) {
                const isBoolean = rec.examType === 'boolean';
                return (
                  <li key={q.id} className={`${card} space-y-3.5`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] font-mono-tabular font-semibold text-[#686C78]">
                        {q.source}
                      </span>
                      {status === 'skipped' ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#FFF4D6] px-2.5 py-0.5 text-[11px] font-semibold text-[#6B4E00]">
                          Skipped
                        </span>
                      ) : status === 'correct' ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#E6F6EC] px-2.5 py-0.5 text-[11px] font-semibold text-[#166534]">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Correct
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#FDECEC] px-2.5 py-0.5 text-[11px] font-semibold text-[#9B1C1C]">
                          <XCircle className="w-3.5 h-3.5" /> Missed
                        </span>
                      )}
                    </div>

                    <p className="font-serif text-[16px] leading-[1.7] text-[#1A1B20]">
                      <span className="font-bold tabular-nums">{q.number}. </span>
                      {q.text}
                    </p>

                    {isBoolean ? (
                      <div className="grid grid-cols-2 gap-2.5">
                        {(['true', 'false'] as const).map((val) => {
                          const expected = q.correctBoolean ? 'true' : 'false';
                          const isRightOption = val === expected;
                          const userPickedThis = mine === val;
                          return (
                            <div
                              key={val}
                              className={`rounded-xl px-3.5 py-2.5 text-sm font-semibold border flex items-center justify-between ${
                                isRightOption
                                  ? 'bg-[#E6F6EC] border-[#166534]/30 text-[#166534]'
                                  : userPickedThis
                                    ? 'bg-[#FDECEC] border-[#9B1C1C]/30 text-[#9B1C1C]'
                                    : 'bg-[#F6F7F9] border-[#1A1B20]/[0.06] text-[#686C78]'
                              }`}
                            >
                              <span>{val === 'true' ? 'True' : 'False'}</span>
                              {isRightOption && <Check className="w-4 h-4" />}
                              {!isRightOption && userPickedThis && <XCircle className="w-4 h-4" />}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {(q.options ?? []).map((opt, idx) => {
                          const isRightOption = idx === q.correctIndex;
                          const userPickedThis = mine !== '' && Number(mine) === idx;
                          return (
                            <div
                              key={idx}
                              className={`rounded-xl p-3 text-sm border flex items-start gap-2.5 ${
                                isRightOption
                                  ? 'bg-[#E6F6EC] border-[#166534]/30 text-[#166534]'
                                  : userPickedThis
                                    ? 'bg-[#FDECEC] border-[#9B1C1C]/30 text-[#9B1C1C]'
                                    : 'bg-[#F6F7F9] border-[#1A1B20]/[0.06] text-[#505460]'
                              }`}
                            >
                              <span className="font-bold shrink-0">{OPTION_LETTERS[idx]}.</span>
                              <span className="flex-1">{opt}</span>
                              {isRightOption && <Check className="w-4 h-4 shrink-0 mt-0.5" />}
                              {!isRightOption && userPickedThis && (
                                <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {q.solution && q.solution.explanation.length > 0 && (
                      <div className="rounded-2xl bg-[#1D1E23] px-4 py-3 text-white">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#A5AAB8]">
                          Explanation
                        </p>
                        <ul className="mt-2 space-y-1.5 text-sm leading-6 text-[#E6E8EE]">
                          {q.solution.explanation.map((step, i) => (
                            <li key={i}>{step}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </li>
                );
              }

              // Theory question detail with interactive self-marking
              const mark = rec.marks[q.id];
              return (
                <li key={q.id} className={`${card} space-y-3.5`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-mono-tabular font-semibold text-[#686C78]">
                      {q.source}
                    </span>
                    {mark === 'got' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#E6F6EC] px-2.5 py-0.5 text-[11px] font-semibold text-[#166534]">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Got it
                      </span>
                    )}
                    {mark === 'partly' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#FFF4D6] px-2.5 py-0.5 text-[11px] font-semibold text-[#6B4E00]">
                        Partly
                      </span>
                    )}
                    {mark === 'missed' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#FDECEC] px-2.5 py-0.5 text-[11px] font-semibold text-[#9B1C1C]">
                        <XCircle className="w-3.5 h-3.5" /> Missed
                      </span>
                    )}
                  </div>

                  <p className="font-serif text-[16px] leading-[1.7] text-[#1A1B20]">
                    <span className="font-bold tabular-nums">{q.number}. </span>
                    {q.text}
                  </p>

                  <div className="rounded-2xl bg-[#F6F7F9] px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#686C78]">
                      Your answer
                    </p>
                    <p className="mt-1 whitespace-pre-line text-sm leading-6 text-[#3A3D47]">
                      {mine || 'You did not answer this one.'}
                    </p>
                  </div>

                  {q.solution ? (
                    <div className="rounded-2xl bg-[#1D1E23] px-4 py-3.5 text-white">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#A5AAB8]">
                        Model answer
                      </p>
                      <p className="mt-1.5 whitespace-pre-line text-[15px] font-semibold leading-relaxed">
                        {q.solution.answer}
                      </p>
                      {q.solution.explanation.length > 0 && (
                        <details className="mt-3 group">
                          <summary className="cursor-pointer list-none text-xs font-semibold text-[#C3C7D2] hover:text-white [&::-webkit-details-marker]:hidden">
                            <span className="group-open:hidden">Show how we got it</span>
                            <span className="hidden group-open:inline">Hide steps</span>
                          </summary>
                          <ol className="mt-3 space-y-2.5">
                            {q.solution.explanation.map((step, i) => (
                              <li key={i} className="flex gap-3 text-sm leading-6 text-[#E6E8EE]">
                                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/15 font-mono-tabular text-[11px] font-semibold">
                                  {i + 1}
                                </span>
                                <span className="min-w-0 flex-1 whitespace-pre-line">{step}</span>
                              </li>
                            ))}
                          </ol>
                        </details>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-2xl bg-[#F6F7F9] px-4 py-3">
                      <p className="text-sm font-semibold text-[#1A1B20]">No model answer yet</p>
                      <p className="mt-0.5 text-sm text-[#505460]">
                        Check your notes or a reading guide, then mark yourself honestly.
                      </p>
                    </div>
                  )}

                  <div>
                    <p className="text-xs font-semibold text-[#686C78]">How did you do?</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(
                        [
                          ['got', 'I got it'],
                          ['partly', 'Partly'],
                          ['missed', 'Missed it'],
                        ] as Array<[TheoryMark, string]>
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => updateTheoryMarks(rec.id, q.id, value)}
                          className={`min-h-[38px] rounded-xl px-3.5 text-xs font-semibold border transition-colors cursor-pointer inline-flex items-center gap-1 ${
                            mark === value
                              ? 'bg-[#1D1E23] text-white border-transparent'
                              : 'bg-[#F6F7F9] text-[#1A1B20] border-[#1A1B20]/[0.08] hover:bg-[#ECEEF3]'
                          }`}
                        >
                          {mark === value && <Check className="w-3.5 h-3.5" />}
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------------ Performance List View
  return (
    <div className="space-y-5 page-enter lg:mx-auto lg:max-w-3xl">
      <DarkHeaderCard>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-[32px] sm:text-[40px] font-extrabold tracking-tight leading-[1.1]">
              {perfCms.heading}
            </h1>
            <p className="mt-1.5 text-xs text-[#C3C7D2]">
              {records.length === 0
                ? 'Your completed practice exams and scores will appear here'
                : `${records.length} completed ${records.length === 1 ? 'exam' : 'exams'} · Tap any entry for full details`}
            </p>
          </div>
          <span className="h-10 w-10 rounded-xl bg-white/10 text-white flex items-center justify-center shrink-0">
            <BarChart3 className="w-5 h-5" />
          </span>
        </div>
      </DarkHeaderCard>

      {records.length === 0 ? (
        <div className={`${card} text-center py-8 space-y-3`}>
          <div className="mx-auto h-12 w-12 rounded-2xl bg-[#F6F7F9] text-[#1D1E23] flex items-center justify-center">
            <ClipboardCheck className="w-6 h-6" />
          </div>
          <div>
            <p className="text-base font-bold text-[#1A1B20]">{perfCms.emptyTitle}</p>
            <p className="mt-1 text-sm text-[#505460] max-w-md mx-auto leading-relaxed">
              {perfCms.emptyBody}
            </p>
          </div>
          <TactileButton variant="dark" onClick={onStartExam}>
            Start a practice exam
          </TactileButton>
        </div>
      ) : (
        <>
          <div className={`${card} flex flex-col sm:flex-row sm:items-center justify-between gap-3`}>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#686C78]">
                {perfCms.combinedLabel}
              </p>
              <p className="mt-0.5 text-sm font-bold text-[#1A1B20]">
                {overall.gradedExams > 0
                  ? `Current overall rating: ${overall.overallPercent}% (${overall.tierLabel})`
                  : 'Mark your Theory answers to unlock your overall rating'}
              </p>
            </div>
            <TactileButton variant="dark" icon={<Award className="w-4 h-4" />} onClick={openOverall}>
              Check overall rating
            </TactileButton>
          </div>

          <ul className="space-y-3" aria-label="Exam performance history">
            {records.map((rec, index) => {
              const isTheoryUnmarked =
                rec.examType === 'theory' && Object.keys(rec.marks).length === 0;
              return (
                <li key={rec.id}>
                  <button
                    type="button"
                    onClick={() => openDetail(rec.id)}
                    className={`${card} w-full text-left hover:border-[#1A1B20]/20 hover:shadow-[0_6px_18px_-6px_rgba(24,25,30,0.12)] transition-all cursor-pointer flex items-center justify-between gap-4`}
                  >
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        {index === 0 && (
                          <span className="rounded-full bg-[#1D1E23] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                            Latest
                          </span>
                        )}
                        <span className="rounded-full bg-[#F2F4F7] px-2.5 py-0.5 text-[11px] font-semibold text-[#1A1B20]">
                          {examTypeBadge(rec.examType)}
                        </span>
                        <span className="text-[11px] font-mono-tabular text-[#686C78]">
                          {formatDate(rec.createdAt)}
                        </span>
                      </div>

                      <p className="font-display text-base font-bold text-[#1A1B20] truncate">
                        {rec.courseLabel}
                        {rec.focus ? ` — ${rec.focus}` : ''}
                      </p>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-[#505460]">
                        <span>
                          {rec.answeredCount}/{rec.totalQuestions} answered
                        </span>
                        {rec.examType !== 'theory' && (
                          <span>{rec.missedCount + rec.skippedCount} missed</span>
                        )}
                        <span className="inline-flex items-center gap-1 font-mono-tabular">
                          <Clock className="w-3.5 h-3.5" />
                          {formatClock(rec.usedSeconds)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                      <div className="text-right">
                        <p className="font-display text-xl font-bold font-mono-tabular text-[#1A1B20]">
                          {isTheoryUnmarked ? 'Mark' : `${rec.scorePercent}%`}
                        </p>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#686C78]">
                          {isTheoryUnmarked ? 'Theory' : 'Score'}
                        </p>
                      </div>
                      <ChevronRight className="w-5 h-5 text-[#686C78]" />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
};
