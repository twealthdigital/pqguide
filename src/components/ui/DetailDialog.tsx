import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useBackHandler } from '../../core/navGuard';

interface DetailDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  maxWidthClass?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export const DetailDialog: React.FC<DetailDialogProps> = ({
  open,
  onClose,
  title,
  subtitle,
  icon,
  maxWidthClass = 'max-w-xl',
  children,
  footer,
}) => {
  useBackHandler(open, onClose);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-5 bg-[#121318]/55 backdrop-blur-[2px] page-enter"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${maxWidthClass} max-h-[88dvh] flex flex-col rounded-3xl bg-white border border-[#1A1B20]/10 shadow-[0_24px_60px_-14px_rgba(18,19,24,0.45)] overflow-hidden`}
      >
        <div className="bg-[#1D1E23] text-white px-4 py-3.5 sm:px-5 sm:py-4 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {icon && (
              <span className="h-9 w-9 rounded-xl bg-white/12 text-white flex items-center justify-center shrink-0">
                {icon}
              </span>
            )}
            <div className="min-w-0">
              <h3 className="font-display text-sm sm:text-base font-bold text-white leading-tight truncate">
                {title}
              </h3>
              {subtitle && (
                <p className="text-[11px] text-[#C3C7D2] mt-0.5 truncate">
                  {subtitle}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="h-10 w-10 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center shrink-0 cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {children}
        </div>

        {footer && (
          <div className="px-4 py-3 sm:px-5 border-t border-[#1A1B20]/[0.08] bg-[#F6F7F9] flex flex-wrap items-center justify-end gap-2 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
