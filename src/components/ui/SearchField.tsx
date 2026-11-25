import React, { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Search } from 'lucide-react';

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel?: string;
  className?: string;
}

type Phase = 'idle' | 'loading' | 'done';

const LOADING_MS = 520;
const DONE_MS = 1400;

/**
 * Search bar with a search button beside it. Results update live as the
 * person types; pressing the button (or Enter) just gives the same feedback
 * as the home search: a spinner, then a check mark, then back to search.
 */
export const SearchField: React.FC<SearchFieldProps> = ({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className = 'mt-3.5',
}) => {
  const [phase, setPhase] = useState<Phase>('idle');
  const timerRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => clearTimer, []);

  // Editing the text again returns the button to its search icon.
  useEffect(() => {
    if (phase === 'done') {
      clearTimer();
      setPhase('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const runSearch = () => {
    if (phase === 'loading') return;
    clearTimer();
    setPhase('loading');
    timerRef.current = window.setTimeout(() => {
      setPhase('done');
      timerRef.current = window.setTimeout(() => {
        setPhase('idle');
        timerRef.current = null;
      }, DONE_MS);
    }, LOADING_MS);
  };

  const iconLayer = (active: boolean, extra = '') =>
    `absolute inset-0 flex items-center justify-center transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
      active ? 'opacity-100 scale-100' : `opacity-0 scale-75 pointer-events-none ${extra}`
    }`;

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        inputRef.current?.blur();
        runSearch();
      }}
      className={`flex items-center gap-2 rounded-2xl bg-white py-1.5 pl-3.5 pr-1.5 text-[#1A1B20] ${className}`}
    >
      <Search className="w-4 h-4 text-[#686C78] shrink-0" aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className="w-full min-w-0 bg-transparent py-1.5 text-sm text-[#1A1B20] placeholder:text-[#8E93A2] focus:outline-none"
      />
      <button
        type="submit"
        disabled={phase === 'loading'}
        aria-label={
          phase === 'loading' ? 'Searching' : phase === 'done' ? 'Search complete' : 'Search'
        }
        className="relative h-9 w-9 min-h-[36px] min-w-[36px] shrink-0 rounded-xl bg-[#1D1E23] text-white flex items-center justify-center transition-colors duration-200 hover:bg-[#2B2D35] active:scale-95 cursor-pointer disabled:cursor-wait"
      >
        <span aria-hidden="true" className={iconLayer(phase === 'idle', '-rotate-45')}>
          <Search className="w-4 h-4" />
        </span>
        <span aria-hidden="true" className={iconLayer(phase === 'loading')}>
          <Loader2 className="w-4 h-4 animate-spin" />
        </span>
        <span aria-hidden="true" className={iconLayer(phase === 'done', 'scale-50')}>
          <Check className="w-4 h-4" strokeWidth={2.5} />
        </span>
      </button>
    </form>
  );
};
