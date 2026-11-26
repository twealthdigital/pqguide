import React, { useEffect, useState } from 'react';
import { Check, Copy, Edit3, Mail } from 'lucide-react';
import { IS_DEV_BOOTSTRAP_ENV } from '../../services/authService';
import { OtpCodeInput } from './OtpCodeInput';

interface OtpVerificationStepProps {
  email: string;
  otpCode: string;
  onOtpChange: (next: string) => void;
  previewCode?: string;
  deliveryMode?: 'email' | 'preview';
  disabled?: boolean;
  hasError?: boolean;
  onChangeEmail?: () => void;
  changeEmailLabel?: string;
}

export const OtpVerificationStep: React.FC<OtpVerificationStepProps> = ({
  email,
  otpCode,
  onOtpChange,
  previewCode,
  deliveryMode,
  disabled = false,
  hasError = false,
  onChangeEmail,
  changeEmailLabel = 'Change email',
}) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(id);
  }, [copied]);

  const handleCopyPreview = () => {
    if (!previewCode) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(previewCode).catch(() => {});
    }
    onOtpChange(previewCode);
    setCopied(true);
  };

  return (
    <div className="space-y-3.5">
      {/* Target email confirmation pill */}
      <div className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/[0.08] px-3.5 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="h-8 w-8 rounded-xl bg-white border border-[#1A1B20]/10 text-[#1D1E23] flex items-center justify-center shrink-0">
            <Mail className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-[#686C78]">
              {deliveryMode === 'email'
                ? 'Human-verification email sent to'
                : 'Verification target'}
            </p>
            <p className="text-xs font-bold text-[#1A1B20] truncate">
              {email}
            </p>
          </div>
        </div>
        {onChangeEmail && (
          <button
            type="button"
            disabled={disabled}
            onClick={onChangeEmail}
            className="min-h-[34px] px-2.5 rounded-xl bg-white border border-[#1A1B20]/10 text-[11px] font-semibold text-[#1A1B20] hover:bg-[#ECEEF3] inline-flex items-center gap-1 shrink-0 cursor-pointer disabled:opacity-45"
          >
            <Edit3 className="w-3 h-3" />
            <span>{changeEmailLabel}</span>
          </button>
        )}
      </div>

      {/* Development-Only OTP Inbox Preview — shown only when RESEND_API_KEY is not set in local dev */}
      {import.meta.env.DEV && IS_DEV_BOOTSTRAP_ENV && Boolean(previewCode) && (
        <div className="rounded-2xl bg-[#FFFBEB] border border-[#FDE68A] p-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.06em] text-[#92400E]">
              Preview Code (Add RESEND_API_KEY for Real Inbox Delivery)
            </p>
            <p className="font-mono-tabular text-sm font-bold text-[#78350F] truncate mt-0.5">
              Code: {previewCode}
            </p>
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={handleCopyPreview}
            className="min-h-[34px] px-3 rounded-xl bg-white border border-[#F59E0B]/30 text-xs font-semibold text-[#78350F] inline-flex items-center gap-1.5 shrink-0 cursor-pointer hover:bg-[#FEF3C7] disabled:opacity-45"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-[#16A34A]" />
                <span>Filled</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Auto-fill</span>
              </>
            )}
          </button>
        </div>
      )}

      <div>
        <label className="block text-xs font-semibold text-[#1A1B20] mb-2 pl-1">
          Enter 6-Digit Verification Code
        </label>
        <OtpCodeInput
          value={otpCode}
          onChange={onOtpChange}
          disabled={disabled}
          hasError={hasError}
        />
      </div>
    </div>
  );
};
