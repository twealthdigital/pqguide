import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export interface CustomSelectOption {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

interface CustomSelectProps {
  id?: string;
  label?: string;
  ariaLabel?: string;
  value: string;
  options: CustomSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  inputPlaceholder?: string;
  allowCustomInput?: boolean;
  emptyValueFallback?: string;
  size?: 'sm' | 'md';
  mono?: boolean;
  menuPlacement?: 'bottom' | 'top';
  className?: string;
}

interface MenuCoords {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  placeAbove: boolean;
  inOverlay: boolean;
}

export const CustomSelect: React.FC<CustomSelectProps> = React.memo(
  ({
    id,
    label,
    ariaLabel,
    value,
    options,
    onChange,
    placeholder = 'Select option',
    inputPlaceholder,
    allowCustomInput = false,
    emptyValueFallback = 'All',
    size = 'md',
    mono = false,
    menuPlacement = 'bottom',
    className = '',
  }) => {
    const generatedId = useId();
    const controlId = id ?? generatedId;
    const [isOpen, setIsOpen] = useState(false);
    const [hasTypedFilter, setHasTypedFilter] = useState(false);
    const [coords, setCoords] = useState<MenuCoords | null>(null);
    const triggerContainerRef = useRef<HTMLDivElement | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);

    const selectedOption = options.find((opt) => opt.value === value);
    const inputDisplayValue =
      allowCustomInput && value === emptyValueFallback ? '' : value;

    const visibleOptions =
      allowCustomInput && hasTypedFilter && inputDisplayValue.trim()
        ? options.filter((opt) => {
            if (opt.value === emptyValueFallback) return false;
            const term = inputDisplayValue.trim().toLowerCase();
            return (
              opt.label.toLowerCase().includes(term) ||
              opt.value.toLowerCase().includes(term)
            );
          })
        : options;

    const updatePosition = useCallback(() => {
      const anchor = allowCustomInput
        ? triggerContainerRef.current
        : triggerRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const inOverlay = Boolean(anchor.closest('aside, [role="dialog"]'));
      const headerClearance = inOverlay ? 12 : viewportWidth < 1024 ? 64 : 80;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = Math.max(0, rect.top - headerClearance);
      const estimatedMenuHeight = Math.min(
        260,
        Math.max(visibleOptions.length, 1) * 46 + 16
      );

      const shouldFlipAbove =
        menuPlacement === 'top' ||
        (spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow);

      const width = Math.max(rect.width, 210);
      const maxLeft = Math.max(12, viewportWidth - width - 12);
      const left = Math.min(Math.max(12, rect.left), maxLeft);

      if (shouldFlipAbove) {
        setCoords({
          bottom: viewportHeight - rect.top + 8,
          left,
          width,
          placeAbove: true,
          inOverlay,
        });
      } else {
        setCoords({
          top: rect.bottom + 8,
          left,
          width,
          placeAbove: false,
          inOverlay,
        });
      }
    }, [allowCustomInput, menuPlacement, visibleOptions.length]);

    useLayoutEffect(() => {
      if (!isOpen) {
        setCoords(null);
        return;
      }
      updatePosition();
    }, [isOpen, updatePosition]);

    useEffect(() => {
      if (!isOpen) {
        setHasTypedFilter(false);
        return;
      }

      const handlePointerDown = (event: PointerEvent) => {
        const target = event.target as Node;
        const clickedTrigger = allowCustomInput
          ? triggerContainerRef.current?.contains(target)
          : triggerRef.current?.contains(target);
        const clickedMenu = menuRef.current?.contains(target);
        if (!clickedTrigger && !clickedMenu) {
          setIsOpen(false);
        }
      };

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          setIsOpen(false);
          if (allowCustomInput) {
            inputRef.current?.focus();
          } else {
            triggerRef.current?.focus();
          }
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
    }, [allowCustomInput, isOpen, updatePosition]);

    const handleSelect = (option: CustomSelectOption) => {
      if (option.disabled) return;
      setHasTypedFilter(false);
      onChange(option.value);
      setIsOpen(false);
    };

    const triggerSizeClass =
      size === 'sm'
        ? 'min-h-[38px] px-3 py-1.5 text-xs rounded-xl'
        : 'min-h-[44px] px-3.5 py-2 text-sm rounded-xl';

    return (
      <div className={`relative ${className}`}>
        {label && (
          <label
            htmlFor={controlId}
            className="block text-xs font-medium text-[#686C78] mb-1.5"
          >
            {label}
          </label>
        )}

        {allowCustomInput ? (
          <div
            ref={triggerContainerRef}
            className={`w-full flex items-center gap-1.5 bg-[#F6F7F9] hover:bg-[#EFF1F5] border text-[#1A1B20] transition-colors duration-150 ${triggerSizeClass} ${
              isOpen
                ? 'border-[#1D1E23] bg-white shadow-[0_6px_16px_-4px_rgba(24,25,30,0.14)]'
                : 'border-[#1A1B20]/10'
            }`}
          >
            <input
              ref={inputRef}
              id={controlId}
              type="text"
              role="combobox"
              autoComplete="off"
              aria-autocomplete="list"
              aria-expanded={isOpen}
              aria-label={ariaLabel ?? label ?? placeholder}
              value={inputDisplayValue}
              placeholder={inputPlaceholder ?? placeholder}
              onFocus={() => {
                setHasTypedFilter(false);
                setIsOpen(true);
              }}
              onClick={() => {
                if (!isOpen) {
                  setHasTypedFilter(false);
                  setIsOpen(true);
                }
              }}
              onChange={(e) => {
                const raw = e.target.value;
                setHasTypedFilter(raw.trim().length > 0);
                onChange(raw ? raw : emptyValueFallback);
                if (!isOpen) setIsOpen(true);
              }}
              className={`w-full min-w-0 bg-transparent font-semibold text-[#1A1B20] placeholder:font-normal placeholder:text-[#8E93A2] focus:outline-none ${
                mono ? 'font-mono-tabular' : ''
              }`}
            />
            <button
              type="button"
              aria-label={`Toggle ${label ?? 'options'} list`}
              tabIndex={-1}
              onClick={() => {
                setHasTypedFilter(false);
                setIsOpen((prev) => !prev);
                inputRef.current?.focus();
              }}
              className="h-7 w-7 -mr-1 rounded-lg flex items-center justify-center text-[#686C78] hover:text-[#1A1B20] shrink-0 cursor-pointer"
            >
              <ChevronDown
                className={`w-4 h-4 transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                  isOpen ? 'rotate-180 text-[#1A1B20]' : ''
                }`}
                aria-hidden="true"
              />
            </button>
          </div>
        ) : (
          <button
            ref={triggerRef}
            id={controlId}
            type="button"
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            aria-label={ariaLabel ?? label ?? placeholder}
            onClick={() => setIsOpen((prev) => !prev)}
            className={`w-full flex items-center justify-between gap-2 bg-[#F6F7F9] hover:bg-[#EFF1F5] border text-left font-semibold text-[#1A1B20] transition-colors duration-150 cursor-pointer select-none ${triggerSizeClass} ${
              isOpen
                ? 'border-[#1D1E23] bg-white shadow-[0_6px_16px_-4px_rgba(24,25,30,0.14)]'
                : 'border-[#1A1B20]/10'
            } ${mono ? 'font-mono-tabular' : ''}`}
          >
            <span className="truncate">
              {selectedOption ? selectedOption.label : placeholder}
            </span>
            <ChevronDown
              className={`w-4 h-4 text-[#686C78] shrink-0 transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                isOpen ? 'rotate-180 text-[#1A1B20]' : ''
              }`}
              aria-hidden="true"
            />
          </button>
        )}

        {isOpen &&
          coords &&
          createPortal(
            <div
              ref={menuRef}
              role="listbox"
              data-custom-select-menu="true"
              aria-labelledby={controlId}
              style={{
                position: 'fixed',
                top: coords.top,
                bottom: coords.bottom,
                left: coords.left,
                width: coords.width,
              }}
              className={`${
                coords.inOverlay ? 'z-[70]' : 'z-20'
              } max-h-64 overflow-y-auto custom-scrollbar rounded-2xl bg-white p-1.5 border border-[#1A1B20]/10 shadow-[0_20px_44px_-10px_rgba(20,21,26,0.28)] page-enter ${
                coords.placeAbove ? 'origin-bottom' : 'origin-top'
              }`}
            >
              {visibleOptions.map((option) => {
                const isSelected = option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={option.disabled}
                    onClick={() => handleSelect(option)}
                    className={`w-full min-h-[42px] px-3 py-2 rounded-xl flex items-center justify-between gap-2 text-left text-xs sm:text-sm transition-colors duration-100 select-none ${
                      option.disabled
                        ? 'opacity-45 cursor-not-allowed text-[#8E93A2]'
                        : isSelected
                        ? 'bg-[#1D1E23] text-white font-semibold cursor-pointer'
                        : 'text-[#1A1B20] hover:bg-[#F2F4F7] font-medium cursor-pointer'
                    } ${mono ? 'font-mono-tabular' : ''}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{option.label}</span>
                      {option.hint && (
                        <span
                          className={`block text-[11px] truncate ${
                            isSelected ? 'text-[#B8BCC8]' : 'text-[#686C78]'
                          }`}
                        >
                          {option.hint}
                        </span>
                      )}
                    </span>
                    {isSelected && (
                      <Check
                        className="w-4 h-4 shrink-0 text-white"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                );
              })}

              {allowCustomInput &&
                inputDisplayValue.trim() &&
                !visibleOptions.some(
                  (opt) =>
                    opt.value.toLowerCase() ===
                    inputDisplayValue.trim().toLowerCase()
                ) && (
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() =>
                      handleSelect({
                        value: inputDisplayValue.trim(),
                        label: inputDisplayValue.trim(),
                      })
                    }
                    className={`w-full min-h-[42px] px-3 py-2 rounded-xl flex items-center justify-between gap-2 text-left text-xs sm:text-sm text-[#1A1B20] hover:bg-[#F2F4F7] font-medium cursor-pointer select-none ${
                      mono ? 'font-mono-tabular' : ''
                    }`}
                  >
                    <span className="truncate">
                      Use &ldquo;{inputDisplayValue.trim()}&rdquo;
                    </span>
                  </button>
                )}
            </div>,
            document.body
          )}
      </div>
    );
  }
);

CustomSelect.displayName = 'CustomSelect';
