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
  ExtractedDiagramAsset,
  ExtractedFormula,
  ExtractedPageContent,
  ExtractedTable,
} from '../../core/types';

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

export const ExtractedTableCard: React.FC<{ table: Pick<ExtractedTable, 'caption' | 'headers' | 'rows'> }> = ({
  table,
}) => (
  <div className="rounded-2xl border border-[#1A1B20]/10 bg-white overflow-hidden">
    {table.caption && (
      <div className="px-3.5 py-2 bg-[#F6F7F9] border-b border-[#1A1B20]/[0.07] text-xs font-bold text-[#1A1B20]">
        {table.caption}
      </div>
    )}
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse text-xs sm:text-sm">
        <thead>
          <tr className="bg-[#1D1E23] text-white">
            {table.headers.map((h, i) => (
              <th key={i} className="px-3 py-2 font-semibold whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rIdx) => (
            <tr key={rIdx} className="border-t border-[#1A1B20]/[0.06] odd:bg-white even:bg-[#F6F7F9]/60">
              {row.map((cell, cIdx) => (
                <td key={cIdx} className="px-3 py-2 text-[#3A3D47]">
                  <RichInlineText text={cell} className="text-xs sm:text-sm" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

export const ExtractedDiagramsGallery: React.FC<{
  diagrams: ExtractedDiagramAsset[];
}> = ({ diagrams }) => {
  const visible = diagrams.filter(
    (d) => Boolean(d.vectorScene && d.vectorScene.polylines.length > 0) || Boolean(sanitizeSafeUrl(d.dataUrl))
  );
  if (visible.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {visible.map((diag) => {
        const safeUrl = sanitizeSafeUrl(diag.dataUrl);
        return (
          <figure
            key={diag.id}
            className="rounded-2xl border border-[#1A1B20]/10 bg-[#F6F7F9] p-3 space-y-2"
          >
            {diag.vectorScene && diag.vectorScene.polylines.length > 0 ? (
              <VectorSceneSvg scene={diag.vectorScene} caption={diag.caption} />
            ) : safeUrl ? (
              <img
                src={safeUrl}
                alt={diag.caption}
                referrerPolicy="no-referrer"
                className="w-full max-h-56 object-contain rounded-xl bg-white"
              />
            ) : null}
            <figcaption className="text-xs text-[#505460] font-medium">
              Page {diag.pageNumber} · {diag.caption}
            </figcaption>
          </figure>
        );
      })}
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
          <div className="flex items-center justify-between text-[11px] font-mono-tabular text-[#686C78] mb-1">
            <span>Formula · Page {f.pageNumber}</span>
          </div>
          <KatexFormula latex={f.latex} displayMode />
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

/** The scanned page image for a page, if there is one. */
export function pageImageUrl(page: ExtractedPageContent, fallback?: string): string | undefined {
  const fromDiagram = page.diagrams.find((d) => d.id.startsWith('scan-sheet'))?.dataUrl;
  return sanitizeSafeUrl(page.renderedPreviewUrl ?? fromDiagram ?? fallback) || undefined;
}

/**
 * One page: the scanned image on the left, everything that was read from it on the
 * right (stacked on small screens). Pages with no image use the full width.
 */
export const ScannedPageSideBySide: React.FC<{
  page: ExtractedPageContent;
  imageUrl?: string;
  totalPages?: number;
  /** Engine, perspective and uncertain-span details. Super Admin only. */
  showTechnical?: boolean;
}> = ({ page, imageUrl, totalPages, showTechnical = false }) => {
  // The image is shown only when the caller passes one (the Extracted view is text only).
  const resolvedImageUrl = imageUrl;
  const text = page.text.trim();
  const charCount = page.charCount ?? text.replace(/\s+/g, '').length;
  const pageExtractedDiagrams = page.diagrams.filter(
    (d) =>
      !d.id.startsWith('scan-sheet') &&
      (Boolean(d.vectorScene && d.vectorScene.polylines.length > 0) || Boolean(sanitizeSafeUrl(d.dataUrl)))
  );
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
    :
    page.ocrEngineUsed === 'hybrid_tesseract_vision'
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
            alt={`Scanned page ${page.pageNumber}`}
            referrerPolicy="no-referrer"
            className="w-full max-h-[560px] object-contain rounded-xl bg-white"
          />
          <figcaption className="text-xs text-[#505460] font-medium">
            Page {page.pageNumber}
            {totalPages && totalPages > 1 ? ` of ${totalPages}` : ''} · {showTechnical ? methodLabel : 'Scanned page'}
            {showTechnical && page.perspectiveCorrected ? ' · Perspective rectified' : ''}
          </figcaption>
        </figure>
      )}
      <div className="rounded-2xl border border-[#1A1B20]/10 bg-white p-3.5 space-y-3 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-bold text-xs uppercase tracking-wider text-[#686C78]">
            Extracted content · Page {page.pageNumber}
          </p>
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
            {showTechnical && page.perspectiveCorrected && (
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
        {text ? (
          <div className="break-words">
            <OrganizedPageText text={text} />
          </div>
        ) : (
          <p className="text-xs sm:text-sm text-[#686C78]">
            No text could be read from this page.
          </p>
        )}
        {pageExtractedDiagrams.length > 0 && (
          <div className="pt-2 border-t border-[#1A1B20]/[0.07] space-y-2">
            <p className="font-bold text-[11px] uppercase tracking-wider text-[#686C78]">
              Drawn Figures &amp; Diagrams · Page {page.pageNumber}
            </p>
            <ExtractedDiagramsGallery diagrams={pageExtractedDiagrams} />
          </div>
        )}
      </div>
    </div>
  );
};
