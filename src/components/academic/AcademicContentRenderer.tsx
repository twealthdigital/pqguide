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
  const visible = diagrams.filter((d) => sanitizeSafeUrl(d.dataUrl));
  if (visible.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {visible.map((diag) => (
        <figure
          key={diag.id}
          className="rounded-2xl border border-[#1A1B20]/10 bg-[#F6F7F9] p-3 space-y-2"
        >
          <img
            src={sanitizeSafeUrl(diag.dataUrl)}
            alt={diag.caption}
            referrerPolicy="no-referrer"
            className="w-full max-h-56 object-contain rounded-xl bg-white"
          />
          <figcaption className="text-xs text-[#505460] font-medium">
            Page {diag.pageNumber} · {diag.caption}
          </figcaption>
        </figure>
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
}> = ({ page, imageUrl, totalPages }) => {
  const resolvedImageUrl = imageUrl || pageImageUrl(page);
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
            {totalPages && totalPages > 1 ? ` of ${totalPages}` : ''} · {methodLabel}
          </figcaption>
        </figure>
      )}
      <div className="rounded-2xl border border-[#1A1B20]/10 bg-white p-3.5 space-y-2 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-bold text-xs uppercase tracking-wider text-[#686C78]">
            Extracted text · Page {page.pageNumber}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-bold">
            <span className="rounded-md bg-[#F6F7F9] px-2 py-0.5 text-[#505460]">
              {methodLabel}
            </span>
            <span className="rounded-md bg-[#F6F7F9] px-2 py-0.5 text-[#505460] font-mono-tabular">
              {page.wordCount}w · {charCount}c
            </span>
            <span className={`rounded-md px-2 py-0.5 ${statusBadge}`}>{statusText}</span>
          </div>
        </div>
        {page.warnings.length > 0 && (
          <div className="rounded-xl bg-[#FEF3C7]/60 border border-[#FDE68A] px-2.5 py-1.5 text-[11px] text-[#92400E] space-y-0.5">
            {page.warnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </div>
        )}
        {page.errors && page.errors.length > 0 && (
          <div className="rounded-xl bg-[#FEF2F2] border border-[#FECACA] px-2.5 py-1.5 text-[11px] text-[#B91C1C] space-y-0.5">
            {page.errors.map((err, i) => (
              <p key={i}>{err}</p>
            ))}
          </div>
        )}
        {text ? (
          <div className="whitespace-pre-wrap break-words">
            <RichInlineText text={text} className="text-xs sm:text-sm leading-relaxed text-[#3A3D47]" />
          </div>
        ) : (
          <p className="text-xs sm:text-sm text-[#686C78]">
            No text could be read from this page.
          </p>
        )}
      </div>
    </div>
  );
};
