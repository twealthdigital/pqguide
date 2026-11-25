import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Clock, RotateCcw, Sparkles } from 'lucide-react';
import { useArchiveStore } from '../hooks/useArchiveStore';
import {
  ALL_COURSES,
  buildExam,
  countQuestionsFor,
  listExamCourses,
  type BuiltExam,
  type ExamSpec,
} from '../core/mockExam';
import { DarkHeaderCard } from '../components/ui/DarkHeaderCard';
import { CustomSelect } from '../components/ui/CustomSelect';
import { TactileButton } from '../components/ui/TactileButton';

interface MockExamScreenProps {
  onBack: () => void;
}

type Phase = 'setup' | 'exam' | 'review';
type Mark = 'got' | 'partly' | 'missed';

const COUNT_CHOICES = [3, 5, 10, 15, 20];
const MINUTE_CHOICES = [15, 30, 45, 60, 90];

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

const Chip: React.FC<{
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}> = ({ selected, onClick, children, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-pressed={selected}
    className={`min-h-[40px] rounded-xl px-4 text-sm font-semibold border transition-colors duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
      selected
        ? 'bg-[#1D1E23] text-white border-transparent'
        : 'bg-[#F6F7F9] text-[#1A1B20] border-[#1A1B20]/[0.08] hover:bg-[#ECEEF3]'
    }`}
  >
    {children}
  </button>
);

export const MockExamScreen: React.FC<MockExamScreenProps> = ({ onBack }) => {
  const store = useArchiveStore();

  const docs = useMemo(
    () =>
      store.documents.filter(
        (d) => d.status === 'published' && d.schoolId === store.selectedSchoolId
      ),
    [store.documents, store.selectedSchoolId]
  );
  const courses = useMemo(() => listExamCourses(docs), [docs]);

  const [phase, setPhase] = useState<Phase>('setup');
  const [courseCode, setCourseCode] = useState<string>(ALL_COURSES);
  const [questionCount, setQuestionCount] = useState(5);
  const [minutes, setMinutes] = useState(30);
  const [focus, setFocus] = useState('');

  const [exam, setExam] = useState<BuiltExam | null>(null);
  const [spec, setSpec] = useState<ExamSpec | null>(null);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [usedSeconds, setUsedSeconds] = useState(0);
  const [endedByTimer, setEndedByTimer] = useState(false);
  const [confirm, setConfirm] = useState<'finish' | 'exit' | null>(null);

  const endAtRef = useRef(0);
  const startedAtRef = useRef(0);

  const pool = useMemo(() => countQuestionsFor(docs, courseCode), [docs, courseCode]);
  const effectiveCount = Math.min(questionCount, Math.max(pool, 1));

  const courseOptions = useMemo(
    () => [
      { value: ALL_COURSES, label: 'All general courses', hint: `${countQuestionsFor(docs, ALL_COURSES)} questions` },
      ...courses.map((c) => ({
        value: c.code,
        label: c.title ? `${c.code} — ${c.title}` : `${c.code} Past Question`,
        hint: `${c.questionCount} questions`,
      })),
    ],
    [courses, docs]
  );

  const startExam = useCallback(
    (nextSpec: ExamSpec) => {
      const built = buildExam(docs, nextSpec);
      if (built.questions.length === 0) return;
      setSpec(nextSpec);
      setExam(built);
      setAnswers({});
      setMarks({});
      setCurrent(0);
      setConfirm(null);
      setEndedByTimer(false);
      setUsedSeconds(0);
      startedAtRef.current = Date.now();
      endAtRef.current = Date.now() + nextSpec.minutes * 60_000;
      setSecondsLeft(nextSpec.minutes * 60);
      setPhase('exam');
      window.scrollTo({ top: 0, behavior: 'instant' });
    },
    [docs]
  );

  const finishExam = useCallback((byTimer: boolean) => {
    setUsedSeconds(Math.round((Date.now() - startedAtRef.current) / 1000));
    setEndedByTimer(byTimer);
    setConfirm(null);
    setPhase('review');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  // Countdown. Based on the clock, so it stays correct if the tab sleeps.
  useEffect(() => {
    if (phase !== 'exam') return;
    const tick = () => {
      const left = Math.round((endAtRef.current - Date.now()) / 1000);
      if (left <= 0) {
        setSecondsLeft(0);
        finishExam(true);
      } else {
        setSecondsLeft(left);
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [phase, finishExam]);

  const handleStart = () =>
    startExam({ courseCode, questionCount: effectiveCount, minutes, focus: focus.trim() });

  const answeredCount = exam ? exam.questions.filter((q) => (answers[q.id] ?? '').trim()).length : 0;
  const total = exam?.questions.length ?? 0;

  const score = useMemo(() => {
    if (!exam) return { marked: 0, points: 0, percent: 0 };
    let marked = 0;
    let points = 0;
    for (const q of exam.questions) {
      const m = marks[q.id];
      if (!m) continue;
      marked += 1;
      points += m === 'got' ? 1 : m === 'partly' ? 0.5 : 0;
    }
    return { marked, points, percent: exam.questions.length ? Math.round((points / exam.questions.length) * 100) : 0 };
  }, [exam, marks]);

  const lowTime = phase === 'exam' && secondsLeft <= 300;

  // ---------------------------------------------------------------- header
  const header = (
    <DarkHeaderCard>
      {phase === 'setup' ? (
        <TactileButton variant="light" size="sm" icon={<ArrowLeft className="w-4 h-4" />} onClick={onBack}>
          Back
        </TactileButton>
      ) : phase === 'exam' ? (
        <div className="flex items-center justify-between gap-3">
          <TactileButton variant="light" size="sm" onClick={() => setConfirm('exit')}>
            Exit exam
          </TactileButton>
          <div
            role="timer"
            aria-label="Time left"
            className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 font-mono-tabular text-base font-bold ${
              lowTime ? 'bg-[#F6C453] text-[#1D1E23]' : 'bg-white/10 text-white'
            }`}
          >
            <Clock className="w-4 h-4" />
            {formatClock(secondsLeft)}
          </div>
        </div>
      ) : (
        <TactileButton variant="light" size="sm" icon={<ArrowLeft className="w-4 h-4" />} onClick={onBack}>
          Back
        </TactileButton>
      )}

      <h1 className="mt-3.5 font-display text-xl sm:text-2xl font-bold leading-snug">
        {phase === 'review' ? 'Your results' : 'Practice exam'}
      </h1>
      <p className="mt-1.5 text-xs text-[#C3C7D2]">
        {phase === 'setup' && 'A predicted exam built from past questions, made for you'}
        {phase === 'exam' && spec &&
          `${spec.courseCode === ALL_COURSES ? 'All general courses' : spec.courseCode} · Question ${current + 1} of ${total}`}
        {phase === 'review' && 'Compare with the model answers and mark yourself'}
      </p>

      {phase === 'exam' && total > 0 && (
        <div className="mt-3 h-1.5 rounded-full bg-white/15 overflow-hidden" aria-hidden="true">
          <div
            className="h-full rounded-full bg-white transition-[width] duration-300 ease-out"
            style={{ width: `${((current + 1) / total) * 100}%` }}
          />
        </div>
      )}
    </DarkHeaderCard>
  );

  // ----------------------------------------------------------------- setup
  if (phase === 'setup') {
    return (
      <div className="space-y-5 page-enter lg:mx-auto lg:max-w-3xl">
        {header}

        {courses.length === 0 ? (
          <div className={card}>
            <p className="text-sm font-semibold text-[#1A1B20]">No past questions yet</p>
            <p className="mt-1 text-sm text-[#505460] leading-relaxed">
              A practice exam is built from the past questions on Home. Once some are
              added, you can set up your exam here.
            </p>
          </div>
        ) : (
          <>
            <div className={`${card} space-y-5`}>
              <CustomSelect
                id="exam-course"
                label="Course"
                value={courseCode}
                options={courseOptions}
                onChange={setCourseCode}
              />

              <div>
                <p className="text-xs font-semibold text-[#686C78]">Number of questions</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {COUNT_CHOICES.filter((n) => n < pool).map((n) => (
                    <Chip key={n} selected={effectiveCount === n} onClick={() => setQuestionCount(n)}>
                      {n}
                    </Chip>
                  ))}
                  <Chip selected={effectiveCount === pool || questionCount >= pool} onClick={() => setQuestionCount(pool)}>
                    All {pool}
                  </Chip>
                </div>
                <p className="mt-2 text-xs text-[#686C78]">
                  {pool} question{pool === 1 ? '' : 's'} available for this choice.
                </p>
              </div>

              <div>
                <p className="text-xs font-semibold text-[#686C78]">Time allowed</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {MINUTE_CHOICES.map((m) => (
                    <Chip key={m} selected={minutes === m} onClick={() => setMinutes(m)}>
                      {m} min
                    </Chip>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="exam-focus" className="text-xs font-semibold text-[#686C78]">
                  Topic to focus on (optional)
                </label>
                <input
                  id="exam-focus"
                  type="text"
                  value={focus}
                  onChange={(e) => setFocus(e.target.value)}
                  placeholder="e.g. essay writing, library, grammar"
                  className="mt-1.5 w-full min-h-[44px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/[0.08] px-3.5 text-sm text-[#1A1B20] placeholder:text-[#8E93A2] focus:outline-none focus:ring-2 focus:ring-[#1D1E23]/20"
                />
              </div>
            </div>

            <div className={`${card} flex items-start gap-3`}>
              <div className="h-10 w-10 rounded-xl bg-[#1D1E23] text-white flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5" />
              </div>
              <p className="text-sm text-[#505460] leading-relaxed">
                This is a prediction, not a promise. Questions are picked from real past questions,
                favouring themes that keep coming back, the latest session and your topic. Real
                exams can still surprise you.
              </p>
            </div>

            <TactileButton variant="dark" size="lg" fullWidth onClick={handleStart} disabled={pool === 0}>
              Start exam
            </TactileButton>
          </>
        )}
      </div>
    );
  }

  if (!exam) return null;

  // ------------------------------------------------------------------ exam
  if (phase === 'exam') {
    const q = exam.questions[current];
    const isLast = current === total - 1;
    const unanswered = total - answeredCount;

    return (
      <div className="space-y-5 page-enter lg:mx-auto lg:max-w-3xl">
        {header}

        {confirm && (
          <div role="alertdialog" aria-label="Confirm" className={`${card} space-y-3`}>
            {confirm === 'exit' ? (
              <p className="text-sm text-[#1A1B20] font-semibold">
                Leave the exam? Your answers will not be kept.
              </p>
            ) : (
              <p className="text-sm text-[#1A1B20] font-semibold">
                {unanswered > 0
                  ? `You have ${unanswered} unanswered question${unanswered === 1 ? '' : 's'}. Submit anyway?`
                  : 'Submit your exam now?'}
              </p>
            )}
            <div className="flex flex-wrap gap-2.5">
              <TactileButton
                variant="dark"
                size="sm"
                onClick={() => (confirm === 'exit' ? onBack() : finishExam(false))}
              >
                {confirm === 'exit' ? 'Leave exam' : 'Submit exam'}
              </TactileButton>
              <TactileButton variant="light" size="sm" onClick={() => setConfirm(null)}>
                Keep going
              </TactileButton>
            </div>
          </div>
        )}

        <section aria-label={`Question ${q.number}`} className={`${card} space-y-4`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-mono-tabular font-semibold text-[#686C78]">{q.source}</span>
            {q.reasons.map((r) => (
              <span key={r} className="rounded-full bg-[#F2F4F7] px-2.5 py-1 text-[11px] font-semibold text-[#505460]">
                {r}
              </span>
            ))}
          </div>

          <p className="font-serif text-[17px] leading-[1.7] text-[#1A1B20]">
            <span className="font-bold tabular-nums">{q.number}. </span>
            {q.text}
          </p>

          <div>
            <label htmlFor="exam-answer" className="text-xs font-semibold text-[#686C78]">
              Your answer
            </label>
            <textarea
              id="exam-answer"
              value={answers[q.id] ?? ''}
              onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
              rows={9}
              placeholder="Type your answer here..."
              className="mt-1.5 w-full rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/[0.08] px-3.5 py-3 text-sm leading-6 text-[#1A1B20] placeholder:text-[#8E93A2] focus:outline-none focus:ring-2 focus:ring-[#1D1E23]/20 resize-y"
            />
          </div>
        </section>

        <nav aria-label="Questions" className="flex flex-wrap gap-2">
          {exam.questions.map((item, i) => {
            const done = (answers[item.id] ?? '').trim().length > 0;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setCurrent(i)}
                aria-label={`Question ${i + 1}${done ? ', answered' : ''}`}
                aria-current={i === current ? 'step' : undefined}
                className={`h-10 w-10 rounded-xl text-sm font-bold transition-colors duration-150 cursor-pointer ${
                  i === current
                    ? 'bg-[#1D1E23] text-white'
                    : done
                      ? 'bg-[#DADDE6] text-[#1A1B20]'
                      : 'bg-white text-[#686C78] border border-[#1A1B20]/[0.1]'
                }`}
              >
                {i + 1}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center justify-between gap-3">
          <TactileButton
            variant="light"
            icon={<ArrowLeft className="w-4 h-4" />}
            disabled={current === 0}
            onClick={() => setCurrent((c) => Math.max(0, c - 1))}
          >
            Previous
          </TactileButton>
          {isLast ? (
            <TactileButton variant="dark" onClick={() => setConfirm('finish')}>
              Submit exam
            </TactileButton>
          ) : (
            <TactileButton
              variant="dark"
              icon={<ArrowRight className="w-4 h-4" />}
              onClick={() => setCurrent((c) => Math.min(total - 1, c + 1))}
            >
              Next
            </TactileButton>
          )}
        </div>
        {!isLast && (
          <button
            type="button"
            onClick={() => setConfirm('finish')}
            className="block mx-auto text-xs font-semibold text-[#505460] underline underline-offset-4 decoration-[#1A1B20]/30 hover:decoration-[#1A1B20] cursor-pointer"
          >
            Submit exam now
          </button>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------- review
  return (
    <div className="space-y-5 page-enter lg:mx-auto lg:max-w-3xl">
      {header}

      <section aria-label="Summary" className={`${card}`}>
        {endedByTimer && (
          <p className="mb-3 rounded-xl bg-[#FFF4D6] px-3.5 py-2.5 text-xs font-semibold text-[#6B4E00]">
            Time was up, so your exam was submitted for you.
          </p>
        )}
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="font-display text-xl font-bold text-[#1A1B20]">
              {answeredCount}/{total}
            </p>
            <p className="text-[11px] text-[#686C78]">Answered</p>
          </div>
          <div>
            <p className="font-display text-xl font-bold text-[#1A1B20] font-mono-tabular">
              {formatClock(usedSeconds)}
            </p>
            <p className="text-[11px] text-[#686C78]">Time used</p>
          </div>
          <div>
            <p className="font-display text-xl font-bold text-[#1A1B20]">
              {score.marked === 0 ? '—' : `${score.percent}%`}
            </p>
            <p className="text-[11px] text-[#686C78]">Your score</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-[#686C78] leading-relaxed">
          {score.marked < total
            ? `Read each model answer, then mark yourself (${score.marked} of ${total} marked) to see your score.`
            : 'All marked. Try another exam to keep improving.'}
        </p>
      </section>

      <ol className="space-y-4">
        {exam.questions.map((q) => {
          const mine = (answers[q.id] ?? '').trim();
          const mark = marks[q.id];
          return (
            <li key={q.id} className={`${card} space-y-3.5`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-mono-tabular font-semibold text-[#686C78]">{q.source}</span>
              </div>
              <p className="font-serif text-[16px] leading-[1.7] text-[#1A1B20]">
                <span className="font-bold tabular-nums">{q.number}. </span>
                {q.text}
              </p>

              <div className="rounded-2xl bg-[#F6F7F9] px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#686C78]">Your answer</p>
                <p className="mt-1 whitespace-pre-line text-sm leading-6 text-[#3A3D47]">
                  {mine || 'You did not answer this one.'}
                </p>
              </div>

              {q.solution ? (
                <div className="rounded-2xl bg-[#1D1E23] px-4 py-3.5 text-white">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#A5AAB8]">Model answer</p>
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
                    ] as Array<[Mark, string]>
                  ).map(([value, label]) => (
                    <Chip
                      key={value}
                      selected={mark === value}
                      onClick={() => setMarks((prev) => ({ ...prev, [q.id]: value }))}
                    >
                      {mark === value && <Check className="inline w-4 h-4 mr-1 -mt-0.5" />}
                      {label}
                    </Chip>
                  ))}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap gap-2.5">
        <TactileButton variant="dark" icon={<RotateCcw className="w-4 h-4" />} onClick={() => spec && startExam(spec)}>
          Try a new exam like this
        </TactileButton>
        <TactileButton variant="light" onClick={() => setPhase('setup')}>
          Change settings
        </TactileButton>
      </div>
    </div>
  );
};
