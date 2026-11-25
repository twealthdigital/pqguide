import React from 'react';

interface BrandLogoProps {
  className?: string;
}

/** Raw glasses shapes in the shared 146 298 618 287 coordinate space (currentColor). */
export const LogoShapes: React.FC<{ pupilClassName?: string }> = ({ pupilClassName }) => (
  <>
      <circle cx="315.0" cy="411.0" r="96.7" fill="none" stroke="currentColor" strokeWidth="31.9"/>
      <circle cx="594.2" cy="411.0" r="96.7" fill="none" stroke="currentColor" strokeWidth="31.9"/>
      <path d="M414.6 399.5A40 40 0 0 1 494.6 399.5" fill="none" stroke="currentColor" strokeWidth="31"/>
      <path d="M164 380H215M692 380H746" fill="none" stroke="currentColor" strokeWidth="32" strokeLinecap="round"/>
      <path d="M203 380H234V440H239V565A18 18 0 0 1 203 565Z" fill="currentColor"/>
      <path d="M676 380H708V525H672V440H676Z" fill="currentColor"/>
      <path d="M659 489L705 553" fill="none" stroke="currentColor" strokeWidth="36" strokeLinecap="round"/>
      <path d="M260.0 403A43.2 43.2 0 0 1 286.0 367M539.8 403A43.2 43.2 0 0 1 565.8 367" fill="none" stroke="currentColor" strokeOpacity=".12" strokeWidth="17.2" strokeLinecap="round"/>
      <circle className={pupilClassName} cx="325.7" cy="412.1" r="20.2" fill="currentColor"/><circle className={pupilClassName} cx="605.8" cy="412" r="20.2" fill="currentColor"/>
  </>
);

/**
 * pqguide glasses mark (icon only). Pure inline SVG: no network request, no
 * defs/ids, drawn with currentColor so it adapts to any surface.
 * Size it by width, e.g. className="w-6" (height follows the aspect ratio).
 */
export const BrandLogo: React.FC<BrandLogoProps> = ({ className = 'w-6' }) => (
  <svg
    viewBox="146 298 618 287"
    className={className}
    fill="none"
    role="img"
    aria-label="pqguide"
  >
    <LogoShapes />
  </svg>
);
