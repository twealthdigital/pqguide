import React, { useEffect, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { BrandLogo } from '../components/ui/BrandLogo';

interface LoadingScreenProps {
  onComplete: () => void;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({ onComplete }) => {
  const [progress, setProgress] = useState(18);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    if (isPaused) return;

    const timer = window.setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) return 100;
        const step = prev < 55 ? 14 : prev < 88 ? 10 : 6;
        return Math.min(100, prev + step);
      });
    }, 240);

    return () => window.clearInterval(timer);
  }, [isPaused]);

  useEffect(() => {
    if (progress < 100 || isPaused) return;
    const doneTimer = window.setTimeout(() => onComplete(), 420);
    return () => window.clearTimeout(doneTimer);
  }, [progress, isPaused, onComplete]);

  const statusText =
    progress < 45
      ? 'Preparing archive...'
      : progress < 85
      ? 'Loading sessions & semesters...'
      : 'Ready';

  return (
    <div
      className="relative min-h-screen w-full overflow-hidden bg-[#1D1E23] text-white flex flex-col items-center justify-between px-6 py-10 select-none"
      role="status"
      aria-label="Loading application"
    >
      {/* Subtle organic wave texture matching dark ash system */}
      <svg
        aria-hidden="true"
        viewBox="0 0 1200 600"
        className="pointer-events-none absolute inset-0 h-full w-full opacity-25"
        preserveAspectRatio="none"
      >
        <path
          d="M-50,380 C220,210 490,510 780,310 C980,175 1120,340 1260,235"
          fill="none"
          stroke="#464A58"
          strokeWidth="1.4"
        />
        <path
          d="M-50,430 C250,260 520,550 810,350 C1010,215 1140,380 1270,280"
          fill="none"
          stroke="#3A3D49"
          strokeWidth="1.1"
        />
        <path
          d="M-50,480 C280,310 550,590 840,395 C1035,260 1160,425 1280,325"
          fill="none"
          stroke="#31343F"
          strokeWidth="0.9"
        />
      </svg>

      {/* Top Preview Controls */}
      <div className="relative z-10 w-full max-w-4xl flex items-center justify-between text-xs text-[#9FA4B2]">
        <span className="font-mono-tabular">PrepVault · Archive</span>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setIsPaused((p) => !p)}
            className="inline-flex items-center gap-1.5 text-white/85 hover:text-white cursor-pointer"
          >
            {isPaused ? (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>Resume</span>
              </>
            ) : (
              <>
                <Pause className="w-3.5 h-3.5" />
                <span>Hold Screen</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onComplete}
            className="text-white font-semibold underline underline-offset-4 cursor-pointer"
          >
            Next
          </button>
        </div>
      </div>

      {/* Center Brand Emblem & Smooth Progress */}
      <div className="relative z-10 w-full max-w-sm flex flex-col items-center text-center">
        <div className="h-20 w-20 rounded-[26px] bg-gradient-to-b from-[#2E313B] to-[#22242C] border border-white/12 shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_18px_40px_-10px_rgba(0,0,0,0.55)] flex items-center justify-center mb-7">
          <BrandLogo className="w-10 h-10 text-white" strokeWidth={1.9} />
        </div>

        <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-white">
          PrepVault
        </h1>
        <p className="mt-2.5 text-sm text-[#A5AAB8] max-w-xs leading-relaxed">
          University past questions indexed cleanly by session, semester, and course code.
        </p>

        {/* GPU-only scaleX progress bar */}
        <div className="mt-9 w-56 h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full w-full bg-white rounded-full origin-left transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{ transform: `scaleX(${progress / 100})` }}
          />
        </div>

        <div className="mt-3 flex items-center gap-2 text-xs text-[#9FA4B2]">
          <span>{statusText}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono-tabular text-white/90">{progress}%</span>
        </div>
      </div>

      <p className="relative z-10 text-xs text-[#7E8392]">
        Built for fast access on every device
      </p>
    </div>
  );
};
