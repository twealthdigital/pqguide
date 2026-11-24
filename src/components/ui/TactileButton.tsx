import React from 'react';
import { Check, Loader2 } from 'lucide-react';

export type TactileVariant = 'dark' | 'light' | 'ghost';

interface TactileButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: TactileVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  fullWidth?: boolean;
  loading?: boolean;
  success?: boolean;
  successLabel?: string;
}

export const TactileButton: React.FC<TactileButtonProps> = React.memo(
  ({
    variant = 'dark',
    size = 'md',
    icon,
    fullWidth = false,
    loading = false,
    success = false,
    successLabel,
    disabled = false,
    className = '',
    children,
    type = 'button',
    ...rest
  }) => {
    const isBusy = loading || success;
    const isDisabled = disabled || isBusy;

    const sizeClasses =
      size === 'sm'
        ? 'min-h-[40px] px-3.5 py-2 text-xs rounded-xl'
        : size === 'lg'
        ? 'min-h-[48px] px-6 py-3 text-sm rounded-2xl'
        : 'min-h-[44px] px-5 py-2.5 text-sm rounded-xl';

    const variantClasses = success
      ? 'bg-[#16A34A] text-white border border-[#15803D]/20 shadow-[0_6px_16px_-4px_rgba(22,163,74,0.35)]'
      : variant === 'dark'
      ? 'tactile-dark text-white hover:brightness-110'
      : variant === 'light'
      ? 'tactile-light text-[#1A1B20] border border-[#1A1B20]/8 hover:bg-[#F7F8FA]'
      : 'bg-transparent text-[#505460] hover:bg-[#1A1B20]/5 hover:text-[#1A1B20]';

    return (
      <button
        type={type}
        disabled={isDisabled}
        aria-busy={loading}
        className={`inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap select-none cursor-pointer transition-all duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] active:translate-y-[1px] active:scale-[0.985] disabled:cursor-not-allowed ${
          isBusy ? 'opacity-95 pointer-events-none' : 'disabled:opacity-45 disabled:pointer-events-none'
        } ${sizeClasses} ${variantClasses} ${
          fullWidth ? 'w-full flex-1 min-w-0' : 'shrink-0'
        } ${className}`}
        {...rest}
      >
        {loading ? (
          <span className="shrink-0 flex items-center" aria-hidden="true">
            <Loader2 className="w-4 h-4 animate-spin" />
          </span>
        ) : success ? (
          <span className="shrink-0 flex items-center" aria-hidden="true">
            <Check className="w-4 h-4 stroke-[2.5]" />
          </span>
        ) : (
          icon && <span className="shrink-0 flex items-center">{icon}</span>
        )}
        {(success && successLabel) || children ? (
          <span>{success && successLabel ? successLabel : children}</span>
        ) : null}
      </button>
    );
  }
);

TactileButton.displayName = 'TactileButton';
