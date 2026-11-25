import React from 'react';
import { LogoShapes } from './BrandLogo';
import { WORDMARK_PATH } from './BrandWordmark';

interface BrandLockupProps {
  className?: string;
}

/**
 * Full pqguide logo: glasses + lettering in one inline SVG, drawn with
 * currentColor so it adapts to any background (set the text colour on it
 * or a parent). Size it by height, e.g. className="h-9 w-auto".
 */
export const BrandLockup: React.FC<BrandLockupProps> = ({ className = 'h-9 w-auto' }) => (
  <svg
    viewBox="146 298 1488 287"
    className={className}
    fill="none"
    role="img"
    aria-label="pqguide"
  >
    <LogoShapes />
    <path fill="currentColor" fillRule="evenodd" d={WORDMARK_PATH} />
  </svg>
);
