import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  autoComplete?: string;
  error?: string | null;
  rightAction?: React.ReactNode;
  compact?: boolean;
}

export const PasswordField: React.FC<PasswordFieldProps> = ({
  id,
  label,
  value,
  onChange,
  placeholder = 'Your password',
  disabled = false,
  autoComplete = 'current-password',
  error,
  rightAction,
  compact = false,
}) => {
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5 px-1 gap-2">
        <label
          htmlFor={id}
          className="block text-xs font-semibold text-[#1A1B20]"
        >
          {label}
        </label>
        {rightAction}
      </div>

      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`${compact ? 'h-11' : 'h-12'} w-full rounded-full border bg-white pl-4 pr-12 text-sm text-[#1A1B20] placeholder:text-[#9AA0AE] transition-colors disabled:opacity-60 ${
            error
              ? 'border-[#DC2626] focus:border-[#B91C1C]'
              : 'border-[#1A1B20]/15 focus:border-[#1D1E23]'
          }`}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => setVisible((prev) => !prev)}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full flex items-center justify-center text-[#686C78] hover:text-[#1A1B20] cursor-pointer disabled:opacity-45"
        >
          {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>

      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 pl-2 text-[11px] font-medium text-[#B91C1C]">
          {error}
        </p>
      )}
    </div>
  );
};
