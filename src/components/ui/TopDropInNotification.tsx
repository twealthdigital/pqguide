import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Bell, FileText, ShieldCheck, X } from 'lucide-react';
import { TooltipBubble } from './TooltipBubble';

export interface DropInNotificationItem {
  id: string;
  versionKey: string;
  title: string;
  message: string;
  category: 'upload' | 'access' | 'system' | 'governance';
  createdAt: string;
  updated?: boolean;
  targetDocId?: string;
  isGovernance?: boolean;
}

interface TopDropInNotificationProps {
  item: DropInNotificationItem | null;
  onView: (item: DropInNotificationItem) => void;
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 5000;

function parseRgba(colorStr: string): [number, number, number, number] | null {
  if (!colorStr || colorStr === 'transparent') return null;
  const match = colorStr.match(
    /rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*(\d+(?:\.\d+)?))?\s*\)/i
  );
  if (!match) return null;
  const r = Number(match[1]);
  const g = Number(match[2]);
  const b = Number(match[3]);
  const a = match[4] !== undefined ? Number(match[4]) : 1;
  if (a <= 0.01) return null;
  return [r, g, b, Math.min(1, Math.max(0, a))];
}

function compositeOver(
  base: [number, number, number],
  fg: [number, number, number, number]
): [number, number, number] {
  const a = fg[3];
  return [
    fg[0] * a + base[0] * (1 - a),
    fg[1] * a + base[1] * (1 - a),
    fg[2] * a + base[2] * (1 - a),
  ];
}

function probePointIsLight(x: number, y: number): boolean {
  if (typeof document === 'undefined') return true;
  const stack = document.elementsFromPoint(
    Math.min(Math.max(8, x), Math.max(8, window.innerWidth - 8)),
    Math.min(Math.max(8, y), Math.max(8, window.innerHeight - 8))
  );

  // Filter out the toast itself, then composite bottom-to-top onto #F6F7F9
  const under = stack.filter((el) => !el.closest('[data-dropin-toast="true"]'));
  let rgb: [number, number, number] = [246, 247, 249];

  for (let i = under.length - 1; i >= 0; i -= 1) {
    const el = under[i];
    if (!(el instanceof Element)) continue;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;

    const bg = parseRgba(style.backgroundColor);
    if (bg) {
      rgb = compositeOver(rgb, bg);
    }

    if (style.backgroundImage && style.backgroundImage.includes('gradient')) {
      const gradColor = parseRgba(style.backgroundImage);
      if (gradColor) {
        rgb = compositeOver(rgb, gradColor);
      }
    }
  }

  const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  return luminance >= 0.52;
}

export const TopDropInNotification: React.FC<TopDropInNotificationProps> = ({
  item,
  onView,
  onDismiss,
}) => {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [backdropIsLight, setBackdropIsLight] = useState(true);
  const [entered, setEntered] = useState(false);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  const dragStateRef = useRef<{
    active: boolean;
    pointerId: number | null;
    startX: number;
    startY: number;
    dx: number;
    dy: number;
    moved: boolean;
  }>({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    dx: 0,
    dy: 0,
    moved: false,
  });

  const timerRef = useRef<number | null>(null);
  const remainingRef = useRef<number>(AUTO_DISMISS_MS);
  const startedAtRef = useRef<number>(0);

  const updateContrast = useCallback(() => {
    const rect = cardRef.current?.getBoundingClientRect();
    const y = rect && rect.height > 0 ? rect.top + rect.height / 2 : 42;
    const width = window.innerWidth;
    const samples = [
      probePointIsLight(width * 0.35, y),
      probePointIsLight(width * 0.5, y),
      probePointIsLight(width * 0.65, y),
    ];
    const lightVotes = samples.filter(Boolean).length;
    setBackdropIsLight(lightVotes >= 2);
  }, []);

  // Entrance & contrast detection whenever a notification arrives or updates
  useLayoutEffect(() => {
    if (!item) {
      setEntered(false);
      setDragOffset({ x: 0, y: 0 });
      setIsDragging(false);
      return;
    }

    setDragOffset({ x: 0, y: 0 });
    setIsDragging(false);
    setEntered(false);
    updateContrast();

    const raf = window.requestAnimationFrame(() => {
      updateContrast();
      setEntered(true);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [item?.versionKey, updateContrast]);

  // Keep adaptive Dark/Light polarity synced while scrolling or resizing
  useEffect(() => {
    if (!item) return;
    const handleViewportChange = () => updateContrast();
    window.addEventListener('scroll', handleViewportChange, { passive: true });
    window.addEventListener('resize', handleViewportChange, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleViewportChange);
      window.removeEventListener('resize', handleViewportChange);
    };
  }, [item, updateContrast]);

  // Reset the 5-second countdown cleanly for every new/updated versionKey
  useEffect(() => {
    remainingRef.current = AUTO_DISMISS_MS;
  }, [item?.versionKey]);

  // 5-second auto-dismiss timer that pauses cleanly during hover or touch drag
  useEffect(() => {
    if (!item) return;
    if (isPaused || isDragging) {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
        const elapsed = Date.now() - startedAtRef.current;
        remainingRef.current = Math.max(250, remainingRef.current - elapsed);
      }
      return;
    }

    startedAtRef.current = Date.now();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      onDismiss();
    }, remainingRef.current);

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [item?.versionKey, isPaused, isDragging, onDismiss]);

  if (!item) return null;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('[data-dropin-close="true"]')) return;
    dragStateRef.current = {
      active: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      dx: 0,
      dy: 0,
      moved: false,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic events without active pointer capture
    }
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = dragStateRef.current;
    if (!st.active || st.pointerId !== e.pointerId) return;
    const rawDx = e.clientX - st.startX;
    const rawDy = e.clientY - st.startY;
    if (!st.moved && Math.hypot(rawDx, rawDy) > 8) {
      st.moved = true;
    }
    const clampedDy = rawDy > 0 ? Math.min(20, rawDy * 0.25) : rawDy;
    st.dx = rawDx;
    st.dy = clampedDy;
    setDragOffset({ x: rawDx, y: clampedDy });
  };

  const finishDrag = (e: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    const st = dragStateRef.current;
    if (!st.active || st.pointerId !== e.pointerId) return;
    st.active = false;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore release errors
    }

    setIsDragging(false);

    if (!cancelled && !st.moved) {
      setDragOffset({ x: 0, y: 0 });
      onView(item);
      return;
    }

    if (!cancelled && (Math.abs(st.dx) > 72 || st.dy < -36)) {
      onDismiss();
      return;
    }

    setDragOffset({ x: 0, y: 0 });
  };

  const swipeProgress = Math.min(
    1,
    Math.max(Math.abs(dragOffset.x) / 150, dragOffset.y < 0 ? Math.abs(dragOffset.y) / 80 : 0)
  );
  const opacity = entered ? Math.max(0.18, 1 - swipeProgress * 0.78) : 0;
  const translateY = entered ? dragOffset.y : -28;

  // Contrast rule: White/Light backdrop behind toast -> Dark card; Dark backdrop -> White card
  const useDarkCard = backdropIsLight;

  return (
    <div
      data-dropin-toast="true"
      role="status"
      aria-live="polite"
      className="fixed top-[calc(0.75rem+env(safe-area-inset-top))] sm:top-4 left-1/2 -translate-x-1/2 z-[115] w-[calc(100%-1.5rem)] max-w-md pointer-events-none"
    >
      <div
        ref={cardRef}
        onPointerEnter={() => setIsPaused(true)}
        onPointerLeave={() => setIsPaused(false)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(e) => finishDrag(e, false)}
        onPointerCancel={(e) => finishDrag(e, true)}
        style={{
          transform: `translate3d(${dragOffset.x}px, ${translateY}px, 0)`,
          opacity,
          transition: isDragging
            ? 'none'
            : 'transform 220ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms ease, background-color 200ms ease, color 200ms ease',
        }}
        className={`pointer-events-auto touch-none select-none cursor-pointer relative overflow-hidden rounded-2xl p-3.5 sm:p-4 border flex items-start gap-3 ${
          useDarkCard
            ? 'bg-[#1D1E23] text-white border-white/15 shadow-[0_18px_40px_-10px_rgba(10,12,18,0.52)]'
            : 'bg-white text-[#1A1B20] border-[#1A1B20]/12 shadow-[0_18px_40px_-10px_rgba(18,19,24,0.32)]'
        }`}
      >
        <div
          className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
            useDarkCard
              ? 'bg-white text-[#1D1E23]'
              : 'bg-[#1D1E23] text-white'
          }`}
        >
          {item.targetDocId ? (
            <FileText className="w-4 h-4" />
          ) : item.isGovernance ? (
            <ShieldCheck className="w-4 h-4" />
          ) : (
            <Bell className="w-4 h-4" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-1.5">
            <p className="font-display text-sm font-bold leading-snug truncate max-w-full">
              {item.title}
            </p>
            <span
              className={`font-mono-tabular text-[11px] font-semibold shrink-0 ${
                useDarkCard ? 'text-[#C3C7D2]' : 'text-[#505460]'
              }`}
            >
              · {item.updated ? 'Updated' : 'New'}
            </span>
          </div>
          <p
            className={`text-xs mt-0.5 line-clamp-2 leading-relaxed ${
              useDarkCard ? 'text-[#D3D6DF]' : 'text-[#505460]'
            }`}
          >
            {item.message}
          </p>
        </div>

        <TooltipBubble content="Dismiss notification" side="bottom">
          <button
            type="button"
            data-dropin-close="true"
            aria-label="Close notification"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
            className={`h-8 w-8 rounded-xl flex items-center justify-center shrink-0 cursor-pointer transition-colors ${
              useDarkCard
                ? 'bg-white/10 text-white hover:bg-white/20'
                : 'bg-[#F2F4F7] text-[#1A1B20] hover:bg-[#E5E8EE]'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </TooltipBubble>
      </div>
    </div>
  );
};
