import React from 'react';

interface SurfaceCardProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: 'white' | 'ash' | 'soft';
  interactive?: boolean;
  withWaves?: boolean;
}

const INNER_FLOW_TOKEN =
  /(?:^|:)(?:space-y-|space-x-|flex|inline-flex|grid|grid-cols-|items-|justify-|gap-|divide-)/;

function splitSurfaceClasses(className: string): { outer: string; inner: string } {
  const outerTokens: string[] = [];
  const innerTokens: string[] = [];
  for (const token of className.split(/\s+/).filter(Boolean)) {
    if (INNER_FLOW_TOKEN.test(token)) {
      innerTokens.push(token);
    } else {
      outerTokens.push(token);
    }
  }
  return {
    outer: outerTokens.join(' '),
    inner: innerTokens.join(' '),
  };
}

export const SurfaceCard: React.FC<SurfaceCardProps> = React.memo(
  ({
    tone = 'white',
    interactive = false,
    withWaves = false,
    className = '',
    children,
    ...rest
  }) => {
    const toneClass =
      tone === 'ash'
        ? 'bg-[#1D1E23] text-white shadow-[0_12px_28px_-10px_rgba(24,25,30,0.36)]'
        : tone === 'soft'
        ? 'bg-[#EFF1F5] text-[#1A1B20]'
        : 'surface-elevated border border-[#1A1B20]/[0.06] text-[#1A1B20]';

    const interactiveClass = interactive
      ? 'cursor-pointer transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 active:scale-[0.99]'
      : '';

    const hasWaves = tone === 'ash' && withWaves;

    if (!hasWaves) {
      return (
        <div
          className={`relative rounded-3xl p-5 ${toneClass} ${interactiveClass} ${className}`}
          {...rest}
        >
          {children}
        </div>
      );
    }

    const { outer, inner } = splitSurfaceClasses(className);

    return (
      <div
        className={`relative rounded-3xl p-5 ${toneClass} ${interactiveClass} ${outer}`}
        {...rest}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl"
        >
          <svg
            viewBox="0 0 400 180"
            className="h-full w-full opacity-25"
            preserveAspectRatio="none"
          >
            <path
              d="M-20,130 C70,60 150,165 240,95 C310,40 365,110 420,65"
              fill="none"
              stroke="#525666"
              strokeWidth="1.2"
            />
            <path
              d="M-20,150 C85,80 175,180 265,110 C335,55 380,130 430,85"
              fill="none"
              stroke="#525666"
              strokeWidth="1"
            />
            <path
              d="M-20,170 C95,105 190,190 285,125 C355,75 395,145 440,105"
              fill="none"
              stroke="#525666"
              strokeWidth="0.9"
            />
          </svg>
        </div>
        <div className={`relative z-10 h-full ${inner}`}>{children}</div>
      </div>
    );
  }
);

SurfaceCard.displayName = 'SurfaceCard';
