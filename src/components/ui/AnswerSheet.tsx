import { useBackHandler } from '../../core/navGuard';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { QuestionSolution } from '../../core/types';

/**
 * Answer + explanation for a question: a bottom sheet on mobile/tablet and a
 * centred dialog box on desktop (see AnswerDialog below).
 *
 * Mobile sheet:
 *
 * Built for speed: all movement is a single `translate3d` on one element,
 * written straight to the DOM while dragging (no React re-renders), and the
 * snap uses a CSS transition. Backdrop opacity follows the sheet.
 *
 * Snap points: ~half screen (question + answer + a peek of the explanation),
 * full (just under the app header) and closed (drops off screen).
 * Content scrolls inside at any height. Dragging the handle moves the sheet;
 * dragging the content moves the sheet only when it should (up while not
 * full, down while scrolled to the top), otherwise the content scrolls.
 */

interface AnswerSheetProps {
  open: boolean;
  number: number;
  question: string;
  solution: QuestionSolution | null;
  onClose: () => void;
  /** Called once the close animation has finished; parent can unmount. */
  onExited: () => void;
}

const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
const HALF_RATIO = 0.5;
const MIN_VISIBLE = 300;
const DRAG_SLOP = 6;

type DragMode = 'idle' | 'pending' | 'sheet' | 'scroll';

const MobileAnswerSheet: React.FC<AnswerSheetProps> = ({
  open,
  number,
  question,
  solution,
  onClose,
  onExited,
}) => {
  const sheetRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const geo = useRef({ full: 0, half: 0 });
  const yRef = useRef(0);
  const firstRef = useRef(true);
  const reduceMotion = useRef(false);
  const returnFocusTo = useRef<HTMLElement | null>(null);

  const drag = useRef({
    mode: 'idle' as DragMode,
    fromHandle: false,
    startY: 0,
    anchorY: 0,
    originY: 0,
    lastY: 0,
    lastT: 0,
    v: 0,
  });

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;

  const dur = () => (reduceMotion.current ? 0 : 340);

  const measure = () => {
    const el = sheetRef.current;
    if (!el) return;
    const full = el.offsetHeight;
    const visible = Math.min(
      full,
      Math.max(MIN_VISIBLE, Math.round(window.innerHeight * HALF_RATIO))
    );
    geo.current = { full, half: full - visible };
  };

  const applyY = (y: number, animate: boolean) => {
    const el = sheetRef.current;
    if (!el) return;
    const t = animate && dur() > 0 ? `${dur()}ms ${EASE}` : 'none';
    el.style.transition = t === 'none' ? 'none' : `transform ${t}`;
    el.style.transform = `translate3d(0, ${y}px, 0)`;
    yRef.current = y;

    const b = backdropRef.current;
    if (b) {
      const { full, half } = geo.current;
      const span = Math.max(1, full - half);
      const o = y <= half ? 1 : Math.max(0, 1 - (y - half) / span);
      b.style.transition = t === 'none' ? 'none' : `opacity ${t}`;
      b.style.opacity = String(o);
    }
  };

  // Lets the content scroll far enough to reveal its end even though the
  // lower part of the sheet is off screen at the half snap.
  const applyPad = (y: number) => {
    const s = scrollRef.current;
    if (s) {
      s.style.paddingBottom = `calc(${Math.round(y)}px + env(safe-area-inset-bottom, 0px) + 28px)`;
    }
  };

  const snapTo = (y: number, animate = true) => {
    applyY(y, animate);
    applyPad(y >= geo.current.full ? geo.current.half : y);
  };

  // ---- open / close animation -------------------------------------------
  useLayoutEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    reduceMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    measure();

    if (firstRef.current) {
      firstRef.current = false;
      applyY(geo.current.full, false);
      el.getBoundingClientRect(); // commit the off-screen start position
    }

    if (open) {
      returnFocusTo.current ??= document.activeElement as HTMLElement | null;
      const raf = requestAnimationFrame(() => {
        snapTo(geo.current.half, true);
        sheetRef.current?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(raf);
    }

    snapTo(geo.current.full, true);
    const timer = window.setTimeout(() => {
      returnFocusTo.current?.focus?.({ preventScroll: true });
      returnFocusTo.current = null;
      onExitedRef.current();
    }, dur() + 40);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ---- page lock + inert background + Esc + resize ----------------------
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPad: body.style.paddingRight,
    };
    const scrollbar = window.innerWidth - html.clientWidth;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;

    const root = document.getElementById('root');
    root?.setAttribute('inert', '');

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    const onResize = () => {
      measure();
      snapTo(geo.current.half, false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);

    return () => {
      html.style.overflow = prev.htmlOverflow;
      body.style.overflow = prev.bodyOverflow;
      body.style.paddingRight = prev.bodyPad;
      root?.removeAttribute('inert');
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- drag engine -------------------------------------------------------
  const currentTranslateY = () => {
    const el = sheetRef.current;
    if (!el) return yRef.current;
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return Number.isFinite(m.m42) ? m.m42 : yRef.current;
  };

  const beginDrag = (clientY: number, t: number, fromHandle: boolean) => {
    const d = drag.current;
    // Catch the sheet mid-animation so it never jumps.
    const live = currentTranslateY();
    if (Math.abs(live - yRef.current) > 0.5) applyY(live, false);
    d.mode = 'pending';
    d.fromHandle = fromHandle;
    d.startY = clientY;
    d.anchorY = clientY;
    d.originY = yRef.current;
    d.lastY = clientY;
    d.lastT = t;
    d.v = 0;
  };

  // Returns true when the sheet is being dragged (caller prevents default).
  const moveDrag = (clientY: number, t: number): boolean => {
    const d = drag.current;
    if (d.mode === 'idle') return false;

    const step = clientY - d.lastY;
    const dt = Math.max(1, t - d.lastT);
    d.v = 0.7 * d.v + 0.3 * (step / dt);
    d.lastY = clientY;
    d.lastT = t;

    const scroller = scrollRef.current;
    const atTop = !scroller || scroller.scrollTop <= 0;

    if (d.mode === 'pending') {
      const dy = clientY - d.startY;
      if (Math.abs(dy) < DRAG_SLOP) return false;
      const dragSheet =
        d.fromHandle || (dy < 0 && yRef.current > 0.5) || (dy > 0 && atTop);
      d.mode = dragSheet ? 'sheet' : 'scroll';
      d.anchorY = clientY;
      d.originY = yRef.current;
    } else if (d.mode === 'scroll' && atTop && step > 0) {
      // Scrolled back to the very top and still pulling down: hand over to the sheet.
      d.mode = 'sheet';
      d.anchorY = clientY;
      d.originY = yRef.current;
    }

    if (d.mode !== 'sheet') return false;

    const { full } = geo.current;
    let y = d.originY + (clientY - d.anchorY);
    if (y < 0) y *= 0.25; // resist pulling past the top
    if (y > full) y = full;
    applyY(y, false);
    return true;
  };

  const endDrag = (t: number) => {
    const d = drag.current;
    const wasSheet = d.mode === 'sheet';
    d.mode = 'idle';
    if (!wasSheet) return;

    const { full, half } = geo.current;
    const v = t - d.lastT > 90 ? 0 : d.v; // released after pausing: no fling
    const projected = yRef.current + v * 180;
    const targets = [0, half, full];
    let best = targets[0];
    for (const c of targets) {
      if (Math.abs(projected - c) < Math.abs(projected - best)) best = c;
    }

    if (best >= full) {
      snapTo(full, true);
      onCloseRef.current();
    } else {
      snapTo(best, true);
    }
  };

  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const target = e.target as Node;
      const fromHandle = !scrollRef.current?.contains(target);
      beginDrag(e.touches[0].clientY, e.timeStamp, fromHandle);
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      if (moveDrag(e.touches[0].clientY, e.timeStamp) && e.cancelable) {
        e.preventDefault();
      }
    };
    const onEnd = (e: TouchEvent) => endDrag(e.timeStamp);

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mouse drag on the handle (desktop / hybrid devices).
  const onHandleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    beginDrag(e.clientY, e.timeStamp, true);
    const move = (ev: MouseEvent) => {
      moveDrag(ev.clientY, ev.timeStamp);
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      endDrag(ev.timeStamp);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const titleId = 'answer-sheet-title';

  return createPortal(
    <div className="fixed inset-0 z-[60]">
      <div
        ref={backdropRef}
        onClick={() => onClose()}
        aria-hidden="true"
        className="absolute inset-0 bg-[#0E0F14]/55"
        style={{ opacity: 0, touchAction: 'none' }}
      />

      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="absolute outline-none inset-x-0 bottom-0 mx-auto flex w-full max-w-[640px] flex-col rounded-t-[28px] bg-white shadow-[0_-14px_40px_-14px_rgba(14,15,20,0.4)]"
        style={{
          height: 'calc(100dvh - env(safe-area-inset-top, 0px) - 3.5rem - 0.5rem)',
          transform: 'translate3d(0, 100%, 0)',
          willChange: 'transform',
        }}
      >
        {/* Handle + header: always draggable */}
        <div
          onMouseDown={onHandleMouseDown}
          className="shrink-0 cursor-grab select-none px-5 pb-2 pt-2.5 active:cursor-grabbing"
          style={{ touchAction: 'none' }}
        >
          <div className="mx-auto h-1.5 w-10 rounded-full bg-[#1A1B20]/15" />
          <div className="mt-3 flex items-center justify-between">
            <h2
              id={titleId}
              className="font-display text-base font-bold text-[#1A1B20]"
            >
              Question {number}
            </h2>
            <button
              type="button"
              onClick={() => onClose()}
              aria-label="Close answer"
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-[#F2F4F7] text-[#1A1B20] transition-transform duration-150 active:scale-90"
            >
              <X className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto px-5"
          style={{
            overscrollBehavior: 'contain',
            WebkitOverflowScrolling: 'touch',
            paddingBottom: 'calc(50vh + 28px)',
          }}
        >
          <AnswerBody question={question} solution={solution} />
        </div>
      </div>
    </div>,
    document.body
  );
};

/** Question text + answer + step-by-step explanation (shared by sheet and dialog). */
const AnswerBody: React.FC<{ question: string; solution: QuestionSolution | null }> = ({
  question,
  solution,
}) => (
  <>
    <p className="font-serif text-[16px] leading-[1.7] text-[#1A1B20]">
      {question}
    </p>

    {solution ? (
      <>
        <div className="mt-5 rounded-3xl bg-[#1D1E23] px-5 py-4 text-white">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#A5AAB8]">
            Answer
          </p>
          <p className="mt-1.5 whitespace-pre-line text-[15px] font-semibold leading-relaxed">
            {solution.answer}
          </p>
        </div>

        <h3 className="mt-6 font-display text-sm font-bold text-[#1A1B20]">
          How we got it
        </h3>
        <ol className="mt-3 space-y-3.5">
          {solution.explanation.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#EFF1F5] font-mono-tabular text-[11px] font-semibold text-[#1A1B20]">
                {i + 1}
              </span>
              <p className="min-w-0 flex-1 whitespace-pre-line text-sm leading-6 text-[#3A3D47]">
                {step}
              </p>
            </li>
          ))}
        </ol>
      </>
    ) : (
      <div className="mt-5 rounded-3xl bg-[#F6F7F9] px-5 py-4">
        <p className="text-sm font-semibold text-[#1A1B20]">
          No answer yet
        </p>
        <p className="mt-1 text-sm leading-6 text-[#5A5E6B]">
          The answer and explanation for this question have not been added.
        </p>
      </div>
    )}
  </>
);

const DESKTOP_QUERY = '(min-width: 1024px)';

const useIsDesktop = () => {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(DESKTOP_QUERY).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setIsDesktop(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isDesktop;
};

/** Desktop: a centred dialog box (fade + gentle scale) instead of a bottom sheet. */
const AnswerDialog: React.FC<AnswerSheetProps> = ({
  open,
  number,
  question,
  solution,
  onClose,
  onExited,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;

  // Enter / exit animation
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (open) {
      returnFocusTo.current ??= document.activeElement as HTMLElement | null;
      const raf = requestAnimationFrame(() => {
        setShown(true);
        dialogRef.current?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    const timer = window.setTimeout(
      () => {
        returnFocusTo.current?.focus?.({ preventScroll: true });
        returnFocusTo.current = null;
        onExitedRef.current();
      },
      reduce ? 0 : 220
    );
    return () => window.clearTimeout(timer);
  }, [open]);

  // Page lock + inert background + Esc
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPad: body.style.paddingRight,
    };
    const scrollbar = window.innerWidth - html.clientWidth;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    const root = document.getElementById('root');
    root?.setAttribute('inert', '');

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      html.style.overflow = prev.htmlOverflow;
      body.style.overflow = prev.bodyOverflow;
      body.style.paddingRight = prev.bodyPad;
      root?.removeAttribute('inert');
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const titleId = 'answer-dialog-title';

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
      <div
        onClick={() => onClose()}
        aria-hidden="true"
        className={`absolute inset-0 bg-[#0E0F14]/55 transition-opacity duration-200 ease-out motion-reduce:transition-none ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative flex w-full max-w-[600px] max-h-[min(80vh,720px)] flex-col rounded-[28px] bg-white outline-none shadow-[0_24px_60px_-16px_rgba(14,15,20,0.5)] transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
          shown ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-2'
        }`}
      >
        <div className="shrink-0 flex items-center justify-between px-6 pt-5 pb-3">
          <h2 id={titleId} className="font-display text-base font-bold text-[#1A1B20]">
            Question {number}
          </h2>
          <button
            type="button"
            onClick={() => onClose()}
            aria-label="Close answer"
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-[#F2F4F7] text-[#1A1B20] transition-colors duration-150 hover:bg-[#E6E9EF] active:scale-90"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto px-6 pb-6"
          style={{ overscrollBehavior: 'contain' }}
        >
          <AnswerBody question={question} solution={solution} />
        </div>
      </div>
    </div>,
    document.body
  );
};

export const AnswerSheet: React.FC<AnswerSheetProps> = (props) => {
  const isDesktop = useIsDesktop();
  // The phone's Back button closes the answer first.
  useBackHandler(props.open, props.onClose);
  return isDesktop ? <AnswerDialog {...props} /> : <MobileAnswerSheet {...props} />;
};
