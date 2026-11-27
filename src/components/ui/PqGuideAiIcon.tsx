import React from 'react';
import { LogoShapes } from './BrandLogo';

export type PqGuideAiState =
  | 'idle'
  | 'working'
  | 'retrieving'
  | 'generating'
  | 'scanning'
  | 'completed'
  | 'failed';

interface PqGuideAiIconProps {
  state?: PqGuideAiState;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZE_BOX: Record<NonNullable<PqGuideAiIconProps['size']>, string> = {
  xs: 'h-5 w-5',
  sm: 'h-7 w-7',
  md: 'h-9 w-9',
  lg: 'h-12 w-12',
  xl: 'h-16 w-16',
};

const LOGO_WIDTH: Record<NonNullable<PqGuideAiIconProps['size']>, string> = {
  xs: 'w-4',
  sm: 'w-5',
  md: 'w-6',
  lg: 'w-8',
  xl: 'w-11',
};

export const PqGuideAiIcon: React.FC<PqGuideAiIconProps> = ({
  state = 'idle',
  size = 'md',
  className = '',
}) => {
  const isActive =
    state === 'working' ||
    state === 'retrieving' ||
    state === 'generating' ||
    state === 'scanning';

  const statusLabel =
    state === 'working'
      ? 'PQGuide AI working'
      : state === 'retrieving'
        ? 'PQGuide AI searching archive'
        : state === 'generating'
          ? 'PQGuide AI generating study answer'
          : state === 'scanning'
            ? 'PQGuide AI scanning document'
            : state === 'completed'
              ? 'PQGuide AI completed'
              : state === 'failed'
                ? 'PQGuide AI encountered an issue'
                : 'PQGuide AI';

  return (
    <span
      role="img"
      aria-label={statusLabel}
      className={`relative inline-flex items-center justify-center shrink-0 ${SIZE_BOX[size]} ${className}`}
    >
      {isActive && (
        <svg
          aria-hidden="true"
          viewBox="0 0 44 44"
          className="pq-ai-ring-active absolute inset-0 h-full w-full pointer-events-none"
        >
          <circle
            cx="22"
            cy="22"
            r="19"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.88"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="64 42"
          />
        </svg>
      )}
      <svg
        viewBox="146 298 618 287"
        fill="none"
        aria-hidden="true"
        className={`${LOGO_WIDTH[size]} ${isActive ? 'scale-[0.82]' : ''} transition-transform duration-200`}
      >
        <LogoShapes pupilClassName={isActive ? 'pq-ai-pupil-active' : undefined} />
      </svg>
      {state === 'completed' && (
        <span
          aria-hidden="true"
          className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-[#15803D] ring-2 ring-white"
        />
      )}
      {state === 'failed' && (
        <span
          aria-hidden="true"
          className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-[#B91C1C] ring-2 ring-white"
        />
      )}
    </span>
  );
};
