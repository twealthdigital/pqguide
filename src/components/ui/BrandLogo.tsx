import React from 'react';

interface BrandLogoProps {
  className?: string;
  strokeWidth?: number;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  className = 'w-5 h-5',
  strokeWidth = 2,
}) => {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* Top-right viewfinder bracket */}
      <path
        d="M15.8 3.5H18.8A1.7 1.7 0 0 1 20.5 5.2V8.2"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Bottom-left viewfinder bracket */}
      <path
        d="M3.5 15.8V18.8A1.7 1.7 0 0 0 5.2 20.5H8.2"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Tilted center capsule loop */}
      <rect
        x="7.6"
        y="5.1"
        width="6.6"
        height="10.8"
        rx="3.3"
        transform="rotate(-28 10.9 10.5)"
        stroke="currentColor"
        strokeWidth={strokeWidth}
      />

      {/* Bottom-right diagonal stem */}
      <path
        d="M14.3 16.6L15.8 19.4"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </svg>
  );
};
