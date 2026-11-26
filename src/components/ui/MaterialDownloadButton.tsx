import React, { useEffect, useRef, useState } from 'react';
import { Check, Download, Loader2 } from 'lucide-react';
import type { StudyMaterial } from '../../core/types';
import { downloadMaterialPdf } from '../../services/materialDownload';
import { TooltipBubble } from './TooltipBubble';

interface MaterialDownloadButtonProps {
  material: StudyMaterial;
  /** "soft" sits on a white card, "light" sits on the dark header. */
  tone?: 'soft' | 'light';
  className?: string;
}

type Phase = 'idle' | 'loading' | 'done' | 'error';

/** Icon only button that saves the guide as a PDF for offline reading. */
export const MaterialDownloadButton: React.FC<MaterialDownloadButtonProps> = ({
  material,
  tone = 'soft',
  className = '',
}) => {
  const [phase, setPhase] = useState<Phase>('idle');
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    []
  );

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (phase === 'loading') return;
    setPhase('loading');
    try {
      await downloadMaterialPdf(material);
      setPhase('done');
    } catch {
      setPhase('error');
    }
    timerRef.current = window.setTimeout(() => setPhase('idle'), 1800);
  };

  const label =
    phase === 'loading'
      ? 'Preparing download'
      : phase === 'done'
      ? 'Downloaded'
      : phase === 'error'
      ? 'Download failed, tap to try again'
      : `Download ${material.title} for offline reading`;

  const tooltipLabel =
    phase === 'loading'
      ? 'Preparing PDF...'
      : phase === 'done'
        ? 'PDF saved offline'
        : phase === 'error'
          ? 'Download failed — click to retry'
          : 'Save study guide as PDF';

  const toneClasses =
    tone === 'light'
      ? 'tactile-light text-[#1A1B20] border border-[#1A1B20]/8 hover:bg-[#F7F8FA]'
      : 'bg-[#F6F7F9] text-[#1A1B20] hover:bg-[#ECEEF2]';

  return (
    <TooltipBubble label={tooltipLabel} side="top">
      <button
        type="button"
        onClick={handleClick}
        disabled={phase === 'loading'}
        aria-label={label}
        className={`pointer-events-auto relative z-10 h-10 w-10 shrink-0 rounded-xl flex items-center justify-center cursor-pointer transition-all duration-150 active:scale-95 disabled:cursor-wait ${
          phase === 'error' ? 'text-[#B42318]' : ''
        } ${toneClasses} ${className}`}
      >
        {phase === 'loading' ? (
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
        ) : phase === 'done' ? (
          <Check className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
        ) : (
          <Download className="w-4 h-4" aria-hidden="true" />
        )}
      </button>
    </TooltipBubble>
  );
};
