import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, TrendingUp } from 'lucide-react';
import type { AppStoreState } from '../../../services/archiveRepository';
import { TooltipBubble, toLocalDateKey } from '../../../components/ui';

interface OverviewPerformanceChartProps {
  store: AppStoreState;
}

type ChartMode = 'bar' | 'line';
type RangeMode = '7d' | '30d' | 'year';
type YearGranularity = 'months' | 'weeks' | 'days';
type MetricFocus = 'revenue' | 'payments' | 'activity';

interface BucketPoint {
  key: string;
  label: string;
  fullLabel: string;
  verifiedRevenue: number;
  successCount: number;
  pendingCount: number;
  failedCount: number;
  examCount: number;
  signupCount: number;
  visitCount: number;
}

function getValueForMetric(bucket: BucketPoint, metric: MetricFocus): number {
  if (metric === 'revenue') return bucket.verifiedRevenue;
  if (metric === 'payments') {
    return bucket.successCount + bucket.pendingCount + bucket.failedCount;
  }
  return bucket.examCount + bucket.signupCount + bucket.visitCount;
}

function formatAxisTick(value: number, metric: MetricFocus): string {
  if (metric === 'revenue') {
    if (value >= 1_000_000) return `₦${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `₦${Math.round(value / 1_000)}k`;
    return `₦${Math.round(value)}`;
  }
  return `${Math.round(value)}`;
}

export const OverviewPerformanceChart: React.FC<OverviewPerformanceChartProps> = ({
  store,
}) => {
  const [chartMode, setChartMode] = useState<ChartMode>('bar');
  const [range, setRange] = useState<RangeMode>('7d');
  const [yearGranularity, setYearGranularity] = useState<YearGranularity>('months');
  const [metricFocus, setMetricFocus] = useState<MetricFocus>('revenue');
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [hoverBox, setHoverBox] = useState<{
    leftPx: number;
    topPx: number;
    above: boolean;
  } | null>(null);

  const chartAreaRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const buckets = useMemo<BucketPoint[]>(() => {
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const list: BucketPoint[] = [];
    const lookup = new Map<string, BucketPoint>();

    if (range === '7d' || range === '30d' || (range === 'year' && yearGranularity === 'days')) {
      const totalDays = range === '7d' ? 7 : range === '30d' ? 30 : 365;
      for (let i = totalDays - 1; i >= 0; i -= 1) {
        const d = new Date(todayMidnight);
        d.setDate(d.getDate() - i);
        const key = toLocalDateKey(d);
        const label =
          range === '7d'
            ? d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })
            : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const fullLabel = d.toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });
        const item: BucketPoint = {
          key,
          label,
          fullLabel,
          verifiedRevenue: 0,
          successCount: 0,
          pendingCount: 0,
          failedCount: 0,
          examCount: 0,
          signupCount: 0,
          visitCount: 0,
        };
        list.push(item);
        lookup.set(key, item);
      }

      for (const tx of store.payments) {
        const dt = new Date(tx.verifiedAt ?? tx.createdAt);
        if (Number.isNaN(dt.getTime())) continue;
        const target = lookup.get(toLocalDateKey(dt));
        if (!target) continue;
        if (tx.status === 'verified_auto') {
          target.successCount += 1;
          target.verifiedRevenue += tx.amountNaira;
        } else if (tx.status === 'pending') {
          target.pendingCount += 1;
        } else {
          target.failedCount += 1;
        }
      }

      for (const act of store.userActivities) {
        const dt = new Date(act.timestamp);
        if (Number.isNaN(dt.getTime())) continue;
        const target = lookup.get(toLocalDateKey(dt));
        if (!target) continue;
        if (act.type === 'exam_completed') target.examCount += 1;
        else if (act.type === 'signup') target.signupCount += 1;
        else target.visitCount += 1;
      }

      return list;
    }

    if (range === 'year' && yearGranularity === 'months') {
      for (let i = 11; i >= 0; i -= 1) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const label = d.toLocaleDateString('en-US', { month: 'short' });
        const fullLabel = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        const item: BucketPoint = {
          key,
          label,
          fullLabel,
          verifiedRevenue: 0,
          successCount: 0,
          pendingCount: 0,
          failedCount: 0,
          examCount: 0,
          signupCount: 0,
          visitCount: 0,
        };
        list.push(item);
        lookup.set(key, item);
      }

      for (const tx of store.payments) {
        const dt = new Date(tx.verifiedAt ?? tx.createdAt);
        if (Number.isNaN(dt.getTime())) continue;
        const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
        const target = lookup.get(key);
        if (!target) continue;
        if (tx.status === 'verified_auto') {
          target.successCount += 1;
          target.verifiedRevenue += tx.amountNaira;
        } else if (tx.status === 'pending') {
          target.pendingCount += 1;
        } else {
          target.failedCount += 1;
        }
      }

      for (const act of store.userActivities) {
        const dt = new Date(act.timestamp);
        if (Number.isNaN(dt.getTime())) continue;
        const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
        const target = lookup.get(key);
        if (!target) continue;
        if (act.type === 'exam_completed') target.examCount += 1;
        else if (act.type === 'signup') target.signupCount += 1;
        else target.visitCount += 1;
      }

      return list;
    }

    // Year by 52 weeks (7-day rolling weekly intervals anchored to today)
    const msPerDay = 86_400_000;
    const msPerWeek = 7 * msPerDay;
    const endWindowMs = todayMidnight.getTime() + msPerDay - 1;
    const startWindowMs = todayMidnight.getTime() - (52 * 7 - 1) * msPerDay;

    for (let w = 0; w < 52; w += 1) {
      const startDate = new Date(startWindowMs + w * msPerWeek);
      const endDate = new Date(startDate.getTime() + 6 * msPerDay);
      const label = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const fullLabel = `${startDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })} – ${endDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })}`;
      list.push({
        key: `w-${w}`,
        label,
        fullLabel,
        verifiedRevenue: 0,
        successCount: 0,
        pendingCount: 0,
        failedCount: 0,
        examCount: 0,
        signupCount: 0,
        visitCount: 0,
      });
    }

    for (const tx of store.payments) {
      const t = new Date(tx.verifiedAt ?? tx.createdAt).getTime();
      if (Number.isNaN(t) || t < startWindowMs || t > endWindowMs) continue;
      const idx = Math.min(51, Math.max(0, Math.floor((t - startWindowMs) / msPerWeek)));
      const target = list[idx];
      if (!target) continue;
      if (tx.status === 'verified_auto') {
        target.successCount += 1;
        target.verifiedRevenue += tx.amountNaira;
      } else if (tx.status === 'pending') {
        target.pendingCount += 1;
      } else {
        target.failedCount += 1;
      }
    }

    for (const act of store.userActivities) {
      const t = new Date(act.timestamp).getTime();
      if (Number.isNaN(t) || t < startWindowMs || t > endWindowMs) continue;
      const idx = Math.min(51, Math.max(0, Math.floor((t - startWindowMs) / msPerWeek)));
      const target = list[idx];
      if (!target) continue;
      if (act.type === 'exam_completed') target.examCount += 1;
      else if (act.type === 'signup') target.signupCount += 1;
      else target.visitCount += 1;
    }

    return list;
  }, [store.payments, store.userActivities, range, yearGranularity]);

  useEffect(() => {
    setHoveredIdx(null);
    setHoverBox(null);
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTo({ left: el.scrollWidth, behavior: 'smooth' });
    }
  }, [range, yearGranularity]);

  const maxVal = useMemo(() => {
    const peak = buckets.reduce(
      (max, b) => Math.max(max, getValueForMetric(b, metricFocus)),
      0
    );
    if (peak <= 0) return metricFocus === 'revenue' ? 10_000 : 4;
    const magnitude = Math.pow(10, Math.floor(Math.log10(peak)));
    const normalized = peak / magnitude;
    const nice =
      normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    const scaled = nice * magnitude;
    if (metricFocus !== 'revenue') {
      return Math.max(4, Math.ceil(Math.max(peak, scaled) / 4) * 4);
    }
    return scaled;
  }, [buckets, metricFocus]);

  const yTicks = useMemo(
    () => [maxVal, maxVal * 0.75, maxVal * 0.5, maxVal * 0.25, 0],
    [maxVal]
  );

  const svgHeight = 230;
  const plotTop = 18;
  const plotBottom = 192;
  const plotHeight = plotBottom - plotTop;
  const stepWidth =
    range === '7d'
      ? 72
      : range === '30d'
        ? 34
        : yearGranularity === 'months'
          ? 64
          : yearGranularity === 'weeks'
            ? 28
            : 16;

  const svgWidth = Math.max(520, buckets.length * stepWidth + 24);
  const labelStride =
    range === '7d'
      ? 1
      : range === '30d'
        ? 3
        : yearGranularity === 'months'
          ? 1
          : yearGranularity === 'weeks'
            ? 4
            : 28;

  const points = useMemo(() => {
    const startX = 18;
    const usableW = svgWidth - 36;
    return buckets.map((bucket, idx) => {
      const val = getValueForMetric(bucket, metricFocus);
      const x =
        buckets.length === 1
          ? startX + usableW / 2
          : startX + (idx / (buckets.length - 1)) * usableW;
      const ratio = maxVal > 0 ? Math.min(1, Math.max(0, val / maxVal)) : 0;
      const y = plotBottom - ratio * plotHeight;
      return { x, y, val, bucket, idx };
    });
  }, [buckets, metricFocus, maxVal, svgWidth, plotBottom, plotHeight]);

  const linePath = useMemo(() => {
    if (points.length === 0) return '';
    return points
      .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
      .join(' ');
  }, [points]);

  const areaPath = useMemo(() => {
    if (points.length === 0) return '';
    const first = points[0];
    const last = points[points.length - 1];
    return `${linePath} L ${last.x.toFixed(1)} ${plotBottom} L ${first.x.toFixed(1)} ${plotBottom} Z`;
  }, [linePath, points, plotBottom]);

  const activePoint = hoveredIdx !== null ? points[hoveredIdx] ?? null : null;

  const handleColumnEnter = (idx: number, ptX: number, ptY: number) => {
    setHoveredIdx(idx);
    const areaEl = chartAreaRef.current;
    const svgEl = svgRef.current;
    if (!areaEl || !svgEl) return;

    const areaRect = areaEl.getBoundingClientRect();
    const svgRect = svgEl.getBoundingClientRect();
    const rawCenterX = svgRect.left + ptX - areaRect.left;
    const halfCardW = 104;
    const minLeft = halfCardW + 8;
    const maxLeft = Math.max(minLeft, areaRect.width - halfCardW - 8);
    const clampedLeft = Math.max(minLeft, Math.min(maxLeft, rawCenterX));

    // If the bar/point is tall (near top of SVG), bring the tooltip down into the visible chart area
    const showAbove = ptY >= 124;
    const topPx = showAbove
      ? ptY - 10
      : Math.max(12, Math.min(plotBottom - 108, ptY + 12));

    setHoverBox({
      leftPx: clampedLeft,
      topPx,
      above: showAbove,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: '7d', label: '7 Days' },
              { id: '30d', label: 'Month (30 Days)' },
              { id: 'year', label: 'Year' },
            ] as const
          ).map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id)}
              className={`min-h-[34px] px-3 rounded-xl text-xs font-semibold cursor-pointer transition-colors ${
                range === r.id
                  ? 'bg-[#1D1E23] text-white'
                  : 'bg-[#F6F7F9] text-[#505460] hover:bg-[#ECEEF3]'
              }`}
            >
              {r.label}
            </button>
          ))}

          {range === 'year' && (
            <div className="flex items-center gap-1 pl-1 border-l border-[#1A1B20]/10">
              {(
                [
                  { id: 'months', label: '12 Months' },
                  { id: 'weeks', label: '52 Weeks' },
                  { id: 'days', label: '365 Days' },
                ] as const
              ).map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setYearGranularity(g.id)}
                  className={`min-h-[30px] px-2.5 rounded-lg text-[11px] font-semibold cursor-pointer transition-colors ${
                    yearGranularity === g.id
                      ? 'bg-[#1A1B20] text-white'
                      : 'bg-[#F6F7F9] text-[#505460] hover:bg-[#ECEEF3]'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-xl bg-[#F6F7F9] p-1 gap-1">
            {(
              [
                { id: 'revenue', label: 'Revenue' },
                { id: 'payments', label: 'Payments' },
                { id: 'activity', label: 'Activity' },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMetricFocus(m.id)}
                className={`min-h-[28px] px-2.5 rounded-lg text-[11px] font-semibold cursor-pointer transition-colors ${
                  metricFocus === m.id
                    ? 'bg-white text-[#1A1B20] shadow-xs'
                    : 'text-[#686C78] hover:text-[#1A1B20]'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="inline-flex items-center rounded-xl bg-[#F6F7F9] p-1 gap-1">
            <TooltipBubble label="Switch to Bar Chart view">
              <button
                type="button"
                onClick={() => setChartMode('bar')}
                aria-label="Bar chart view"
                aria-pressed={chartMode === 'bar'}
                className={`min-h-[28px] px-2.5 rounded-lg inline-flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer transition-colors ${
                  chartMode === 'bar'
                    ? 'bg-[#1D1E23] text-white'
                    : 'text-[#686C78] hover:text-[#1A1B20]'
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5" />
                <span>Bar</span>
              </button>
            </TooltipBubble>

            <TooltipBubble label="Switch to Line Chart view">
              <button
                type="button"
                onClick={() => setChartMode('line')}
                aria-label="Line chart view"
                aria-pressed={chartMode === 'line'}
                className={`min-h-[28px] px-2.5 rounded-lg inline-flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer transition-colors ${
                  chartMode === 'line'
                    ? 'bg-[#1D1E23] text-white'
                    : 'text-[#686C78] hover:text-[#1A1B20]'
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5" />
                <span>Line</span>
              </button>
            </TooltipBubble>
          </div>
        </div>
      </div>

      <div
        ref={chartAreaRef}
        className="relative flex items-stretch gap-2"
        onMouseLeave={() => {
          setHoveredIdx(null);
          setHoverBox(null);
        }}
      >
        {/* Fixed Left Y-Axis */}
        <div
          className="w-12 sm:w-14 shrink-0 relative select-none"
          style={{ height: svgHeight }}
          aria-hidden="true"
        >
          {yTicks.map((tick, i) => {
            const topPx = plotTop + (i / (yTicks.length - 1)) * plotHeight;
            return (
              <span
                key={i}
                style={{ top: topPx }}
                className="absolute right-1 -translate-y-1/2 text-[10px] font-mono-tabular text-[#686C78] whitespace-nowrap"
              >
                {formatAxisTick(tick, metricFocus)}
              </span>
            );
          })}
        </div>

        {/* Scrollable Plot Area */}
        <div
          ref={scrollContainerRef}
          onScroll={() => {
            setHoveredIdx(null);
            setHoverBox(null);
          }}
          className="flex-1 overflow-x-auto scroll-smooth relative"
        >
          <div style={{ width: svgWidth, minWidth: '100%' }} className="relative">
            <svg
              ref={svgRef}
              width={svgWidth}
              height={svgHeight}
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="block overflow-visible"
              role="img"
              aria-label="Platform daily performance chart"
            >
              <defs>
                <linearGradient id="pqPerfAreaFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1D1E23" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#1D1E23" stopOpacity="0.01" />
                </linearGradient>
              </defs>

              {yTicks.map((_, i) => {
                const gy = plotTop + (i / (yTicks.length - 1)) * plotHeight;
                return (
                  <line
                    key={i}
                    x1={0}
                    x2={svgWidth}
                    y1={gy}
                    y2={gy}
                    stroke="#1A1B20"
                    strokeOpacity={i === yTicks.length - 1 ? 0.14 : 0.06}
                    strokeDasharray={i === yTicks.length - 1 ? undefined : '4 4'}
                  />
                );
              })}

              {chartMode === 'line' && areaPath && (
                <path d={areaPath} fill="url(#pqPerfAreaFill)" />
              )}

              {chartMode === 'line' && linePath && (
                <path
                  d={linePath}
                  fill="none"
                  stroke="#1D1E23"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {points.map((pt) => {
                const isHovered = hoveredIdx === pt.idx;
                const barWidth = Math.max(
                  6,
                  Math.min(28, stepWidth * 0.54)
                );
                const barH = Math.max(pt.val > 0 ? 4 : 2, plotBottom - pt.y);
                const barY = pt.val > 0 ? pt.y : plotBottom - 2;
                const showTickLabel =
                  pt.idx % labelStride === 0 || pt.idx === points.length - 1;

                return (
                  <g key={pt.bucket.key}>
                    {isHovered && (
                      <line
                        x1={pt.x}
                        x2={pt.x}
                        y1={plotTop}
                        y2={plotBottom}
                        stroke="#1D1E23"
                        strokeOpacity={0.18}
                        strokeDasharray="3 3"
                      />
                    )}

                    {chartMode === 'bar' ? (
                      <rect
                        x={pt.x - barWidth / 2}
                        y={barY}
                        width={barWidth}
                        height={barH}
                        rx={Math.min(6, barWidth / 2)}
                        fill={
                          pt.val === 0
                            ? '#E5E7EB'
                            : isHovered
                              ? '#15803D'
                              : '#1D1E23'
                        }
                        className="transition-colors duration-150"
                      />
                    ) : (
                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r={isHovered ? 5.5 : pt.val > 0 ? 3.5 : 2}
                        fill={
                          isHovered
                            ? '#15803D'
                            : pt.val > 0
                              ? '#1D1E23'
                              : '#D1D5DB'
                        }
                        stroke="#FFFFFF"
                        strokeWidth={isHovered ? 2 : 1.2}
                      />
                    )}

                    {showTickLabel && (
                      <text
                        x={pt.x}
                        y={svgHeight - 10}
                        textAnchor="middle"
                        className="fill-[#686C78] text-[10px] font-mono-tabular"
                      >
                        {pt.bucket.label}
                      </text>
                    )}

                    {/* Full-column hover/focus hit area */}
                    <rect
                      x={pt.x - stepWidth / 2}
                      y={0}
                      width={stepWidth}
                      height={svgHeight}
                      fill="transparent"
                      className="cursor-pointer"
                      tabIndex={0}
                      aria-label={`${pt.bucket.fullLabel}: ₦${pt.bucket.verifiedRevenue.toLocaleString()} verified revenue`}
                      onMouseEnter={() => handleColumnEnter(pt.idx, pt.x, pt.y)}
                      onFocus={() => handleColumnEnter(pt.idx, pt.x, pt.y)}
                      onClick={() => handleColumnEnter(pt.idx, pt.x, pt.y)}
                    />
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {activePoint && hoverBox && (
          <div
            style={{
              left: hoverBox.leftPx,
              top: hoverBox.topPx,
            }}
            className={`pointer-events-none absolute z-30 -translate-x-1/2 ${
              hoverBox.above ? '-translate-y-full' : ''
            } rounded-2xl bg-[#1D1E23] text-white border border-white/12 px-3.5 py-2.5 shadow-[0_14px_32px_-8px_rgba(14,15,20,0.52)] min-w-[200px] space-y-1.5`}
          >
            <p className="text-[11px] font-bold text-white border-b border-white/10 pb-1">
              {activePoint.bucket.fullLabel}
            </p>
            <div className="flex items-center justify-between gap-4 text-[11px] font-mono-tabular">
              <span className="text-[#C3C7D2]">Verified Revenue</span>
              <span className="font-bold text-[#4ADE80]">
                ₦{activePoint.bucket.verifiedRevenue.toLocaleString()}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 pt-0.5 text-[10px] font-mono-tabular">
              <span className="text-[#4ADE80]">
                Ok: {activePoint.bucket.successCount}
              </span>
              <span className="text-[#FBBF24]">
                Pend: {activePoint.bucket.pendingCount}
              </span>
              <span className="text-[#F87171]">
                Decl: {activePoint.bucket.failedCount}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 text-[10px] text-[#B8BCC8] font-mono-tabular pt-0.5 border-t border-white/10">
              <span>Exams: {activePoint.bucket.examCount}</span>
              <span>Signups: {activePoint.bucket.signupCount}</span>
              <span>Visits: {activePoint.bucket.visitCount}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
