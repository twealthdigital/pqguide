import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  BookOpen,
  Check,
  ChevronUp,
  FileText,
  Image as ImageIcon,
  Loader2,
  ScanLine,
  Send,
  Upload,
} from 'lucide-react';

type ShowcasePhase =
  // Card 1 (White): Photo Upload -> Scan-to-PDF
  | 'c1_intro'
  | 'c1_move_expand'
  | 'c1_click_expand'
  | 'c1_ready'
  | 'c1_move_upload'
  | 'c1_click_upload'
  | 'c1_uploading'
  | 'c1_photo_verified'
  | 'c1_move_scan'
  | 'c1_click_scan'
  | 'c1_scanning'
  | 'c1_scan_verified'
  | 'c1_converted'
  | 'c1_move_download'
  | 'c1_click_download'
  | 'c1_downloaded_fly'
  | 'c1_move_read'
  | 'c1_click_read'
  | 'c1_pdf_open'
  | 'c1_scroll_1_ready'
  | 'c1_pdf_scroll_1'
  | 'c1_scroll_2_ready'
  | 'c1_pdf_scroll_2'
  | 'c1_move_header'
  | 'c1_click_collapse'
  | 'c1_collapsed'
  | 'c1_scroll_to_c2'
  // Card 2 (Dark): Typed Doc -> Indexed Questions
  | 'c2_intro'
  | 'c2_move_expand'
  | 'c2_click_expand'
  | 'c2_canvas_ready'
  | 'c2_move_canvas'
  | 'c2_click_canvas'
  | 'c2_typing'
  | 'c2_autosaved'
  | 'c2_move_publish'
  | 'c2_click_publish'
  | 'c2_publishing'
  | 'c2_scanning'
  | 'c2_verified'
  | 'c2_converted'
  | 'c2_move_download'
  | 'c2_click_download'
  | 'c2_downloaded_fly'
  | 'c2_move_read'
  | 'c2_click_read'
  | 'c2_pdf_open'
  | 'c2_scroll_1_ready'
  | 'c2_pdf_scroll_1'
  | 'c2_scroll_2_ready'
  | 'c2_pdf_scroll_2'
  | 'c2_move_header'
  | 'c2_click_collapse'
  | 'c2_collapsed'
  | 'c2_scroll_back_c1';

interface CursorState {
  xPct: number;
  yPx: number;
  visible: boolean;
  clicking: boolean;
}

interface TypingChunk {
  text: string;
  delay: number;
  fast?: boolean;
  hit?: boolean;
}

// Clean deterministic cumulative typing steps (small count for 1GB RAM efficiency)
const TYPING_FRAMES: TypingChunk[] = [
  { text: 'CSC 201 · ', delay: 120, hit: true },
  { text: 'CSC 201 · Q1: ', delay: 110, hit: true },
  { text: 'CSC 201 · Q1: Distinguish ', delay: 130, hit: true },
  { text: 'CSC 201 · Q1: Distinguish procd', delay: 115, hit: true },
  { text: 'CSC 201 · Q1: Distinguish procdural', delay: 120, hit: true },
  { text: 'CSC 201 · Q1: Distinguish procdural', delay: 320, hit: false }, // pause on typo
  { text: 'CSC 201 · Q1: Distinguish procdura', delay: 80, hit: true },
  { text: 'CSC 201 · Q1: Distinguish procdur', delay: 75, hit: true },
  { text: 'CSC 201 · Q1: Distinguish procdu', delay: 75, hit: true },
  { text: 'CSC 201 · Q1: Distinguish procd', delay: 75, hit: true },
  { text: 'CSC 201 · Q1: Distinguish proc', delay: 90, hit: true },
  { text: 'CSC 201 · Q1: Distinguish proced', delay: 105, hit: true },
  { text: 'CSC 201 · Q1: Distinguish procedural ', delay: 115, hit: true },
  { text: 'CSC 201 · Q1: Distinguish procedural vs OOP ', delay: 115, hit: true },
  // Fast-forward finish
  {
    text: 'CSC 201 · Q1: Distinguish procedural vs OOP with examples.',
    delay: 85,
    fast: true,
    hit: true,
  },
  {
    text: 'CSC 201 · Q1: Distinguish procedural vs OOP with examples.\nQ2: Explain Encapsulation & ',
    delay: 85,
    fast: true,
    hit: true,
  },
  {
    text: 'CSC 201 · Q1: Distinguish procedural vs OOP with examples.\nQ2: Explain Encapsulation & Polymorphism.',
    delay: 95,
    fast: true,
    hit: true,
  },
];

function getCursorState(phase: ShowcasePhase): CursorState {
  switch (phase) {
    // Card 1 coordinates
    case 'c1_intro':
      return { xPct: 96, yPx: 80, visible: true, clicking: false };
    case 'c1_move_expand':
      return { xPct: 52, yPx: 80, visible: true, clicking: false };
    case 'c1_click_expand':
      return { xPct: 52, yPx: 80, visible: true, clicking: true };
    case 'c1_ready':
      return { xPct: 96, yPx: 128, visible: true, clicking: false };
    case 'c1_move_upload':
      return { xPct: 50, yPx: 128, visible: true, clicking: false };
    case 'c1_click_upload':
      return { xPct: 50, yPx: 128, visible: true, clicking: true };
    case 'c1_uploading':
    case 'c1_photo_verified':
      return { xPct: 96, yPx: 128, visible: true, clicking: false };
    case 'c1_move_scan':
      return { xPct: 50, yPx: 217, visible: true, clicking: false };
    case 'c1_click_scan':
      return { xPct: 50, yPx: 217, visible: true, clicking: true };
    case 'c1_scanning':
    case 'c1_scan_verified':
    case 'c1_converted':
      return { xPct: 96, yPx: 144, visible: true, clicking: false };
    case 'c1_move_download':
      return { xPct: 74, yPx: 217, visible: true, clicking: false };
    case 'c1_click_download':
      return { xPct: 74, yPx: 217, visible: true, clicking: true };
    case 'c1_downloaded_fly':
      return { xPct: 96, yPx: 196, visible: true, clicking: false };
    case 'c1_move_read':
      return { xPct: 26, yPx: 217, visible: true, clicking: false };
    case 'c1_click_read':
      return { xPct: 26, yPx: 217, visible: true, clicking: true };
    case 'c1_pdf_open':
      return { xPct: 96, yPx: 164, visible: true, clicking: false };
    case 'c1_scroll_1_ready':
      return { xPct: 78, yPx: 184, visible: true, clicking: false };
    case 'c1_pdf_scroll_1':
      return { xPct: 78, yPx: 138, visible: true, clicking: true };
    case 'c1_scroll_2_ready':
      return { xPct: 78, yPx: 184, visible: true, clicking: false };
    case 'c1_pdf_scroll_2':
      return { xPct: 78, yPx: 138, visible: true, clicking: true };
    case 'c1_move_header':
      return { xPct: 52, yPx: 34, visible: true, clicking: false };
    case 'c1_click_collapse':
      return { xPct: 52, yPx: 34, visible: true, clicking: true };
    case 'c1_collapsed':
      return { xPct: 96, yPx: 56, visible: true, clicking: false };
    case 'c1_scroll_to_c2':
      return { xPct: 96, yPx: 16, visible: true, clicking: true };

    // Card 2 coordinates
    case 'c2_intro':
      return { xPct: 96, yPx: 74, visible: true, clicking: false };
    case 'c2_move_expand':
      return { xPct: 52, yPx: 74, visible: true, clicking: false };
    case 'c2_click_expand':
      return { xPct: 52, yPx: 74, visible: true, clicking: true };
    case 'c2_canvas_ready':
      return { xPct: 96, yPx: 128, visible: true, clicking: false };
    case 'c2_move_canvas':
      return { xPct: 44, yPx: 126, visible: true, clicking: false };
    case 'c2_click_canvas':
      return { xPct: 44, yPx: 126, visible: true, clicking: true };
    case 'c2_typing':
    case 'c2_autosaved':
      return { xPct: 96, yPx: 128, visible: true, clicking: false };
    case 'c2_move_publish':
      return { xPct: 50, yPx: 217, visible: true, clicking: false };
    case 'c2_click_publish':
      return { xPct: 50, yPx: 217, visible: true, clicking: true };
    case 'c2_publishing':
    case 'c2_scanning':
    case 'c2_verified':
    case 'c2_converted':
      return { xPct: 96, yPx: 144, visible: true, clicking: false };
    case 'c2_move_download':
      return { xPct: 74, yPx: 217, visible: true, clicking: false };
    case 'c2_click_download':
      return { xPct: 74, yPx: 217, visible: true, clicking: true };
    case 'c2_downloaded_fly':
      return { xPct: 96, yPx: 196, visible: true, clicking: false };
    case 'c2_move_read':
      return { xPct: 26, yPx: 217, visible: true, clicking: false };
    case 'c2_click_read':
      return { xPct: 26, yPx: 217, visible: true, clicking: true };
    case 'c2_pdf_open':
      return { xPct: 96, yPx: 164, visible: true, clicking: false };
    case 'c2_scroll_1_ready':
      return { xPct: 78, yPx: 184, visible: true, clicking: false };
    case 'c2_pdf_scroll_1':
      return { xPct: 78, yPx: 138, visible: true, clicking: true };
    case 'c2_scroll_2_ready':
      return { xPct: 78, yPx: 184, visible: true, clicking: false };
    case 'c2_pdf_scroll_2':
      return { xPct: 78, yPx: 138, visible: true, clicking: true };
    case 'c2_move_header':
      return { xPct: 52, yPx: 34, visible: true, clicking: false };
    case 'c2_click_collapse':
      return { xPct: 52, yPx: 34, visible: true, clicking: true };
    case 'c2_collapsed':
      return { xPct: 96, yPx: 20, visible: true, clicking: false };
    case 'c2_scroll_back_c1':
      return { xPct: 96, yPx: 72, visible: true, clicking: true };
  }
}

export const ScanToPdfShowcase: React.FC = () => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<ShowcasePhase>('c1_intro');
  const [loopCount, setLoopCount] = useState(0);
  const [isTabVisible, setIsTabVisible] = useState<boolean>(
    typeof document !== 'undefined' ? document.visibilityState === 'visible' : true
  );
  const [isOnScreen, setIsOnScreen] = useState(true);

  const [typedText, setTypedText] = useState('');
  const [isFastForwarding, setIsFastForwarding] = useState(false);
  const [hitParity, setHitParity] = useState(false);

  const isActive = isTabVisible && isOnScreen;

  // Pause completely on screen off / tab switch / off-screen, and restart cleanly when returning
  useEffect(() => {
    let wasOnScreen = true;

    const syncVisibility = () => {
      const visible = document.visibilityState === 'visible';
      setIsTabVisible(visible);
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

  // Main timeline scheduler (runs only while visible)
  useEffect(() => {
    if (!isActive) {
      setPhase('c1_intro');
      setTypedText('');
      setIsFastForwarding(false);
      setHitParity(false);
      return;
    }

    setPhase('c1_intro');
    setTypedText('');
    setIsFastForwarding(false);
    setHitParity(false);

    const timeline: Array<[ShowcasePhase, number]> = [
      // Card 1 sequence
      ['c1_move_expand', 850],
      ['c1_click_expand', 1350],
      ['c1_ready', 1650],
      ['c1_move_upload', 2400],
      ['c1_click_upload', 2880],
      ['c1_uploading', 3180],
      ['c1_photo_verified', 4600],
      ['c1_move_scan', 5500],
      ['c1_click_scan', 5980],
      ['c1_scanning', 6280],
      ['c1_scan_verified', 8350],
      ['c1_converted', 9300],
      ['c1_move_download', 10200],
      ['c1_click_download', 10680],
      ['c1_downloaded_fly', 10980],
      ['c1_move_read', 12350],
      ['c1_click_read', 12830],
      ['c1_pdf_open', 13130],
      ['c1_scroll_1_ready', 14350],
      ['c1_pdf_scroll_1', 14750],
      ['c1_scroll_2_ready', 15800],
      ['c1_pdf_scroll_2', 16200],
      ['c1_move_header', 17250],
      ['c1_click_collapse', 17800],
      ['c1_collapsed', 18120],
      ['c1_scroll_to_c2', 18950],

      // Card 2 (Dark) sequence
      ['c2_intro', 19550],
      ['c2_move_expand', 20250],
      ['c2_click_expand', 20750],
      ['c2_canvas_ready', 21080],
      ['c2_move_canvas', 21800],
      ['c2_click_canvas', 22280],
      ['c2_typing', 22580],
      ['c2_autosaved', 25300],
      ['c2_move_publish', 26200],
      ['c2_click_publish', 26680],
      ['c2_publishing', 26980],
      ['c2_scanning', 28250],
      ['c2_verified', 30350],
      ['c2_converted', 31300],
      ['c2_move_download', 32200],
      ['c2_click_download', 32680],
      ['c2_downloaded_fly', 32980],
      ['c2_move_read', 34350],
      ['c2_click_read', 34830],
      ['c2_pdf_open', 35130],
      ['c2_scroll_1_ready', 36350],
      ['c2_pdf_scroll_1', 36750],
      ['c2_scroll_2_ready', 37800],
      ['c2_pdf_scroll_2', 38200],
      ['c2_move_header', 39250],
      ['c2_click_collapse', 39800],
      ['c2_collapsed', 40120],
      ['c2_scroll_back_c1', 40950],
    ];

    const timers = timeline.map(([nextPhase, delay]) =>
      window.setTimeout(() => setPhase(nextPhase), delay)
    );

    const loopTimer = window.setTimeout(() => {
      setLoopCount((n) => n + 1);
    }, 41900);

    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      window.clearTimeout(loopTimer);
    };
  }, [isActive, loopCount]);

  // Typing & keystroke tactile hit effect (only active during c2_typing while visible)
  useEffect(() => {
    if (!isActive || phase !== 'c2_typing') {
      setHitParity(false);
      setIsFastForwarding(false);
      return;
    }

    let cancelled = false;
    let timerId: number | undefined;
    let index = 0;

    const runStep = () => {
      if (cancelled || index >= TYPING_FRAMES.length) {
        setHitParity(false);
        setIsFastForwarding(false);
        return;
      }

      const frame = TYPING_FRAMES[index];
      setTypedText(frame.text);
      setIsFastForwarding(Boolean(frame.fast));
      if (frame.hit) {
        setHitParity((prev) => !prev);
      }
      index += 1;
      timerId = window.setTimeout(runStep, frame.delay);
    };

    timerId = window.setTimeout(runStep, 80);

    return () => {
      cancelled = true;
      if (timerId !== undefined) {
        window.clearTimeout(timerId);
      }
      setHitParity(false);
      setIsFastForwarding(false);
    };
  }, [isActive, phase]);

  const isCard2Phase = phase.startsWith('c2_');
  const cursor = getCursorState(phase);

  // Card 1 derived state
  const c1IntroPair =
    phase === 'c1_intro' ||
    phase === 'c1_move_expand' ||
    phase === 'c1_click_expand';
  const c1CollapsedEnd =
    phase === 'c1_collapsed' || phase === 'c1_scroll_to_c2';
  const c1BodyClosed = c1IntroPair || c1CollapsedEnd || isCard2Phase;

  const c1ShowUpload =
    phase === 'c1_ready' ||
    phase === 'c1_move_upload' ||
    phase === 'c1_click_upload';
  const c1Uploading = phase === 'c1_uploading';
  const c1PhotoVerified = phase === 'c1_photo_verified';
  const c1ShowScanBtn =
    phase === 'c1_photo_verified' ||
    phase === 'c1_move_scan' ||
    phase === 'c1_click_scan';
  const c1Scanning = phase === 'c1_scanning';
  const c1ScanVerified = phase === 'c1_scan_verified';
  const c1ShowActions =
    phase === 'c1_converted' ||
    phase === 'c1_move_download' ||
    phase === 'c1_click_download' ||
    phase === 'c1_downloaded_fly' ||
    phase === 'c1_move_read' ||
    phase === 'c1_click_read';
  const c1DownloadZoom =
    phase === 'c1_move_download' ||
    phase === 'c1_click_download' ||
    phase === 'c1_downloaded_fly';
  const c1Downloaded =
    phase === 'c1_downloaded_fly' ||
    phase === 'c1_move_read' ||
    phase === 'c1_click_read' ||
    phase === 'c1_pdf_open' ||
    phase === 'c1_scroll_1_ready' ||
    phase === 'c1_pdf_scroll_1' ||
    phase === 'c1_scroll_2_ready' ||
    phase === 'c1_pdf_scroll_2' ||
    phase === 'c1_move_header' ||
    phase === 'c1_click_collapse' ||
    c1CollapsedEnd;
  const c1PdfOpen =
    phase === 'c1_pdf_open' ||
    phase === 'c1_scroll_1_ready' ||
    phase === 'c1_pdf_scroll_1' ||
    phase === 'c1_scroll_2_ready' ||
    phase === 'c1_pdf_scroll_2' ||
    phase === 'c1_move_header' ||
    phase === 'c1_click_collapse';
  const c1ScrollStep =
    phase === 'c1_pdf_scroll_1' || phase === 'c1_scroll_2_ready'
      ? 1
      : phase === 'c1_pdf_scroll_2' ||
        phase === 'c1_move_header' ||
        phase === 'c1_click_collapse'
      ? 2
      : 0;
  const c1DocConverted = c1ShowActions || c1PdfOpen;
  const c1PhotoEntered =
    !isCard2Phase && !c1IntroPair && !c1ShowUpload && !c1CollapsedEnd;

  // Card 2 derived state
  const c2IntroOnly =
    phase === 'c2_intro' ||
    phase === 'c2_move_expand' ||
    phase === 'c2_click_expand';
  const c2CollapsedEnd =
    phase === 'c2_collapsed' || phase === 'c2_scroll_back_c1';
  const c2BodyClosed = !isCard2Phase || c2IntroOnly || c2CollapsedEnd;

  const c2ShowCanvasWait =
    phase === 'c2_canvas_ready' ||
    phase === 'c2_move_canvas' ||
    phase === 'c2_click_canvas';
  const c2CanvasActive =
    c2ShowCanvasWait ||
    phase === 'c2_typing' ||
    phase === 'c2_autosaved' ||
    phase === 'c2_move_publish' ||
    phase === 'c2_click_publish';
  const c2ShowCaret =
    phase === 'c2_typing' ||
    phase === 'c2_autosaved' ||
    phase === 'c2_move_publish' ||
    phase === 'c2_click_publish';
  const c2ShowPublishBtn = c2CanvasActive;
  const c2CanPublish =
    phase === 'c2_autosaved' ||
    phase === 'c2_move_publish' ||
    phase === 'c2_click_publish';
  const c2Publishing = phase === 'c2_publishing';
  const c2Scanning = phase === 'c2_scanning';
  const c2Verified = phase === 'c2_verified';
  const c2ShowActions =
    phase === 'c2_converted' ||
    phase === 'c2_move_download' ||
    phase === 'c2_click_download' ||
    phase === 'c2_downloaded_fly' ||
    phase === 'c2_move_read' ||
    phase === 'c2_click_read';
  const c2DownloadZoom =
    phase === 'c2_move_download' ||
    phase === 'c2_click_download' ||
    phase === 'c2_downloaded_fly';
  const c2Downloaded =
    phase === 'c2_downloaded_fly' ||
    phase === 'c2_move_read' ||
    phase === 'c2_click_read' ||
    phase === 'c2_pdf_open' ||
    phase === 'c2_scroll_1_ready' ||
    phase === 'c2_pdf_scroll_1' ||
    phase === 'c2_scroll_2_ready' ||
    phase === 'c2_pdf_scroll_2' ||
    phase === 'c2_move_header' ||
    phase === 'c2_click_collapse' ||
    c2CollapsedEnd;
  const c2PdfOpen =
    phase === 'c2_pdf_open' ||
    phase === 'c2_scroll_1_ready' ||
    phase === 'c2_pdf_scroll_1' ||
    phase === 'c2_scroll_2_ready' ||
    phase === 'c2_pdf_scroll_2' ||
    phase === 'c2_move_header' ||
    phase === 'c2_click_collapse';
  const c2ScrollStep =
    phase === 'c2_pdf_scroll_1' || phase === 'c2_scroll_2_ready'
      ? 1
      : phase === 'c2_pdf_scroll_2' ||
        phase === 'c2_move_header' ||
        phase === 'c2_click_collapse'
      ? 2
      : 0;
  const c2DocConverted = c2ShowActions || c2PdfOpen;

  // Card 1 & Card 2 vertical positioning inside fixed h-[268px] tilted stack
  const card1TransformClass = isCard2Phase
    ? phase === 'c2_scroll_back_c1'
      ? 'translate-y-[44px] opacity-100 scale-100'
      : c2IntroOnly
      ? '-translate-y-[92px] opacity-55 scale-[0.94]'
      : '-translate-y-[116px] opacity-20 scale-[0.92]'
    : c1IntroPair
    ? phase === 'c1_click_expand'
      ? 'translate-y-[44px] opacity-100 scale-[0.985]'
      : 'translate-y-[44px] opacity-100 scale-100'
    : phase === 'c1_scroll_to_c2'
    ? '-translate-y-[92px] opacity-55 scale-[0.94]'
    : 'translate-y-0 opacity-100 scale-100';

  const card2TransformClass = isCard2Phase
    ? c2IntroOnly
      ? phase === 'c2_click_expand'
        ? 'translate-y-[36px] opacity-100 scale-[0.985]'
        : 'translate-y-[36px] opacity-100 scale-100'
      : phase === 'c2_scroll_back_c1'
      ? 'translate-y-[130px] opacity-100 scale-100'
      : c2CollapsedEnd
      ? 'translate-y-0 opacity-100 scale-100'
      : hitParity
      ? 'translate-y-[1px] opacity-100 scale-[0.996]'
      : 'translate-y-0 opacity-100 scale-100'
    : c1IntroPair
    ? 'translate-y-[130px] opacity-100 scale-100'
    : phase === 'c1_scroll_to_c2'
    ? 'translate-y-[36px] opacity-100 scale-100'
    : phase === 'c1_collapsed'
    ? 'translate-y-[150px] opacity-25 scale-[0.95]'
    : 'translate-y-[268px] opacity-20 scale-[0.95]';

  // Titles & subtitles
  const c1Title =
    c1IntroPair || c1ShowUpload || c1CollapsedEnd || isCard2Phase
      ? 'Photo Upload → Scan-to-PDF'
      : c1Uploading
      ? 'Uploading Photo...'
      : c1ShowScanBtn
      ? 'Photo Verified'
      : c1Scanning
      ? 'Scanning Sheet...'
      : c1ScanVerified
      ? 'Scan Verified'
      : phase === 'c1_downloaded_fly'
      ? 'Downloaded'
      : c1PdfOpen
      ? 'CSC 201 · Digital PDF'
      : 'Converted to Document';

  const c1Subtitle =
    c1IntroPair || c1ShowUpload || c1CollapsedEnd || isCard2Phase
      ? 'Auto-normalized high-contrast digital exam sheets'
      : c1Uploading
      ? 'CSC201_Capture.png · Checking clarity'
      : c1ShowScanBtn
      ? 'Tap Scan to convert photo to PDF'
      : c1Scanning
      ? 'Zooming & detecting text lines'
      : c1ScanVerified
      ? 'High-contrast edges locked'
      : phase === 'c1_downloaded_fly'
      ? 'Saved CSC201_2024.pdf to device'
      : c1ScrollStep > 0
      ? `Scrolling questions (${c1ScrollStep}/2)...`
      : c1PdfOpen
      ? 'Full past question opened'
      : 'Ready to Read or Download';

  const c2Title =
    !isCard2Phase || c2IntroOnly || c2ShowCanvasWait || c2CollapsedEnd
      ? 'Typed Doc → Indexed Questions'
      : phase === 'c2_typing'
      ? 'Typing Past Question...'
      : c2CanPublish
      ? 'Auto-saved'
      : c2Publishing
      ? 'Publishing Document...'
      : c2Scanning
      ? 'Scanning for Errors...'
      : c2Verified
      ? 'Verified · Zero Errors'
      : phase === 'c2_downloaded_fly'
      ? 'Downloaded'
      : c2PdfOpen
      ? 'CSC 201 · Indexed PDF'
      : 'Converted to PDF';

  const c2Subtitle =
    !isCard2Phase || c2IntroOnly || c2ShowCanvasWait || c2CollapsedEnd
      ? 'Search every question line by session & semester'
      : phase === 'c2_typing'
      ? isFastForwarding
        ? 'Fast-forwarding document...'
        : 'Live editor · Keystrokes synced'
      : c2CanPublish
      ? 'Draft saved · Ready to publish'
      : c2Publishing
      ? 'Preparing document package...'
      : c2Scanning
      ? 'Checking typos & course info'
      : c2Verified
      ? 'Ready as verified digital PDF'
      : phase === 'c2_downloaded_fly'
      ? 'Saved CSC201_Typed.pdf to device'
      : c2ScrollStep > 0
      ? `Scrolling questions (${c2ScrollStep}/2)...`
      : c2PdfOpen
      ? 'Full past question opened'
      : 'Ready to Read or Download';

  const anyDownloadTrayActive =
    phase === 'c1_downloaded_fly' || phase === 'c2_downloaded_fly';
  const anyDownloaded = c1Downloaded || c2Downloaded;

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className="pointer-events-none select-none relative w-full h-full overflow-hidden flex items-center justify-center"
    >
      {/* Chrome-style Top-Right Download Tray Target */}
      <div
        className={`absolute top-14 right-5 z-20 h-9 w-9 rounded-full flex items-center justify-center border transition-all duration-300 ${
          anyDownloadTrayActive
            ? 'bg-[#1D1E23] text-white border-[#1D1E23] scale-110 shadow-lg'
            : anyDownloaded
            ? 'bg-white/95 text-[#1D1E23] border-[#1A1B20]/15 shadow-sm scale-100'
            : 'opacity-0 scale-75'
        }`}
      >
        <ArrowDownToLine className="w-4 h-4" />
      </div>

      {/* Subtly Tilted Diagonal Container (unified stage origin for both cards & pointer) */}
      <div className="relative w-full max-w-[335px] sm:max-w-[375px] h-[268px] px-4 -mt-2 md:-mt-2 lg:mt-0 -rotate-[4.5deg] md:scale-[0.96] lg:scale-[0.95] xl:scale-100">
        {/* Solid Black High-Contrast Mouse Pointer across both Card 1 and Card 2 */}
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

        {/* CARD 1 (White): Photo Upload -> Scan-to-PDF */}
        <div
          className={`absolute left-4 right-4 top-0 rounded-[28px] bg-white p-4 border border-[#1A1B20]/[0.08] shadow-[0_14px_32px_-12px_rgba(20,21,26,0.14)] transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            isCard2Phase ? 'z-10' : 'z-20'
          } ${card1TransformClass}`}
        >
          <div
            className={`flex items-center justify-between gap-2.5 transition-transform duration-150 ${
              phase === 'c1_click_collapse' ? 'scale-[0.985]' : 'scale-100'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 transition-colors duration-300 ${
                  c1PhotoVerified || c1ScanVerified
                    ? 'bg-[#16A34A] text-white'
                    : c1DocConverted
                    ? 'bg-[#1D1E23] text-white'
                    : 'bg-[#EFF1F5] text-[#1D1E23]'
                }`}
              >
                {c1IntroPair || c1ShowUpload || c1CollapsedEnd || isCard2Phase ? (
                  <ScanLine className="w-5 h-5" />
                ) : c1Uploading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : c1PhotoVerified || c1ScanVerified ? (
                  <Check className="w-5 h-5" />
                ) : c1Scanning ? (
                  <ScanLine className="w-5 h-5" />
                ) : c1DocConverted ? (
                  <FileText className="w-5 h-5" />
                ) : (
                  <ImageIcon className="w-5 h-5" />
                )}
              </div>

              <div className="min-w-0">
                <p className="font-display text-sm font-bold text-[#1A1B20] truncate">
                  {c1Title}
                </p>
                <p className="text-xs text-[#686C78] truncate">{c1Subtitle}</p>
              </div>
            </div>

            {c1PdfOpen && (
              <span
                className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 transition-colors duration-150 ${
                  phase === 'c1_move_header' || phase === 'c1_click_collapse'
                    ? 'bg-[#1D1E23] text-white'
                    : 'bg-[#F2F4F7] text-[#686C78]'
                }`}
              >
                <ChevronUp className="w-4 h-4" />
              </span>
            )}
          </div>

          <div
            className={`grid transition-[grid-template-rows,opacity,margin] duration-[600ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
              c1BodyClosed
                ? 'grid-rows-[0fr] opacity-0 mt-0'
                : 'grid-rows-[1fr] opacity-100 mt-3.5'
            }`}
          >
            <div className="overflow-hidden min-h-0">
              <div
                className={`relative rounded-2xl bg-[#F4F5F8] overflow-hidden flex items-center justify-center border border-[#1A1B20]/[0.05] transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                  c1PdfOpen
                    ? 'h-[168px] p-3 items-start justify-start bg-white'
                    : 'h-[116px]'
                }`}
              >
                {c1ShowUpload ? (
                  <div
                    className={`h-[40px] px-4 rounded-xl tactile-dark text-white text-xs font-semibold inline-flex items-center gap-2 transition-transform duration-150 ${
                      phase === 'c1_click_upload' ? 'scale-95' : 'scale-100'
                    }`}
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload Photo</span>
                  </div>
                ) : !c1PdfOpen ? (
                  <div
                    className={`relative w-44 sm:w-48 h-20 rounded-xl bg-white border border-[#1A1B20]/10 shadow-sm p-3 flex flex-col justify-between transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                      c1Uploading
                        ? 'animate-slide-in-photo'
                        : c1Scanning
                        ? 'scale-[1.16] rotate-0'
                        : 'scale-100 rotate-0'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`h-2.5 w-2.5 rounded-sm transition-colors duration-300 ${
                            c1DocConverted ? 'bg-[#1D1E23]' : 'bg-[#C5C9D6]'
                          }`}
                        />
                        <span className="h-2 w-16 rounded-full bg-[#1D1E23]/80" />
                      </div>
                      <span className="font-mono-tabular text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#1D1E23] text-white">
                        {c1DocConverted ? 'PDF' : 'PNG'}
                      </span>
                    </div>

                    {!c1DocConverted ? (
                      <div className="flex items-end justify-between gap-2 pt-1">
                        <div className="space-y-1.5 flex-1">
                          <div className="h-1.5 w-full rounded-full bg-[#D2D6E0]" />
                          <div className="h-1.5 w-3/4 rounded-full bg-[#E0E3EB]" />
                        </div>
                        <div className="h-7 w-9 rounded-md bg-[#EFF1F5] border border-[#1A1B20]/[0.06] flex items-center justify-center text-[#686C78] shrink-0">
                          <ImageIcon className="w-3.5 h-3.5" />
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="h-1.5 w-full rounded-full bg-[#1D1E23]/80" />
                        <div className="h-1.5 w-11/12 rounded-full bg-[#1D1E23]/55" />
                        <div className="h-1.5 w-4/5 rounded-full bg-[#1D1E23]/35" />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="w-full h-full flex flex-col text-left page-enter overflow-hidden">
                    <div className="flex items-center justify-between border-b border-[#1A1B20]/10 pb-2 shrink-0 bg-white z-10">
                      <div>
                        <p className="font-display text-xs font-extrabold text-[#1A1B20]">
                          AAUA · CSC 201 (2023/2024)
                        </p>
                        <p className="text-[10px] text-[#686C78]">
                          First Semester Examination
                        </p>
                      </div>
                      <span className="font-mono-tabular text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#1D1E23] text-white">
                        PDF OPEN
                      </span>
                    </div>

                    <div className="relative flex-1 overflow-hidden pt-1.5">
                      <div
                        className={`space-y-2 text-[11px] leading-snug text-[#2E313B] transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform ${
                          c1ScrollStep === 1
                            ? '-translate-y-[54px]'
                            : c1ScrollStep === 2
                            ? '-translate-y-[116px]'
                            : 'translate-y-0'
                        }`}
                      >
                        <p>
                          <strong className="text-[#1A1B20]">Q1:</strong> Distinguish procedural vs object-oriented programming with examples.
                        </p>
                        <p>
                          <strong className="text-[#1A1B20]">Q2:</strong> Explain Encapsulation, Inheritance, and Polymorphism.
                        </p>
                        <p>
                          <strong className="text-[#1A1B20]">Q3:</strong> Trace recursive fibonacci(5) stack frames step by step.
                        </p>
                        <p>
                          <strong className="text-[#1A1B20]">Q4:</strong> Write a class hierarchy for Student & Lecturer records.
                        </p>
                        <p>
                          <strong className="text-[#1A1B20]">Q5:</strong> Compare abstract classes vs interfaces in Java.
                        </p>
                        <p className="text-[#686C78]">
                          <strong className="text-[#1A1B20]">Q6:</strong> Design an exception handler for invalid matric numbers.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {c1PhotoEntered && c1Uploading && (
                  <div className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-semibold text-[#1A1B20] shadow-xs flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Loading...</span>
                  </div>
                )}

                <div
                  className={`pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${
                    c1Scanning ? 'opacity-100' : 'opacity-0'
                  }`}
                >
                  <div className="absolute inset-x-10 top-2 h-0.5 bg-[#1D1E23] shadow-[0_0_12px_2px_rgba(29,30,35,0.45)] animate-scan-sweep rounded-full" />
                  <div className="h-10 w-10 rounded-full bg-[#1D1E23]/90 text-white flex items-center justify-center shadow-lg">
                    <ScanLine className="w-5 h-5" />
                  </div>
                </div>

                <div
                  className={`pointer-events-none absolute inset-0 bg-white/35 backdrop-blur-[1px] flex items-center justify-center transition-all duration-300 ${
                    c1PhotoVerified || c1ScanVerified
                      ? 'opacity-100 scale-100'
                      : 'opacity-0 scale-75'
                  }`}
                >
                  <div className="h-10 w-10 rounded-full bg-[#16A34A] text-white flex items-center justify-center shadow-lg">
                    <Check className="w-5 h-5 stroke-[2.5]" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {!isCard2Phase && c1ShowScanBtn && (
            <div className="mt-3 animate-[pageEnter_240ms_ease-out_both]">
              <div
                className={`h-[38px] w-full rounded-xl tactile-dark text-white px-3 flex items-center justify-center gap-2 text-xs font-semibold transition-transform duration-150 ${
                  phase === 'c1_click_scan' ? 'scale-95' : 'scale-100'
                }`}
              >
                <ScanLine className="w-3.5 h-3.5" />
                <span>Scan to PDF</span>
              </div>
            </div>
          )}

          {!isCard2Phase && c1ShowActions && (
            <div
              className={`mt-3 grid grid-cols-2 gap-2.5 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] origin-bottom animate-[pageEnter_260ms_ease-out_both] ${
                c1DownloadZoom
                  ? 'scale-[1.04]'
                  : phase === 'c1_click_read' || phase === 'c1_move_read'
                  ? 'scale-[1.02]'
                  : 'scale-100'
              }`}
            >
              <div
                className={`h-[38px] rounded-xl px-3 flex items-center justify-center gap-1.5 text-xs font-semibold transition-transform duration-150 ${
                  phase === 'c1_click_read'
                    ? 'tactile-dark text-white scale-95 ring-2 ring-[#1D1E23]/30'
                    : 'tactile-dark text-white'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>Read</span>
              </div>

              <div
                className={`relative h-[38px] rounded-xl px-3 flex items-center justify-center gap-1.5 text-xs font-semibold border transition-all duration-150 ${
                  phase === 'c1_downloaded_fly'
                    ? 'bg-[#DCFCE7] border-[#86EFAC] text-[#15803D] scale-95'
                    : phase === 'c1_click_download'
                    ? 'bg-[#1D1E23] border-[#1D1E23] text-white scale-95'
                    : 'tactile-light border-[#1A1B20]/10 text-[#1A1B20]'
                }`}
              >
                {c1Downloaded ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Downloaded</span>
                  </>
                ) : (
                  <>
                    <ArrowDownToLine className="w-3.5 h-3.5" />
                    <span>Download</span>
                  </>
                )}

                {phase === 'c1_downloaded_fly' && (
                  <div className="pointer-events-none absolute -top-2 right-2 z-30 rounded-lg bg-[#1D1E23] text-white px-2 py-1 text-[10px] font-mono-tabular font-bold shadow-lg flex items-center gap-1 animate-fly-download">
                    <FileText className="w-3 h-3" />
                    <span>PDF</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* CARD 2 (Dark): Typed Doc -> Indexed Questions */}
        <div
          className={`absolute left-4 right-4 top-0 rounded-[28px] bg-[#1D1E23] text-white p-4 border border-white/[0.08] shadow-[0_18px_36px_-12px_rgba(20,21,26,0.45)] transition-all ${
            phase === 'c2_typing'
              ? 'duration-75 ease-out'
              : 'duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]'
          } ${isCard2Phase ? 'z-20' : 'z-10'} ${card2TransformClass}`}
        >
          {/* Card 2 Header */}
          <div
            className={`flex items-center justify-between gap-2.5 transition-transform duration-150 ${
              phase === 'c2_click_collapse' ? 'scale-[0.985]' : 'scale-100'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 transition-colors duration-300 ${
                  c2Verified
                    ? 'bg-[#16A34A] text-white'
                    : c2DocConverted
                    ? 'bg-white text-[#1D1E23]'
                    : 'bg-[#2A2C34] text-white'
                }`}
              >
                {c2Publishing ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : c2Verified ? (
                  <Check className="w-5 h-5" />
                ) : c2Scanning ? (
                  <ScanLine className="w-5 h-5" />
                ) : (
                  <FileText className="w-5 h-5" />
                )}
              </div>

              <div className="min-w-0">
                <p className="font-display text-sm font-bold text-white truncate flex items-center gap-1.5">
                  <span className="truncate">{c2Title}</span>
                  {c2CanPublish && (
                    <Check className="w-3.5 h-3.5 text-[#4ADE80] shrink-0" />
                  )}
                </p>
                <p className="text-xs text-[#A5AAB8] truncate">{c2Subtitle}</p>
              </div>
            </div>

            {c2PdfOpen && (
              <span
                className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 transition-colors duration-150 ${
                  phase === 'c2_move_header' || phase === 'c2_click_collapse'
                    ? 'bg-white text-[#1D1E23]'
                    : 'bg-[#2A2C34] text-[#A5AAB8]'
                }`}
              >
                <ChevronUp className="w-4 h-4" />
              </span>
            )}
          </div>

          {/* Card 2 Expandable Body */}
          <div
            className={`grid transition-[grid-template-rows,opacity,margin] duration-[600ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
              c2BodyClosed
                ? 'grid-rows-[0fr] opacity-0 mt-0'
                : 'grid-rows-[1fr] opacity-100 mt-3.5'
            }`}
          >
            <div className="overflow-hidden min-h-0">
              <div
                className={`relative rounded-2xl bg-[#141519] overflow-hidden border border-white/[0.08] transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                  c2PdfOpen
                    ? 'h-[168px] p-3 flex flex-col items-start justify-start'
                    : c2CanvasActive
                    ? 'h-[116px] p-3 flex flex-col justify-between'
                    : 'h-[116px] flex items-center justify-center'
                }`}
              >
                {/* Mode A: Dark Typing Canvas */}
                {c2CanvasActive ? (
                  <div
                    className={`w-full h-full flex flex-col justify-between text-left transition-transform duration-150 ${
                      phase === 'c2_click_canvas' ? 'scale-[0.985]' : 'scale-100'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] text-[#8E93A4]">
                      <span className="font-mono-tabular font-semibold text-white/80">
                        {c2ShowCaret
                          ? isFastForwarding
                            ? 'Fast-forwarding...'
                            : 'AAUA_CSC201.doc'
                          : 'Click text area to type'}
                      </span>
                      <span className="font-mono-tabular text-[9px] font-bold px-1.5 py-0.5 rounded bg-white/10 text-white">
                        {c2CanPublish ? 'SAVED' : 'DOC'}
                      </span>
                    </div>

                    <div className="flex-1 pt-2 font-sans text-[11px] leading-relaxed text-[#E7E9F0] whitespace-pre-line overflow-hidden">
                      {!c2ShowCaret ? (
                        <span className="text-[#6F7485]">
                          Tap here to type past questions...
                        </span>
                      ) : (
                        <>
                          <span>{typedText}</span>
                          <span className="inline-block align-middle w-[1.5px] h-3.5 bg-white ml-0.5 animate-caret-blink" />
                        </>
                      )}
                    </div>
                  </div>
                ) : !c2PdfOpen ? (
                  /* Mode B: Dark Document Card converting to Dark PDF */
                  <div
                    className={`relative w-44 sm:w-48 h-20 rounded-xl bg-[#22242B] border border-white/10 shadow-sm p-3 flex flex-col justify-between transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                      c2Scanning ? 'scale-[1.14]' : 'scale-100'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-sm bg-white" />
                        <span className="h-2 w-16 rounded-full bg-white/80" />
                      </div>
                      <span className="font-mono-tabular text-[9px] font-bold px-1.5 py-0.5 rounded bg-white text-[#1D1E23]">
                        {c2DocConverted ? 'PDF' : 'DOC'}
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      <div className="h-1.5 w-full rounded-full bg-white/75" />
                      <div className="h-1.5 w-11/12 rounded-full bg-white/50" />
                      <div className="h-1.5 w-4/5 rounded-full bg-white/30" />
                    </div>
                  </div>
                ) : (
                  /* Mode C: Dark Mode Opened PDF with 2x Question Scroll */
                  <div className="w-full h-full flex flex-col text-left page-enter overflow-hidden">
                    <div className="flex items-center justify-between border-b border-white/10 pb-2 shrink-0 bg-[#141519] z-10 w-full">
                      <div>
                        <p className="font-display text-xs font-extrabold text-white">
                          AAUA · CSC 201 (2023/2024)
                        </p>
                        <p className="text-[10px] text-[#9A9FAD]">
                          Indexed Digital Past Question
                        </p>
                      </div>
                      <span className="font-mono-tabular text-[9px] font-bold px-1.5 py-0.5 rounded bg-white text-[#1D1E23]">
                        PDF OPEN
                      </span>
                    </div>

                    <div className="relative flex-1 overflow-hidden pt-1.5 w-full">
                      <div
                        className={`space-y-2 text-[11px] leading-snug text-[#D6D9E2] transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform ${
                          c2ScrollStep === 1
                            ? '-translate-y-[54px]'
                            : c2ScrollStep === 2
                            ? '-translate-y-[116px]'
                            : 'translate-y-0'
                        }`}
                      >
                        <p>
                          <strong className="text-white">Q1:</strong> Distinguish procedural vs OOP programming with examples.
                        </p>
                        <p>
                          <strong className="text-white">Q2:</strong> Explain Encapsulation &amp; Polymorphism.
                        </p>
                        <p>
                          <strong className="text-white">Q3:</strong> Trace recursive fibonacci(5) stack frames step by step.
                        </p>
                        <p>
                          <strong className="text-white">Q4:</strong> Write a class hierarchy for Student &amp; Lecturer records.
                        </p>
                        <p>
                          <strong className="text-white">Q5:</strong> Compare abstract classes vs interfaces in Java.
                        </p>
                        <p className="text-[#9A9FAD]">
                          <strong className="text-white">Q6:</strong> Design an exception handler for invalid matric numbers.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Publishing spinner badge inside dark preview */}
                {c2Publishing && (
                  <div className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-[#2A2C34] border border-white/10 px-2.5 py-1 text-[10px] font-semibold text-white shadow-xs flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Publishing...</span>
                  </div>
                )}

                {/* Dark Mode Scan Bar + Icon (for error/info check) */}
                <div
                  className={`pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${
                    c2Scanning ? 'opacity-100' : 'opacity-0'
                  }`}
                >
                  <div className="absolute inset-x-10 top-2 h-0.5 bg-white shadow-[0_0_12px_2px_rgba(255,255,255,0.45)] animate-scan-sweep rounded-full" />
                  <div className="h-10 w-10 rounded-full bg-white text-[#1D1E23] flex items-center justify-center shadow-lg">
                    <ScanLine className="w-5 h-5" />
                  </div>
                </div>

                {/* Dark Mode Verify Overlay */}
                <div
                  className={`pointer-events-none absolute inset-0 bg-[#141519]/55 backdrop-blur-[1px] flex items-center justify-center transition-all duration-300 ${
                    c2Verified
                      ? 'opacity-100 scale-100'
                      : 'opacity-0 scale-75'
                  }`}
                >
                  <div className="h-10 w-10 rounded-full bg-[#16A34A] text-white flex items-center justify-center shadow-lg">
                    <Check className="w-5 h-5 stroke-[2.5]" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Card 2 Publish Button */}
          {isCard2Phase && c2ShowPublishBtn && (
            <div className="mt-3 animate-[pageEnter_240ms_ease-out_both]">
              <div
                className={`h-[38px] w-full rounded-xl px-3 flex items-center justify-center gap-2 text-xs font-semibold transition-all duration-150 ${
                  c2CanPublish
                    ? phase === 'c2_click_publish'
                      ? 'bg-white text-[#1D1E23] scale-95 shadow-md'
                      : 'bg-white text-[#1D1E23] shadow-md'
                    : 'bg-[#2A2C34] text-[#7D8292] border border-white/[0.06]'
                }`}
              >
                <Send className="w-3.5 h-3.5" />
                <span>Publish</span>
              </div>
            </div>
          )}

          {/* Card 2 Dark Mode Read & Download Action Bar */}
          {isCard2Phase && c2ShowActions && (
            <div
              className={`mt-3 grid grid-cols-2 gap-2.5 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] origin-bottom animate-[pageEnter_260ms_ease-out_both] ${
                c2DownloadZoom
                  ? 'scale-[1.04]'
                  : phase === 'c2_click_read' || phase === 'c2_move_read'
                  ? 'scale-[1.02]'
                  : 'scale-100'
              }`}
            >
              <div
                className={`h-[38px] rounded-xl px-3 flex items-center justify-center gap-1.5 text-xs font-semibold transition-transform duration-150 ${
                  phase === 'c2_click_read'
                    ? 'bg-white text-[#1D1E23] scale-95 ring-2 ring-white/30'
                    : 'bg-white text-[#1D1E23]'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>Read</span>
              </div>

              <div
                className={`relative h-[38px] rounded-xl px-3 flex items-center justify-center gap-1.5 text-xs font-semibold border transition-all duration-150 ${
                  phase === 'c2_downloaded_fly'
                    ? 'bg-[#16A34A] border-[#22C55E] text-white scale-95'
                    : phase === 'c2_click_download'
                    ? 'bg-white border-white text-[#1D1E23] scale-95'
                    : 'bg-[#2A2C34] border-white/15 text-white'
                }`}
              >
                {c2Downloaded ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Downloaded</span>
                  </>
                ) : (
                  <>
                    <ArrowDownToLine className="w-3.5 h-3.5" />
                    <span>Download</span>
                  </>
                )}

                {phase === 'c2_downloaded_fly' && (
                  <div className="pointer-events-none absolute -top-2 right-2 z-30 rounded-lg bg-white text-[#1D1E23] px-2 py-1 text-[10px] font-mono-tabular font-bold shadow-lg flex items-center gap-1 animate-fly-download">
                    <FileText className="w-3 h-3" />
                    <span>PDF</span>
                  </div>
                )}
              </div>
            </div>
          )}
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
