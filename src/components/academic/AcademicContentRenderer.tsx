import React, { useEffect, useRef, useState } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { sanitizeSafeUrl } from '../../core/security';

export interface StructuredAiBlock {
  type: 'paragraph' | 'math' | 'steps' | 'table' | 'chart' | 'diagram' | 'practice_question';
  title?: string;
  text?: string;
  latex?: string;
  displayMode?: boolean;
  steps?: string[];
  headers?: string[];
  rows?: string[][];
  chartKind?: 'bar' | 'line';
  chartSeries?: Array<{ label: string; value: number }>;
  diagramPreset?: 'free_body_incline' | 'cell_mitosis' | 'ohm_circuit' | 'binary_tree';
  diagramCaption?: string;
  question?: string;
  options?: string[];
  answer?: string;
  explanation?: string;
}
import type {
  AcademicDocumentRecord,
  DetailedAcademicCategory,
  DocumentClassificationResult,
  DocumentIntegrityReport,
  ExtractedAcademicMetadata,
  ExtractedDiagramAsset,
  ExtractedFormula,
  ExtractedPageContent,
  ExtractedTable,
  FormExtractionResult,
  HandwritingAnalysisResult,
  LanguageAnalysisResult,
  MergedTableCellSpan,
  OmrScanResult,
  QrCodeMatch,
  ReconstructedBlock,
  ScannerModuleRunReport,
  SignatureDetection,
  StampDetection,
} from '../../core/types';
import { buildBlocksFromStructuredText } from '../../services/intelligence/layoutReconstructor';

export const KatexFormula: React.FC<{
  latex: string;
  displayMode?: boolean;
  className?: string;
}> = ({ latex, displayMode = false, className = '' }) => {
  const containerRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    try {
      katex.render(latex, el, {
        displayMode,
        throwOnError: false,
        trust: false,
        strict: false,
        output: 'htmlAndMathml',
      });
    } catch {
      el.textContent = latex;
    }
  }, [latex, displayMode]);

  return (
    <span
      ref={containerRef}
      className={`${displayMode ? 'block overflow-x-auto py-1 text-center' : 'inline-block align-middle'} ${className}`}
    />
  );
};

export const RichInlineText: React.FC<{ text: string; className?: string }> = ({
  text,
  className = 'text-sm leading-relaxed text-[#3A3D47]',
}) => {
  // Tokenize $$...$$ and $...$ safely into structured React nodes (no HTML injection)
  const parts: Array<{ kind: 'text' | 'block_math' | 'inline_math'; value: string }> = [];
  const regex = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ kind: 'text', value: text.slice(lastIndex, match.index) });
    }
    if (match[1]) {
      parts.push({ kind: 'block_math', value: match[1].trim() });
    } else if (match[2]) {
      parts.push({ kind: 'inline_math', value: match[2].trim() });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ kind: 'text', value: text.slice(lastIndex) });
  }

  return (
    <div className={className}>
      {parts.map((part, idx) =>
        part.kind === 'block_math' ? (
          <KatexFormula key={idx} latex={part.value} displayMode className="my-2" />
        ) : part.kind === 'inline_math' ? (
          <KatexFormula key={idx} latex={part.value} displayMode={false} className="mx-1" />
        ) : (
          <span key={idx} className="whitespace-pre-line">
            {part.value}
          </span>
        )
      )}
    </div>
  );
};

export const VectorSceneSvg: React.FC<{
  scene: NonNullable<ExtractedDiagramAsset['vectorScene']>;
  caption?: string;
}> = ({ scene, caption }) => {
  const width = Number.isFinite(scene.width) && scene.width > 0 ? scene.width : 300;
  const height = Number.isFinite(scene.height) && scene.height > 0 ? scene.height : 200;
  const strokeW = Math.max(1.2, Math.min(3.2, width / 150));

  return (
    <div className="w-full rounded-xl bg-white border border-[#1A1B20]/[0.06] p-3 flex items-center justify-center">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full max-h-56 h-auto"
        role="img"
        aria-label={caption || 'Extracted drawn vector figure'}
      >
        {scene.polylines.map((pl, idx) => {
          const cleanPts = pl.points
            .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
            .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
            .join(' ');
          if (!cleanPts) return null;
          const dash = pl.dashed ? `${(strokeW * 3).toFixed(1)} ${(strokeW * 2).toFixed(1)}` : undefined;
          const fill = pl.fill ? 'rgba(29, 30, 35, 0.08)' : 'none';
          return pl.closed ? (
            <polygon
              key={idx}
              points={cleanPts}
              fill={fill}
              stroke="#1D1E23"
              strokeWidth={strokeW}
              strokeDasharray={dash}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : (
            <polyline
              key={idx}
              points={cleanPts}
              fill="none"
              stroke="#1D1E23"
              strokeWidth={strokeW}
              strokeDasharray={dash}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}
        {(scene.labels ?? []).map((lbl, idx) => {
          if (!Number.isFinite(lbl.x) || !Number.isFinite(lbl.y) || !lbl.text) return null;
          const fontSize =
            lbl.fontSize && Number.isFinite(lbl.fontSize)
              ? Math.max(8, Math.min(20, lbl.fontSize))
              : Math.max(10, Math.min(14, width / 24));
          return (
            <text
              key={idx}
              x={lbl.x}
              y={lbl.y}
              fill="#1A1B20"
              fontSize={fontSize}
              fontWeight="700"
              fontFamily="system-ui, -apple-system, sans-serif"
            >
              {lbl.text}
            </text>
          );
        })}
      </svg>
    </div>
  );
};

export const SchematicDiagramSvg: React.FC<{
  preset: NonNullable<StructuredAiBlock['diagramPreset']>;
  caption?: string;
}> = ({ preset, caption }) => {
  return (
    <figure className="rounded-2xl border border-[#1A1B20]/10 bg-[#F6F7F9] p-4 space-y-2">
      <div className="bg-white rounded-xl border border-[#1A1B20]/[0.06] p-3 flex justify-center">
        {preset === 'free_body_incline' && (
          <svg viewBox="0 0 360 200" className="w-full max-w-[340px] h-auto" role="img" aria-label="Inclined plane free body diagram">
            <polygon points="40,170 310,170 310,60" fill="#EFF1F5" stroke="#1D1E23" strokeWidth="2.5" />
            <g transform="translate(185,112) rotate(-22)">
              <rect x="-24" y="-22" width="48" height="28" rx="4" fill="#1D1E23" />
              <text x="0" y="-4" textAnchor="middle" fill="#FFFFFF" fontSize="11" fontWeight="700">m</text>
              <line x1="0" y1="-22" x2="0" y2="-68" stroke="#15803D" strokeWidth="2.5" />
              <text x="8" y="-56" fill="#15803D" fontSize="11" fontWeight="700">N</text>
              <line x1="24" y1="-8" x2="72" y2="-8" stroke="#B91C1C" strokeWidth="2.5" />
              <text x="58" y="-15" fill="#B91C1C" fontSize="11" fontWeight="700">f</text>
              <line x1="-24" y1="-8" x2="-74" y2="-8" stroke="#1D1E23" strokeWidth="2.5" />
              <text x="-76" y="-15" fill="#1D1E23" fontSize="11" fontWeight="700">mg sinθ</text>
            </g>
            <line x1="185" y1="112" x2="185" y2="178" stroke="#1D1E23" strokeWidth="2.5" strokeDasharray="4 3" />
            <text x="193" y="174" fill="#1D1E23" fontSize="11" fontWeight="700">mg</text>
            <text x="95" y="160" fill="#505460" fontSize="12" fontWeight="700">θ</text>
          </svg>
        )}

        {preset === 'ohm_circuit' && (
          <svg viewBox="0 0 360 180" className="w-full max-w-[340px] h-auto" role="img" aria-label="Series DC circuit diagram">
            <rect x="70" y="36" width="220" height="108" rx="6" fill="none" stroke="#1D1E23" strokeWidth="2.5" />
            <rect x="52" y="66" width="36" height="48" fill="#FFFFFF" />
            <line x1="56" y1="80" x2="84" y2="80" stroke="#1D1E23" strokeWidth="3.5" />
            <line x1="62" y1="94" x2="78" y2="94" stroke="#1D1E23" strokeWidth="2.5" />
            <text x="28" y="92" fill="#1D1E23" fontSize="12" fontWeight="700">V</text>
            <rect x="148" y="24" width="64" height="24" rx="4" fill="#1D1E23" />
            <text x="180" y="40" textAnchor="middle" fill="#FFFFFF" fontSize="11" fontWeight="700">R</text>
            <line x1="230" y1="36" x2="262" y2="36" stroke="#15803D" strokeWidth="3" />
            <polygon points="268,36 258,30 258,42" fill="#15803D" />
            <text x="248" y="24" fill="#15803D" fontSize="11" fontWeight="700">I</text>
          </svg>
        )}

        {preset === 'cell_mitosis' && (
          <svg viewBox="0 0 360 180" className="w-full max-w-[340px] h-auto" role="img" aria-label="Cell division diagram">
            <ellipse cx="180" cy="90" rx="125" ry="68" fill="#EFF1F5" stroke="#1D1E23" strokeWidth="2.5" />
            <circle cx="135" cy="90" r="24" fill="#FFFFFF" stroke="#1D1E23" strokeWidth="2" strokeDasharray="4 3" />
            <circle cx="225" cy="90" r="24" fill="#FFFFFF" stroke="#1D1E23" strokeWidth="2" strokeDasharray="4 3" />
            <path d="M128 78 L142 102 M142 78 L128 102" stroke="#15803D" strokeWidth="3" strokeLinecap="round" />
            <path d="M218 78 L232 102 M232 78 L218 102" stroke="#15803D" strokeWidth="3" strokeLinecap="round" />
            <text x="180" y="38" textAnchor="middle" fill="#1D1E23" fontSize="11" fontWeight="700">Spindle &amp; Dividing Chromatids</text>
          </svg>
        )}

        {preset === 'binary_tree' && (
          <svg viewBox="0 0 360 180" className="w-full max-w-[340px] h-auto" role="img" aria-label="Binary search tree diagram">
            <line x1="180" y1="38" x2="105" y2="90" stroke="#1D1E23" strokeWidth="2" />
            <line x1="180" y1="38" x2="255" y2="90" stroke="#1D1E23" strokeWidth="2" />
            <line x1="105" y1="90" x2="65" y2="142" stroke="#1D1E23" strokeWidth="2" />
            <line x1="105" y1="90" x2="145" y2="142" stroke="#1D1E23" strokeWidth="2" />
            {[
              { x: 180, y: 38, lbl: '50' },
              { x: 105, y: 90, lbl: '25' },
              { x: 255, y: 90, lbl: '75' },
              { x: 65, y: 142, lbl: '12' },
              { x: 145, y: 142, lbl: '38' },
            ].map((node) => (
              <g key={node.lbl}>
                <circle cx={node.x} cy={node.y} r="18" fill="#1D1E23" />
                <text x={node.x} y={node.y + 4} textAnchor="middle" fill="#FFFFFF" fontSize="12" fontWeight="700">
                  {node.lbl}
                </text>
              </g>
            ))}
          </svg>
        )}
      </div>
      {caption && <figcaption className="text-xs text-[#505460]">{caption}</figcaption>}
    </figure>
  );
};

const StructuredChartSvg: React.FC<{
  kind: 'bar' | 'line';
  series: Array<{ label: string; value: number }>;
}> = ({ kind, series }) => {
  if (series.length === 0) return null;
  const maxVal = Math.max(1, ...series.map((s) => s.value));
  const width = 420;
  const height = 180;
  const padX = 36;
  const padY = 24;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;

  return (
    <div className="rounded-2xl border border-[#1A1B20]/10 bg-[#F6F7F9] p-3 overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[280px] max-w-[440px] h-auto" role="img" aria-label="Academic data chart">
        <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} stroke="#C3C7D2" strokeWidth="1.5" />
        {kind === 'bar' ? (
          series.map((pt, i) => {
            const slotW = plotW / series.length;
            const barW = Math.max(16, slotW * 0.56);
            const barH = (pt.value / maxVal) * plotH;
            const x = padX + i * slotW + (slotW - barW) / 2;
            const y = height - padY - barH;
            return (
              <g key={pt.label}>
                <rect x={x} y={y} width={barW} height={barH} rx="5" fill="#1D1E23" />
                <text x={x + barW / 2} y={y - 5} textAnchor="middle" fontSize="10" fontWeight="700" fill="#1A1B20">
                  {pt.value}
                </text>
                <text x={x + barW / 2} y={height - 7} textAnchor="middle" fontSize="10" fill="#505460">
                  {pt.label.slice(0, 10)}
                </text>
              </g>
            );
          })
        ) : (
          <>
            <polyline
              fill="none"
              stroke="#1D1E23"
              strokeWidth="2.5"
              points={series
                .map((pt, i) => {
                  const x =
                    padX +
                    (series.length === 1 ? plotW / 2 : (i / (series.length - 1)) * plotW);
                  const y = height - padY - (pt.value / maxVal) * plotH;
                  return `${x},${y}`;
                })
                .join(' ')}
            />
            {series.map((pt, i) => {
              const x =
                padX +
                (series.length === 1 ? plotW / 2 : (i / (series.length - 1)) * plotW);
              const y = height - padY - (pt.value / maxVal) * plotH;
              return (
                <g key={pt.label}>
                  <circle cx={x} cy={y} r="4.5" fill="#1D1E23" />
                  <text x={x} y={y - 8} textAnchor="middle" fontSize="10" fontWeight="700" fill="#1A1B20">
                    {pt.value}
                  </text>
                  <text x={x} y={height - 7} textAnchor="middle" fontSize="10" fill="#505460">
                    {pt.label.slice(0, 10)}
                  </text>
                </g>
              );
            })}
          </>
        )}
      </svg>
    </div>
  );
};

type TableCardInput = Pick<ExtractedTable, 'caption' | 'headers' | 'rows'> &
  Partial<
    Pick<
      ExtractedTable,
      | 'borderStyle'
      | 'hasMergedCells'
      | 'mergedCells'
      | 'columnAlignments'
      | 'continuedFromPage'
      | 'continuesOnPage'
      | 'uncertainStructure'
      | 'uncertaintyReason'
      | 'rowHeaders'
      | 'markdown'
      | 'jsonRows'
    >
  >;

function buildFallbackMarkdown(table: TableCardInput): string {
  if (table.markdown) return table.markdown;
  const cols = Math.max(table.headers.length, ...table.rows.map((r) => r.length), 1);
  const pad = (row: string[]) => Array.from({ length: cols }, (_, i) => (row[i] ?? '').replace(/\|/g, '\\|'));
  const head = pad(table.headers.length > 0 ? table.headers : Array.from({ length: cols }, (_, i) => `Col ${i + 1}`));
  const sep = Array.from({ length: cols }, () => '---');
  const lines = [`| ${head.join(' | ')} |`, `| ${sep.join(' | ')} |`];
  for (const r of table.rows) lines.push(`| ${pad(r).join(' | ')} |`);
  return lines.join('\n');
}

function buildFallbackJson(table: TableCardInput): Array<Record<string, string>> {
  if (table.jsonRows) return table.jsonRows;
  return table.rows.map((row) => {
    const rec: Record<string, string> = {};
    const cols = Math.max(table.headers.length, row.length);
    for (let i = 0; i < cols; i += 1) {
      const key = table.headers[i]?.trim() || `col_${i + 1}`;
      rec[key] = row[i] ?? '';
    }
    return rec;
  });
}

function alignClass(align?: 'left' | 'center' | 'right'): string {
  if (align === 'center') return 'text-center';
  if (align === 'right') return 'text-right';
  return 'text-left';
}

export const ExtractedTableCard: React.FC<{
  table: TableCardInput;
  variant?: 'admin' | 'student';
}> = ({ table, variant = 'admin' }) => {
  const [copiedMode, setCopiedMode] = useState<'md' | 'json' | null>(null);
  const [exportPreview, setExportPreview] = useState<'none' | 'md' | 'json'>('none');

  const handleCopy = async (mode: 'md' | 'json') => {
    const content =
      mode === 'md'
        ? buildFallbackMarkdown(table)
        : JSON.stringify(buildFallbackJson(table), null, 2);
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMode(mode);
      window.setTimeout(() => setCopiedMode(null), 1600);
    } catch {
      setExportPreview((prev) => (prev === mode ? 'none' : mode));
    }
  };

  // Precompute merged-cell map (0-based row: 0 = header row, 1..N = body rows)
  const spanAt = new Map<string, MergedTableCellSpan>();
  const coveredSlots = new Set<string>();
  for (const span of table.mergedCells ?? []) {
    const rSpan = Math.max(1, span.rowSpan);
    const cSpan = Math.max(1, span.colSpan);
    if (rSpan === 1 && cSpan === 1) continue;
    spanAt.set(`${span.row},${span.col}`, { ...span, rowSpan: rSpan, colSpan: cSpan });
    for (let dr = 0; dr < rSpan; dr += 1) {
      for (let dc = 0; dc < cSpan; dc += 1) {
        if (dr === 0 && dc === 0) continue;
        coveredSlots.add(`${span.row + dr},${span.col + dc}`);
      }
    }
  }

  return (
    <div className="rounded-xl border border-[#1A1B20]/12 bg-white overflow-hidden">
      {variant === 'admin' ? (
        <div className="px-3.5 py-2 bg-[#F6F7F9] border-b border-[#1A1B20]/[0.07] flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-bold text-[#1A1B20]">
              {table.caption || 'Table'}
            </span>
            {table.borderStyle && (
              <span className="rounded bg-white border border-[#1A1B20]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#505460]">
                {table.borderStyle}
              </span>
            )}
            {table.hasMergedCells && (
              <span className="rounded bg-white border border-[#1A1B20]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#505460]">
                Merged cells
              </span>
            )}
            {table.continuedFromPage && (
              <span className="rounded bg-[#EFF6FF] text-[#1D4ED8] px-1.5 py-0.5 text-[10px] font-semibold">
                Continued from p.{table.continuedFromPage}
              </span>
            )}
            {table.continuesOnPage && (
              <span className="rounded bg-[#EFF6FF] text-[#1D4ED8] px-1.5 py-0.5 text-[10px] font-semibold">
                Continues on p.{table.continuesOnPage}
              </span>
            )}
            {table.uncertainStructure && (
              <span
                title={table.uncertaintyReason}
                className="rounded bg-[#FEF3C7] text-[#92400E] px-1.5 py-0.5 text-[10px] font-bold"
              >
                Uncertain structure
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-[10px] font-semibold">
            <button
              type="button"
              onClick={() => void handleCopy('md')}
              className="rounded-lg bg-white border border-[#1A1B20]/10 px-2 py-0.5 text-[#1A1B20] hover:bg-[#ECEEF3] cursor-pointer"
            >
              {copiedMode === 'md' ? 'Copied MD' : 'Copy MD'}
            </button>
            <button
              type="button"
              onClick={() => void handleCopy('json')}
              className="rounded-lg bg-white border border-[#1A1B20]/10 px-2 py-0.5 text-[#1A1B20] hover:bg-[#ECEEF3] cursor-pointer"
            >
              {copiedMode === 'json' ? 'Copied JSON' : 'Copy JSON'}
            </button>
          </div>
        </div>
      ) : table.caption ? (
        <div className="px-3.5 py-2 bg-[#F6F7F9] border-b border-[#1A1B20]/[0.07]">
          <p className="text-xs font-bold text-[#1A1B20]">{table.caption}</p>
        </div>
      ) : null}

      {variant === 'admin' && table.uncertainStructure && table.uncertaintyReason && (
        <div className="px-3.5 py-1.5 bg-[#FEF3C7]/45 border-b border-[#FDE68A] text-[11px] text-[#92400E]">
          {table.uncertaintyReason}
        </div>
      )}
      {variant === 'admin' && exportPreview !== 'none' && (
        <pre className="p-3 bg-[#1D1E23] text-[#F6F7F9] text-[11px] overflow-x-auto max-h-44">
          {exportPreview === 'md'
            ? buildFallbackMarkdown(table)
            : JSON.stringify(buildFallbackJson(table), null, 2)}
        </pre>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs sm:text-sm">
          {table.headers.length > 0 && (
            <thead>
              <tr className="bg-[#1D1E23] text-white">
                {table.headers.map((h, cIdx) => {
                  const slotKey = `0,${cIdx}`;
                  if (coveredSlots.has(slotKey)) return null;
                  const span = spanAt.get(slotKey);
                  const colAlign = alignClass(table.columnAlignments?.[cIdx]);
                  return (
                    <th
                      key={cIdx}
                      colSpan={span?.colSpan}
                      rowSpan={span?.rowSpan}
                      className={`px-3 py-2 font-semibold border-r border-white/10 last:border-r-0 ${colAlign}`}
                    >
                      {h ? (
                        <RichInlineText text={h} className="text-xs sm:text-sm text-white" />
                      ) : (
                        <span className="opacity-40">—</span>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
          )}
          <tbody>
            {table.rows.map((row, rIdx) => (
              <tr
                key={rIdx}
                className="border-t border-[#1A1B20]/[0.08] odd:bg-white even:bg-[#F6F7F9]/60"
              >
                {row.map((cell, cIdx) => {
                  const slotKey = `${rIdx + 1},${cIdx}`;
                  if (coveredSlots.has(slotKey)) return null;
                  const span = spanAt.get(slotKey);
                  const isRowHeader = cIdx === 0 && Boolean(table.rowHeaders?.length);
                  const colAlign = alignClass(table.columnAlignments?.[cIdx]);
                  return (
                    <td
                      key={cIdx}
                      colSpan={span?.colSpan}
                      rowSpan={span?.rowSpan}
                      className={`px-3 py-2 border-r border-[#1A1B20]/[0.06] last:border-r-0 align-top ${colAlign} ${
                        isRowHeader ? 'font-semibold text-[#1A1B20] bg-[#F6F7F9]/50' : 'text-[#3A3D47]'
                      }`}
                    >
                      {cell ? (
                        <RichInlineText text={cell} className="text-xs sm:text-sm" />
                      ) : (
                        <span className="text-[11px] text-[#8E93A2]">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const DIAGRAM_TYPE_LABELS: Record<string, string> = {
  flowchart: 'Flowchart',
  uml_class: 'UML Class',
  uml_sequence: 'UML Sequence',
  uml_use_case: 'UML Use-Case',
  erd: 'ERD',
  circuit: 'Circuit',
  network: 'Network',
  math_graph: 'Math Graph',
  geometric: 'Geometric',
  scientific_illustration: 'Scientific',
  engineering: 'Engineering',
  general_diagram: 'Diagram',
};

export const DiagramFigureBlock: React.FC<{
  diag: ExtractedDiagramAsset;
  variant?: 'admin' | 'student';
}> = ({ diag, variant = 'admin' }) => {
  const [showOriginalCrop, setShowOriginalCrop] = useState(false);
  const safeUrl = sanitizeSafeUrl(diag.dataUrl);
  const safeOriginalCrop = sanitizeSafeUrl(diag.originalCropDataUrl);
  const hasVector = Boolean(diag.vectorScene && diag.vectorScene.polylines.length > 0);
  const hasOriginalRef =
    variant === 'admin' && Boolean(safeOriginalCrop && (hasVector || safeOriginalCrop !== safeUrl));

  return (
    <figure className="rounded-xl border border-[#1A1B20]/10 bg-[#F6F7F9] p-3 space-y-2 my-1">
      {variant === 'admin' && (diag.diagramType || (diag.extractedNodes && diag.extractedNodes.length > 0) || hasOriginalRef) && (
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {diag.diagramType && (
              <span className="rounded bg-[#1D1E23] text-white px-2 py-0.5 text-[10px] font-bold">
                {DIAGRAM_TYPE_LABELS[diag.diagramType] ?? diag.diagramType}
              </span>
            )}
            {diag.extractedNodes && diag.extractedNodes.length > 0 && (
              <span className="rounded bg-white border border-[#1A1B20]/10 px-1.5 py-0.5 text-[10px] text-[#505460] font-mono-tabular">
                {diag.extractedNodes.length} nodes · {diag.extractedEdges?.length ?? 0} edges
              </span>
            )}
          </div>
          {hasOriginalRef && (
            <button
              type="button"
              onClick={() => setShowOriginalCrop((prev) => !prev)}
              className="rounded-lg bg-white border border-[#1A1B20]/10 px-2 py-0.5 text-[10px] font-semibold text-[#1A1B20] cursor-pointer"
            >
              {showOriginalCrop ? 'View Extracted' : 'Original Crop'}
            </button>
          )}
        </div>
      )}

      {showOriginalCrop && safeOriginalCrop ? (
        <img
          src={safeOriginalCrop}
          alt={`Original unedited crop: ${diag.caption}`}
          referrerPolicy="no-referrer"
          className="w-full max-h-64 object-contain rounded-lg bg-white"
        />
      ) : hasVector && diag.vectorScene ? (
        <VectorSceneSvg scene={diag.vectorScene} caption={diag.caption} />
      ) : safeUrl ? (
        <img
          src={safeUrl}
          alt={diag.caption}
          referrerPolicy="no-referrer"
          className="w-full max-h-64 object-contain rounded-lg bg-white"
        />
      ) : null}

      {diag.caption && (
        <figcaption className="text-xs text-[#3A3D47] font-medium text-center">
          {diag.caption}
        </figcaption>
      )}
      {variant === 'admin' && (diag.extractedMeasurements?.length || diag.extractedLabels?.length) ? (
        <p className="text-[11px] text-[#686C78] break-words">
          {diag.extractedMeasurements && diag.extractedMeasurements.length > 0
            ? `Measurements: ${diag.extractedMeasurements.slice(0, 6).join(', ')}`
            : ''}
          {diag.extractedMeasurements?.length && diag.extractedLabels?.length ? ' · ' : ''}
          {diag.extractedLabels && diag.extractedLabels.length > 0
            ? `Labels: ${diag.extractedLabels.slice(0, 6).join(', ')}`
            : ''}
        </p>
      ) : null}
    </figure>
  );
};

export const ExtractedDiagramsGallery: React.FC<{
  diagrams: ExtractedDiagramAsset[];
}> = ({ diagrams }) => {
  const visible = diagrams.filter(
    (d) => Boolean(d.vectorScene && d.vectorScene.polylines.length > 0) || Boolean(sanitizeSafeUrl(d.dataUrl))
  );
  if (visible.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {visible.map((diag) => (
        <DiagramFigureBlock key={diag.id} diag={diag} variant="admin" />
      ))}
    </div>
  );
};

export const ExtractedFormulasList: React.FC<{
  formulas: ExtractedFormula[];
}> = ({ formulas }) => {
  if (formulas.length === 0) return null;
  return (
    <div className="space-y-2">
      {formulas.map((f) => (
        <div
          key={f.id}
          className="rounded-2xl border border-[#1A1B20]/10 bg-[#F6F7F9] px-4 py-3 overflow-x-auto"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono-tabular text-[#686C78] mb-1">
            <span>
              Formula · Page {f.pageNumber}
              {f.kind ? ` · ${f.kind.replace(/_/g, ' ')}` : ''}
            </span>
            {f.uncertain && (
              <span className="rounded bg-[#FEF3C7] text-[#92400E] px-2 py-0.5 font-sans font-bold text-[10px]">
                Uncertain equation — review
              </span>
            )}
          </div>
          <KatexFormula latex={f.latex} displayMode />
          {f.uncertain && f.uncertaintyReason && (
            <p className="mt-1.5 text-[11px] text-[#92400E]">{f.uncertaintyReason}</p>
          )}
        </div>
      ))}
    </div>
  );
};

const PracticeQuestionCard: React.FC<{ block: StructuredAiBlock }> = ({ block }) => {
  const [showAnswer, setShowAnswer] = useState(false);
  return (
    <div className="rounded-2xl border border-[#1A1B20]/10 bg-white p-4 space-y-3">
      {block.title && (
        <p className="font-display text-xs font-bold uppercase tracking-wider text-[#686C78]">
          {block.title}
        </p>
      )}
      {block.question && <RichInlineText text={block.question} className="text-sm font-semibold text-[#1A1B20]" />}
      {Array.isArray(block.options) && block.options.length > 0 && (
        <ul className="space-y-1.5 text-xs sm:text-sm text-[#3A3D47]">
          {block.options.map((opt, idx) => (
            <li key={idx} className="rounded-xl bg-[#F6F7F9] px-3 py-2">
              {opt}
            </li>
          ))}
        </ul>
      )}
      {block.answer && (
        <div>
          <button
            type="button"
            onClick={() => setShowAnswer((prev) => !prev)}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-[#1D1E23] cursor-pointer underline underline-offset-4"
          >
            <span>{showAnswer ? 'Hide worked solution' : 'Show worked solution'}</span>
            {showAnswer ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          {showAnswer && (
            <div className="mt-2.5 rounded-xl bg-[#1D1E23] text-white p-3.5 space-y-1.5 text-xs sm:text-sm">
              <p className="font-bold">Answer: {block.answer}</p>
              {block.explanation && (
                <RichInlineText text={block.explanation} className="text-xs text-[#C3C7D2]" />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const AcademicBlocksRenderer: React.FC<{
  blocks: StructuredAiBlock[];
}> = ({ blocks }) => {
  return (
    <div className="space-y-4">
      {blocks.map((block, index) => {
        if (block.type === 'math' && block.latex) {
          return (
            <div key={index} className="rounded-2xl border border-[#1A1B20]/10 bg-[#F6F7F9] p-4 space-y-1.5">
              {block.title && (
                <p className="text-xs font-bold text-[#1A1B20]">{block.title}</p>
              )}
              <KatexFormula latex={block.latex} displayMode={block.displayMode ?? true} />
            </div>
          );
        }

        if (block.type === 'steps' && Array.isArray(block.steps)) {
          return (
            <div key={index} className="rounded-2xl border border-[#1A1B20]/10 bg-white p-4 space-y-2.5">
              {block.title && (
                <p className="font-display text-sm font-bold text-[#1A1B20]">{block.title}</p>
              )}
              <ol className="space-y-2">
                {block.steps.map((step, sIdx) => (
                  <li key={sIdx} className="flex items-start gap-2.5">
                    <span className="h-6 w-6 rounded-full bg-[#1D1E23] text-white text-[11px] font-mono-tabular font-bold flex items-center justify-center shrink-0">
                      {sIdx + 1}
                    </span>
                    <RichInlineText text={step} className="text-xs sm:text-sm text-[#3A3D47] flex-1" />
                  </li>
                ))}
              </ol>
            </div>
          );
        }

        if (block.type === 'table' && Array.isArray(block.headers) && Array.isArray(block.rows)) {
          return (
            <ExtractedTableCard
              key={index}
              table={{ caption: block.title, headers: block.headers, rows: block.rows }}
            />
          );
        }

        if (block.type === 'chart' && Array.isArray(block.chartSeries)) {
          return (
            <div key={index} className="space-y-1.5">
              {block.title && (
                <p className="font-display text-sm font-bold text-[#1A1B20]">{block.title}</p>
              )}
              <StructuredChartSvg
                kind={block.chartKind ?? 'bar'}
                series={block.chartSeries}
              />
            </div>
          );
        }

        if (block.type === 'diagram' && block.diagramPreset) {
          return (
            <div key={index} className="space-y-1.5">
              {block.title && (
                <p className="font-display text-sm font-bold text-[#1A1B20]">{block.title}</p>
              )}
              <SchematicDiagramSvg
                preset={block.diagramPreset}
                caption={block.diagramCaption}
              />
            </div>
          );
        }

        if (block.type === 'practice_question') {
          return <PracticeQuestionCard key={index} block={block} />;
        }

        return (
          <div key={index} className="rounded-2xl border border-[#1A1B20]/10 bg-white p-4 space-y-1.5">
            {block.title && (
              <p className="font-display text-sm font-bold text-[#1A1B20]">{block.title}</p>
            )}
            {block.text && <RichInlineText text={block.text} />}
          </div>
        );
      })}
    </div>
  );
};

function parseOrganizedTableRow(rawLine: string): { kind: 'pipe' | 'tab' | null; cells: string[] } {
  const trimmed = rawLine.trim();
  if (!trimmed) return { kind: null, cells: [] };
  if (/^[+|┌┐└┘├┤┬┴┼─═\-_=.\s]+$/.test(trimmed) && /[-─═_|+]/.test(trimmed)) {
    return { kind: null, cells: [] };
  }
  const normalizedPipes = trimmed.replace(/[│┃]/g, '|');
  if (normalizedPipes.includes('|')) {
    const rawCells = normalizedPipes
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
    const looksPipeRow =
      (normalizedPipes.startsWith('|') && normalizedPipes.includes('|', 1) && rawCells.length >= 2) ||
      rawCells.length >= 3;
    if (looksPipeRow) {
      return { kind: 'pipe', cells: rawCells };
    }
  }
  if (trimmed.includes('\t')) {
    const tabCells = trimmed.split('\t').map((c) => c.trim());
    if (tabCells.length >= 2) {
      return { kind: 'tab', cells: tabCells };
    }
  }
  return { kind: null, cells: [] };
}

function isMarkdownDividerCells(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.trim()));
}

function isHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 95) return false;
  if (/^#{1,3}\s+/.test(trimmed)) return true;
  if (/^(?:SECTION|PART|QUESTION)\s+[A-Z0-9IVX]+\b/i.test(trimmed)) return true;
  if (/^(?:FIRST|SECOND|THIRD)\s+SEMESTER\b/i.test(trimmed)) return true;
  if (/^(?:UNIVERSITY|COLLEGE|FACULTY|DEPARTMENT)\s+OF\b/i.test(trimmed)) return true;
  if (/^COURSE\s+CODE\s*:/i.test(trimmed)) return true;
  if (
    trimmed.length >= 5 &&
    trimmed.length <= 72 &&
    trimmed === trimmed.toUpperCase() &&
    /[A-Z]{3,}/.test(trimmed) &&
    !/[=.]$/.test(trimmed)
  ) {
    return true;
  }
  return false;
}

type OrganizedBlock =
  | { type: 'heading'; text: string }
  | { type: 'table'; caption?: string; headers: string[]; rows: string[][] }
  | { type: 'question'; label: string; body: string }
  | { type: 'option'; label: string; body: string }
  | { type: 'paragraph'; text: string };

export const OrganizedPageText: React.FC<{ text: string }> = ({ text }) => {
  const lines = text.split(/\r?\n/);
  const blocks: OrganizedBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // 1. Box rule lines used purely as visual borders around tables
    if (/^[+|┌┐└┘├┤┬┴┼─═\-_=.\s]+$/.test(trimmed) && /[-─═_|+]/.test(trimmed)) {
      i += 1;
      continue;
    }

    // 2. Inline pipe or tab-aligned tables
    const parsedRow = parseOrganizedTableRow(trimmed);
    if (parsedRow.kind) {
      const collectedRows: string[][] = [];
      let look = i;
      while (look < lines.length) {
        const lt = lines[look].trim();
        if (!lt) break;
        if (/^[+|┌┐└┘├┤┬┴┼─═\-_=.\s]+$/.test(lt) && /[-─═_|+]/.test(lt)) {
          look += 1;
          continue;
        }
        const nextRow = parseOrganizedTableRow(lt);
        if (nextRow.kind !== parsedRow.kind) break;
        if (isMarkdownDividerCells(nextRow.cells)) {
          look += 1;
          continue;
        }
        collectedRows.push(nextRow.cells);
        look += 1;
      }

      if (collectedRows.length >= 2) {
        const colCount = Math.max(...collectedRows.map((r) => r.length));
        const normalized = collectedRows.map((r) => {
          const copy = [...r];
          while (copy.length < colCount) copy.push('');
          return copy.slice(0, colCount);
        });

        let caption: string | undefined;
        const prevBlock = blocks[blocks.length - 1];
        if (
          prevBlock &&
          (prevBlock.type === 'paragraph' || prevBlock.type === 'heading') &&
          /^(?:table|tab\.?)\s*\d*[:.\-–\s]/i.test(prevBlock.text)
        ) {
          caption = prevBlock.text;
          blocks.pop();
        }

        blocks.push({
          type: 'table',
          caption,
          headers: normalized[0],
          rows: normalized.slice(1),
        });
        i = look;
        continue;
      }
    }

    // 3. Headings
    if (isHeadingLine(trimmed)) {
      blocks.push({
        type: 'heading',
        text: trimmed.replace(/^#{1,3}\s+/, ''),
      });
      i += 1;
      continue;
    }

    // 4. Numbered questions (e.g., "1. ...", "Q2. ...", "1) ...")
    const qMatch = trimmed.match(/^((?:Q(?:uestion)?\s*)?\d+[.)])\s+(.+)$/i);
    if (qMatch) {
      blocks.push({
        type: 'question',
        label: qMatch[1],
        body: qMatch[2],
      });
      i += 1;
      continue;
    }

    // 5. Sub-questions & options (e.g., "(a) ...", "a) ...", "A. ...", "(ii) ...")
    const optMatch = trimmed.match(/^(\([a-z0-9]{1,4}\)|[A-Ea-e][.)])\s+(.+)$/);
    if (optMatch) {
      blocks.push({
        type: 'option',
        label: optMatch[1],
        body: optMatch[2],
      });
      i += 1;
      continue;
    }

    // 6. Regular paragraph lines grouped until blank line or structural break
    const paraLines: string[] = [trimmed];
    let pLook = i + 1;
    while (pLook < lines.length) {
      const nextTrim = lines[pLook].trim();
      if (!nextTrim) break;
      if (parseOrganizedTableRow(nextTrim).kind) break;
      if (isHeadingLine(nextTrim)) break;
      if (/^((?:Q(?:uestion)?\s*)?\d+[.)])\s+/i.test(nextTrim)) break;
      if (/^(\([a-z0-9]{1,4}\)|[A-Ea-e][.)])\s+/.test(nextTrim)) break;
      paraLines.push(nextTrim);
      pLook += 1;
    }
    blocks.push({
      type: 'paragraph',
      text: paraLines.join('\n'),
    });
    i = pLook;
  }

  return (
    <div className="space-y-2.5 text-xs sm:text-sm leading-relaxed text-[#3A3D47]">
      {blocks.map((blk, idx) => {
        if (blk.type === 'heading') {
          return (
            <h4
              key={idx}
              className="font-display text-xs sm:text-sm font-bold text-[#1A1B20] pt-1 border-b border-[#1A1B20]/[0.06] pb-1"
            >
              {blk.text}
            </h4>
          );
        }
        if (blk.type === 'table') {
          return (
            <div key={idx} className="my-1">
              <ExtractedTableCard
                table={{ caption: blk.caption, headers: blk.headers, rows: blk.rows }}
              />
            </div>
          );
        }
        if (blk.type === 'question') {
          return (
            <div
              key={idx}
              className="flex items-start gap-2 pt-1 text-[#1A1B20]"
            >
              <span className="font-mono-tabular font-bold text-[#1D1E23] shrink-0">
                {blk.label}
              </span>
              <RichInlineText text={blk.body} className="flex-1 text-xs sm:text-sm font-medium text-[#1A1B20] leading-relaxed" />
            </div>
          );
        }
        if (blk.type === 'option') {
          return (
            <div
              key={idx}
              className="flex items-start gap-2 pl-4 sm:pl-5 text-[#3A3D47]"
            >
              <span className="font-mono-tabular font-semibold text-[#505460] shrink-0">
                {blk.label}
              </span>
              <RichInlineText text={blk.body} className="flex-1 text-xs sm:text-sm text-[#3A3D47] leading-relaxed" />
            </div>
          );
        }
        return (
          <RichInlineText
            key={idx}
            text={blk.text}
            className="text-xs sm:text-sm leading-relaxed text-[#3A3D47]"
          />
        );
      })}
    </div>
  );
};

function blockAlignClass(alignment?: ReconstructedBlock['alignment']): string {
  if (alignment === 'center') return 'text-center';
  if (alignment === 'right') return 'text-right';
  return 'text-left';
}

function blockIndentClass(indentLevel?: number): string {
  if (!indentLevel || indentLevel <= 0) return '';
  if (indentLevel === 1) return 'pl-4 sm:pl-6';
  return 'pl-8 sm:pl-10';
}

export const ReconstructedPageFlow: React.FC<{
  page: ExtractedPageContent;
  variant?: 'admin' | 'student';
  searchQuery?: string;
  renderQuestionAction?: (
    questionText: string,
    questionLabel: string | undefined,
    blockIndex: number
  ) => React.ReactNode;
  showPageHeaderFooter?: boolean;
}> = ({
  page,
  variant = 'student',
  searchQuery = '',
  renderQuestionAction,
  showPageHeaderFooter = true,
}) => {
  const blocks: ReconstructedBlock[] =
    page.blocks && page.blocks.length > 0
      ? page.blocks
      : buildBlocksFromStructuredText({
          pageNumber: page.pageNumber,
          text: page.text,
          tables: page.tables,
          formulas: page.formulas,
          diagrams: page.diagrams,
          headerLines: page.headerLines,
          footerLines: page.footerLines,
        });

  if (blocks.length === 0) {
    return (
      <p className="text-xs sm:text-sm text-[#686C78]">
        No readable content was extracted from this page.
      </p>
    );
  }

  const normalizedQuery = searchQuery.trim().toLowerCase();

  return (
    <div className="space-y-3 text-sm leading-relaxed text-[#2D303A]">
      {blocks.map((block, idx) => {
        const isSearchHit =
          Boolean(normalizedQuery) &&
          Boolean(
            (block.text && block.text.toLowerCase().includes(normalizedQuery)) ||
              (block.latex && block.latex.toLowerCase().includes(normalizedQuery)) ||
              (block.table &&
                (block.table.caption?.toLowerCase().includes(normalizedQuery) ||
                  block.table.headers.some((h) => h.toLowerCase().includes(normalizedQuery)) ||
                  block.table.rows.some((r) => r.some((c) => c.toLowerCase().includes(normalizedQuery)))))
          );

        const searchRingCls = isSearchHit
          ? 'ring-2 ring-[#F59E0B]/40 bg-[#FEF3C7]/25 rounded-lg px-2 py-1 -mx-2'
          : '';

        if (block.kind === 'header') {
          if (!showPageHeaderFooter || !block.text) return null;
          return (
            <div
              key={block.id || idx}
              className={`border-b border-[#1A1B20]/[0.08] pb-1.5 text-[11px] font-semibold tracking-wide text-[#686C78] ${blockAlignClass(
                block.alignment ?? 'center'
              )}`}
            >
              {block.text}
            </div>
          );
        }

        if (block.kind === 'footer') {
          if (!showPageHeaderFooter || !block.text) return null;
          return (
            <div
              key={block.id || idx}
              className={`border-t border-[#1A1B20]/[0.08] pt-1.5 text-[11px] text-[#686C78] ${blockAlignClass(
                block.alignment ?? 'center'
              )}`}
            >
              {block.text}
            </div>
          );
        }

        if (block.kind === 'heading' && block.text) {
          const level = block.headingLevel ?? 2;
          return (
            <h3
              key={block.id || idx}
              className={`font-display text-[#1A1B20] pt-1.5 ${blockAlignClass(block.alignment)} ${
                level === 1
                  ? 'text-base sm:text-lg font-extrabold tracking-tight'
                  : 'text-sm sm:text-base font-bold'
              } ${searchRingCls}`}
            >
              <RichInlineText
                text={block.text}
                className={
                  level === 1
                    ? 'text-base sm:text-lg font-extrabold text-[#1A1B20]'
                    : 'text-sm sm:text-base font-bold text-[#1A1B20]'
                }
              />
            </h3>
          );
        }

        if (block.kind === 'subheading' && block.text) {
          return (
            <h4
              key={block.id || idx}
              className={`font-display text-xs sm:text-sm font-bold text-[#1A1B20] pt-1 ${blockAlignClass(
                block.alignment
              )} ${blockIndentClass(block.indentLevel)} ${searchRingCls}`}
            >
              <RichInlineText text={block.text} className="text-xs sm:text-sm font-bold text-[#1A1B20]" />
            </h4>
          );
        }

        if (block.kind === 'table' && block.table) {
          return (
            <div key={block.id || idx} className={`my-2 ${searchRingCls}`}>
              <ExtractedTableCard table={block.table} variant={variant} />
            </div>
          );
        }

        if (block.kind === 'formula' && (block.latex || block.text)) {
          return (
            <div
              key={block.id || idx}
              className={`my-2 rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/[0.08] px-3.5 py-2.5 overflow-x-auto ${searchRingCls}`}
            >
              <KatexFormula
                latex={block.latex || block.text || ''}
                displayMode={block.displayMode ?? true}
              />
              {variant === 'admin' && block.uncertain && block.uncertainReason && (
                <p className="mt-1 text-[10px] text-[#92400E] font-medium">
                  {block.uncertainReason}
                </p>
              )}
            </div>
          );
        }

        if (block.kind === 'diagram' && block.diagram) {
          return (
            <div key={block.id || idx} className={`my-2 ${searchRingCls}`}>
              <DiagramFigureBlock diag={block.diagram} variant={variant} />
            </div>
          );
        }

        if (block.kind === 'question' && block.text) {
          const actionNode = renderQuestionAction?.(block.text, block.label, idx);
          return (
            <div
              key={block.id || idx}
              className={`pt-1.5 ${blockIndentClass(block.indentLevel)} ${searchRingCls}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-start gap-2.5 flex-1 min-w-0">
                  {block.label && (
                    <span className="font-mono-tabular font-bold text-[#1A1B20] shrink-0 text-sm leading-relaxed">
                      {block.label}
                    </span>
                  )}
                  <div className="flex-1 min-w-0">
                    <RichInlineText
                      text={block.text}
                      className="text-sm font-medium text-[#1A1B20] leading-relaxed"
                    />
                    {variant === 'admin' && block.uncertain && block.uncertainReason && (
                      <p className="mt-0.5 text-[10px] text-[#92400E]">{block.uncertainReason}</p>
                    )}
                  </div>
                </div>
                {actionNode && <div className="shrink-0">{actionNode}</div>}
              </div>
            </div>
          );
        }

        if (block.kind === 'subquestion' && block.text) {
          return (
            <div
              key={block.id || idx}
              className={`flex items-start gap-2 ${blockIndentClass(
                block.indentLevel ?? 1
              )} text-[#3A3D47] ${searchRingCls}`}
            >
              {block.label && (
                <span className="font-mono-tabular font-semibold text-[#505460] shrink-0 text-xs sm:text-sm leading-relaxed">
                  {block.label}
                </span>
              )}
              <div className="flex-1 min-w-0">
                <RichInlineText text={block.text} className="text-xs sm:text-sm text-[#3A3D47] leading-relaxed" />
              </div>
            </div>
          );
        }

        if (block.kind === 'uncertain' && block.text) {
          if (variant === 'student') {
            return (
              <div
                key={block.id || idx}
                className={`${blockIndentClass(block.indentLevel)} ${blockAlignClass(
                  block.alignment
                )} ${searchRingCls}`}
              >
                <RichInlineText text={block.text} className="text-sm leading-relaxed text-[#3A3D47]" />
              </div>
            );
          }
          return (
            <div
              key={block.id || idx}
              className={`rounded-lg border border-[#FDE68A] bg-[#FEF3C7]/40 px-2.5 py-1.5 ${blockIndentClass(
                block.indentLevel
              )} ${searchRingCls}`}
            >
              <RichInlineText text={block.text} className="text-sm leading-relaxed text-[#1A1B20]" />
              {block.uncertainReason && (
                <p className="mt-0.5 text-[10px] font-semibold text-[#92400E]">
                  {block.uncertainReason}
                </p>
              )}
            </div>
          );
        }

        if (block.text) {
          return (
            <div
              key={block.id || idx}
              className={`${blockIndentClass(block.indentLevel)} ${blockAlignClass(
                block.alignment
              )} ${searchRingCls}`}
            >
              <RichInlineText
                text={block.text}
                className="text-sm leading-relaxed text-[#2D303A]"
              />
              {variant === 'admin' && block.uncertain && block.uncertainReason && (
                <p className="mt-0.5 text-[10px] text-[#92400E]">{block.uncertainReason}</p>
              )}
            </div>
          );
        }

        return null;
      })}
    </div>
  );
};

export const ReconstructedDocumentRenderer: React.FC<{
  pages: ExtractedPageContent[];
  variant?: 'admin' | 'student';
  searchQuery?: string;
  renderQuestionAction?: (
    questionText: string,
    questionLabel: string | undefined,
    blockIndex: number,
    pageNumber: number
  ) => React.ReactNode;
}> = ({ pages, variant = 'student', searchQuery = '', renderQuestionAction }) => {
  const orderedPages = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  if (orderedPages.length === 0) return null;

  return (
    <div className="space-y-6">
      {orderedPages.map((pg, idx) => (
        <section
          key={pg.pageNumber}
          className={
            idx > 0
              ? 'pt-5 border-t-2 border-dashed border-[#1A1B20]/12 space-y-3'
              : 'space-y-3'
          }
        >
          {orderedPages.length > 1 && (
            <div className="flex items-center justify-between text-[11px] font-mono-tabular font-semibold uppercase tracking-wider text-[#686C78]">
              <span>Page {pg.pageNumber} of {orderedPages.length}</span>
            </div>
          )}
          <ReconstructedPageFlow
            page={pg}
            variant={variant}
            searchQuery={searchQuery}
            renderQuestionAction={
              renderQuestionAction
                ? (qText, qLabel, blockIdx) =>
                    renderQuestionAction(qText, qLabel, blockIdx, pg.pageNumber)
                : undefined
            }
          />
        </section>
      ))}
    </div>
  );
};

/** The scanned page image for a page, if there is one. */
export function pageImageUrl(page: ExtractedPageContent, fallback?: string): string | undefined {
  const fromDiagram = page.diagrams.find((d) => d.id.startsWith('scan-sheet'))?.dataUrl;
  return sanitizeSafeUrl(page.renderedPreviewUrl ?? fromDiagram ?? fallback) || undefined;
}

/**
 * One page: the original scanned page on the left, the reconstructed document in
 * original reading order on the right (stacked on small screens).
 */
export const ScannedPageSideBySide: React.FC<{
  page: ExtractedPageContent;
  imageUrl?: string;
  fallbackImageUrl?: string;
  totalPages?: number;
  /** Engine, perspective and uncertain-span details. Super Admin only. */
  showTechnical?: boolean;
  onOpenOriginalFile?: () => void;
}> = ({
  page,
  imageUrl,
  fallbackImageUrl,
  totalPages,
  showTechnical = false,
  onOpenOriginalFile,
}) => {
  const resolvedImageUrl = imageUrl ?? pageImageUrl(page, fallbackImageUrl);
  const text = page.text.trim();
  const charCount = page.charCount ?? text.replace(/\s+/g, '').length;
  const methodLabel =
    page.extractionMethod === 'hybrid_native_plus_ocr'
      ? 'Native + OCR'
      : page.extractionMethod === 'ocr' || page.ocrApplied
        ? `OCR${page.ocrConfidence !== null ? ` ${page.ocrConfidence}%` : ''}`
        : page.extractionMethod === 'docx_xml'
          ? 'DOCX'
          : page.extractionMethod === 'plain_text'
            ? 'Text'
            : 'Native PDF';
  const engineBadge = !showTechnical
    ? null
    : page.ocrEngineUsed === 'surya'
      ? 'Surya Layout OCR'
      : page.ocrEngineUsed === 'hybrid_surya_tesseract'
        ? 'Hybrid Surya + Tesseract'
        : page.ocrEngineUsed === 'hybrid_tesseract_vision'
          ? 'Hybrid Tesseract + Vision'
          : page.ocrEngineUsed === 'vision'
            ? 'Vision OCR'
            : null;
  const uncertainSpans = showTechnical ? (page.uncertainSpans ?? []) : [];
  const statusBadge =
    page.processingStatus === 'failed'
      ? 'bg-[#FEE2E2] text-[#B91C1C]'
      : page.processingStatus === 'needs_review'
        ? 'bg-[#FEF3C7] text-[#92400E]'
        : page.processingStatus === 'completed_with_warnings'
          ? 'bg-[#FEF3C7] text-[#92400E]'
          : 'bg-[#DCFCE7] text-[#15803D]';
  const statusText =
    page.processingStatus === 'failed'
      ? 'Failed'
      : page.processingStatus === 'needs_review'
        ? 'Needs review'
        : page.processingStatus === 'completed_with_warnings'
          ? 'Warnings'
          : 'Completed';

  return (
    <div
      className={`grid grid-cols-1 gap-3 items-start ${resolvedImageUrl ? 'md:grid-cols-2' : ''}`}
    >
      {resolvedImageUrl && (
        <figure className="rounded-2xl border border-[#1A1B20]/10 bg-[#F6F7F9] p-3 space-y-2 md:sticky md:top-0">
          <img
            src={resolvedImageUrl}
            alt={`Original page ${page.pageNumber}`}
            referrerPolicy="no-referrer"
            className="w-full max-h-[560px] object-contain rounded-xl bg-white"
          />
          <figcaption className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#505460] font-medium">
            <span>
              Original · Page {page.pageNumber}
              {totalPages && totalPages > 1 ? ` of ${totalPages}` : ''}
              {showTechnical ? ` · ${methodLabel}` : ''}
              {showTechnical && page.perspectiveCorrected ? ' · Perspective rectified' : ''}
            </span>
            {onOpenOriginalFile && (
              <button
                type="button"
                onClick={onOpenOriginalFile}
                className="rounded-lg bg-white border border-[#1A1B20]/10 px-2 py-0.5 text-[11px] font-semibold text-[#1A1B20] hover:bg-[#ECEEF3] cursor-pointer"
              >
                Download Original
              </button>
            )}
          </figcaption>
        </figure>
      )}
      <div className="rounded-2xl border border-[#1A1B20]/10 bg-white p-4 space-y-3 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1A1B20]/[0.06] pb-2">
          <div className="flex items-center gap-2">
            <p className="font-bold text-xs uppercase tracking-wider text-[#686C78]">
              Reconstructed Document · Page {page.pageNumber}
            </p>
            {!resolvedImageUrl && onOpenOriginalFile && (
              <button
                type="button"
                onClick={onOpenOriginalFile}
                className="rounded-lg bg-[#F6F7F9] border border-[#1A1B20]/10 px-2 py-0.5 text-[10px] font-semibold text-[#1A1B20] hover:bg-[#ECEEF3] cursor-pointer"
              >
                Download Original
              </button>
            )}
          </div>
          {showTechnical && (
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-bold">
              <span className="rounded-md bg-[#F6F7F9] px-2 py-0.5 text-[#505460]">
                {methodLabel}
              </span>
              {engineBadge && (
                <span className="rounded-md bg-[#1D1E23] px-2 py-0.5 text-white">
                  {engineBadge}
                </span>
              )}
              {page.perspectiveCorrected && (
                <span className="rounded-md bg-[#F6F7F9] px-2 py-0.5 text-[#1A1B20]">
                  4-pt Rectified
                </span>
              )}
              <span className="rounded-md bg-[#F6F7F9] px-2 py-0.5 text-[#505460] font-mono-tabular">
                {page.wordCount}w · {charCount}c
              </span>
              <span className={`rounded-md px-2 py-0.5 ${statusBadge}`}>{statusText}</span>
            </div>
          )}
        </div>
        {showTechnical && page.warnings.length > 0 && (
          <div className="rounded-xl bg-[#FEF3C7]/60 border border-[#FDE68A] px-2.5 py-1.5 text-[11px] text-[#92400E] space-y-0.5">
            {page.warnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </div>
        )}
        {uncertainSpans.length > 0 && (
          <details className="rounded-xl bg-[#FEF3C7]/45 border border-[#FDE68A] px-2.5 py-2 text-[11px] text-[#78350F]">
            <summary className="font-bold cursor-pointer select-none">
              Uncertain Spans Requiring Review ({uncertainSpans.length})
            </summary>
            <ul className="mt-1.5 space-y-1 border-t border-[#FDE68A]/70 pt-1.5">
              {uncertainSpans.slice(0, 12).map((span, idx) => (
                <li key={idx} className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-mono-tabular font-semibold text-[#1A1B20] break-all">
                    "{span.text}"
                  </span>
                  <span className="text-[10px] text-[#92400E]">
                    {span.confidence}% · {span.reason}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
        {page.errors && page.errors.length > 0 && (
          <div className="rounded-xl bg-[#FEF2F2] border border-[#FECACA] px-2.5 py-1.5 text-[11px] text-[#B91C1C] space-y-0.5">
            {page.errors.map((err, i) => (
              <p key={i}>{err}</p>
            ))}
          </div>
        )}
        <div className="break-words">
          <ReconstructedPageFlow page={page} variant="admin" />
        </div>
      </div>
    </div>
  );
};

const METADATA_FIELD_LABELS: Array<[keyof ExtractedAcademicMetadata, string]> = [
  ['institution', 'Institution'],
  ['faculty', 'Faculty / School'],
  ['department', 'Department'],
  ['courseCode', 'Course Code'],
  ['courseTitle', 'Course Title'],
  ['courseUnit', 'Course Unit'],
  ['academicSession', 'Academic Session'],
  ['semester', 'Semester'],
  ['examinationType', 'Examination Type'],
  ['examinationDate', 'Examination Date'],
  ['examinationDuration', 'Duration'],
  ['totalMarks', 'Total Marks'],
  ['examinerName', 'Examiner / Lecturer'],
  ['instructions', 'Instructions'],
];

export const AcademicMetadataGrid: React.FC<{
  metadata: ExtractedAcademicMetadata;
}> = ({ metadata }) => (
  <div className="rounded-2xl border border-[#1A1B20]/10 bg-white p-4 space-y-3">
    <p className="font-display text-xs font-bold uppercase tracking-wider text-[#686C78]">
      Extracted Academic Metadata (14 Fields)
    </p>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-xs">
      {METADATA_FIELD_LABELS.map(([key, label]) => {
        const field = metadata[key];
        const statusCls =
          field.status === 'extracted'
            ? 'bg-[#DCFCE7] text-[#15803D]'
            : field.status === 'uncertain'
              ? 'bg-[#FEF3C7] text-[#92400E]'
              : 'bg-[#F6F7F9] text-[#686C78]';
        return (
          <div
            key={key}
            className="rounded-xl border border-[#1A1B20]/[0.08] bg-[#F6F7F9]/60 p-2.5 space-y-1"
          >
            <div className="flex items-center justify-between gap-1.5">
              <span className="font-semibold text-[#505460]">{label}</span>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${statusCls}`}>
                {field.status === 'not_found'
                  ? 'Not found'
                  : field.status === 'uncertain'
                    ? 'Uncertain'
                    : field.sourcePage
                      ? `p.${field.sourcePage}`
                      : 'Extracted'}
              </span>
            </div>
            <p className="font-medium text-[#1A1B20] break-words">
              {field.value ?? <span className="text-[#8E93A2] italic">not_found</span>}
            </p>
          </div>
        );
      })}
    </div>
  </div>
);

const DETAILED_CATEGORY_OPTIONS: Array<{ value: DetailedAcademicCategory; label: string }> = [
  { value: 'past_question', label: 'Past Question' },
  { value: 'examination_paper', label: 'Examination Paper' },
  { value: 'answer_sheet', label: 'Answer Sheet / OMR' },
  { value: 'lecture_note', label: 'Lecture Note' },
  { value: 'course_material', label: 'Course Material' },
  { value: 'handout', label: 'Handout' },
  { value: 'assignment', label: 'Assignment / Problem Set' },
  { value: 'study_guide', label: 'Study Guide' },
  { value: 'academic_timetable', label: 'Academic Timetable' },
  { value: 'other_academic_document', label: 'Other Academic Document' },
];

export const DocumentClassificationCard: React.FC<{
  classification: DocumentClassificationResult;
  onOverrideCategory?: (nextCategory: DetailedAcademicCategory) => void;
}> = ({ classification, onOverrideCategory }) => (
  <div className="rounded-2xl border border-[#1A1B20]/10 bg-[#F6F7F9] p-4 space-y-2.5 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <p className="font-display font-bold text-[#1A1B20]">
          Document Classification: {classification.primaryLabel}
        </p>
        <p className="text-[#505460]">
          Confidence {Math.round(classification.confidence * 100)}% · Legacy mapping:{' '}
          <span className="font-mono-tabular">{classification.mappedLegacyCategory}</span>
          {classification.overriddenByAdmin && ' · Overridden by Super Admin'}
        </p>
      </div>
      {classification.uncertain && (
        <span className="rounded bg-[#FEF3C7] text-[#92400E] px-2 py-0.5 font-bold text-[11px]">
          Low confidence — confirm category
        </span>
      )}
    </div>
    <p className="text-[#3A3D47]">{classification.reason}</p>
    {classification.candidates.length > 1 && (
      <div className="flex flex-wrap gap-1.5">
        {classification.candidates.slice(0, 4).map((c) => (
          <span
            key={c.category}
            className="rounded-lg bg-white border border-[#1A1B20]/10 px-2 py-1 text-[11px] text-[#505460]"
          >
            {c.label}: {Math.round(c.score * 100)}%
          </span>
        ))}
      </div>
    )}
    {onOverrideCategory && (
      <div className="pt-1 flex flex-wrap items-center gap-2">
        <label htmlFor="cls-override-select" className="font-semibold text-[#1A1B20]">
          Super Admin Override:
        </label>
        <select
          id="cls-override-select"
          value={classification.primaryCategory}
          onChange={(e) => onOverrideCategory(e.target.value as DetailedAcademicCategory)}
          className="rounded-xl border border-[#1A1B20]/15 bg-white px-2.5 py-1.5 text-xs text-[#1A1B20]"
        >
          {DETAILED_CATEGORY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    )}
  </div>
);

export const IntegrityQualityBanner: React.FC<{
  integrityReport?: DocumentIntegrityReport;
  pages?: ExtractedPageContent[];
}> = ({ integrityReport, pages }) => {
  const qualityWarnings = Array.from(
    new Set((pages ?? []).flatMap((p) => p.qualityMetrics?.actionableWarnings ?? []))
  );
  const issues: string[] = [...(integrityReport?.warnings ?? []), ...qualityWarnings];
  if (!integrityReport && issues.length === 0) return null;

  const isHealthy = (integrityReport?.isComplete ?? true) && issues.length === 0;
  return (
    <div
      className={`rounded-2xl border p-3.5 text-xs space-y-1.5 ${
        isHealthy
          ? 'bg-[#DCFCE7]/50 border-[#86EFAC] text-[#15803D]'
          : 'bg-[#FEF3C7]/60 border-[#FDE68A] text-[#92400E]'
      }`}
    >
      <p className="font-bold">
        {isHealthy
          ? 'Page Sequence & Scan Quality Audit: Complete'
          : 'Page Sequence & Quality Inspection Notices'}
      </p>
      {integrityReport && (
        <p className="text-[11px]">
          {integrityReport.hasDuplicatePages ? 'Duplicate pages detected · ' : ''}
          {integrityReport.missingPageNumbers.length > 0
            ? `Missing printed pages: ${integrityReport.missingPageNumbers.join(', ')} · `
            : ''}
          {integrityReport.outOfOrderDetected ? 'Out-of-order numbering detected · ' : ''}
          {integrityReport.blankPages.length > 0
            ? `Blank pages: ${integrityReport.blankPages.join(', ')} · `
            : ''}
          {integrityReport.incompleteOrCroppedPages.length > 0
            ? `Cropped/incomplete pages: ${integrityReport.incompleteOrCroppedPages.join(', ')} · `
            : ''}
          {integrityReport.damagedOrCorruptedPages.length > 0
            ? `Damaged/faded pages: ${integrityReport.damagedOrCorruptedPages.join(', ')}`
            : ''}
        </p>
      )}
      {issues.length > 0 && (
        <ul className="list-disc pl-4 space-y-0.5">
          {issues.slice(0, 6).map((w, idx) => (
            <li key={idx}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
};

export const HandwritingReviewCard: React.FC<{
  handwriting: HandwritingAnalysisResult;
}> = ({ handwriting }) => {
  if (!handwriting.detected && !handwriting.missingModelNote) return null;
  return (
    <div className="rounded-2xl border border-[#1A1B20]/10 bg-white p-4 space-y-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-display font-bold text-[#1A1B20]">
          Handwriting Detection (HTR) · {handwriting.regions.length} region(s)
        </p>
        <span className="rounded bg-[#FEF3C7] text-[#92400E] px-2 py-0.5 text-[10px] font-bold">
          {handwriting.unreadableCount} unreadable · {handwriting.uncertainCount} uncertain
        </span>
      </div>
      {handwriting.missingModelNote && (
        <p className="rounded-xl bg-[#FEF3C7]/50 border border-[#FDE68A] px-2.5 py-1.5 text-[11px] text-[#92400E]">
          {handwriting.missingModelNote}
        </p>
      )}
      {handwriting.regions.slice(0, 8).map((reg) => (
        <div
          key={reg.id}
          className="rounded-xl bg-[#F6F7F9] px-3 py-2 border border-[#1A1B20]/[0.06] space-y-0.5"
        >
          <p className="font-semibold text-[#1A1B20]">
            Page {reg.pageNumber} · {reg.classification}
            {reg.confidence !== null ? ` (${reg.confidence}%)` : ''}
          </p>
          <p className="text-[#3A3D47] font-mono-tabular break-words">{reg.extractedText}</p>
          {reg.note && <p className="text-[11px] text-[#686C78]">{reg.note}</p>}
        </div>
      ))}
    </div>
  );
};

export const OmrResultsCard: React.FC<{ omr: OmrScanResult }> = ({ omr }) => {
  if (!omr.detected) return null;
  return (
    <div className="rounded-2xl border border-[#1A1B20]/10 bg-white p-4 space-y-2.5 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-display font-bold text-[#1A1B20]">
          OMR Bubble Recognition ({omr.templateUsed})
        </p>
        <span className="rounded bg-[#FEF3C7] text-[#92400E] px-2 py-0.5 text-[10px] font-bold">
          Review required · No auto-grading
        </span>
      </div>
      <p className="text-[#505460]">
        Total {omr.summary.totalQuestions} · Answered {omr.summary.answered} · Blank{' '}
        {omr.summary.unanswered} · Multi-shaded {omr.summary.multipleSelected} · Ambiguous{' '}
        {omr.summary.ambiguous}
        {omr.studentIdValue ? ` · Detected Student ID: ${omr.studentIdValue}` : ''}
      </p>
      {omr.questions.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-1.5">
          {omr.questions.slice(0, 30).map((q) => (
            <div
              key={`${q.pageNumber}-${q.questionNumber}`}
              className={`rounded-lg border px-2 py-1 text-[11px] font-mono-tabular ${
                q.status === 'answered'
                  ? 'bg-[#F6F7F9] border-[#1A1B20]/10 text-[#1A1B20]'
                  : q.status === 'unanswered'
                    ? 'bg-white border-[#1A1B20]/10 text-[#686C78]'
                    : 'bg-[#FEF3C7] border-[#FDE68A] text-[#92400E]'
              }`}
            >
              Q{q.questionNumber}:{' '}
              <strong>
                {q.selectedOptions.length > 0 ? q.selectedOptions.join(',') : '—'}
              </strong>{' '}
              ({q.status === 'answered' ? `${q.confidence}%` : q.status})
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const FormFieldsCard: React.FC<{ form: FormExtractionResult }> = ({ form }) => {
  if (!form.detected) return null;
  return (
    <div className="rounded-2xl border border-[#1A1B20]/10 bg-white p-4 space-y-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-display font-bold text-[#1A1B20]">
          Form Fields &amp; Checkboxes ({form.totalFields})
        </p>
        {form.isIncompleteForm && (
          <span className="rounded bg-[#FEF3C7] text-[#92400E] px-2 py-0.5 text-[10px] font-bold">
            Incomplete / {form.unfilledCount} unfilled
          </span>
        )}
      </div>
      <div className="space-y-1">
        {form.fields.slice(0, 20).map((f) => (
          <div
            key={f.id}
            className="flex items-center justify-between gap-2 rounded-lg bg-[#F6F7F9] px-2.5 py-1.5"
          >
            <span className="font-medium text-[#1A1B20] truncate">
              [{f.kind}] {f.label}
            </span>
            <span className="font-mono-tabular text-[#505460] shrink-0">
              {f.kind === 'text_field'
                ? f.value || 'unfilled'
                : f.checked
                  ? 'Checked'
                  : f.status === 'ambiguous'
                    ? 'Ambiguous'
                    : 'Unchecked'}{' '}
              ({f.confidence}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const SignaturesStampsCard: React.FC<{
  signatures?: SignatureDetection[];
  stamps?: StampDetection[];
}> = ({ signatures, stamps }) => {
  if ((!signatures || signatures.length === 0) && (!stamps || stamps.length === 0)) return null;
  return (
    <div className="rounded-2xl border border-[#1A1B20]/10 bg-white p-4 space-y-2 text-xs">
      <p className="font-display font-bold text-[#1A1B20]">
        Signature Presence &amp; Official Stamp Detection
      </p>
      <p className="text-[11px] text-[#686C78]">
        Presence &amp; visual outline detection only — does not verify biometric handwriting identity or legal authenticity.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {(signatures ?? []).map((sig) => (
          <div key={sig.id} className="rounded-xl bg-[#F6F7F9] p-2.5">
            <p className="font-semibold text-[#1A1B20]">
              Signature · Page {sig.pageNumber} ({sig.status} · {sig.confidence}%)
            </p>
            <p className="text-[11px] text-[#505460]">{sig.note}</p>
          </div>
        ))}
        {(stamps ?? []).map((st) => (
          <div key={st.id} className="rounded-xl bg-[#F6F7F9] p-2.5">
            <p className="font-semibold text-[#1A1B20]">
              Stamp ({st.shape}, {st.colorTone}) · Page {st.pageNumber} ({st.confidence}%)
            </p>
            {st.extractedText && <p className="text-[#1A1B20]">Text: {st.extractedText}</p>}
            <p className="text-[11px] text-[#505460]">{st.note}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export const BarcodesQrCard: React.FC<{ codes: QrCodeMatch[] }> = ({ codes }) => {
  if (codes.length === 0) return null;
  return (
    <div className="rounded-2xl border border-[#1A1B20]/10 bg-white p-4 space-y-2 text-xs">
      <p className="font-display font-bold text-[#1A1B20]">
        Detected Barcodes &amp; QR Codes ({codes.length})
      </p>
      <div className="space-y-1.5">
        {codes.map((c, idx) => (
          <div
            key={idx}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#F6F7F9] px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-[#1A1B20] break-all">
                [{c.format ?? 'QR_CODE'}] {c.payload}
              </p>
              {c.warning && <p className="text-[11px] text-[#92400E]">{c.warning}</p>}
            </div>
            <span
              className={`rounded px-2 py-0.5 text-[10px] font-bold shrink-0 ${
                c.unreadableDetected
                  ? 'bg-[#FEE2E2] text-[#B91C1C]'
                  : c.isSafeUrl
                    ? 'bg-[#DCFCE7] text-[#15803D]'
                    : 'bg-[#FEF3C7] text-[#92400E]'
              }`}
            >
              {c.unreadableDetected
                ? 'Damaged / Unreadable'
                : c.isSafeUrl
                  ? 'Safe payload'
                  : 'Blocked / Untrusted URL'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const LanguageAnalysisCard: React.FC<{ language: LanguageAnalysisResult }> = ({
  language,
}) => (
  <div className="rounded-2xl border border-[#1A1B20]/10 bg-[#F6F7F9] p-3.5 text-xs space-y-1.5">
    <p className="font-bold text-[#1A1B20]">
      Detected Language(s): {language.detectedLanguages.map((l) => `${l.name} (${Math.round(l.confidence * 100)}%)`).join(', ')}
    </p>
    <p className="text-[#505460]">
      Installed OCR models: {language.installedOcrModels.join(', ')}
      {language.unsupportedLanguages.length > 0 &&
        ` · Missing models: ${language.unsupportedLanguages.join(', ')}`}
    </p>
  </div>
);

export const ModuleExecutionSummaryCard: React.FC<{
  reports: ScannerModuleRunReport[];
  processingDurationMs?: number;
}> = ({ reports, processingDurationMs }) => {
  if (reports.length === 0) return null;
  return (
    <details className="rounded-2xl border border-[#1A1B20]/10 bg-[#F6F7F9] p-3.5 text-xs">
      <summary className="font-bold text-[#1A1B20] cursor-pointer select-none">
        Scanner Pipeline Module Execution ({reports.length} modules
        {typeof processingDurationMs === 'number' ? ` · ${processingDurationMs} ms` : ''})
      </summary>
      <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {reports.map((rep, idx) => (
          <div
            key={`${rep.module}-${idx}`}
            className="rounded-xl bg-white border border-[#1A1B20]/[0.06] px-2.5 py-1.5 flex items-center justify-between gap-2"
          >
            <div className="min-w-0">
              <p className="font-semibold text-[#1A1B20] truncate">{rep.module}</p>
              {rep.detail && <p className="text-[10px] text-[#686C78] truncate">{rep.detail}</p>}
              {rep.missingRequirement && (
                <p className="text-[10px] text-[#92400E]">{rep.missingRequirement}</p>
              )}
            </div>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold shrink-0 ${
                rep.status === 'executed'
                  ? 'bg-[#DCFCE7] text-[#15803D]'
                  : rep.status === 'failed'
                    ? 'bg-[#FEE2E2] text-[#B91C1C]'
                    : rep.status === 'model_unavailable_partial'
                      ? 'bg-[#FEF3C7] text-[#92400E]'
                      : 'bg-[#F6F7F9] text-[#686C78]'
              }`}
            >
              {rep.status}
            </span>
          </div>
        ))}
      </div>
    </details>
  );
};

export const AcademicStructureSummaryCard: React.FC<{
  structure: NonNullable<AcademicDocumentRecord['academicStructure']>;
}> = ({ structure }) => {
  if (structure.totalDetectedQuestions === 0 && structure.issues.length === 0) return null;
  const warnings = structure.issues.filter((i) => i.severity === 'warning');
  return (
    <div className="rounded-2xl border border-[#1A1B20]/10 bg-white p-4 space-y-2.5 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-display font-bold text-[#1A1B20]">
          Parsed Exam Structure · {structure.totalDetectedQuestions} Question(s)
        </p>
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-bold">
          {structure.continuedQuestionNumbers.length > 0 && (
            <span className="rounded bg-[#EFF1F5] text-[#1A1B20] px-2 py-0.5">
              Stitched cross-page: Q{structure.continuedQuestionNumbers.join(', Q')}
            </span>
          )}
          {warnings.length > 0 ? (
            <span className="rounded bg-[#FEF3C7] text-[#92400E] px-2 py-0.5">
              {warnings.length} consistency warning(s)
            </span>
          ) : (
            <span className="rounded bg-[#DCFCE7] text-[#15803D] px-2 py-0.5">
              Sequence consistent
            </span>
          )}
        </div>
      </div>
      {structure.instructions.length > 0 && (
        <p className="text-[11px] text-[#505460]">
          <strong>Instructions:</strong> {structure.instructions.join(' · ')}
        </p>
      )}
      {warnings.length > 0 && (
        <ul className="rounded-xl bg-[#FEF3C7]/55 border border-[#FDE68A] px-3 py-2 text-[11px] text-[#92400E] list-disc pl-6 space-y-0.5">
          {warnings.slice(0, 6).map((w, idx) => (
            <li key={idx}>{w.message}</li>
          ))}
        </ul>
      )}
      {structure.questions.length > 0 && (
        <div className="space-y-1.5">
          {structure.questions.slice(0, 8).map((q) => (
            <div
              key={q.id}
              className="rounded-xl bg-[#F6F7F9] px-3 py-2 border border-[#1A1B20]/[0.06] space-y-0.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-[#1A1B20]">
                  Q{q.questionNumber}
                  {q.marks ? ` (${q.marks})` : ''}
                  {q.subquestions.length > 0 ? ` · ${q.subquestions.length} subquestion(s)` : ''}
                  {q.options.length > 0 ? ` · ${q.options.length} MCQ options` : ''}
                </span>
                <span className="text-[10px] font-mono-tabular text-[#686C78]">
                  Page {q.pageNumbers.join('–')}
                </span>
              </div>
              <p className="text-[#3A3D47] line-clamp-2">{q.stem || '[No stem text]'}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const SuperAdminIntelligenceSuite: React.FC<{
  doc: Pick<
    AcademicDocumentRecord,
    | 'academicMetadata'
    | 'classification'
    | 'integrityReport'
    | 'academicStructure'
    | 'pages'
    | 'handwritingAnalysis'
    | 'omrResults'
    | 'formResults'
    | 'signatures'
    | 'stamps'
    | 'qrCodesFound'
    | 'languageAnalysis'
    | 'moduleReports'
    | 'processingDurationMs'
  >;
  onOverrideCategory?: (nextCategory: DetailedAcademicCategory) => void;
}> = ({ doc, onOverrideCategory }) => (
  <div className="space-y-3">
    <IntegrityQualityBanner integrityReport={doc.integrityReport} pages={doc.pages} />
    {doc.academicStructure && <AcademicStructureSummaryCard structure={doc.academicStructure} />}
    {doc.classification && (
      <DocumentClassificationCard
        classification={doc.classification}
        onOverrideCategory={onOverrideCategory}
      />
    )}
    {doc.academicMetadata && <AcademicMetadataGrid metadata={doc.academicMetadata} />}
    {doc.omrResults?.detected && <OmrResultsCard omr={doc.omrResults} />}
    {doc.formResults?.detected && <FormFieldsCard form={doc.formResults} />}
    {doc.handwritingAnalysis && <HandwritingReviewCard handwriting={doc.handwritingAnalysis} />}
    <SignaturesStampsCard signatures={doc.signatures} stamps={doc.stamps} />
    {doc.qrCodesFound.length > 0 && <BarcodesQrCard codes={doc.qrCodesFound} />}
    {doc.languageAnalysis && <LanguageAnalysisCard language={doc.languageAnalysis} />}
    {doc.moduleReports && doc.moduleReports.length > 0 && (
      <ModuleExecutionSummaryCard
        reports={doc.moduleReports}
        processingDurationMs={doc.processingDurationMs}
      />
    )}
  </div>
);
