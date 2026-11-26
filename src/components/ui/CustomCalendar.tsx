import React, { useEffect, useMemo, useState } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { TooltipBubble } from './TooltipBubble';

export interface CalendarDayStat {
  successCount: number;
  pendingCount: number;
  failedCount: number;
  totalAmount: number;
}

interface CustomCalendarProps {
  selectedDateKey: string;
  todayDateKey: string;
  onSelectDate: (dateKey: string) => void;
  dayStats?: Record<string, CalendarDayStat>;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function toLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseDateKey(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map((n) => Number(n));
  return new Date(y || 2026, (m || 1) - 1, d || 1);
}

export const CustomCalendar: React.FC<CustomCalendarProps> = ({
  selectedDateKey,
  todayDateKey,
  onSelectDate,
  dayStats = {},
}) => {
  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const d = parseDateKey(selectedDateKey);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  useEffect(() => {
    const sel = parseDateKey(selectedDateKey);
    setViewMonth((prev) => {
      if (prev.getFullYear() === sel.getFullYear() && prev.getMonth() === sel.getMonth()) {
        return prev;
      }
      return new Date(sel.getFullYear(), sel.getMonth(), 1);
    });
  }, [selectedDateKey]);

  const monthLabel = useMemo(
    () =>
      viewMonth.toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
      }),
    [viewMonth]
  );

  const cells = useMemo(() => {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const list: Array<{ day: number | null; dateKey: string | null }> = [];

    for (let i = 0; i < firstWeekday; i += 1) {
      list.push({ day: null, dateKey: null });
    }
    for (let d = 1; d <= daysInMonth; d += 1) {
      const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      list.push({ day: d, dateKey });
    }
    return list;
  }, [viewMonth]);

  const shiftMonth = (delta: number) => {
    setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  const todayDate = parseDateKey(todayDateKey);
  const isViewingTodayMonth =
    viewMonth.getFullYear() === todayDate.getFullYear() &&
    viewMonth.getMonth() === todayDate.getMonth();

  return (
    <div className="rounded-2xl bg-white border border-[#1A1B20]/[0.08] p-4 sm:p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="h-8 w-8 rounded-xl bg-[#1D1E23] text-white flex items-center justify-center shrink-0">
            <CalendarIcon className="w-4 h-4" />
          </span>
          <p className="font-display text-sm sm:text-base font-bold text-[#1A1B20] truncate">
            {monthLabel}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {(selectedDateKey !== todayDateKey || !isViewingTodayMonth) && (
            <TooltipBubble label="Jump back to today's payment records">
              <button
                type="button"
                onClick={() => {
                  onSelectDate(todayDateKey);
                  setViewMonth(new Date(todayDate.getFullYear(), todayDate.getMonth(), 1));
                }}
                className="min-h-[34px] px-2.5 rounded-xl bg-[#F6F7F9] hover:bg-[#ECEEF3] border border-[#1A1B20]/10 text-[11px] font-semibold text-[#1A1B20] cursor-pointer transition-colors"
              >
                Today
              </button>
            </TooltipBubble>
          )}

          <TooltipBubble label="Previous month">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              aria-label="Previous month"
              className="h-8 w-8 rounded-xl bg-[#F6F7F9] hover:bg-[#ECEEF3] text-[#1A1B20] flex items-center justify-center cursor-pointer transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </TooltipBubble>

          <TooltipBubble label="Next month">
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              aria-label="Next month"
              className="h-8 w-8 rounded-xl bg-[#F6F7F9] hover:bg-[#ECEEF3] text-[#1A1B20] flex items-center justify-center cursor-pointer transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </TooltipBubble>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((wd) => (
          <div
            key={wd}
            className="py-1 text-[10px] font-bold uppercase tracking-wider text-[#686C78]"
          >
            {wd}
          </div>
        ))}

        {cells.map((cell, idx) => {
          if (!cell.day || !cell.dateKey) {
            return <div key={`empty-${idx}`} className="h-10" />;
          }

          const isSelected = cell.dateKey === selectedDateKey;
          const isToday = cell.dateKey === todayDateKey;
          const stat = dayStats[cell.dateKey];
          const hasActivity = Boolean(
            stat && stat.successCount + stat.pendingCount + stat.failedCount > 0
          );

          const tipText = stat
            ? `${cell.dateKey}: ${stat.successCount} successful, ${stat.pendingCount} pending, ${stat.failedCount} declined`
            : `View payments for ${cell.dateKey}`;

          return (
            <TooltipBubble key={cell.dateKey} label={tipText} fullWidth>
              <button
                type="button"
                onClick={() => onSelectDate(cell.dateKey!)}
                aria-label={tipText}
                aria-pressed={isSelected}
                className={`w-full h-10 rounded-xl flex flex-col items-center justify-center gap-0.5 text-xs font-mono-tabular transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-[#1D1E23] text-white font-bold shadow-xs'
                    : isToday
                      ? 'bg-[#EFF1F5] text-[#1A1B20] font-bold ring-1 ring-[#1D1E23]/30 hover:bg-[#E5E8EF]'
                      : 'text-[#1A1B20] hover:bg-[#F6F7F9]'
                }`}
              >
                <span className="leading-none">{cell.day}</span>
                {hasActivity && (
                  <span className="flex items-center gap-0.5">
                    {stat.successCount > 0 && (
                      <span
                        className={`h-1 w-1 rounded-full ${
                          isSelected ? 'bg-[#4ADE80]' : 'bg-[#15803D]'
                        }`}
                      />
                    )}
                    {stat.pendingCount > 0 && (
                      <span
                        className={`h-1 w-1 rounded-full ${
                          isSelected ? 'bg-[#FBBF24]' : 'bg-[#D97706]'
                        }`}
                      />
                    )}
                    {stat.failedCount > 0 && (
                      <span
                        className={`h-1 w-1 rounded-full ${
                          isSelected ? 'bg-[#F87171]' : 'bg-[#DC2626]'
                        }`}
                      />
                    )}
                  </span>
                )}
              </button>
            </TooltipBubble>
          );
        })}
      </div>
    </div>
  );
};
