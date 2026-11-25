import React, { useEffect, useRef, useState } from 'react';
import { LogoShapes } from '../components/ui/BrandLogo';
import { WORDMARK_PATH } from '../components/ui/BrandWordmark';

interface LoadingScreenProps {
  /** Fires as the splash starts to fade, so the app can mount underneath it. */
  onReveal: () => void;
  /** Fires once the splash has fully faded away and can be removed. */
  onComplete: () => void;
}

// Eyes blink and look around (about 2.7s), the name slides out (0.9s), then a
// short pause before the splash fades and drops away. Keep in sync with the
// pq-boot-* animations in index.css.
const HOLD_MS = 4000;
const HOLD_REDUCED_MS = 700;
const FADE_MS = 650;

export const LoadingScreen: React.FC<LoadingScreenProps> = ({ onReveal, onComplete }) => {
  const [leaving, setLeaving] = useState(false);
  const revealRef = useRef(onReveal);
  const completeRef = useRef(onComplete);
  revealRef.current = onReveal;
  completeRef.current = onComplete;

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const fadeAt = reduced ? HOLD_REDUCED_MS : HOLD_MS;

    const fadeTimer = window.setTimeout(() => {
      setLeaving(true);
      revealRef.current();
    }, fadeAt);
    const doneTimer = window.setTimeout(() => completeRef.current(), fadeAt + FADE_MS);

    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(doneTimer);
    };
  }, []);

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-[#1D1E23] text-white select-none transition-opacity duration-[650ms] ease-out ${
        leaving ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      role="status"
      aria-label="Loading application"
    >
      <div
        className={`pq-boot-stage transition-transform duration-[650ms] ease-in ${
          leaving ? 'translate-y-10 scale-95' : ''
        }`}
      >
        <div className="pq-boot-pop">
          <div className="pq-boot-settle flex items-center">
            {/* Glasses mark: pupils look around, lids blink */}
            <svg viewBox="146 298 618 287" className="pq-boot-mark" fill="none" aria-hidden="true">
              <LogoShapes pupilClassName="pq-boot-pupil" />
              <circle className="pq-boot-lid" cx="315" cy="411" r="79" fill="#1D1E23" stroke="currentColor" strokeWidth="6" />
              <circle className="pq-boot-lid" cx="594.2" cy="411" r="79" fill="#1D1E23" stroke="currentColor" strokeWidth="6" />
            </svg>

            {/* Name wipes out from behind the mark, pushing it to the side */}
            <div className="pq-boot-name">
              <svg viewBox="764 298 870 287" className="pq-boot-word" aria-hidden="true">
                <path fill="currentColor" fillRule="evenodd" d={WORDMARK_PATH} />
              </svg>
            </div>
          </div>
        </div>
        <span className="sr-only">pqguide</span>
      </div>
    </div>
  );
};
