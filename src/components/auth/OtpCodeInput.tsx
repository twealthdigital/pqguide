import React, { useRef } from 'react';

interface OtpCodeInputProps {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  hasError?: boolean;
}

export const OtpCodeInput: React.FC<OtpCodeInputProps> = ({
  value,
  onChange,
  disabled = false,
  hasError = false,
}) => {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length: 6 }, (_, idx) => value[idx] ?? '');

  const handleDigitChange = (idx: number, raw: string) => {
    const cleaned = raw.replace(/\D/g, '');
    if (!cleaned) {
      const nextArr = [...digits];
      nextArr[idx] = '';
      onChange(nextArr.join(''));
      return;
    }

    if (cleaned.length > 1) {
      const merged = cleaned.slice(0, 6);
      onChange(merged);
      const focusIdx = Math.min(5, merged.length - 1);
      inputRefs.current[focusIdx]?.focus();
      return;
    }

    const nextArr = [...digits];
    nextArr[idx] = cleaned;
    onChange(nextArr.join(''));
    if (idx < 5) {
      inputRefs.current[idx + 1]?.focus();
    }
  };

  const handleKeyDown = (
    idx: number,
    e: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (e.key === 'Backspace' && !digits[idx] && idx > 0) {
      inputRefs.current[idx - 1]?.focus();
    } else if (e.key === 'ArrowLeft' && idx > 0) {
      inputRefs.current[idx - 1]?.focus();
    } else if (e.key === 'ArrowRight' && idx < 5) {
      inputRefs.current[idx + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    e.preventDefault();
    onChange(pasted);
    const focusIdx = Math.min(5, pasted.length - 1);
    inputRefs.current[focusIdx]?.focus();
  };

  return (
    <div
      className="grid grid-cols-6 gap-2 sm:gap-2.5"
      role="group"
      aria-label="6-digit verification code"
    >
      {digits.map((digit, idx) => (
        <input
          key={idx}
          ref={(el) => {
            inputRefs.current[idx] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={idx === 0 ? 'one-time-code' : 'off'}
          maxLength={6}
          disabled={disabled}
          value={digit}
          onChange={(e) => handleDigitChange(idx, e.target.value)}
          onKeyDown={(e) => handleKeyDown(idx, e)}
          onPaste={handlePaste}
          aria-label={`Digit ${idx + 1}`}
          aria-invalid={hasError}
          className={`h-12 sm:h-13 w-full rounded-2xl border bg-[#F8F9FB] focus:bg-white text-center font-mono-tabular text-lg font-bold text-[#1A1B20] transition-colors disabled:opacity-55 ${
            hasError
              ? 'border-[#DC2626] focus:border-[#B91C1C]'
              : 'border-[#1A1B20]/15 focus:border-[#1D1E23]'
          }`}
        />
      ))}
    </div>
  );
};
