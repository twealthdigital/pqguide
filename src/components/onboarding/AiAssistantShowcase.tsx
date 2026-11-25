import React, { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Calendar,
  Check,
  ChevronRight,
  ChevronUp,
  FileText,
  Lightbulb,
  Loader2,
  Sparkles,
} from 'lucide-react';

type AiPhase =
  | 'ai_bounce_in'
  | 'move_to_ai'
  | 'click_ai'
  | 'course_select'
  | 'move_to_course'
  | 'click_course'
  | 'course_loading'
  | 'options_from_course'
  | 'move_to_opt1'
  | 'click_opt1'
  | 'opt1_loading'
  | 'opt1_view'
  | 'opt1_s1_ready'
  | 'opt1_scroll_1'
  | 'opt1_s2_ready'
  | 'opt1_scroll_2'
  | 'opt1_swipe_ready'
  | 'opt1_swiping'
  | 'options_from_opt1'
  | 'move_to_opt2'
  | 'click_opt2'
  | 'opt2_loading'
  | 'opt2_view'
  | 'opt2_s1_ready'
  | 'opt2_scroll_1'
  | 'opt2_s2_ready'
  | 'opt2_scroll_2'
  | 'opt2_swipe_ready'
  | 'opt2_swiping'
  | 'options_from_opt2'
  | 'move_to_opt3'
  | 'click_opt3'
  | 'opt3_years_loading'
  | 'opt3_years'
  | 'move_to_2020'
  | 'click_2020'
  | 'opt3_paper_open'
  | 'opt3_s1_ready'
  | 'opt3_scroll_1'
  | 'opt3_s2_ready'
  | 'opt3_scroll_2'
  | 'move_to_header'
  | 'click_collapse'
  | 'collapse_to_ai';

interface CursorState {
  xPct: number;
  yPx: number;
  visible: boolean;
  clicking: boolean;
}

function getCursorState(phase: AiPhase): CursorState {
  switch (phase) {
    case 'ai_bounce_in':
      return { xPct: 86, yPx: 125, visible: true, clicking: false };
    case 'move_to_ai':
      return { xPct: 50, yPx: 125, visible: true, clicking: false };
    case 'click_ai':
      return { xPct: 50, yPx: 125, visible: true, clicking: true };
    case 'course_select':
      return { xPct: 96, yPx: 102, visible: true, clicking: false };
    case 'move_to_course':
      return { xPct: 48, yPx: 102, visible: true, clicking: false };
    case 'click_course':
      return { xPct: 48, yPx: 102, visible: true, clicking: true };
    case 'course_loading':
    case 'options_from_course':
      return { xPct: 96, yPx: 112, visible: true, clicking: false };

    // Option 1: Predictable & Suggested Questions
    case 'move_to_opt1':
      return { xPct: 48, yPx: 102, visible: true, clicking: false };
    case 'click_opt1':
      return { xPct: 48, yPx: 102, visible: true, clicking: true };
    case 'opt1_loading':
    case 'opt1_view':
      return { xPct: 96, yPx: 140, visible: true, clicking: false };
    case 'opt1_s1_ready':
    case 'opt1_s2_ready':
      return { xPct: 78, yPx: 184, visible: true, clicking: false };
    case 'opt1_scroll_1':
    case 'opt1_scroll_2':
      return { xPct: 78, yPx: 136, visible: true, clicking: true };
    case 'opt1_swipe_ready':
      return { xPct: 18, yPx: 152, visible: true, clicking: false };
    case 'opt1_swiping':
      return { xPct: 84, yPx: 152, visible: true, clicking: true };
    case 'options_from_opt1':
      return { xPct: 96, yPx: 150, visible: true, clicking: false };

    // Option 2: Research on a Course
    case 'move_to_opt2':
      return { xPct: 48, yPx: 150, visible: true, clicking: false };
    case 'click_opt2':
      return { xPct: 48, yPx: 150, visible: true, clicking: true };
    case 'opt2_loading':
    case 'opt2_view':
      return { xPct: 96, yPx: 140, visible: true, clicking: false };
    case 'opt2_s1_ready':
    case 'opt2_s2_ready':
      return { xPct: 78, yPx: 184, visible: true, clicking: false };
    case 'opt2_scroll_1':
    case 'opt2_scroll_2':
      return { xPct: 78, yPx: 136, visible: true, clicking: true };
    case 'opt2_swipe_ready':
      return { xPct: 18, yPx: 152, visible: true, clicking: false };
    case 'opt2_swiping':
      return { xPct: 84, yPx: 152, visible: true, clicking: true };
    case 'options_from_opt2':
      return { xPct: 96, yPx: 188, visible: true, clicking: false };

    // Option 3: Work on All Past Questions -> Year 2020 -> Scroll 2x -> Collapse
    case 'move_to_opt3':
      return { xPct: 48, yPx: 198, visible: true, clicking: false };
    case 'click_opt3':
      return { xPct: 48, yPx: 198, visible: true, clicking: true };
    case 'opt3_years_loading':
    case 'opt3_years':
      return { xPct: 96, yPx: 150, visible: true, clicking: false };
    case 'move_to_2020':
      return { xPct: 70, yPx: 150, visible: true, clicking: false };
    case 'click_2020':
      return { xPct: 70, yPx: 150, visible: true, clicking: true };
    case 'opt3_paper_open':
      return { xPct: 96, yPx: 140, visible: true, clicking: false };
    case 'opt3_s1_ready':
    case 'opt3_s2_ready':
      return { xPct: 78, yPx: 184, visible: true, clicking: false };
    case 'opt3_scroll_1':
    case 'opt3_scroll_2':
      return { xPct: 78, yPx: 136, visible: true, clicking: true };
    case 'move_to_header':
      return { xPct: 48, yPx: 36, visible: true, clicking: false };
    case 'click_collapse':
      return { xPct: 48, yPx: 36, visible: true, clicking: true };
    case 'collapse_to_ai':
      return { xPct: 86, yPx: 125, visible: true, clicking: false };
  }
}

export const AiAssistantShowcase: React.FC = () => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<AiPhase>('ai_bounce_in');
  const [loopCount, setLoopCount] = useState(0);
  const [isTabVisible, setIsTabVisible] = useState<boolean>(
    typeof document !== 'undefined' ? document.visibilityState === 'visible' : true
  );
  const [isOnScreen, setIsOnScreen] = useState(true);

  const isActive = isTabVisible && isOnScreen;

  // Lightweight visibility guard: zero timers while hidden/screen-off, restart cleanly on return
  useEffect(() => {
    let wasOnScreen = true;

    const syncVisibility = () => {
      setIsTabVisible(document.visibilityState === 'visible');
    };
    const handlePageHide = () => setIsTabVisible(false);
    const handlePageShow = () => setIsTabVisible(true);

    document.addEventListener('visibilitychange', syncVisibility);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);

    let observer: IntersectionObserver | null = null;
    if (rootRef.current && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        ([entry]) => {
          const intersecting = Boolean(entry?.isIntersecting);
          if (intersecting !== wasOnScreen) {
            wasOnScreen = intersecting;
            setIsOnScreen(intersecting);
          }
        },
        { threshold: 0.1 }
      );
      observer.observe(rootRef.current);
    }

    return () => {
      document.removeEventListener('visibilitychange', syncVisibility);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!isActive) {
      setPhase('ai_bounce_in');
      return;
    }

    setPhase('ai_bounce_in');

    const timeline: Array<[AiPhase, number]> = [
      ['move_to_ai', 950],
      ['click_ai', 1450],
      ['course_select', 1750],
      ['move_to_course', 2550],
      ['click_course', 3050],
      ['course_loading', 3350],
      ['options_from_course', 4550],

      // Option 1: Predictable & Suggested Questions
      ['move_to_opt1', 5550],
      ['click_opt1', 6050],
      ['opt1_loading', 6350],
      ['opt1_view', 7350],
      ['opt1_s1_ready', 8250],
      ['opt1_scroll_1', 8650],
      ['opt1_s2_ready', 9700],
      ['opt1_scroll_2', 10100],
      ['opt1_swipe_ready', 11150],
      ['opt1_swiping', 11550],
      ['options_from_opt1', 12150],

      // Option 2: Research on a Course
      ['move_to_opt2', 13000],
      ['click_opt2', 13500],
      ['opt2_loading', 13800],
      ['opt2_view', 14800],
      ['opt2_s1_ready', 15700],
      ['opt2_scroll_1', 16100],
      ['opt2_s2_ready', 17150],
      ['opt2_scroll_2', 17550],
      ['opt2_swipe_ready', 18600],
      ['opt2_swiping', 19000],
      ['options_from_opt2', 19600],

      // Option 3: Work on All Past Questions -> Year 2020 -> Scroll 2x -> Collapse
      ['move_to_opt3', 20450],
      ['click_opt3', 20950],
      ['opt3_years_loading', 21250],
      ['opt3_years', 22050],
      ['move_to_2020', 22950],
      ['click_2020', 23450],
      ['opt3_paper_open', 23750],
      ['opt3_s1_ready', 24750],
      ['opt3_scroll_1', 25150],
      ['opt3_s2_ready', 26200],
      ['opt3_scroll_2', 26600],
      ['move_to_header', 27650],
      ['click_collapse', 28200],
      ['collapse_to_ai', 28520],
    ];

    const timers = timeline.map(([nextPhase, delay]) =>
      window.setTimeout(() => setPhase(nextPhase), delay)
    );

    const loopTimer = window.setTimeout(() => {
      setLoopCount((n) => n + 1);
    }, 29600);

    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      window.clearTimeout(loopTimer);
    };
  }, [isActive, loopCount]);

  const cursor = getCursorState(phase);

  const isAiCentered =
    phase === 'ai_bounce_in' ||
    phase === 'move_to_ai' ||
    phase === 'click_ai' ||
    phase === 'collapse_to_ai';

  const isCourseSelect =
    phase === 'course_select' ||
    phase === 'move_to_course' ||
    phase === 'click_course';
  const isCourseLoading = phase === 'course_loading';
  const isOptionsList =
    phase === 'options_from_course' ||
    phase === 'move_to_opt1' ||
    phase === 'click_opt1' ||
    phase === 'options_from_opt1' ||
    phase === 'move_to_opt2' ||
    phase === 'click_opt2' ||
    phase === 'options_from_opt2' ||
    phase === 'move_to_opt3' ||
    phase === 'click_opt3';

  const isOpt1Loading = phase === 'opt1_loading';
  const isOpt1View =
    phase === 'opt1_view' ||
    phase === 'opt1_s1_ready' ||
    phase === 'opt1_scroll_1' ||
    phase === 'opt1_s2_ready' ||
    phase === 'opt1_scroll_2' ||
    phase === 'opt1_swipe_ready' ||
    phase === 'opt1_swiping';

  const isOpt2Loading = phase === 'opt2_loading';
  const isOpt2View =
    phase === 'opt2_view' ||
    phase === 'opt2_s1_ready' ||
    phase === 'opt2_scroll_1' ||
    phase === 'opt2_s2_ready' ||
    phase === 'opt2_scroll_2' ||
    phase === 'opt2_swipe_ready' ||
    phase === 'opt2_swiping';

  const isOpt3YearsLoading = phase === 'opt3_years_loading';
  const isOpt3Years =
    phase === 'opt3_years' ||
    phase === 'move_to_2020' ||
    phase === 'click_2020';
  const isOpt3Paper =
    phase === 'opt3_paper_open' ||
    phase === 'opt3_s1_ready' ||
    phase === 'opt3_scroll_1' ||
    phase === 'opt3_s2_ready' ||
    phase === 'opt3_scroll_2' ||
    phase === 'move_to_header' ||
    phase === 'click_collapse';

  const isLoadingScreen =
    isCourseLoading || isOpt1Loading || isOpt2Loading || isOpt3YearsLoading;
  const isSwipingAway = phase === 'opt1_swiping' || phase === 'opt2_swiping';

  const scrollStep =
    phase === 'opt1_scroll_1' ||
    phase === 'opt1_s2_ready' ||
    phase === 'opt2_scroll_1' ||
    phase === 'opt2_s2_ready' ||
    phase === 'opt3_scroll_1' ||
    phase === 'opt3_s2_ready'
      ? 1
      : phase === 'opt1_scroll_2' ||
        phase === 'opt1_swipe_ready' ||
        phase === 'opt1_swiping' ||
        phase === 'opt2_scroll_2' ||
        phase === 'opt2_swipe_ready' ||
        phase === 'opt2_swiping' ||
        phase === 'opt3_scroll_2' ||
        phase === 'move_to_header' ||
        phase === 'click_collapse'
      ? 2
      : 0;

  const headerTitle = isCourseSelect
    ? 'Select Course'
    : isCourseLoading
    ? 'Understanding CSC 201...'
    : isOptionsList
    ? 'Use CSC 201 for...'
    : isOpt1Loading || isOpt1View
    ? 'Predictable Questions'
    : isOpt2Loading || isOpt2View
    ? 'Research · CSC 201'
    : isOpt3YearsLoading || isOpt3Years
    ? 'All Past Questions'
    : 'CSC 201 · 2020 Past Question';

  const headerSubtitle = isCourseSelect
    ? 'Pick a course to start studying'
    : isCourseLoading
    ? 'Reading syllabus & exam pattern'
    : isOptionsList
    ? 'Choose an AI study mode'
    : isOpt1Loading
    ? 'Ranking likely exam topics...'
    : isOpt1View
    ? 'CSC 201 · Suggested questions'
    : isOpt2Loading
    ? 'Synthesizing core course notes...'
    : isOpt2View
    ? 'Core concepts & key definitions'
    : isOpt3YearsLoading
    ? 'Loading sessions...'
    : isOpt3Years
    ? 'Select an exam year'
    : '2020 First & Second Semester';

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className="pointer-events-none select-none relative w-full h-full overflow-hidden flex items-center justify-center"
    >
      {/* Subtly Tilted Stage Wrapper matching Slide 2 */}
      <div className="relative w-full max-w-[335px] sm:max-w-[375px] h-[250px] px-4 -mt-2 md:-mt-2 lg:mt-0 -rotate-[4deg] md:scale-[0.96] lg:scale-[0.95] xl:scale-100">
        {/* Solid Black High-Contrast Mouse Pointer */}
        <div
          className="pointer-events-none absolute inset-0 z-50 transition-[transform,opacity] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform"
          style={{
            opacity: cursor.visible ? 1 : 0,
            transform: `translate3d(${cursor.xPct}%, ${cursor.yPx}px, 0)`,
          }}
        >
          <svg
            viewBox="0 0 24 24"
            className={`w-6 h-6 -ml-1 -mt-1 drop-shadow-[0_3px_6px_rgba(0,0,0,0.42)] origin-top-left transition-transform duration-150 ${
              cursor.clicking ? 'scale-[0.8]' : 'scale-100'
            }`}
            fill="none"
          >
            <path
              d="M4.5 3.2L19.4 11.1L12.7 13.4L10.3 20.1L4.5 3.2Z"
              fill="#000000"
              stroke="#FFFFFF"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        {/* Centered AI Icon (bounces in at start, collapses back & bounces at end) */}
        {isAiCentered && (
          <div className="absolute inset-0 flex items-center justify-center z-20">
            <div
              className={`h-16 w-16 rounded-[22px] tactile-dark text-white flex items-center justify-center shadow-[0_18px_36px_-10px_rgba(20,21,26,0.45)] transition-transform duration-150 ${
                phase === 'click_ai'
                  ? 'scale-90'
                  : 'animate-ai-bounce'
              }`}
            >
              <Sparkles className="w-7 h-7" />
            </div>
          </div>
        )}

        {/* Main Dialogue Box (opens smoothly after AI click, shrinks back to AI icon at end) */}
        <div
          className={`absolute left-4 right-4 top-0 rounded-[28px] bg-white p-4 border border-[#1A1B20]/[0.08] shadow-[0_14px_32px_-12px_rgba(20,21,26,0.14)] transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            isAiCentered
              ? 'opacity-0 scale-75 pointer-events-none'
              : 'opacity-100 scale-100'
          }`}
        >
          {/* Dialogue Header with Docked AI Icon */}
          <div
            className={`flex items-center justify-between gap-2.5 transition-transform duration-150 ${
              phase === 'click_collapse' ? 'scale-[0.985]' : 'scale-100'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-xl tactile-dark text-white flex items-center justify-center shrink-0">
                {isLoadingScreen ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Sparkles className="w-5 h-5" />
                )}
              </div>

              <div className="min-w-0">
                <p className="font-display text-sm font-bold text-[#1A1B20] truncate">
                  {headerTitle}
                </p>
                <p className="text-xs text-[#686C78] truncate">
                  {headerSubtitle}
                </p>
              </div>
            </div>

            {isOpt3Paper && (
              <span
                className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 transition-colors duration-150 ${
                  phase === 'move_to_header' || phase === 'click_collapse'
                    ? 'bg-[#1D1E23] text-white'
                    : 'bg-[#F2F4F7] text-[#686C78]'
                }`}
              >
                <ChevronUp className="w-4 h-4" />
              </span>
            )}
          </div>

          {/* Inner Dialogue Viewport (exact h-[164px], p-3 -> rows at y=102, 150, 198) */}
          <div className="mt-3.5 relative h-[164px] rounded-2xl bg-[#F4F5F8] border border-[#1A1B20]/[0.05] p-3 overflow-hidden">
            {/* Step 1: Course Selection */}
            {isCourseSelect && (
              <div className="space-y-2 page-enter">
                <div
                  className={`h-[40px] rounded-xl px-3 flex items-center justify-between text-xs font-semibold border transition-all duration-150 ${
                    phase === 'click_course'
                      ? 'bg-[#1D1E23] text-white border-[#1D1E23] scale-[0.98]'
                      : phase === 'move_to_course'
                      ? 'bg-white text-[#1A1B20] border-[#1D1E23]/40 shadow-xs'
                      : 'bg-white text-[#1A1B20] border-[#1A1B20]/[0.07]'
                  }`}
                >
                  <span className="truncate">CSC 201 · Computer Programming</span>
                  <ChevronRight className="w-3.5 h-3.5 shrink-0 opacity-60" />
                </div>

                <div className="h-[40px] rounded-xl bg-white/80 px-3 flex items-center justify-between text-xs font-medium text-[#5E6370] border border-[#1A1B20]/[0.05]">
                  <span className="truncate">GNS 101 · Use of English</span>
                  <ChevronRight className="w-3.5 h-3.5 shrink-0 opacity-40" />
                </div>

                <div className="h-[40px] rounded-xl bg-white/80 px-3 flex items-center justify-between text-xs font-medium text-[#5E6370] border border-[#1A1B20]/[0.05]">
                  <span className="truncate">LAW 301 · Law of Torts</span>
                  <ChevronRight className="w-3.5 h-3.5 shrink-0 opacity-40" />
                </div>
              </div>
            )}

            {/* Loading States */}
            {isLoadingScreen && (
              <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-center page-enter">
                <div className="h-10 w-10 rounded-full bg-white border border-[#1A1B20]/10 shadow-xs flex items-center justify-center text-[#1D1E23]">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
                <p className="font-display text-xs font-bold text-[#1A1B20]">
                  {isCourseLoading
                    ? 'Analyzing CSC 201...'
                    : isOpt1Loading
                    ? 'Preparing Suggested Questions...'
                    : isOpt2Loading
                    ? 'Gathering Course Research...'
                    : 'Loading Exam Home...'}
                </p>
              </div>
            )}

            {/* Step 2: 3 Study Mode Options */}
            {isOptionsList && (
              <div className="space-y-2 page-enter">
                <div
                  className={`h-[40px] rounded-xl px-3 flex items-center justify-between text-xs font-semibold border transition-all duration-150 ${
                    phase === 'click_opt1'
                      ? 'bg-[#1D1E23] text-white border-[#1D1E23] scale-[0.98]'
                      : phase === 'move_to_opt1'
                      ? 'bg-white text-[#1A1B20] border-[#1D1E23]/40 shadow-xs'
                      : 'bg-white text-[#1A1B20] border-[#1A1B20]/[0.07]'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <Lightbulb className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">
                      1. Predictable &amp; Suggested Questions
                    </span>
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 shrink-0 opacity-60" />
                </div>

                <div
                  className={`h-[40px] rounded-xl px-3 flex items-center justify-between text-xs font-semibold border transition-all duration-150 ${
                    phase === 'click_opt2'
                      ? 'bg-[#1D1E23] text-white border-[#1D1E23] scale-[0.98]'
                      : phase === 'move_to_opt2'
                      ? 'bg-white text-[#1A1B20] border-[#1D1E23]/40 shadow-xs'
                      : 'bg-white text-[#1A1B20] border-[#1A1B20]/[0.07]'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <BookOpen className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">2. Research on a Course</span>
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 shrink-0 opacity-60" />
                </div>

                <div
                  className={`h-[40px] rounded-xl px-3 flex items-center justify-between text-xs font-semibold border transition-all duration-150 ${
                    phase === 'click_opt3'
                      ? 'bg-[#1D1E23] text-white border-[#1D1E23] scale-[0.98]'
                      : phase === 'move_to_opt3'
                      ? 'bg-white text-[#1A1B20] border-[#1D1E23]/40 shadow-xs'
                      : 'bg-white text-[#1A1B20] border-[#1A1B20]/[0.07]'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <FileText className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">
                      3. Work on All Past Questions
                    </span>
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 shrink-0 opacity-60" />
                </div>
              </div>
            )}

            {/* Option 1 View: Predictable & Suggested Questions (2x scroll + left-to-right swipe away) */}
            {isOpt1View && (
              <div
                className={`w-full h-full rounded-xl bg-white border border-[#1A1B20]/[0.07] p-2.5 flex flex-col text-left transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  isSwipingAway
                    ? 'translate-x-36 opacity-0 rotate-2'
                    : 'translate-x-0 opacity-100 rotate-0 page-enter'
                }`}
              >
                <div className="flex items-center justify-between border-b border-[#1A1B20]/10 pb-1.5 shrink-0">
                  <span className="font-display text-[11px] font-bold text-[#1A1B20]">
                    High-Probability Questions · CSC 201
                  </span>
                  <span className="font-mono-tabular text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#1D1E23] text-white">
                    AI PICK
                  </span>
                </div>

                <div className="relative flex-1 overflow-hidden pt-1.5">
                  <div
                    className={`space-y-2 text-[11px] leading-snug text-[#2E313B] transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform ${
                      scrollStep === 1
                        ? '-translate-y-[46px]'
                        : scrollStep === 2
                        ? '-translate-y-[98px]'
                        : 'translate-y-0'
                    }`}
                  >
                    <p>
                      <strong className="text-[#1A1B20]">P1:</strong> Contrast method overloading and method overriding with Java code.
                    </p>
                    <p>
                      <strong className="text-[#1A1B20]">P2:</strong> Trace a recursive factorial trace tree for n = 5.
                    </p>
                    <p>
                      <strong className="text-[#1A1B20]">P3:</strong> Explain why constructors cannot be inherited directly.
                    </p>
                    <p>
                      <strong className="text-[#1A1B20]">P4:</strong> State four access modifiers and their visibility scope.
                    </p>
                    <p className="text-[#686C78]">
                      <strong className="text-[#1A1B20]">P5:</strong> Write a class encapsulating student CGPA validation.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Option 2 View: Research on a Course (explanatory text content, 2x scroll + left-to-right swipe away) */}
            {isOpt2View && (
              <div
                className={`w-full h-full rounded-xl bg-white border border-[#1A1B20]/[0.07] p-2.5 flex flex-col text-left transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  isSwipingAway
                    ? 'translate-x-36 opacity-0 rotate-2'
                    : 'translate-x-0 opacity-100 rotate-0 page-enter'
                }`}
              >
                <div className="flex items-center justify-between border-b border-[#1A1B20]/10 pb-1.5 shrink-0">
                  <span className="font-display text-[11px] font-bold text-[#1A1B20]">
                    CSC 201 · Course Research Brief
                  </span>
                  <span className="font-mono-tabular text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#1D1E23] text-white">
                    NOTES
                  </span>
                </div>

                <div className="relative flex-1 overflow-hidden pt-1.5">
                  <div
                    className={`space-y-2.5 text-[11px] leading-snug text-[#2E313B] transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform ${
                      scrollStep === 1
                        ? '-translate-y-[56px]'
                        : scrollStep === 2
                        ? '-translate-y-[118px]'
                        : 'translate-y-0'
                    }`}
                  >
                    <p>
                      <strong className="text-[#1A1B20]">OOP Architecture:</strong> Objects bind internal fields with class methods so large systems stay modular and maintainable.
                    </p>
                    <p>
                      <strong className="text-[#1A1B20]">Encapsulation:</strong> Declaring attributes private protects object invariants while exposing clean public interfaces.
                    </p>
                    <p>
                      <strong className="text-[#1A1B20]">Polymorphism:</strong> A single superclass reference dispatches specialized subclass behavior dynamically at runtime.
                    </p>
                    <p className="text-[#686C78]">
                      <strong className="text-[#1A1B20]">Call Stack Memory:</strong> Local variables live on stack frames while instantiated objects reside on the heap.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Option 3 Step A: Select Exam Year (2x3 grid, rows align at y=102, 150, 198) */}
            {isOpt3Years && (
              <div className="grid grid-cols-2 gap-2 page-enter">
                <div className="h-[40px] rounded-xl bg-white px-3 flex items-center justify-between text-xs font-semibold text-[#5E6370] border border-[#1A1B20]/[0.06]">
                  <span className="font-mono-tabular">2023/2024</span>
                  <Calendar className="w-3.5 h-3.5 opacity-50" />
                </div>
                <div className="h-[40px] rounded-xl bg-white px-3 flex items-center justify-between text-xs font-semibold text-[#5E6370] border border-[#1A1B20]/[0.06]">
                  <span className="font-mono-tabular">2022/2023</span>
                  <Calendar className="w-3.5 h-3.5 opacity-50" />
                </div>
                <div className="h-[40px] rounded-xl bg-white px-3 flex items-center justify-between text-xs font-semibold text-[#5E6370] border border-[#1A1B20]/[0.06]">
                  <span className="font-mono-tabular">2021/2022</span>
                  <Calendar className="w-3.5 h-3.5 opacity-50" />
                </div>
                <div
                  className={`h-[40px] rounded-xl px-3 flex items-center justify-between text-xs font-bold border transition-all duration-150 ${
                    phase === 'click_2020'
                      ? 'bg-[#1D1E23] text-white border-[#1D1E23] scale-[0.97]'
                      : phase === 'move_to_2020'
                      ? 'bg-white text-[#1A1B20] border-[#1D1E23]/50 shadow-xs'
                      : 'bg-white text-[#1A1B20] border-[#1A1B20]/[0.08]'
                  }`}
                >
                  <span className="font-mono-tabular">2020</span>
                  {phase === 'click_2020' ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Calendar className="w-3.5 h-3.5 opacity-70" />
                  )}
                </div>
                <div className="h-[40px] rounded-xl bg-white/80 px-3 flex items-center justify-between text-xs font-medium text-[#686C78] border border-[#1A1B20]/[0.05]">
                  <span className="font-mono-tabular">2019</span>
                  <Calendar className="w-3.5 h-3.5 opacity-40" />
                </div>
                <div className="h-[40px] rounded-xl bg-white/80 px-3 flex items-center justify-between text-xs font-medium text-[#686C78] border border-[#1A1B20]/[0.05]">
                  <span className="font-mono-tabular">2018</span>
                  <Calendar className="w-3.5 h-3.5 opacity-40" />
                </div>
              </div>
            )}

            {/* Option 3 Step B: 2020 Past Questions Open (2x scroll -> header click collapses to AI orb) */}
            {isOpt3Paper && (
              <div className="w-full h-full rounded-xl bg-white border border-[#1A1B20]/[0.07] p-2.5 flex flex-col text-left page-enter">
                <div className="flex items-center justify-between border-b border-[#1A1B20]/10 pb-1.5 shrink-0">
                  <span className="font-display text-[11px] font-bold text-[#1A1B20]">
                    AAUA · CSC 201 (2020 Past Question)
                  </span>
                  <span className="font-mono-tabular text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#1D1E23] text-white">
                    2020
                  </span>
                </div>

                <div className="relative flex-1 overflow-hidden pt-1.5">
                  <div
                    className={`space-y-2 text-[11px] leading-snug text-[#2E313B] transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform ${
                      scrollStep === 1
                        ? '-translate-y-[48px]'
                        : scrollStep === 2
                        ? '-translate-y-[104px]'
                        : 'translate-y-0'
                    }`}
                  >
                    <p>
                      <strong className="text-[#1A1B20]">Q1:</strong> Define data abstraction and explain how classes enforce it.
                    </p>
                    <p>
                      <strong className="text-[#1A1B20]">Q2:</strong> Write a Java program to compute prime numbers up to 100.
                    </p>
                    <p>
                      <strong className="text-[#1A1B20]">Q3:</strong> Distinguish checked vs unchecked exceptions with examples.
                    </p>
                    <p>
                      <strong className="text-[#1A1B20]">Q4:</strong> Explain static variables and static blocks in OOP.
                    </p>
                    <p className="text-[#686C78]">
                      <strong className="text-[#1A1B20]">Q5:</strong> Implement binary search over a sorted array of integers.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Top darker blurred fade (mobile & tablet; desktop uses full-width fade in OnboardingScreen) */}
      <div
        className="lg:hidden pointer-events-none absolute inset-x-0 top-0 h-32 backdrop-blur-[4px]"
        style={{
          background:
            'linear-gradient(to bottom, rgba(29,30,35,0.52) 0%, rgba(29,30,35,0.22) 48%, rgba(29,30,35,0) 100%)',
          maskImage:
            'linear-gradient(to bottom, black 0%, black 38%, transparent 100%)',
          WebkitMaskImage:
            'linear-gradient(to bottom, black 0%, black 38%, transparent 100%)',
        }}
      />

      {/* Seamless multi-stop white bottom fade on mobile & tablet */}
      <div
        className="md:hidden pointer-events-none absolute inset-x-0 bottom-0 h-36 sm:h-40"
        style={{
          background:
            'linear-gradient(to top, #FFFFFF 0%, #FFFFFF 24%, rgba(255,255,255,0.92) 50%, rgba(255,255,255,0.48) 76%, rgba(255,255,255,0) 100%)',
        }}
      />
      <div
        className="hidden md:block lg:hidden pointer-events-none absolute inset-x-0 bottom-0 h-28"
        style={{
          background:
            'linear-gradient(to top, #FFFFFF 0%, #FFFFFF 18%, rgba(255,255,255,0.86) 48%, rgba(255,255,255,0.38) 78%, rgba(255,255,255,0) 100%)',
        }}
      />
    </div>
  );
};
