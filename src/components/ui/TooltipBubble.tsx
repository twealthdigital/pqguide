import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

interface TooltipBubbleProps {
  label?: string;
  content?: string;
  side?: TooltipSide;
  delayMs?: number;
  fullWidth?: boolean;
  disabled?: boolean;
  wrapperClassName?: string;
  children: React.ReactNode;
}

export const TooltipBubble: React.FC<TooltipBubbleProps> = ({
  label,
  content,
  side = 'top',
  delayMs = 150,
  fullWidth = false,
  disabled = false,
  wrapperClassName = '',
  children,
}) => {
  const tooltipText = label ?? content;
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el || typeof window === 'undefined') return;
    const rect = el.getBoundingClientRect();
    const gap = 8;
    let top = rect.top - gap;
    let left = rect.left + rect.width / 2;

    if (side === 'bottom') {
      top = rect.bottom + gap;
      left = rect.left + rect.width / 2;
    } else if (side === 'right') {
      top = rect.top + rect.height / 2;
      left = rect.right + gap;
    } else if (side === 'left') {
      top = rect.top + rect.height / 2;
      left = rect.left - gap;
    }

    // Clamp horizontally within viewport margins so bubbles never clip on edges
    const vw = window.innerWidth;
    if (side === 'top' || side === 'bottom') {
      left = Math.max(96, Math.min(vw - 96, left));
    }
    setCoords({ top, left });
  }, [side]);

  const scheduleOpen = useCallback(() => {
    if (!tooltipText || disabled) return;
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      updatePosition();
      setVisible(true);
    }, delayMs);
  }, [clearTimer, delayMs, disabled, tooltipText, updatePosition]);

  const closeNow = useCallback(() => {
    clearTimer();
    setVisible(false);
  }, [clearTimer]);

  useEffect(() => {
    return () => clearTimer();
  }, [clearTimer]);

  useEffect(() => {
    if (!visible) return;
    const onScrollOrResize = () => closeNow();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [visible, closeNow]);

  if (!tooltipText || disabled) {
    return <>{children}</>;
  }

  const transformClass =
    side === 'top'
      ? '-translate-x-1/2 -translate-y-full'
      : side === 'bottom'
        ? '-translate-x-1/2'
        : side === 'right'
          ? '-translate-y-1/2'
          : '-translate-x-full -translate-y-1/2';

  return (
    <>
      <span
        ref={triggerRef}
        onPointerEnter={(e) => {
          if (e.pointerType === 'touch') return;
          scheduleOpen();
        }}
        onPointerLeave={closeNow}
        onPointerDown={closeNow}
        onFocus={(e) => {
          if (e.target.matches?.(':focus-visible')) {
            scheduleOpen();
          }
        }}
        onBlur={closeNow}
        className={`${fullWidth ? 'block w-full' : 'inline-flex'} ${wrapperClassName}`}
      >
        {children}
      </span>

      {visible &&
        coords &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="tooltip"
            style={{ top: coords.top, left: coords.left }}
            className={`fixed z-[130] pointer-events-none select-none rounded-xl bg-[#1D1E23] text-white border border-white/12 px-2.5 py-1.5 text-[11px] font-medium leading-snug shadow-[0_12px_28px_-6px_rgba(14,15,20,0.48)] max-w-[230px] whitespace-normal text-center ${transformClass}`}
          >
            {tooltipText}
          </div>,
          document.body
        )}
    </>
  );
};
