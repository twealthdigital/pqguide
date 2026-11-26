import React from 'react';
import { AlertCircle, ArrowLeft, Check, ShieldAlert, X } from 'lucide-react';
import { BrandLockup } from '../ui/BrandLockup';
import type { AuthNotice } from './types';

interface AuthPortalShellProps {
  portalTag: string;
  portalTagTone?: 'student' | 'school_admin' | 'super_admin';
  brandHeadline: string;
  brandDescription: string;
  brandFooter: string;
  heading: string;
  subheading: string;
  showBackButton: boolean;
  onBackClick: () => void;
  disableBack?: boolean;
  errorMsg?: string | null;
  infoMsg?: string | null;
  sessionNotice?: AuthNotice | null;
  onDismissSessionNotice?: () => void;
  children: React.ReactNode;
}

export const AuthPortalShell: React.FC<AuthPortalShellProps> = ({
  portalTag,
  portalTagTone = 'student',
  brandHeadline,
  brandDescription,
  brandFooter,
  heading,
  subheading,
  showBackButton,
  onBackClick,
  disableBack = false,
  errorMsg,
  infoMsg,
  sessionNotice,
  onDismissSessionNotice,
  children,
}) => {
  const leftSurfaceClass =
    portalTagTone === 'super_admin'
      ? 'bg-[#121318]'
      : portalTagTone === 'school_admin'
        ? 'bg-[#181A20]'
        : 'bg-[#1D1E23]';

  const badgeClass =
    portalTagTone === 'super_admin'
      ? 'bg-white/12 text-white border border-white/20'
      : portalTagTone === 'school_admin'
        ? 'bg-white/10 text-[#E5E7EB] border border-white/15'
        : 'bg-white/10 text-[#E5E7EB] border border-white/12';

  return (
    <div
      className={`min-h-[100dvh] w-full ${leftSurfaceClass} text-[#1A1B20] flex flex-col lg:grid lg:grid-cols-12 page-enter`}
    >
      {/* Left / Top Brand Panel */}
      <div
        className={`relative ${leftSurfaceClass} text-white lg:col-span-5 flex flex-col justify-between overflow-hidden shrink-0`}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 800 500"
          className="pointer-events-none absolute inset-0 h-full w-full opacity-25"
          preserveAspectRatio="none"
        >
          <path
            d="M-40,340 C160,210 380,410 620,250 C720,180 790,230 840,190"
            fill="none"
            stroke="#464A58"
            strokeWidth="1.5"
          />
          <path
            d="M-40,390 C180,260 400,450 640,290 C740,220 800,270 840,235"
            fill="none"
            stroke="#363946"
            strokeWidth="1.2"
          />
        </svg>

        {/* Top Bar */}
        <div className="relative z-10 flex items-center justify-between px-4 sm:px-8 pt-[calc(1rem+env(safe-area-inset-top))] sm:pt-[calc(1.75rem+env(safe-area-inset-top))] min-h-[52px]">
          {showBackButton ? (
            <button
              type="button"
              disabled={disableBack}
              onClick={onBackClick}
              aria-label="Go back"
              className="h-10 w-10 rounded-full bg-[#2B2E38] hover:bg-[#353946] text-white inline-flex items-center justify-center cursor-pointer transition-colors disabled:opacity-45"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          ) : (
            <div className="h-10" aria-hidden="true" />
          )}

          <span
            className={`px-3 py-1 rounded-full text-[11px] font-bold tracking-[0.04em] ${badgeClass}`}
          >
            {portalTag}
          </span>
        </div>

        {/* Brand Lockup */}
        <div className="relative z-10 flex flex-col items-center lg:items-start text-center lg:text-left px-6 pt-5 pb-11 sm:pt-7 sm:pb-14 lg:px-12 lg:py-0 lg:my-auto">
          <div className="text-white">
            <BrandLockup className="h-12 lg:h-16 w-auto" />
          </div>

          <h2 className="mt-4 font-display text-base lg:text-lg font-bold text-white tracking-tight max-w-xs">
            {brandHeadline}
          </h2>
          <p className="mt-1.5 text-xs lg:text-sm text-[#A5AAB8] max-w-xs leading-relaxed">
            {brandDescription}
          </p>
        </div>

        {/* Desktop Security Footer */}
        <div className="hidden lg:flex items-center gap-2 relative z-10 px-12 pb-8 text-xs text-[#8E93A2]">
          {portalTagTone === 'super_admin' && (
            <ShieldAlert className="w-3.5 h-3.5 shrink-0 text-[#C3C7D2]" />
          )}
          <span>{brandFooter}</span>
        </div>
      </div>

      {/* Right / Bottom White Sheet */}
      <div className="relative flex-1 bg-white lg:col-span-7 flex flex-col justify-center px-5 sm:px-10 pt-7 pb-8 sm:pt-9 sm:pb-10 lg:py-10 rounded-t-[36px] sm:rounded-t-[44px] -mt-5 sm:-mt-6 lg:mt-0 lg:rounded-tr-none lg:rounded-l-[44px] lg:-ml-6 z-20">
        <div className="w-full max-w-md mx-auto">
          <div className="mb-6">
            <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-[#1A1B20]">
              {heading}
            </h1>
            <p className="mt-1.5 text-xs sm:text-sm text-[#686C78] leading-relaxed">
              {subheading}
            </p>
          </div>

          {sessionNotice && (
            <div
              role={sessionNotice.tone === 'error' ? 'alert' : 'status'}
              className={`mb-4 rounded-2xl border px-4 py-3 text-xs font-medium flex items-start justify-between gap-3 page-enter ${
                sessionNotice.tone === 'error'
                  ? 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
                  : sessionNotice.tone === 'warning'
                    ? 'bg-[#FFFBEB] border-[#FDE68A] text-[#92400E]'
                    : sessionNotice.tone === 'success'
                      ? 'bg-[#F0FDF4] border-[#BBF7D0] text-[#15803D]'
                      : 'bg-[#F6F7F9] border-[#1A1B20]/12 text-[#1A1B20]'
              }`}
            >
              <div className="flex items-start gap-2 min-w-0">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{sessionNotice.message}</span>
              </div>
              {onDismissSessionNotice && (
                <button
                  type="button"
                  onClick={onDismissSessionNotice}
                  aria-label="Dismiss notice"
                  className="h-6 w-6 rounded-lg flex items-center justify-center opacity-70 hover:opacity-100 cursor-pointer shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {errorMsg && (
            <div
              role="alert"
              className="mb-4 rounded-2xl bg-[#FEF2F2] border border-[#FECACA] px-4 py-3 text-xs font-medium text-[#B91C1C] page-enter"
            >
              {errorMsg}
            </div>
          )}

          {infoMsg && (
            <div
              role="status"
              className="mb-4 rounded-2xl bg-[#F0FDF4] border border-[#BBF7D0] px-4 py-3 text-xs font-medium text-[#15803D] flex items-center gap-2 page-enter"
            >
              <Check className="w-4 h-4 shrink-0" />
              <span>{infoMsg}</span>
            </div>
          )}

          {children}
        </div>
      </div>
    </div>
  );
};
