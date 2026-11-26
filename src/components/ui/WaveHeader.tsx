import React, { useEffect, useRef } from 'react';
import {
  Check,
  ChevronUp,
  Loader2,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import bannerAshWaves from '../../assets/images/banner_ash_waves.webp';
import { useBackHandler } from '../../core/navGuard';
import { TooltipBubble } from './TooltipBubble';

export type SearchActionPhase = 'idle' | 'loading' | 'done';

interface WaveHeaderProps {
  title: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit?: () => void;
  searchPhase?: SearchActionPhase;
  onFilterToggle?: () => void;
  onFilterClose?: () => void;
  filterActive?: boolean;
  filterDropdown?: React.ReactNode;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
  placeholder?: string;
  /** What is being searched, e.g. "past questions" or "materials". */
  noun?: string;
}

export const WaveHeader: React.FC<WaveHeaderProps> = React.memo(
  ({
    title,
    searchValue,
    onSearchChange,
    onSearchSubmit,
    searchPhase = 'idle',
    onFilterToggle,
    onFilterClose,
    filterActive = false,
    filterDropdown,
    searchInputRef,
    placeholder = 'Search course code or topic (e.g. GNS 101, GNS 102)...',
    noun = 'past questions',
  }) => {
    const searchClusterRef = useRef<HTMLDivElement | null>(null);
    const isTyping = searchValue.trim().length > 0;

    useBackHandler(Boolean(filterActive && onFilterClose), () => {
      onFilterClose?.();
    });

    let activeIconKey: 'sliders' | 'chevron' | 'search' | 'loading' | 'done' =
      'sliders';
    if (searchPhase === 'loading') {
      activeIconKey = 'loading';
    } else if (searchPhase === 'done') {
      activeIconKey = 'done';
    } else if (isTyping) {
      activeIconKey = 'search';
    } else if (filterActive) {
      activeIconKey = 'chevron';
    }

    useEffect(() => {
      if (!filterActive) return;

      const handlePointerDown = (event: PointerEvent) => {
        const target = event.target as HTMLElement | null;
        if (!target) return;
        if (searchClusterRef.current?.contains(target)) return;
        if (target.closest('[data-custom-select-menu="true"]')) return;
        onFilterClose?.();
      };

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          const openSelectMenu = document.querySelector(
            '[data-custom-select-menu="true"]'
          );
          if (openSelectMenu) return;
          onFilterClose?.();
        }
      };

      document.addEventListener('pointerdown', handlePointerDown);
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('pointerdown', handlePointerDown);
        document.removeEventListener('keydown', handleKeyDown);
      };
    }, [filterActive, onFilterClose]);

    const handleFormSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (searchPhase === 'loading') return;
      if (!isTyping) {
        onFilterToggle?.();
        return;
      }
      onSearchSubmit?.();
    };

    const handleActionClick = () => {
      if (searchPhase === 'loading') return;
      if (!isTyping) {
        onFilterToggle?.();
        return;
      }
      onSearchSubmit?.();
    };

    const actionAriaLabel =
      activeIconKey === 'sliders'
        ? 'Open filter settings'
        : activeIconKey === 'chevron'
        ? 'Close filter settings'
        : activeIconKey === 'loading'
        ? `Preparing ${noun}`
        : activeIconKey === 'done'
        ? `Results ready for ${noun}`
        : `Search ${noun}`;

    return (
      <section className="relative z-30 mb-4 md:mb-6">
        {/* Mobile: full-bleed top banner with red-line asymmetric wave silhouette & zero horizontal shadow line.
            Tablet: matching asymmetric bottom silhouette with graceful right-edge curve.
            Desktop: floating sculpted rounded card. */}
        <div className="relative -mx-4 sm:-mx-6 lg:mx-0 lg:rounded-3xl bg-[#1D1E23] px-5 pt-[calc(76px+env(safe-area-inset-top))] pb-[78px] sm:px-8 sm:pt-[calc(84px+env(safe-area-inset-top))] md:pb-[84px] lg:px-10 lg:pt-10 lg:pb-10 text-white shadow-none lg:shadow-[0_18px_40px_-14px_rgba(18,19,24,0.38)]">
          {/* Clipped background layer so anchored search dropdown can overflow cleanly below */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-hidden lg:rounded-3xl"
          >
            {/* Generated Dark Ash Curved Background Image */}
            <img
              src={bannerAshWaves}
              alt=""
              width={1200}
              height={670}
              decoding="async"
              fetchPriority="high"
              referrerPolicy="no-referrer"
              className="select-none absolute inset-0 h-full w-full object-cover object-center opacity-85"
            />

            {/* Measured contrast scrim so bold white headline & search bar stay crisp */}
            <div
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(180deg, rgba(18,19,24,0.72) 0%, rgba(22,23,29,0.48) 52%, rgba(24,25,31,0.78) 100%)',
              }}
            />

            {/* Mobile-only asymmetric wave bottom silhouette matching the drawn red-line contour */}
            <svg
              viewBox="0 0 1440 120"
              preserveAspectRatio="none"
              className="md:hidden absolute -bottom-px inset-x-0 z-10 w-full h-[76px]"
            >
              <path
                d="M0,2 C32,32 105,36 220,36 L1020,36 C1235,36 1375,58 1440,118 L1440,120 L0,120 Z"
                fill="#F6F7F9"
              />
            </svg>

            {/* Tablet-only bottom silhouette with right-edge downward curve */}
            <svg
              viewBox="0 0 1440 120"
              preserveAspectRatio="none"
              className="hidden md:block lg:hidden absolute -bottom-px inset-x-0 z-10 w-full h-[84px]"
            >
              <path
                d="M0,0 C24,34 80,38 175,38 L1160,38 C1305,38 1398,62 1440,119 L1440,120 L0,120 Z"
                fill="#F6F7F9"
              />
            </svg>
          </div>

          {/* Foreground Content: Bold Headline + Crisp Integrated Search Bar + Anchored Floating Dropdown */}
          <div className="relative z-30 max-w-2xl">
            <h1
              className="font-display text-[28px] sm:text-[34px] lg:text-[36px] font-extrabold tracking-tight text-white leading-[1.12]"
              style={{ textWrap: 'balance' }}
            >
              {title}
            </h1>

            <div ref={searchClusterRef} className="relative mt-5 sm:mt-6">
              <form
                onSubmit={handleFormSubmit}
                role="search"
                className="flex items-center gap-2 rounded-2xl bg-white p-1.5 pl-4 shadow-[0_14px_32px_-8px_rgba(10,11,15,0.48)]"
              >
                <Search
                  className="w-4 h-4 sm:w-[18px] sm:h-[18px] text-[#7D8290] shrink-0"
                  aria-hidden="true"
                />
                <input
                  ref={searchInputRef}
                  type="text"
                  inputMode="search"
                  enterKeyHint="search"
                  autoComplete="off"
                  value={searchValue}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder={placeholder}
                  aria-label={`Search ${noun}`}
                  className="w-full min-w-0 bg-transparent py-2.5 text-sm text-[#1A1B20] placeholder:text-[#8E93A2] focus:outline-none"
                />
                <TooltipBubble label={actionAriaLabel} side="top">
                  <button
                    type="button"
                    onClick={handleActionClick}
                    disabled={searchPhase === 'loading'}
                    aria-label={actionAriaLabel}
                    aria-expanded={!isTyping && searchPhase === 'idle' ? filterActive : undefined}
                    className={`relative min-h-[42px] min-w-[42px] rounded-xl flex items-center justify-center transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-95 cursor-pointer shrink-0 disabled:cursor-wait ${
                      activeIconKey === 'chevron'
                        ? 'bg-[#2C2F39] text-white'
                        : 'bg-[#1D1E23] text-white hover:bg-[#2B2D35]'
                    }`}
                  >
                    {/* Smooth morphing icon stack (compositor opacity + scale transitions) */}
                    <span
                      aria-hidden="true"
                      className={`absolute inset-0 flex items-center justify-center transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                        activeIconKey === 'sliders'
                          ? 'opacity-100 scale-100 rotate-0'
                          : 'opacity-0 scale-75 -rotate-45 pointer-events-none'
                      }`}
                    >
                      <SlidersHorizontal className="w-4 h-4" />
                    </span>

                    <span
                      aria-hidden="true"
                      className={`absolute inset-0 flex items-center justify-center transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                        activeIconKey === 'chevron'
                          ? 'opacity-100 scale-100 rotate-0'
                          : 'opacity-0 scale-75 rotate-45 pointer-events-none'
                      }`}
                    >
                      <ChevronUp className="w-[18px] h-[18px]" />
                    </span>

                    <span
                      aria-hidden="true"
                      className={`absolute inset-0 flex items-center justify-center transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                        activeIconKey === 'search'
                          ? 'opacity-100 scale-100'
                          : 'opacity-0 scale-75 pointer-events-none'
                      }`}
                    >
                      <Search className="w-4 h-4" />
                    </span>

                    <span
                      aria-hidden="true"
                      className={`absolute inset-0 flex items-center justify-center transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                        activeIconKey === 'loading'
                          ? 'opacity-100 scale-100'
                          : 'opacity-0 scale-75 pointer-events-none'
                      }`}
                    >
                      <Loader2 className="w-4 h-4 animate-spin" />
                    </span>

                    <span
                      aria-hidden="true"
                      className={`absolute inset-0 flex items-center justify-center transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                        activeIconKey === 'done'
                          ? 'opacity-100 scale-100'
                          : 'opacity-0 scale-50 pointer-events-none'
                      }`}
                    >
                      <Check className="w-4 h-4" strokeWidth={2.5} />
                    </span>
                  </button>
                </TooltipBubble>
              </form>

              {filterActive && filterDropdown && (
                <div className="absolute left-0 right-0 top-full mt-2 z-50">
                  {filterDropdown}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    );
  }
);

WaveHeader.displayName = 'WaveHeader';
