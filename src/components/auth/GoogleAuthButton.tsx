import React from 'react';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { getGoogleOAuthConfigStatus } from '../../services/auth/googleAuthService';

interface GoogleAuthButtonProps {
  mode: 'signin' | 'signup';
  loading: boolean;
  success: boolean;
  disabled?: boolean;
  statusMessage?: { tone: 'error' | 'warning' | 'success'; text: string } | null;
  onClick: () => void;
}

export const GoogleAuthButton: React.FC<GoogleAuthButtonProps> = ({
  mode,
  loading,
  success,
  disabled = false,
  statusMessage,
  onClick,
}) => {
  const config = getGoogleOAuthConfigStatus();

  return (
    <div className="space-y-2.5">
      <div className="relative flex items-center py-1" aria-hidden="true">
        <div className="flex-grow border-t border-[#1A1B20]/[0.09]" />
        <span className="mx-3 shrink-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#8E93A2]">
          Or continue with
        </span>
        <div className="flex-grow border-t border-[#1A1B20]/[0.09]" />
      </div>

      <button
        type="button"
        disabled={disabled || loading || success}
        onClick={onClick}
        aria-label={mode === 'signup' ? 'Register with Google' : 'Continue with Google'}
        className={`w-full min-h-[48px] px-5 rounded-full border text-sm font-semibold flex items-center justify-center gap-3 transition-all duration-150 cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed ${
          success
            ? 'bg-[#F0FDF4] border-[#BBF7D0] text-[#15803D]'
            : 'bg-white border-[#1A1B20]/15 text-[#1A1B20] hover:bg-[#F6F7F9] active:scale-[0.99]'
        }`}
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin text-[#1D1E23]" />
            <span>Connecting to Google...</span>
          </>
        ) : success ? (
          <>
            <CheckCircle2 className="w-4 h-4 text-[#16A34A]" />
            <span>Google Account Verified</span>
          </>
        ) : (
          <>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="w-4 h-4 shrink-0"
            >
              <path
                fill="#4285F4"
                d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.54 5.54 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.54-5.17 3.54-8.87Z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.07 7.94-2.9l-3.88-3c-1.07.72-2.44 1.15-4.06 1.15-3.12 0-5.77-2.11-6.72-4.95H1.28v3.09A12 12 0 0 0 12 24Z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.3a7.2 7.2 0 0 1 0-4.6V6.61H1.28a12 12 0 0 0 0 10.78l4-3.09Z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.76 0 3.34.6 4.58 1.79l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.61l4 3.09C6.23 6.86 8.88 4.75 12 4.75Z"
              />
            </svg>
            <span>{mode === 'signup' ? 'Continue with Google' : 'Continue with Google'}</span>
          </>
        )}
      </button>

      {!config.ready && !statusMessage && (
        <p className="text-center text-[11px] text-[#686C78] leading-relaxed px-2">
          Student Google Sign-In requires <span className="font-mono-tabular">VITE_GOOGLE_OAUTH_CLIENT_ID</span> and backend verification via <span className="font-mono-tabular">VITE_AUTH_API_BASE_URL</span>.
        </p>
      )}

      {statusMessage && (
        <div
          role={statusMessage.tone === 'error' ? 'alert' : 'status'}
          className={`rounded-2xl px-3.5 py-2.5 text-xs flex items-start gap-2 border ${
            statusMessage.tone === 'error'
              ? 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
              : statusMessage.tone === 'warning'
                ? 'bg-[#FFFBEB] border-[#FDE68A] text-[#92400E]'
                : 'bg-[#F0FDF4] border-[#BBF7D0] text-[#15803D]'
          }`}
        >
          {statusMessage.tone === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <span className="leading-relaxed">{statusMessage.text}</span>
        </div>
      )}
    </div>
  );
};
