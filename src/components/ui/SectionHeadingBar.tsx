import React from 'react';

interface SectionHeadingBarProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}

export const SectionHeadingBar: React.FC<SectionHeadingBarProps> = ({
  title,
  subtitle,
  icon,
  right,
  className = '',
}) => {
  return (
    <div
      className={`rounded-2xl bg-[#1D1E23] text-white px-4 py-3.5 shadow-[0_10px_24px_-12px_rgba(18,19,24,0.55)] flex items-center justify-between gap-3 ${className}`}
    >
      <div className="flex items-center gap-3 min-w-0">
        {icon && (
          <span className="h-8 w-8 rounded-xl bg-white/12 text-white flex items-center justify-center shrink-0">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h2 className="font-display text-sm sm:text-base font-bold text-white leading-tight truncate">
            {title}
          </h2>
          {subtitle && (
            <p className="text-[11px] text-[#C3C7D2] mt-0.5 leading-snug truncate">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      {right && <div className="shrink-0 flex items-center gap-2">{right}</div>}
    </div>
  );
};
