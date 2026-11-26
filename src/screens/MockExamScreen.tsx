import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  FileText,
  ListChecks,
  Loader2,
  Minus,
  Monitor,
  Plus,
  RotateCcw,
  Search,
  ToggleLeft,
  XCircle,
} from 'lucide-react';
import { useArchiveStore } from '../hooks/useArchiveStore';
import {
  ALL_COURSES,
  EXAM_TYPES,
  buildExam,
  countQuestionsFor,
  listExamCourses,
  type BuiltExam,
  type ExamSpec,
  type ExamType,
} from '../core/mockExam';
import { useBackHandler, useNavigationGuard } from '../core/navGuard';
import { saveExamPerformance } from '../core/performanceStore';
import { LogoShapes } from '../components/ui/BrandLogo';
import { DarkHeaderCard } from '../components/ui/DarkHeaderCard';
import { TactileButton } from '../components/ui/TactileButton';
import type { PaywallContext } from '../core/subscription';

interface MockExamScreenProps {
  onBack: () => void;
  onSubmitted?: (recordId: string) => void;
  onOpenPaywall?: (context?: PaywallContext) => void;
}

type Phase = 'setup' | 'exam' | 'review';
type SetupStep = 'intro' | 'course' | 'type' | 'settings';
type PrepState = 'idle' | 'loading' | 'dropping';
type Mark = 'got' | 'partly' | 'missed';

const COUNT_CHOICES = [5, 10, 15, 20];
const MINUTE_CHOICES = [15, 30, 45, 60, 90];
const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const;

const PREP_MESSAGES = [
  'Loading questions...',
  'Getting a good prediction...',
  'Preparing your exam paper...',
] as const;

const STEP_TRANSITION_MS = 260;
const STEP_TRANSITION_REDUCED_MS = 40;
const PREP_HOLD_MS = 2100;
const PREP_HOLD_REDUCED_MS = 450;
const PREP_DROP_MS = 480;

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

const EXAM_TYPE_ICON: Record<ExamType, React.ReactNode> = {
  obj: <ListChecks className="w-4 h-4" />,
  theory: <FileText className="w-4 h-4" />,
  boolean: <ToggleLeft className="w-4 h-4" />,
  cbt: <Monitor className="w-4 h-4" />,
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
    className={`min-h-[40px] rounded-xl px-4 text-sm font-semibold border transition-colors duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5 ${
      selected
        ? 'bg-[#1D1E23] text-white border-transparent'
        : 'bg-[#F6F7F9] text-[#1A1B20] border-[#1A1B20]/[0.08] hover:bg-[#ECEEF3]'
    }`}
  >
    {children}
  </button>
);

export const MockExamScreen: React.FC<MockExamScreenProps> = ({
  onBack,
  onSubmitted,
}) => {
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
  const [setupStep, setSetupStep] = useState<SetupStep>('intro');
  const [stepLoading, setStepLoading] = useState(false);

  const [examType, setExamType] = useState<ExamType>('obj');
  const [courseCode, setCourseCode] = useState<string>(ALL_COURSES);
  const [courseQuery, setCourseQuery] = useState('');
  const [courseListOpen, setCourseListOpen] = useState(true);

  const [questionCount, setQuestionCount] = useState<number>(5);
  const [customCountMode, setCustomCountMode] = useState<boolean>(false);
  const [customCountInput, setCustomCountInput] = useState<string>('12');

  const [minutes, setMinutes] = useState<number>(30);
  const [customTimeMode, setCustomTimeMode] = useState<boolean>(false);
  const [customTimeInput, setCustomTimeInput] = useState<string>('25');

  const [prepState, setPrepState] = useState<PrepState>('idle');
  const [prepMessageIndex, setPrepMessageIndex] = useState(0);

  const [exam, setExam] = useState<BuiltExam | null>(null);
  const [spec, setSpec] = useState<ExamSpec | null>(null);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [marks, setMarks] = useState<Record<string, Mark>>({});

  const [secondsLeft, setSecondsLeft] = useState(0);
  const [usedSeconds, setUsedSeconds] = useState(0);
  const [endedByTimer, setEndedByTimer] = useState(false);
  const [confirm, setConfirm] = useState<'finish' | 'exit' | null>(null);
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'submitted'>('idle');

  const endAtRef = useRef(0);
  const startedAtRef = useRef(0);
  const stepTimerRef = useRef<number | null>(null);
  const startTimersRef = useRef<number[]>([]);
  const submitTimersRef = useRef<number[]>([]);
  const finishedRef = useRef(false);
  const leavingRef = useRef(false);
  const pendingLeaveRef = useRef<(() => void) | null>(null);

  const [leaving, setLeaving] = useState(false);

  const isExamDialogBlocked = leaving || submitState !== 'idle' || finishedRef.current;

  const goBackSetupStep = useCallback(() => {
    if (stepLoading || prepState !== 'idle') return;
    setSetupStep((prev) => {
      if (prev === 'settings') return 'type';
      if (prev === 'type') return 'course';
      if (prev === 'course') return 'intro';
      return 'intro';
    });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [prepState, stepLoading]);

  // Setup sub-steps claim device Back until back at the Practice Exam intro screen.
  useBackHandler(
    phase === 'setup' && setupStep !== 'intro' && prepState === 'idle',
    goBackSetupStep
  );

  // Brief loader overlay blocks accidental Back presses while preparing.
  useBackHandler(prepState !== 'idle', () => {});

  // Running exam claims device Back to ask before leaving.
  useBackHandler(phase === 'exam' && confirm === null && !isExamDialogBlocked, () => {
    pendingLeaveRef.current = null;
    setConfirm('exit');
  });

  // Open confirm dialog box ("Quit exam?" or "Submit exam?") has its own Back step.
  useBackHandler(phase === 'exam' && confirm !== null && !isExamDialogBlocked, () => {
    pendingLeaveRef.current = null;
    setConfirm(null);
  });

  // Intercept any in-app navigation (tabs, drawer links, notifications, paywall, sign-out, etc.)
  // while an exam is actively running.
  useNavigationGuard(
    phase === 'exam' && !isExamDialogBlocked,
    (proceed) => {
      pendingLeaveRef.current = proceed;
      setConfirm('exit');
    },
    () => !finishedRef.current && !leavingRef.current
  );

  useEffect(() => {
    return () => {
      if (stepTimerRef.current !== null) window.clearTimeout(stepTimerRef.current);
      startTimersRef.current.forEach((t) => window.clearTimeout(t));
      submitTimersRef.current.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  useEffect(() => {
    if (prepState !== 'loading') return;
    setPrepMessageIndex(0);
    const intervalId = window.setInterval(() => {
      setPrepMessageIndex((idx) => (idx + 1) % PREP_MESSAGES.length);
    }, 700);
    return () => window.clearInterval(intervalId);
  }, [prepState]);

  const pool = useMemo(() => countQuestionsFor(docs, courseCode), [docs, courseCode]);

  const courseOptions = useMemo(
    () => [
      {
        value: ALL_COURSES,
        label: 'All general courses',
        code: 'ALL',
        title: 'Mixed questions across available courses',
        hint: `${countQuestionsFor(docs, ALL_COURSES)} questions`,
      },
      ...courses.map((c) => ({
        value: c.code,
        label: c.title ? `${c.code} — ${c.title}` : `${c.code} Past Question`,
        code: c.code,
        title: c.title || 'Past questions archive',
        hint: `${c.questionCount} question${c.questionCount === 1 ? '' : 's'}`,
      })),
    ],
    [courses, docs]
  );

  const filteredCourseOptions = useMemo(() => {
    const q = courseQuery.trim().toLowerCase();
    if (!q) return courseOptions;
    return courseOptions.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        opt.code.toLowerCase().includes(q) ||
        opt.title.toLowerCase().includes(q)
    );
  }, [courseOptions, courseQuery]);

  const selectedCourseOption = useMemo(
    () => courseOptions.find((opt) => opt.value === courseCode) ?? courseOptions[0],
    [courseCode, courseOptions]
  );

  const advanceToStep = (nextStep: SetupStep) => {
    if (stepLoading || prepState !== 'idle') return;
    if (stepTimerRef.current !== null) window.clearTimeout(stepTimerRef.current);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const delay = reduced ? STEP_TRANSITION_REDUCED_MS : STEP_TRANSITION_MS;
    setStepLoading(true);
    stepTimerRef.current = window.setTimeout(() => {
      stepTimerRef.current = null;
      setStepLoading(false);
      setSetupStep(nextStep);
      window.scrollTo({ top: 0, behavior: 'instant' });
    }, delay);
  };

  const applyCustomCount = (raw: string) => {
    setCustomCountInput(raw);
    const parsed = parseInt(raw, 10);
    if (!Number.isNaN(parsed) && parsed >= 1) {
      setQuestionCount(Math.min(50, parsed));
    }
  };

  const applyCustomMinutes = (raw: string) => {
    setCustomTimeInput(raw);
    const parsed = parseInt(raw, 10);
    if (!Number.isNaN(parsed) && parsed >= 1) {
      setMinutes(Math.min(240, parsed));
    }
  };

  const beginExamSession = useCallback((nextSpec: ExamSpec, built: BuiltExam) => {
    finishedRef.current = false;
    leavingRef.current = false;
    pendingLeaveRef.current = null;
    setLeaving(false);
    setSpec(nextSpec);
    setExam(built);
    setAnswers({});
    setMarks({});
    setCurrent(0);
    setConfirm(null);
    setSubmitState('idle');
    setEndedByTimer(false);
    setUsedSeconds(0);
    startedAtRef.current = Date.now();
    endAtRef.current = Date.now() + nextSpec.minutes * 60_000;
    setSecondsLeft(nextSpec.minutes * 60);
    setPhase('exam');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  const launchWithLoader = useCallback(
    (nextSpec: ExamSpec) => {
      const built = buildExam(docs, nextSpec);
      if (built.questions.length === 0) {
        setPrepState('idle');
        return;
      }

      startTimersRef.current.forEach((t) => window.clearTimeout(t));
      startTimersRef.current = [];
      submitTimersRef.current.forEach((t) => window.clearTimeout(t));
      submitTimersRef.current = [];

      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      const holdMs = reduced ? PREP_HOLD_REDUCED_MS : PREP_HOLD_MS;

      setPrepState('loading');

      const dropTimer = window.setTimeout(() => {
        beginExamSession(nextSpec, built);
        setPrepState('dropping');
      }, holdMs);

      const doneTimer = window.setTimeout(() => {
        setPrepState('idle');
      }, holdMs + (reduced ? 60 : PREP_DROP_MS));

      startTimersRef.current.push(dropTimer, doneTimer);
    },
    [beginExamSession, docs]
  );

  const completeSubmission = useCallback(
    (byTimer: boolean) => {
      if (finishedRef.current || !exam || !spec) return;
      finishedRef.current = true;
      const elapsed = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
      setUsedSeconds(elapsed);
      setEndedByTimer(byTimer);
      setConfirm(null);

      const record = saveExamPerformance({
        spec,
        questions: exam.questions,
        answers,
        usedSeconds: elapsed,
        endedByTimer: byTimer,
      });

      if (onSubmitted) {
        onSubmitted(record.id);
      } else {
        setPhase('review');
        window.scrollTo({ top: 0, behavior: 'instant' });
      }
    },
    [answers, exam, onSubmitted, spec]
  );

  const triggerAnimatedSubmit = useCallback(
    (byTimer = false) => {
      if (submitState !== 'idle' || finishedRef.current) return;
      setSubmitState('submitting');
      const t1 = window.setTimeout(() => {
        setSubmitState('submitted');
        const t2 = window.setTimeout(() => {
          completeSubmission(byTimer);
        }, 550);
        submitTimersRef.current.push(t2);
      }, 750);
      submitTimersRef.current.push(t1);
    },
    [completeSubmission, submitState]
  );

  // Countdown. Based on the clock, so it stays correct if the tab sleeps.
  useEffect(() => {
    if (phase !== 'exam') return;
    const tick = () => {
      const left = Math.round((endAtRef.current - Date.now()) / 1000);
      if (left <= 0) {
        setSecondsLeft(0);
        completeSubmission(true);
      } else {
        setSecondsLeft(left);
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [phase, completeSubmission]);

  const handleStart = () => {
    if (pool === 0 || prepState !== 'idle' || stepLoading) return;
    const safeCount = Math.max(1, Math.min(50, questionCount || 5));
    const safeMinutes = Math.max(1, Math.min(240, minutes || 30));
    const nextSpec: ExamSpec = {
      examType,
      courseCode,
      questionCount: safeCount,
      minutes: safeMinutes,
      focus: '',
    };
    launchWithLoader(nextSpec);
  };

  const answeredCount = exam
    ? exam.questions.filter((q) => (answers[q.id] ?? '').trim().length > 0).length
    : 0;
  const total = exam?.questions.length ?? 0;

  const isAutoGraded =
    exam?.examType === 'obj' || exam?.examType === 'cbt' || exam?.examType === 'boolean';

  const autoScore = useMemo(() => {
    if (!exam || !isAutoGraded) return { correct: 0, percent: 0 };
    let correct = 0;
    for (const q of exam.questions) {
      const ans = answers[q.id];
      if (!ans) continue;
      if (exam.examType === 'boolean') {
        const expected = q.correctBoolean ? 'true' : 'false';
        if (ans === expected) correct += 1;
      } else if (typeof q.correctIndex === 'number') {
        if (Number(ans) === q.correctIndex) correct += 1;
      }
    }
    return {
      correct,
      percent: exam.questions.length ? Math.round((correct / exam.questions.length) * 100) : 0,
    };
  }, [answers, exam, isAutoGraded]);

  const theoryScore = useMemo(() => {
    if (!exam) return { marked: 0, points: 0, percent: 0 };
    let marked = 0;
    let points = 0;
    for (const q of exam.questions) {
      const m = marks[q.id];
      if (!m) continue;
      marked += 1;
      points += m === 'got' ? 1 : m === 'partly' ? 0.5 : 0;
    }
    return {
      marked,
      points,
      percent: exam.questions.length ? Math.round((points / exam.questions.length) * 100) : 0,
    };
  }, [exam, marks]);

  const activeExamMeta = useMemo(
    () => EXAM_TYPES.find((t) => t.id === (spec?.examType ?? examType)) ?? EXAM_TYPES[0],
    [examType, spec?.examType]
  );

  const lowTime = phase === 'exam' && secondsLeft <= 300;
  const progressPercent =
    total === 0
      ? 0
      : exam?.examType === 'cbt'
        ? ((current + 1) / total) * 100
        : (answeredCount / total) * 100;

  // --------------------------------------------------- exam preparation overlay
  const prepOverlay =
    prepState !== 'idle' &&
    typeof document !== 'undefined' &&
    createPortal(
      <div
        role="status"
        aria-live="polite"
        aria-label="Preparing your exam"
        className={`fixed inset-0 z-[90] flex flex-col items-center justify-center overflow-hidden bg-[#1D1E23] px-6 text-white select-none transition-[opacity,transform] duration-[480ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
          prepState === 'dropping'
            ? 'opacity-0 translate-y-12 scale-95 pointer-events-none'
            : 'opacity-100 translate-y-0 scale-100'
        }`}
      >
        <div className="relative flex h-32 w-32 items-center justify-center">
          {/* Rolling incomplete circle catching its end */}
          <svg
            viewBox="0 0 120 120"
            className="pq-exam-ring absolute inset-0 h-full w-full"
            fill="none"
            aria-hidden="true"
          >
            <circle
              cx="60"
              cy="60"
              r="50"
              stroke="rgba(255, 255, 255, 0.14)"
              strokeWidth="4"
            />
            <circle
              cx="60"
              cy="60"
              r="50"
              stroke="#FFFFFF"
              strokeWidth="4.5"
              strokeLinecap="round"
              className="pq-exam-ring-arc"
            />
          </svg>

          {/* pqguide glasses mark only: blinking and looking around */}
          <svg
            viewBox="146 298 618 287"
            className="w-16 text-white"
            fill="none"
            aria-hidden="true"
          >
            <LogoShapes pupilClassName="pq-exam-pupil" />
            <circle
              className="pq-exam-lid"
              cx="315"
              cy="411"
              r="79"
              fill="#1D1E23"
              stroke="currentColor"
              strokeWidth="6"
            />
            <circle
              className="pq-exam-lid"
              cx="594.2"
              cy="411"
              r="79"
              fill="#1D1E23"
              stroke="currentColor"
              strokeWidth="6"
            />
          </svg>
        </div>

        <p className="mt-6 text-center text-sm font-medium tracking-wide text-[#E6E8EE] transition-opacity duration-200">
          {PREP_MESSAGES[prepMessageIndex]}
        </p>
      </div>,
      document.body
    );

  // ---------------------------------------------------------------- header
  const setupHeaderTitle =
    setupStep === 'intro'
      ? 'Practice exam'
      : setupStep === 'course'
        ? 'Select course'
        : setupStep === 'type'
          ? 'Exam type'
          : 'Questions & time';

  const setupHeaderSubtitle =
    setupStep === 'intro'
      ? 'Timed practice built from verified past questions'
      : setupStep === 'course'
        ? 'Type to filter or pick directly from the course list'
        : setupStep === 'type'
          ? `${selectedCourseOption?.value === ALL_COURSES ? 'All general courses' : selectedCourseOption?.code} · Pick your exam format`
          : `${selectedCourseOption?.value === ALL_COURSES ? 'All general courses' : selectedCourseOption?.code} · ${activeExamMeta.badge}`;

  const header = (
    <DarkHeaderCard>
      {phase === 'setup' ? (
        <TactileButton
          variant="light"
          size="sm"
          icon={<ArrowLeft className="w-4 h-4" />}
          onClick={setupStep === 'intro' ? onBack : goBackSetupStep}
          disabled={stepLoading || prepState !== 'idle'}
        >
          Back
        </TactileButton>
      ) : phase === 'exam' ? (
        <div className="flex items-center justify-between gap-3">
          <TactileButton
            variant="light"
            size="sm"
            onClick={() => {
              pendingLeaveRef.current = null;
              setConfirm('exit');
            }}
          >
            Exit exam
          </TactileButton>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-flex items-center rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-[#D6DAE4]">
              {answeredCount}/{total} answered
            </span>
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
        </div>
      ) : (
        <TactileButton variant="light" size="sm" icon={<ArrowLeft className="w-4 h-4" />} onClick={onBack}>
          Back
        </TactileButton>
      )}

      <h1 className="mt-3.5 font-display text-xl sm:text-2xl font-bold leading-snug">
        {phase === 'setup'
          ? setupHeaderTitle
          : phase === 'review'
            ? 'Your results'
            : 'Practice exam'}
      </h1>
      <p className="mt-1.5 text-xs text-[#C3C7D2]">
        {phase === 'setup' && setupHeaderSubtitle}
        {phase === 'exam' &&
          spec &&
          (spec.examType === 'cbt'
            ? `${spec.courseCode === ALL_COURSES ? 'All general courses' : spec.courseCode} · ${activeExamMeta.badge} · Question ${current + 1} of ${total}`
            : `${spec.courseCode === ALL_COURSES ? 'All general courses' : spec.courseCode} · ${activeExamMeta.badge} · ${answeredCount} of ${total} answered`)}
        {phase === 'review' &&
          (isAutoGraded
            ? `${activeExamMeta.badge} · Auto-graded summary and explanations`
            : `${activeExamMeta.badge} · Compare with the model answers and mark yourself`)}
      </p>

      {phase === 'exam' && total > 0 && (
        <div className="mt-3 h-1.5 rounded-full bg-white/15 overflow-hidden" aria-hidden="true">
          <div
            className="h-full rounded-full bg-white transition-[width] duration-300 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      )}
    </DarkHeaderCard>
  );

  // ----------------------------------------------------------------- setup
  if (phase === 'setup') {
    return (
      <div className="space-y-5 page-enter lg:mx-auto lg:max-w-3xl">
        {prepOverlay}
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
            {/* Step 0: Simple intro card with 2-line writeup + Take Exam button */}
            {setupStep === 'intro' && (
              <div className={`${card} space-y-5 page-enter`}>
                <p className="text-sm text-[#505460] leading-relaxed">
                  Practice under real exam timing with questions drawn from past papers and course
                  guides. Pick your course, format, and question count to start.
                </p>

                <button
                  type="button"
                  onClick={() => advanceToStep('course')}
                  disabled={stepLoading}
                  aria-busy={stepLoading}
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#1D1E23] text-sm font-semibold text-white shadow-[0_8px_18px_-8px_rgba(24,25,30,0.45)] transition-all duration-150 hover:bg-[#2B2D35] active:scale-[0.99] cursor-pointer disabled:opacity-75 disabled:cursor-default"
                >
                  {stepLoading ? (
                    <Loader2 className="w-5 h-5 feedback-roll" />
                  ) : (
                    <>
                      <span>Take Exam</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Step 1: Select Course (search input + visible long scrollable dropdown + Continue) */}
            {setupStep === 'course' && (
              <div className={`${card} space-y-4 page-enter`}>
                <div>
                  <label
                    htmlFor="exam-course-search"
                    className="block text-xs font-semibold text-[#686C78]"
                  >
                    Select course
                  </label>

                  <div className="relative mt-2 flex items-center">
                    <Search className="pointer-events-none absolute left-3.5 h-4 w-4 text-[#686C78]" />
                    <input
                      id="exam-course-search"
                      type="text"
                      value={courseQuery}
                      onFocus={() => setCourseListOpen(true)}
                      onChange={(e) => {
                        setCourseQuery(e.target.value);
                        if (!courseListOpen) setCourseListOpen(true);
                      }}
                      placeholder="Search course code or title (e.g. CSC 201)..."
                      autoComplete="off"
                      className="min-h-[44px] w-full rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/[0.08] pl-10 pr-10 text-sm text-[#1A1B20] placeholder:text-[#8E93A2] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1D1E23]/20"
                    />
                    <button
                      type="button"
                      onClick={() => setCourseListOpen((o) => !o)}
                      aria-label={courseListOpen ? 'Collapse course list' : 'Expand course list'}
                      aria-expanded={courseListOpen}
                      className="absolute right-2 flex h-8 w-8 items-center justify-center rounded-lg text-[#686C78] hover:bg-[#ECEEF3] hover:text-[#1A1B20] cursor-pointer"
                    >
                      <ChevronDown
                        className={`h-4 w-4 transition-transform duration-150 ${
                          courseListOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {courseListOpen && (
                  <div
                    role="listbox"
                    aria-label="Available courses"
                    className="max-h-64 sm:max-h-72 overflow-y-auto rounded-xl border border-[#1A1B20]/[0.08] bg-[#F6F7F9] p-1.5 space-y-1"
                  >
                    {filteredCourseOptions.length === 0 ? (
                      <p className="px-3 py-6 text-center text-xs text-[#686C78]">
                        No courses match "{courseQuery.trim()}".
                      </p>
                    ) : (
                      filteredCourseOptions.map((opt) => {
                        const selected = courseCode === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            onClick={() => setCourseCode(opt.value)}
                            className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors duration-100 cursor-pointer flex items-center justify-between gap-3 ${
                              selected
                                ? 'bg-[#1D1E23] text-white'
                                : 'bg-white/70 text-[#1A1B20] hover:bg-white'
                            }`}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold">
                                {opt.label}
                              </span>
                              <span
                                className={`block text-[11px] ${
                                  selected ? 'text-[#C3C7D2]' : 'text-[#686C78]'
                                }`}
                              >
                                {opt.hint}
                              </span>
                            </span>
                            {selected && <Check className="h-4 w-4 shrink-0 text-white" />}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 rounded-xl bg-[#F6F7F9] px-3.5 py-2.5 text-xs">
                  <span className="font-medium text-[#505460] truncate">
                    Selected:{' '}
                    <strong className="font-semibold text-[#1A1B20]">
                      {selectedCourseOption?.label}
                    </strong>
                  </span>
                  <span className="shrink-0 font-mono-tabular font-semibold text-[#686C78]">
                    {pool} Qs
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => advanceToStep('type')}
                  disabled={pool === 0 || stepLoading}
                  aria-busy={stepLoading}
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#1D1E23] text-sm font-semibold text-white shadow-[0_8px_18px_-8px_rgba(24,25,30,0.45)] transition-all duration-150 hover:bg-[#2B2D35] active:scale-[0.99] cursor-pointer disabled:opacity-45 disabled:cursor-default"
                >
                  {stepLoading ? (
                    <Loader2 className="w-5 h-5 feedback-roll" />
                  ) : (
                    <>
                      <span>Continue</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Step 2: Exam Type */}
            {setupStep === 'type' && (
              <div className={`${card} space-y-5 page-enter`}>
                <div>
                  <p className="text-xs font-semibold text-[#686C78]">Choose exam type</p>
                  <div
                    className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2.5"
                    role="radiogroup"
                    aria-label="Exam type"
                  >
                    {EXAM_TYPES.map((type) => {
                      const active = examType === type.id;
                      return (
                        <button
                          key={type.id}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => setExamType(type.id)}
                          className={`text-left rounded-xl p-3.5 border transition-all duration-150 cursor-pointer flex items-start gap-3 ${
                            active
                              ? 'bg-[#1D1E23] text-white border-transparent shadow-[0_6px_16px_-6px_rgba(24,25,30,0.35)]'
                              : 'bg-[#F6F7F9] text-[#1A1B20] border-[#1A1B20]/[0.08] hover:bg-[#ECEEF3]'
                          }`}
                        >
                          <span
                            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                              active
                                ? 'bg-white/15 text-white'
                                : 'bg-white text-[#1D1E23] border border-[#1A1B20]/[0.08]'
                            }`}
                          >
                            {EXAM_TYPE_ICON[type.id]}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-bold leading-snug">
                              {type.label}
                            </span>
                            <span
                              className={`mt-0.5 block text-xs leading-relaxed ${
                                active ? 'text-[#C3C7D2]' : 'text-[#686C78]'
                              }`}
                            >
                              {type.description}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => advanceToStep('settings')}
                  disabled={stepLoading}
                  aria-busy={stepLoading}
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#1D1E23] text-sm font-semibold text-white shadow-[0_8px_18px_-8px_rgba(24,25,30,0.45)] transition-all duration-150 hover:bg-[#2B2D35] active:scale-[0.99] cursor-pointer disabled:opacity-75 disabled:cursor-default"
                >
                  {stepLoading ? (
                    <Loader2 className="w-5 h-5 feedback-roll" />
                  ) : (
                    <>
                      <span>Continue</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Step 3: Number of Questions & Time Allowed */}
            {setupStep === 'settings' && (
              <div className={`${card} space-y-5 page-enter`}>
                <div>
                  <p className="text-xs font-semibold text-[#686C78]">Number of questions</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {COUNT_CHOICES.map((n) => (
                      <Chip
                        key={n}
                        selected={!customCountMode && questionCount === n}
                        onClick={() => {
                          setCustomCountMode(false);
                          setQuestionCount(n);
                        }}
                      >
                        {n}
                      </Chip>
                    ))}
                    {examType === 'theory' && pool > 0 && !COUNT_CHOICES.includes(pool) && (
                      <Chip
                        selected={!customCountMode && questionCount === pool}
                        onClick={() => {
                          setCustomCountMode(false);
                          setQuestionCount(pool);
                        }}
                      >
                        All {pool}
                      </Chip>
                    )}
                    <Chip
                      selected={customCountMode}
                      onClick={() => {
                        setCustomCountMode(true);
                        setCustomCountInput(String(questionCount));
                      }}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Custom
                    </Chip>
                  </div>

                  {customCountMode && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/[0.08] p-2.5">
                      <button
                        type="button"
                        aria-label="Decrease number of questions"
                        onClick={() => applyCustomCount(String(Math.max(1, questionCount - 1)))}
                        className="h-9 w-9 rounded-lg bg-white border border-[#1A1B20]/[0.1] flex items-center justify-center text-[#1A1B20] hover:bg-[#ECEEF3] cursor-pointer"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <input
                        type="number"
                        min={1}
                        max={50}
                        inputMode="numeric"
                        aria-label="Custom number of questions"
                        value={customCountInput}
                        onChange={(e) => applyCustomCount(e.target.value)}
                        onBlur={() => setCustomCountInput(String(questionCount))}
                        className="h-9 w-20 rounded-lg bg-white border border-[#1A1B20]/[0.1] px-2.5 text-center font-mono-tabular text-sm font-bold text-[#1A1B20] focus:outline-none focus:ring-2 focus:ring-[#1D1E23]/20"
                      />
                      <button
                        type="button"
                        aria-label="Increase number of questions"
                        onClick={() => applyCustomCount(String(Math.min(50, questionCount + 1)))}
                        className="h-9 w-9 rounded-lg bg-white border border-[#1A1B20]/[0.1] flex items-center justify-center text-[#1A1B20] hover:bg-[#ECEEF3] cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                      <span className="text-xs font-medium text-[#505460] ml-1">
                        questions (1–50)
                      </span>
                    </div>
                  )}

                  <p className="mt-2 text-xs text-[#686C78]">
                    {questionCount} question{questionCount === 1 ? '' : 's'} selected · {pool} past question
                    {pool === 1 ? '' : 's'} in archive.
                  </p>
                </div>

                <div>
                  <p className="text-xs font-semibold text-[#686C78]">Time allowed</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {MINUTE_CHOICES.map((m) => (
                      <Chip
                        key={m}
                        selected={!customTimeMode && minutes === m}
                        onClick={() => {
                          setCustomTimeMode(false);
                          setMinutes(m);
                        }}
                      >
                        {m} min
                      </Chip>
                    ))}
                    <Chip
                      selected={customTimeMode}
                      onClick={() => {
                        setCustomTimeMode(true);
                        setCustomTimeInput(String(minutes));
                      }}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Custom
                    </Chip>
                  </div>

                  {customTimeMode && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/[0.08] p-2.5">
                      <button
                        type="button"
                        aria-label="Decrease exam minutes"
                        onClick={() => applyCustomMinutes(String(Math.max(1, minutes - 5)))}
                        className="h-9 w-9 rounded-lg bg-white border border-[#1A1B20]/[0.1] flex items-center justify-center text-[#1A1B20] hover:bg-[#ECEEF3] cursor-pointer"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <input
                        type="number"
                        min={1}
                        max={240}
                        inputMode="numeric"
                        aria-label="Custom time allowed in minutes"
                        value={customTimeInput}
                        onChange={(e) => applyCustomMinutes(e.target.value)}
                        onBlur={() => setCustomTimeInput(String(minutes))}
                        className="h-9 w-20 rounded-lg bg-white border border-[#1A1B20]/[0.1] px-2.5 text-center font-mono-tabular text-sm font-bold text-[#1A1B20] focus:outline-none focus:ring-2 focus:ring-[#1D1E23]/20"
                      />
                      <button
                        type="button"
                        aria-label="Increase exam minutes"
                        onClick={() => applyCustomMinutes(String(Math.min(240, minutes + 5)))}
                        className="h-9 w-9 rounded-lg bg-white border border-[#1A1B20]/[0.1] flex items-center justify-center text-[#1A1B20] hover:bg-[#ECEEF3] cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                      <span className="text-xs font-medium text-[#505460] ml-1">
                        minutes (1–240)
                      </span>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleStart}
                  disabled={pool === 0 || prepState !== 'idle'}
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#1D1E23] text-sm font-semibold text-white shadow-[0_8px_18px_-8px_rgba(24,25,30,0.45)] transition-all duration-150 hover:bg-[#2B2D35] active:scale-[0.99] cursor-pointer disabled:opacity-45 disabled:cursor-default"
                >
                  <span>Start exam</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  if (!exam) return null;

  // ------------------------------------------------------------------ exam
  if (phase === 'exam') {
    const unanswered = total - answeredCount;
    const isBusySubmitting = submitState !== 'idle';

    const renderAnimatedSubmitButton = (onClick: () => void, label = 'Submit exam') => (
      <button
        type="button"
        onClick={onClick}
        disabled={isBusySubmitting}
        aria-label={
          submitState === 'submitted'
            ? 'Exam submitted'
            : submitState === 'submitting'
              ? 'Submitting exam'
              : label
        }
        aria-busy={submitState === 'submitting'}
        className={`inline-flex h-11 items-center justify-center overflow-hidden font-semibold text-sm text-white select-none cursor-pointer transition-[width,background-color,border-radius,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] disabled:cursor-default shrink-0 ${
          isBusySubmitting ? 'w-11 rounded-full' : 'px-5 rounded-2xl shadow-[0_8px_18px_-8px_rgba(24,25,30,0.45)]'
        } ${
          submitState === 'submitted'
            ? 'bg-[#16A34A]'
            : 'bg-[#1D1E23] hover:bg-[#2B2D35] active:scale-[0.98]'
        }`}
      >
        {submitState === 'idle' && <span>{label}</span>}
        {submitState === 'submitting' && <Loader2 className="w-5 h-5 feedback-roll" />}
        {submitState === 'submitted' && <Check className="w-5 h-5 feedback-check" strokeWidth={3} />}
      </button>
    );

    const handleDirectSubmitClick = () => {
      if (isBusySubmitting) return;
      if (unanswered === 0) {
        triggerAnimatedSubmit(false);
      } else {
        setConfirm('finish');
      }
    };

    const confirmDialog =
      confirm &&
      typeof document !== 'undefined' &&
      createPortal(
        <div
          className="fixed inset-0 z-[80] bg-[#121318]/55 backdrop-blur-[2px] flex items-center justify-center p-4"
          onClick={() => {
            if (!isBusySubmitting) {
              pendingLeaveRef.current = null;
              setConfirm(null);
            }
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label={confirm === 'exit' ? 'Quit exam' : 'Submit exam'}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl bg-white p-5 border border-[#1A1B20]/[0.08] shadow-[0_24px_48px_-12px_rgba(14,15,20,0.35)] space-y-4 page-enter"
          >
            {confirm === 'exit' ? (
              <div className="space-y-1.5">
                <p className="font-display text-base font-bold text-[#1A1B20]">Quit exam?</p>
                <p className="text-sm text-[#505460] leading-relaxed">
                  Your current answers will not be saved if you end this exam now.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <p className="font-display text-base font-bold text-[#1A1B20]">
                  {unanswered > 0
                    ? `${unanswered} unanswered question${unanswered === 1 ? '' : 's'}`
                    : 'Submit exam?'}
                </p>
                <p className="text-sm text-[#505460] leading-relaxed">
                  {unanswered > 0
                    ? `You have answered ${answeredCount} of ${total} questions. Submit anyway?`
                    : 'Submit your answers now and view your performance.'}
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2.5">
              {confirm === 'exit' ? (
                <>
                  <TactileButton
                    variant="dark"
                    size="sm"
                    onClick={() => {
                      pendingLeaveRef.current = null;
                      setConfirm(null);
                    }}
                  >
                    Continue
                  </TactileButton>
                  <TactileButton
                    variant="light"
                    size="sm"
                    onClick={() => {
                      leavingRef.current = true;
                      setLeaving(true);
                      setConfirm(null);
                      const proceed = pendingLeaveRef.current;
                      pendingLeaveRef.current = null;
                      if (proceed) {
                        proceed();
                      } else {
                        onBack();
                      }
                    }}
                  >
                    End exam
                  </TactileButton>
                </>
              ) : (
                <>
                  {renderAnimatedSubmitButton(() => triggerAnimatedSubmit(false), 'Submit exam')}
                  <TactileButton
                    variant="light"
                    size="sm"
                    disabled={isBusySubmitting}
                    onClick={() => setConfirm(null)}
                  >
                    Continue
                  </TactileButton>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      );

    // CBT Mode: One question at a time with A–D options
    if (exam.examType === 'cbt') {
      const q = exam.questions[current];
      const isLast = current === total - 1;
      const selectedOption = answers[q.id];

      return (
        <div className="space-y-5 page-enter lg:mx-auto lg:max-w-3xl">
          {prepOverlay}
          {header}
          {confirmDialog}

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

            <div className="space-y-2.5" role="radiogroup" aria-label={`Options for question ${q.number}`}>
              {(q.options ?? []).map((opt, idx) => {
                const picked = selectedOption === String(idx);
                return (
                  <button
                    key={idx}
                    type="button"
                    role="radio"
                    aria-checked={picked}
                    disabled={isBusySubmitting}
                    onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: String(idx) }))}
                    className={`w-full text-left rounded-xl p-3.5 border transition-all duration-150 cursor-pointer flex items-start gap-3 ${
                      picked
                        ? 'bg-[#1D1E23] text-white border-transparent shadow-[0_4px_12px_-4px_rgba(24,25,30,0.3)]'
                        : 'bg-[#F6F7F9] text-[#1A1B20] border-[#1A1B20]/[0.08] hover:bg-[#ECEEF3]'
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        picked ? 'bg-white text-[#1D1E23]' : 'bg-white text-[#1A1B20] border border-[#1A1B20]/15'
                      }`}
                    >
                      {OPTION_LETTERS[idx]}
                    </span>
                    <span className="text-sm leading-relaxed">{opt}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <nav aria-label="Questions" className="flex flex-wrap gap-2">
            {exam.questions.map((item, i) => {
              const done = (answers[item.id] ?? '').trim().length > 0;
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={isBusySubmitting}
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
              disabled={current === 0 || isBusySubmitting}
              onClick={() => setCurrent((c) => Math.max(0, c - 1))}
            >
              Previous
            </TactileButton>
            {isLast ? (
              renderAnimatedSubmitButton(handleDirectSubmitClick)
            ) : (
              <TactileButton
                variant="dark"
                icon={<ArrowRight className="w-4 h-4" />}
                disabled={isBusySubmitting}
                onClick={() => setCurrent((c) => Math.min(total - 1, c + 1))}
              >
                Next
              </TactileButton>
            )}
          </div>
          {!isLast && (
            <button
              type="button"
              disabled={isBusySubmitting}
              onClick={() => setConfirm('finish')}
              className="block mx-auto text-xs font-semibold text-[#505460] underline underline-offset-4 decoration-[#1A1B20]/30 hover:decoration-[#1A1B20] cursor-pointer disabled:opacity-50"
            >
              Submit exam now
            </button>
          )}
        </div>
      );
    }

    // Paper Exam Modes (OBJ Paper, Theory Paper, True / False Paper) — full question list
    const paperSubtitle =
      exam.examType === 'obj'
        ? 'SECTION A · OBJECTIVE (MULTIPLE CHOICE)'
        : exam.examType === 'theory'
          ? 'SECTION B · THEORY & ESSAY QUESTIONS'
          : 'TRUE OR FALSE ASSESSMENT';

    const paperInstructions =
      exam.examType === 'obj'
        ? 'Answer all questions. Select the most appropriate option (A–D) for each question on the sheet.'
        : exam.examType === 'theory'
          ? 'Read each question carefully and write your answer in the space provided directly underneath.'
          : 'Read each statement carefully and select either True or False.';

    return (
      <div className="space-y-5 page-enter lg:mx-auto lg:max-w-3xl">
        {prepOverlay}
        {header}
        {confirmDialog}

        {/* Printed Paper Masthead */}
        <section
          aria-label="Examination paper instructions"
          className="rounded-2xl bg-white border border-[#1A1B20]/[0.1] p-5 shadow-[0_2px_12px_-4px_rgba(24,25,30,0.08)]"
        >
          <div className="border-b border-[#1A1B20]/[0.1] pb-3 text-center">
            <p className="text-[11px] font-mono-tabular font-bold uppercase tracking-[0.14em] text-[#686C78]">
              {paperSubtitle}
            </p>
            <h2 className="mt-1 font-display text-base sm:text-lg font-bold text-[#1A1B20]">
              {spec?.courseCode === ALL_COURSES
                ? 'GENERAL STUDIES PRACTICE PAPER'
                : `${spec?.courseCode} PRACTICE EXAMINATION`}
            </h2>
            <p className="mt-1 text-xs font-medium text-[#505460]">
              Time Allowed: {spec?.minutes} Minutes · Total Questions: {total}
            </p>
          </div>
          <p className="mt-3 text-xs sm:text-sm text-[#3A3D47] leading-relaxed">
            <span className="font-bold text-[#1A1B20]">Instructions: </span>
            {paperInstructions}
          </p>
        </section>

        {/* Full List of Questions on the Exam Sheet */}
        <ol className="space-y-4">
          {exam.questions.map((q) => {
            const val = answers[q.id] ?? '';
            const isAnswered = val.trim().length > 0;

            return (
              <li
                key={q.id}
                className="rounded-2xl bg-white p-4 sm:p-6 border border-[#1A1B20]/[0.08] shadow-[0_2px_10px_-4px_rgba(24,25,30,0.05)] space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-mono-tabular font-semibold text-[#686C78]">
                      {q.source}
                    </span>
                    {q.reasons.map((r) => (
                      <span
                        key={r}
                        className="rounded-full bg-[#F2F4F7] px-2.5 py-0.5 text-[11px] font-semibold text-[#505460]"
                      >
                        {r}
                      </span>
                    ))}
                  </div>
                  {isAnswered && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#1D1E23]/[0.07] px-2.5 py-0.5 text-[11px] font-semibold text-[#1A1B20]">
                      <Check className="w-3 h-3" /> Answered
                    </span>
                  )}
                </div>

                <p className="font-serif text-[16.5px] sm:text-[17px] leading-[1.75] text-[#1A1B20]">
                  <span className="font-bold tabular-nums mr-1.5">{q.number}.</span>
                  {q.text}
                </p>

                {/* OBJ: Full list with A–D options */}
                {exam.examType === 'obj' && (
                  <div
                    className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1"
                    role="radiogroup"
                    aria-label={`Options for question ${q.number}`}
                  >
                    {(q.options ?? []).map((opt, idx) => {
                      const picked = val === String(idx);
                      return (
                        <button
                          key={idx}
                          type="button"
                          role="radio"
                          aria-checked={picked}
                          onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: String(idx) }))}
                          className={`text-left rounded-xl p-3 border transition-all duration-150 cursor-pointer flex items-start gap-2.5 ${
                            picked
                              ? 'bg-[#1D1E23] text-white border-transparent shadow-[0_4px_12px_-4px_rgba(24,25,30,0.28)]'
                              : 'bg-[#F8F9FB] text-[#1A1B20] border-[#1A1B20]/[0.09] hover:bg-[#ECEEF3]'
                          }`}
                        >
                          <span
                            className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                              picked
                                ? 'bg-white text-[#1D1E23]'
                                : 'bg-white text-[#1A1B20] border border-[#1A1B20]/15'
                            }`}
                          >
                            {OPTION_LETTERS[idx]}
                          </span>
                          <span className="text-sm leading-snug">{opt}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Theory: Answer space directly underneath each question */}
                {exam.examType === 'theory' && (
                  <div className="pt-1">
                    <label
                      htmlFor={`answer-${q.id}`}
                      className="text-xs font-semibold uppercase tracking-[0.06em] text-[#686C78]"
                    >
                      Your answer (Question {q.number})
                    </label>
                    <textarea
                      id={`answer-${q.id}`}
                      value={val}
                      onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                      rows={5}
                      placeholder="Write your answer underneath this question..."
                      className="mt-1.5 w-full rounded-xl bg-[#FAFAFC] border border-[#1A1B20]/[0.12] px-3.5 py-3 text-sm leading-6 text-[#1A1B20] placeholder:text-[#8E93A2] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1D1E23]/20 resize-y"
                    />
                  </div>
                )}

                {/* Boolean: True / False only */}
                {exam.examType === 'boolean' && (
                  <div
                    className="grid grid-cols-2 gap-3 pt-1"
                    role="radiogroup"
                    aria-label={`True or False for question ${q.number}`}
                  >
                    {[
                      { value: 'true', label: 'True' },
                      { value: 'false', label: 'False' },
                    ].map((choice) => {
                      const picked = val === choice.value;
                      return (
                        <button
                          key={choice.value}
                          type="button"
                          role="radio"
                          aria-checked={picked}
                          onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: choice.value }))}
                          className={`min-h-[46px] rounded-xl px-4 text-sm font-bold border transition-all duration-150 cursor-pointer flex items-center justify-center gap-2 ${
                            picked
                              ? 'bg-[#1D1E23] text-white border-transparent shadow-[0_4px_12px_-4px_rgba(24,25,30,0.28)]'
                              : 'bg-[#F8F9FB] text-[#1A1B20] border-[#1A1B20]/[0.09] hover:bg-[#ECEEF3]'
                          }`}
                        >
                          {picked && <Check className="w-4 h-4" />}
                          {choice.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        {/* Paper Footer Submit Bar */}
        <div className={`${card} flex flex-col sm:flex-row sm:items-center justify-between gap-3`}>
          <div>
            <p className="text-sm font-bold text-[#1A1B20]">
              {answeredCount} of {total} answered
            </p>
            <p className="text-xs text-[#686C78]">
              {unanswered === 0
                ? 'All questions answered. Ready to submit.'
                : `${unanswered} question${unanswered === 1 ? '' : 's'} remaining.`}
            </p>
          </div>
          {renderAnimatedSubmitButton(handleDirectSubmitClick)}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- review
  return (
    <div className="space-y-5 page-enter lg:mx-auto lg:max-w-3xl">
      {prepOverlay}
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
              {isAutoGraded ? `${autoScore.correct}/${total}` : `${answeredCount}/${total}`}
            </p>
            <p className="text-[11px] text-[#686C78]">
              {isAutoGraded ? 'Correct' : 'Answered'}
            </p>
          </div>
          <div>
            <p className="font-display text-xl font-bold text-[#1A1B20] font-mono-tabular">
              {formatClock(usedSeconds)}
            </p>
            <p className="text-[11px] text-[#686C78]">Time used</p>
          </div>
          <div>
            <p className="font-display text-xl font-bold text-[#1A1B20]">
              {isAutoGraded
                ? `${autoScore.percent}%`
                : theoryScore.marked === 0
                  ? '—'
                  : `${theoryScore.percent}%`}
            </p>
            <p className="text-[11px] text-[#686C78]">Your score</p>
          </div>
        </div>

        <p className="mt-3 text-xs text-[#686C78] leading-relaxed">
          {isAutoGraded
            ? autoScore.percent >= 70
              ? 'Strong result! Review any missed explanations below to lock in the details.'
              : 'Good effort. Check the explanations below and try another practice set to sharpen weak areas.'
            : theoryScore.marked < total
              ? `Read each model answer, then mark yourself (${theoryScore.marked} of ${total} marked) to see your score.`
              : 'All marked. Try another exam to keep improving.'}
        </p>
      </section>

      <ol className="space-y-4">
        {exam.questions.map((q) => {
          const rawAns = answers[q.id] ?? '';
          const mine = rawAns.trim();

          if (isAutoGraded) {
            const isBoolean = exam.examType === 'boolean';
            const isCorrect = isBoolean
              ? mine === (q.correctBoolean ? 'true' : 'false')
              : mine !== '' && Number(mine) === q.correctIndex;
            const skipped = mine === '';

            return (
              <li key={q.id} className={`${card} space-y-3.5`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-mono-tabular font-semibold text-[#686C78]">
                    {q.source}
                  </span>
                  {skipped ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#FFF4D6] px-2.5 py-0.5 text-[11px] font-semibold text-[#6B4E00]">
                      Skipped
                    </span>
                  ) : isCorrect ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#E6F6EC] px-2.5 py-0.5 text-[11px] font-semibold text-[#166534]">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Correct
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#FDECEC] px-2.5 py-0.5 text-[11px] font-semibold text-[#9B1C1C]">
                      <XCircle className="w-3.5 h-3.5" /> Incorrect
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
                          {!isRightOption && userPickedThis && <XCircle className="w-4 h-4 shrink-0 mt-0.5" />}
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

          // Theory review card
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
        <TactileButton
          variant="dark"
          icon={<RotateCcw className="w-4 h-4" />}
          onClick={() => spec && launchWithLoader(spec)}
        >
          Try a new exam like this
        </TactileButton>
        <TactileButton
          variant="light"
          onClick={() => {
            setPhase('setup');
            setSetupStep('settings');
          }}
        >
          Change settings
        </TactileButton>
      </div>
    </div>
  );
};
