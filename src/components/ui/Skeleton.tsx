import React from 'react';

interface SkeletonBoxProps {
  className?: string;
}

export const SkeletonBox: React.FC<SkeletonBoxProps> = ({ className = '' }) => (
  <div className={`skeleton-shimmer rounded-2xl ${className}`} aria-hidden="true" />
);

export const DocumentListSkeleton: React.FC<{ rows?: number }> = ({ rows = 4 }) => (
  <div className="space-y-3" aria-busy="true" aria-label="Loading past questions">
    {Array.from({ length: rows }).map((_, index) => (
      <div
        key={index}
        className="flex items-center justify-between gap-4 rounded-2xl bg-white p-4 border border-[#1A1B20]/[0.05]"
      >
        <div className="flex items-center gap-3.5 min-w-0 flex-1">
          <SkeletonBox className="h-11 w-11 rounded-xl shrink-0" />
          <div className="space-y-2 flex-1 max-w-md">
            <SkeletonBox className="h-4 w-44 rounded-lg" />
            <SkeletonBox className="h-3 w-64 max-w-full rounded-lg" />
          </div>
        </div>
        <SkeletonBox className="h-9 w-20 rounded-xl shrink-0" />
      </div>
    ))}
  </div>
);

export const HomeScreenSkeleton: React.FC = () => (
  <div className="space-y-6 page-enter" aria-busy="true" aria-label="Loading home view">
    <div className="rounded-3xl bg-[#1D1E23] p-6 sm:p-8 space-y-5">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <SkeletonBox className="h-3.5 w-32 bg-[#2D2F38] rounded-md" />
          <SkeletonBox className="h-7 w-64 bg-[#2D2F38] rounded-lg" />
        </div>
        <SkeletonBox className="h-11 w-11 rounded-full bg-[#2D2F38]" />
      </div>
      <SkeletonBox className="h-12 w-full bg-[#2D2F38] rounded-2xl" />
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <SkeletonBox className="h-40 rounded-3xl" />
      <SkeletonBox className="h-40 rounded-3xl" />
      <SkeletonBox className="h-40 rounded-3xl hidden lg:block" />
    </div>

    <DocumentListSkeleton rows={4} />
  </div>
);
