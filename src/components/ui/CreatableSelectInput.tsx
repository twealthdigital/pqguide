import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Plus } from 'lucide-react';
import { useBackHandler } from '../../core/navGuard';

interface CreatableSelectInputProps {
  id: string;
  label: string;
  value: string;
  options: string[];
  onChange: (nextValue: string) => void;
  onAddOption: (newOption: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

interface MenuCoords {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  placeAbove: boolean;
}

export const CreatableSelectInput: React.FC<CreatableSelectInputProps> = ({
  id,
  label,
  value,
  options,
  onChange,
  onAddOption,
  placeholder = 'Type or select...',
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [hasTyped, setHasTyped] = useState(false);
  const [coords, setCoords] = useState<MenuCoords | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const trimmedValue = value.trim();

  const filteredOptions = useMemo(() => {
    if (!hasTyped || !trimmedValue) return options;
    const query = trimmedValue.toLowerCase();
    return options.filter((opt) => opt.toLowerCase().includes(query));
  }, [hasTyped, options, trimmedValue]);

  const hasExactMatch = useMemo(() => {
    if (!trimmedValue) return true;
    const lower = trimmedValue.toLowerCase();
    return options.some((opt) => opt.toLowerCase() === lower);
  }, [options, trimmedValue]);

  const showAddOption = trimmedValue.length >= 2 && !hasExactMatch;
  const menuVisible = isOpen && (filteredOptions.length > 0 || showAddOption);

  useBackHandler(menuVisible, () => {
    setIsOpen(false);
    setHasTyped(false);
  });

  const updatePosition = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const spaceBelow = viewportHeight - rect.bottom;
    const totalItems = filteredOptions.length + (showAddOption ? 1 : 0);
    const estimatedHeight = Math.min(250, Math.max(1, totalItems) * 44 + 16);

    const shouldFlipAbove = spaceBelow < estimatedHeight && rect.top > spaceBelow;
    const width = Math.max(rect.width, 210);
    const maxLeft = Math.max(12, viewportWidth - width - 12);
    const left = Math.min(Math.max(12, rect.left), maxLeft);

    if (shouldFlipAbove) {
      setCoords({
        bottom: viewportHeight - rect.top + 8,
        left,
        width,
        placeAbove: true,
      });
    } else {
      setCoords({
        top: rect.bottom + 8,
        left,
        width,
        placeAbove: false,
      });
    }
  }, [filteredOptions.length, showAddOption]);

  useLayoutEffect(() => {
    if (!isOpen) {
      setCoords(null);
      return;
    }
    updatePosition();
  }, [isOpen, updatePosition]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const insideContainer = containerRef.current?.contains(target);
      const insideMenu = menuRef.current?.contains(target);
      if (!insideContainer && !insideMenu) {
        if (hasTyped && trimmedValue.length >= 2 && !hasExactMatch) {
          onAddOption(trimmedValue);
          onChange(trimmedValue);
        }
        setIsOpen(false);
        setHasTyped(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        setHasTyped(false);
      }
    };

    const handleViewportChange = () => {
      updatePosition();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleViewportChange, true);
    window.addEventListener('resize', handleViewportChange);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleViewportChange, true);
      window.removeEventListener('resize', handleViewportChange);
    };
  }, [hasExactMatch, hasTyped, isOpen, onAddOption, onChange, trimmedValue, updatePosition]);

  const handleSelectExisting = (option: string) => {
    onChange(option);
    setIsOpen(false);
    setHasTyped(false);
  };

  const handleSelectNew = () => {
    if (!trimmedValue) return;
    onAddOption(trimmedValue);
    onChange(trimmedValue);
    setIsOpen(false);
    setHasTyped(false);
  };

  return (
    <div className="relative">
      <label
        htmlFor={id}
        className="block text-xs font-semibold text-[#1A1B20] mb-1.5 pl-1"
      >
        {label}
      </label>

      <div ref={containerRef} className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-autocomplete="list"
          disabled={disabled}
          value={value}
          onFocus={() => {
            if (!disabled) {
              setIsOpen(true);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && isOpen) {
              e.preventDefault();
              if (showAddOption) {
                handleSelectNew();
              } else if (filteredOptions.length > 0) {
                handleSelectExisting(filteredOptions[0]);
              }
            }
          }}
          onChange={(e) => {
            onChange(e.target.value);
            setHasTyped(true);
            if (!isOpen) setIsOpen(true);
          }}
          placeholder={placeholder}
          className={`h-12 w-full rounded-full border bg-white pl-4 pr-10 text-sm text-[#1A1B20] placeholder:text-[#9AA0AE] transition-colors disabled:opacity-60 ${
            isOpen
              ? 'border-[#1D1E23] shadow-[0_6px_16px_-4px_rgba(24,25,30,0.12)]'
              : 'border-[#1A1B20]/15'
          }`}
        />

        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          aria-label={`Toggle ${label} list`}
          onClick={() => {
            if (disabled) return;
            setHasTyped(false);
            setIsOpen((prev) => !prev);
            inputRef.current?.focus();
          }}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full flex items-center justify-center text-[#686C78] hover:text-[#1A1B20] cursor-pointer disabled:opacity-45"
        >
          <ChevronDown
            className={`w-4 h-4 transition-transform duration-150 ${
              isOpen ? 'rotate-180 text-[#1A1B20]' : ''
            }`}
            aria-hidden="true"
          />
        </button>
      </div>

      {isOpen &&
        coords &&
        (filteredOptions.length > 0 || showAddOption) &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label={`${label} options`}
            style={{
              position: 'fixed',
              top: coords.top,
              bottom: coords.bottom,
              left: coords.left,
              width: coords.width,
            }}
            className={`z-[70] max-h-60 overflow-y-auto custom-scrollbar rounded-2xl bg-white p-1.5 border border-[#1A1B20]/10 shadow-[0_20px_44px_-10px_rgba(20,21,26,0.28)] page-enter ${
              coords.placeAbove ? 'origin-bottom' : 'origin-top'
            }`}
          >
            {showAddOption && (
              <button
                type="button"
                role="option"
                aria-selected={false}
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleSelectNew}
                className="w-full min-h-[42px] px-3 py-2 rounded-xl flex items-center justify-between gap-2 text-left text-xs sm:text-sm bg-[#F6F7F9] hover:bg-[#1D1E23] text-[#1A1B20] hover:text-white font-semibold transition-colors duration-100 cursor-pointer mb-1"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{trimmedValue}</span>
                </span>
                <span className="text-[11px] opacity-70 shrink-0">Tap to add</span>
              </button>
            )}

            {filteredOptions.map((option) => {
              const isSelected =
                option.toLowerCase() === trimmedValue.toLowerCase();
              return (
                <button
                  key={option}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelectExisting(option)}
                  className={`w-full min-h-[40px] px-3 py-2 rounded-xl flex items-center justify-between gap-2 text-left text-xs sm:text-sm transition-colors duration-100 cursor-pointer ${
                    isSelected
                      ? 'bg-[#1D1E23] text-white font-semibold'
                      : 'text-[#1A1B20] hover:bg-[#F2F4F7] font-medium'
                  }`}
                >
                  <span className="truncate">{option}</span>
                  {isSelected && (
                    <Check className="w-4 h-4 shrink-0 text-white" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
};
