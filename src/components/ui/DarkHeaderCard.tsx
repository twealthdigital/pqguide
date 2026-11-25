import React from 'react';
import bannerAshWaves from '../../assets/images/banner_ash_waves.webp';

/** Compact dark ash wave card used as the header of simple pages. */
export const DarkHeaderCard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="relative overflow-hidden rounded-3xl bg-[#1D1E23] px-5 py-5 text-white shadow-[0_12px_28px_-10px_rgba(24,25,30,0.36)]">
    <img
      src={bannerAshWaves}
      alt=""
      aria-hidden="true"
      width={1200}
      height={670}
      decoding="async"
      className="pointer-events-none select-none absolute inset-0 h-full w-full object-cover object-center opacity-85"
    />
    <div
      aria-hidden="true"
      className="absolute inset-0"
      style={{
        background:
          'linear-gradient(180deg, rgba(18,19,24,0.72) 0%, rgba(22,23,29,0.48) 52%, rgba(24,25,30,0.78) 100%)',
      }}
    />
    <div className="relative">{children}</div>
  </div>
);
