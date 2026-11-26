import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Lock,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import {
  authService,
  evaluatePasswordStrength,
  IS_DEV_BOOTSTRAP_ENV,
  validateEmailAddress,
} from '../../services/authService';
import { TactileButton } from '../ui/TactileButton';
import { AuthPortalShell } from './AuthPortalShell';
import { OtpVerificationStep } from './OtpVerificationStep';
import { PasswordField } from './PasswordField';
import { PasswordStrengthMeter } from './PasswordStrengthMeter';
import type { AuthView, PortalAuthProps } from './types';

type SuperAdminActionKey =
  | 'signin'
  | 'dev_bootstrap'
  | 'dev_reset'
  | 'resend_code'
  | 'forgot_request'
  | 'forgot_verify'
  | 'forgot_save';

const ALLOWED_SUPER_ADMIN_VIEWS = new Set<AuthView>([
  'signin',
  'forgot_request',
  'forgot_verify',
  'forgot_reset',
  'forgot_success',
  'dev_super_admin_setup',
]);

export const SuperAdminAuthPortal: React.FC<PortalAuthProps> = ({
  view: rawView,
  sessionNotice,
  onDismissSessionNotice,
  onSwitchView,
  onGoBack,
  onAuthenticated,
  onBusyChange,
}) => {
  const view: AuthView =
    rawView === 'dev_super_admin_setup' && !(import.meta.env.DEV && IS_DEV_BOOTSTRAP_ENV)
      ? 'signin'
      : ALLOWED_SUPER_ADMIN_VIEWS.has(rawView)
        ? rawView
        : 'signin';

  const [activeAction, setActiveAction] = useState<SuperAdminActionKey | null>(null);
  const [successAction, setSuccessAction] = useState<SuperAdminActionKey | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  // Sign-in state
  const [signinEmail, setSigninEmail] = useState('');
  const [signinPassword, setSigninPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);

  // Dev-only bootstrap state
  const [devBootstrapAvailable, setDevBootstrapAvailable] = useState(() =>
    authService.isDevBootstrapAvailable()
  );
  const [devFullName, setDevFullName] = useState('');
  const [devEmail, setDevEmail] = useState('');
  const [devPassword, setDevPassword] = useState('');
  const [devConfirmPassword, setDevConfirmPassword] = useState('');
  const [devConfirmPhrase, setDevConfirmPhrase] = useState('');
  const [showDevResetBox, setShowDevResetBox] = useState(false);
  const [devResetPhrase, setDevResetPhrase] = useState('');

  // Recovery state
  const [pendingEmail, setPendingEmail] = useState('');
  const [pendingCodePreview, setPendingCodePreview] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [forgotEmail, setForgotEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const timersRef = useRef<number[]>([]);
  const mountedRef = useRef(true);
  const keepNoticeRef = useRef(false);

  const isBusy = activeAction !== null || successAction !== null;

  useEffect(() => {
    onBusyChange?.(isBusy);
  }, [isBusy, onBusyChange]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      timersRef.current.forEach((id) => window.clearTimeout(id));
      timersRef.current = [];
    };
  }, []);

  useEffect(() => {
    setErrorMsg(null);
    if (keepNoticeRef.current) {
      keepNoticeRef.current = false;
    } else {
      setInfoMsg(null);
    }
  }, [view]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = window.setTimeout(() => {
      setResendCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearTimeout(id);
  }, [resendCooldown]);

  const scheduleDelay = (ms: number) =>
    new Promise<void>((resolve) => {
      const id = window.setTimeout(() => resolve(), ms);
      timersRef.current.push(id);
    });

  const navigateView = (next: AuthView, keepNotices = false, replace = false) => {
    if (isBusy) return;
    keepNoticeRef.current = keepNotices;
    setErrorMsg(null);
    if (!keepNotices) setInfoMsg(null);
    onSwitchView(next, { replace });
  };

  const navigateBack = (fallback: AuthView) => {
    if (isBusy) return;
    keepNoticeRef.current = false;
    setErrorMsg(null);
    setInfoMsg(null);
    onGoBack(fallback);
  };

  const devPwReport = useMemo(
    () => evaluatePasswordStrength(devPassword, 'super_admin'),
    [devPassword]
  );
  const devConfirmError =
    devConfirmPassword && devPassword !== devConfirmPassword
      ? 'Passwords do not match.'
      : null;

  const resetPwReport = useMemo(
    () => evaluatePasswordStrength(newPassword, 'super_admin'),
    [newPassword]
  );
  const resetConfirmError =
    confirmNewPassword && newPassword !== confirmNewPassword ? 'Passwords do not match.' : null;

  const isDevBootstrapFormValid =
    devFullName.trim().length >= 2 &&
    validateEmailAddress(devEmail) &&
    devPwReport.meetsMinimum &&
    devPassword === devConfirmPassword &&
    devConfirmPhrase.trim().toUpperCase() === 'INITIALIZE SUPER ADMIN';

  const handleSignInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setErrorMsg(null);
    setInfoMsg(null);
    setActiveAction('signin');

    await scheduleDelay(420);
    if (!mountedRef.current) return;

    const result = await authService.signinWithPortal(
      'super_admin',
      signinEmail,
      signinPassword,
      rememberMe
    );
    if (!mountedRef.current) return;

    if (!result.ok || !result.data) {
      setActiveAction(null);
      setErrorMsg(result.error ?? 'Authentication failed.');
      return;
    }

    setActiveAction(null);
    setSuccessAction('signin');
    await scheduleDelay(420);
    if (!mountedRef.current) return;

    setSuccessAction(null);
    onAuthenticated(result.data.account, rememberMe);
  };

  const handleDevBootstrapSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setErrorMsg(null);
    setInfoMsg(null);
    setActiveAction('dev_bootstrap');

    await scheduleDelay(420);
    if (!mountedRef.current) return;

    const result = await authService.bootstrapFirstSuperAdmin({
      fullName: devFullName,
      email: devEmail,
      password: devPassword,
      confirmPassword: devConfirmPassword,
      confirmationPhrase: devConfirmPhrase,
      rememberMe,
    });
    if (!mountedRef.current) return;

    if (!result.ok || !result.data) {
      setActiveAction(null);
      setErrorMsg(result.error ?? 'Bootstrap failed.');
      return;
    }

    setDevBootstrapAvailable(false);
    setActiveAction(null);
    setSuccessAction('dev_bootstrap');
    await scheduleDelay(450);
    if (!mountedRef.current) return;

    setSuccessAction(null);
    onAuthenticated(result.data.account, rememberMe);
  };

  const handleDevResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setErrorMsg(null);
    setInfoMsg(null);
    setActiveAction('dev_reset');

    await scheduleDelay(300);
    if (!mountedRef.current) return;

    const result = authService.resetLocalDevData(devResetPhrase, null);
    setActiveAction(null);
    if (!result.ok) {
      setErrorMsg(result.error ?? 'Could not reset local development data.');
      return;
    }

    setDevBootstrapAvailable(authService.isDevBootstrapAvailable());
    setDevResetPhrase('');
    setShowDevResetBox(false);
    setInfoMsg('Local development storage cleared. You can initialize a Super Admin now.');
  };

  const handleForgotRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setErrorMsg(null);
    setInfoMsg(null);
    setActiveAction('forgot_request');

    await scheduleDelay(420);
    if (!mountedRef.current) return;

    const result = authService.requestPasswordReset(forgotEmail, 'super_admin');
    if (!mountedRef.current) return;

    if (!result.ok || !result.data) {
      setActiveAction(null);
      setErrorMsg(result.error ?? 'No verified Super Admin matches that email.');
      return;
    }

    setActiveAction(null);
    setSuccessAction('forgot_request');
    await scheduleDelay(450);
    if (!mountedRef.current) return;

    setSuccessAction(null);
    setPendingEmail(result.data.email);
    setPendingCodePreview(result.data.verificationCode ?? '');
    setOtpCode('');
    setResendCooldown(30);
    setInfoMsg(`Security recovery code sent to ${result.data.email}.`);
    navigateView('forgot_verify', true);
  };

  const handleForgotVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setErrorMsg(null);
    setActiveAction('forgot_verify');

    await scheduleDelay(400);
    if (!mountedRef.current) return;

    const result = authService.verifyResetCode(pendingEmail, otpCode);
    if (!mountedRef.current) return;

    if (!result.ok) {
      setActiveAction(null);
      setErrorMsg(result.error ?? 'Invalid security code.');
      return;
    }

    setActiveAction(null);
    setSuccessAction('forgot_verify');
    await scheduleDelay(450);
    if (!mountedRef.current) return;

    setSuccessAction(null);
    setNewPassword('');
    setConfirmNewPassword('');
    setInfoMsg('Security code verified. Set a strong new Super Admin password.');
    navigateView('forgot_reset', true);
  };

  const handleForgotResetSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setErrorMsg(null);
    setActiveAction('forgot_save');

    await scheduleDelay(450);
    if (!mountedRef.current) return;

    const result = await authService.completePasswordReset(
      pendingEmail,
      newPassword,
      confirmNewPassword
    );
    if (!mountedRef.current) return;

    if (!result.ok || !result.data) {
      setActiveAction(null);
      setErrorMsg(result.error ?? 'Unable to update password.');
      return;
    }

    setActiveAction(null);
    setSuccessAction('forgot_save');
    setSigninEmail(result.data.identifier);
    setSigninPassword('');
    await scheduleDelay(450);
    if (!mountedRef.current) return;

    setSuccessAction(null);
    navigateView('forgot_success', true, true);
  };

  const handleResendCode = async () => {
    if (isBusy || resendCooldown > 0) return;
    setErrorMsg(null);
    setActiveAction('resend_code');

    await scheduleDelay(380);
    if (!mountedRef.current) return;

    const result = authService.resendCode(pendingEmail, 'reset');
    if (!mountedRef.current) return;

    if (!result.ok || !result.data) {
      setActiveAction(null);
      setErrorMsg(result.error ?? 'Could not resend code.');
      return;
    }

    setActiveAction(null);
    setSuccessAction('resend_code');
    setPendingCodePreview(result.data.verificationCode ?? '');
    setOtpCode('');
    setResendCooldown(30);
    setInfoMsg(`Fresh security code sent to ${pendingEmail}.`);

    await scheduleDelay(550);
    if (!mountedRef.current) return;
    setSuccessAction(null);
  };

  const headingMap: Record<string, string> = {
    signin: 'Super Admin Console',
    forgot_request: 'Super Admin Recovery',
    forgot_verify: 'Verify Security Code',
    forgot_reset: 'Set New Super Admin Password',
    forgot_success: 'Console Password Updated',
    dev_super_admin_setup: 'Dev Super Admin Bootstrap',
  };

  const subheadingMap: Record<string, string> = {
    signin: 'Restricted platform control authentication. Enter your registered Super Admin credentials.',
    forgot_request: 'Enter the registered Super Admin email to initiate recovery verification.',
    forgot_verify: `Enter the 6-digit verification code sent to ${pendingEmail}.`,
    forgot_reset: 'Create a 10+ character password containing uppercase, lowercase, and numbers.',
    forgot_success: 'Your Super Admin password has been reset successfully.',
    dev_super_admin_setup: 'Development-only one-time initialization for the first local Super Admin account.',
  };

  const handleTopBack = () => {
    if (view === 'forgot_reset') navigateBack('forgot_verify');
    else if (view === 'forgot_verify') navigateBack('forgot_request');
    else navigateBack('signin');
  };

  return (
    <AuthPortalShell
      portalTag="Restricted Console · Super Admin"
      portalTagTone="super_admin"
      brandHeadline="PQGuide Control Room"
      brandDescription="Platform-wide governance, university administration, moderation audits, broadcasts, and payment verification."
      brandFooter="Authorized Super Administrator access only · Public registration & social login disabled."
      heading={headingMap[view] ?? 'Super Admin Console'}
      subheading={subheadingMap[view] ?? ''}
      showBackButton={view !== 'signin'}
      onBackClick={handleTopBack}
      disableBack={isBusy}
      errorMsg={errorMsg}
      infoMsg={infoMsg}
      sessionNotice={sessionNotice}
      onDismissSessionNotice={onDismissSessionNotice}
    >
      {/* SIGN IN */}
      {view === 'signin' && (
        <div className="space-y-4 page-enter">
          <div className="rounded-2xl bg-[#1D1E23] text-white px-4 py-3 flex items-start gap-2.5 text-xs">
            <Lock className="w-4 h-4 text-[#C3C7D2] shrink-0 mt-0.5" />
            <p className="text-[#D4D7E0] leading-relaxed">
              Privileged governance gateway. Only verified Super Admin credentials provisioned for this console are accepted.
            </p>
          </div>

          <form onSubmit={handleSignInSubmit} className="space-y-4" noValidate>
            <div>
              <label
                htmlFor="super-admin-email"
                className="block text-xs font-semibold text-[#1A1B20] mb-1.5 pl-1"
              >
                Registered Super Admin Email
              </label>
              <input
                id="super-admin-email"
                type="email"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="email"
                disabled={isBusy}
                value={signinEmail}
                onChange={(e) => setSigninEmail(e.target.value)}
                placeholder="superadmin@pqguide.local"
                className="h-12 w-full rounded-full border border-[#1A1B20]/15 bg-white px-4 text-sm text-[#1A1B20] placeholder:text-[#9AA0AE] focus:border-[#1D1E23] transition-colors disabled:opacity-60"
              />
            </div>

            <PasswordField
              id="super-admin-password"
              label="Password"
              value={signinPassword}
              onChange={setSigninPassword}
              disabled={isBusy}
              autoComplete="current-password"
              rightAction={
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => {
                    setForgotEmail(signinEmail);
                    navigateView('forgot_request');
                  }}
                  className="text-xs font-semibold text-[#1D1E23] hover:underline underline-offset-4 cursor-pointer disabled:opacity-45"
                >
                  Forgot password?
                </button>
              }
            />

            <label className="flex items-center gap-2.5 pl-1 cursor-pointer select-none min-h-[32px]">
              <input
                type="checkbox"
                checked={rememberMe}
                disabled={isBusy}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 rounded border-[#1A1B20]/30 accent-[#1D1E23] cursor-pointer"
              />
              <span className="text-xs font-medium text-[#505460]">
                Remember console session across tab reloads (max 12 hours)
              </span>
            </label>

            <TactileButton
              type="submit"
              variant="dark"
              size="lg"
              fullWidth
              className="rounded-full"
              loading={activeAction === 'signin'}
              success={successAction === 'signin'}
              successLabel="Console Unlocked!"
              disabled={isBusy}
            >
              Authenticate Super Admin
            </TactileButton>
          </form>

          {/* Strictly Local Dev Only Bootstrap & Reset */}
          {import.meta.env.DEV && IS_DEV_BOOTSTRAP_ENV && (
            <div className="mt-5 pt-4 border-t border-[#1A1B20]/[0.08] space-y-2.5">
              {devBootstrapAvailable && (
                <button
                  type="button"
                  onClick={() => navigateView('dev_super_admin_setup')}
                  className="w-full min-h-[44px] rounded-2xl border border-[#1A1B20]/12 bg-[#F6F7F9] hover:bg-[#ECEEF3] px-3.5 py-2.5 text-left flex items-center justify-between gap-3 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <ShieldCheck className="w-4 h-4 text-[#1D1E23] shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[#1A1B20] truncate">
                        Local Dev Setup: Initialize First Super Admin
                      </p>
                      <p className="text-[11px] text-[#686C78] truncate">
                        Development mode only · Locks after initialization
                      </p>
                    </div>
                  </div>
                </button>
              )}

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => setShowDevResetBox((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#686C78] hover:text-[#1A1B20] cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Local Dev Data Reset</span>
                </button>
              </div>

              {showDevResetBox && (
                <form
                  onSubmit={handleDevResetSubmit}
                  className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/10 p-3.5 space-y-2.5"
                >
                  <p className="text-[11px] text-[#505460] leading-relaxed">
                    Clears local accounts, sessions, and bootstrap lock in development storage only. Type{' '}
                    <span className="font-mono-tabular font-bold text-[#1A1B20]">
                      RESET DEV DATA
                    </span>{' '}
                    to confirm.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={devResetPhrase}
                      onChange={(e) => setDevResetPhrase(e.target.value)}
                      placeholder="RESET DEV DATA"
                      className="flex-1 min-h-[38px] rounded-xl bg-white border border-[#1A1B20]/15 px-3 text-xs font-mono-tabular text-[#1A1B20]"
                    />
                    <TactileButton
                      type="submit"
                      variant="dark"
                      size="sm"
                      loading={activeAction === 'dev_reset'}
                    >
                      Reset
                    </TactileButton>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      )}

      {/* DEV-ONLY FIRST SUPER ADMIN BOOTSTRAP */}
      {view === 'dev_super_admin_setup' && import.meta.env.DEV && IS_DEV_BOOTSTRAP_ENV && (
        <div className="space-y-4 page-enter">
          <div className="rounded-2xl bg-[#FFFBEB] border border-[#FDE68A] px-4 py-3 text-xs text-[#92400E] leading-relaxed">
            <p className="font-bold">Local Development Only — Disabled in Production</p>
            <p className="mt-0.5">
              Creates your first local Super Admin in browser storage and permanently locks further bootstrap attempts unless local dev data is reset.
            </p>
          </div>

          {!devBootstrapAvailable ? (
            <div className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/10 p-5 text-center space-y-3">
              <p className="text-sm font-bold text-[#1A1B20]">Bootstrap Interface Locked</p>
              <p className="text-xs text-[#505460]">
                A Super Admin account has already been initialized for this environment.
              </p>
              <TactileButton
                type="button"
                variant="dark"
                size="md"
                onClick={() => navigateBack('signin')}
              >
                Return to Sign In
              </TactileButton>
            </div>
          ) : (
            <form onSubmit={handleDevBootstrapSubmit} className="space-y-3.5" noValidate>
              <div>
                <label
                  htmlFor="dev-sa-name"
                  className="block text-xs font-semibold text-[#1A1B20] mb-1 pl-1"
                >
                  Super Admin Full Name
                </label>
                <input
                  id="dev-sa-name"
                  type="text"
                  disabled={isBusy}
                  value={devFullName}
                  onChange={(e) => setDevFullName(e.target.value)}
                  placeholder="e.g. Platform Lead"
                  className="h-11 w-full rounded-full border border-[#1A1B20]/15 bg-white px-4 text-sm text-[#1A1B20]"
                />
              </div>

              <div>
                <label
                  htmlFor="dev-sa-email"
                  className="block text-xs font-semibold text-[#1A1B20] mb-1 pl-1"
                >
                  Super Admin Email
                </label>
                <input
                  id="dev-sa-email"
                  type="email"
                  disabled={isBusy}
                  value={devEmail}
                  onChange={(e) => setDevEmail(e.target.value)}
                  placeholder="lead@pqguide.local"
                  className="h-11 w-full rounded-full border border-[#1A1B20]/15 bg-white px-4 text-sm text-[#1A1B20]"
                />
              </div>

              <PasswordField
                id="dev-sa-password"
                label="Password (10+ chars, upper, lower & numbers)"
                value={devPassword}
                onChange={setDevPassword}
                placeholder="Create strong Super Admin password"
                disabled={isBusy}
                autoComplete="new-password"
                compact
              />

              <PasswordStrengthMeter password={devPassword} role="super_admin" />

              <PasswordField
                id="dev-sa-confirm"
                label="Confirm Password"
                value={devConfirmPassword}
                onChange={setDevConfirmPassword}
                placeholder="Re-enter password"
                disabled={isBusy}
                autoComplete="new-password"
                error={devConfirmError}
                compact
              />

              <div>
                <label
                  htmlFor="dev-sa-phrase"
                  className="block text-xs font-semibold text-[#1A1B20] mb-1 pl-1"
                >
                  Type <span className="font-mono-tabular">INITIALIZE SUPER ADMIN</span>
                </label>
                <input
                  id="dev-sa-phrase"
                  type="text"
                  disabled={isBusy}
                  value={devConfirmPhrase}
                  onChange={(e) => setDevConfirmPhrase(e.target.value)}
                  placeholder="INITIALIZE SUPER ADMIN"
                  className="h-11 w-full rounded-full border border-[#1A1B20]/15 bg-white px-4 font-mono-tabular text-sm text-[#1A1B20]"
                />
              </div>

              <TactileButton
                type="submit"
                variant="dark"
                size="lg"
                fullWidth
                className="rounded-full"
                loading={activeAction === 'dev_bootstrap'}
                success={successAction === 'dev_bootstrap'}
                successLabel="Super Admin Ready!"
                disabled={isBusy || !isDevBootstrapFormValid}
              >
                Initialize Dev Super Admin
              </TactileButton>
            </form>
          )}

          <div className="text-center pt-1">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => navigateBack('signin')}
              className="text-xs font-semibold text-[#686C78] hover:text-[#1A1B20] inline-flex items-center gap-1 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Super Admin Sign In</span>
            </button>
          </div>
        </div>
      )}

      {/* RECOVERY: REQUEST */}
      {view === 'forgot_request' && (
        <form onSubmit={handleForgotRequestSubmit} className="space-y-4 page-enter" noValidate>
          <div>
            <label
              htmlFor="super-admin-forgot-email"
              className="block text-xs font-semibold text-[#1A1B20] mb-1.5 pl-1"
            >
              Registered Super Admin Email
            </label>
            <input
              id="super-admin-forgot-email"
              type="email"
              autoComplete="email"
              disabled={isBusy}
              value={forgotEmail}
              onChange={(e) => setForgotEmail(e.target.value)}
              placeholder="superadmin@pqguide.local"
              className="h-12 w-full rounded-full border border-[#1A1B20]/15 bg-white px-4 text-sm text-[#1A1B20] placeholder:text-[#9AA0AE] focus:border-[#1D1E23] transition-colors disabled:opacity-60"
            />
          </div>

          <TactileButton
            type="submit"
            variant="dark"
            size="lg"
            fullWidth
            className="rounded-full"
            loading={activeAction === 'forgot_request'}
            success={successAction === 'forgot_request'}
            successLabel="Code Sent!"
            disabled={isBusy || !validateEmailAddress(forgotEmail)}
          >
            Send Recovery Code
          </TactileButton>

          <div className="text-center pt-1">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => navigateBack('signin')}
              className="text-xs font-semibold text-[#686C78] hover:text-[#1A1B20] inline-flex items-center gap-1 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Console Sign In</span>
            </button>
          </div>
        </form>
      )}

      {/* RECOVERY: VERIFY OTP */}
      {view === 'forgot_verify' && (
        <form onSubmit={handleForgotVerifySubmit} className="space-y-4 page-enter" noValidate>
          <OtpVerificationStep
            email={pendingEmail}
            otpCode={otpCode}
            onOtpChange={setOtpCode}
            previewCode={pendingCodePreview}
            disabled={isBusy}
            hasError={Boolean(errorMsg)}
            changeEmailLabel="Change email"
            onChangeEmail={() => navigateBack('forgot_request')}
          />

          <div className="space-y-2.5 pt-1">
            <TactileButton
              type="submit"
              variant="dark"
              size="lg"
              fullWidth
              className="rounded-full"
              loading={activeAction === 'forgot_verify'}
              success={successAction === 'forgot_verify'}
              successLabel="Verified!"
              disabled={isBusy || otpCode.length !== 6}
            >
              Verify Security Code
            </TactileButton>

            <TactileButton
              type="button"
              variant="light"
              size="md"
              fullWidth
              className="rounded-full"
              icon={<RefreshCw className="w-3.5 h-3.5" />}
              loading={activeAction === 'resend_code'}
              success={successAction === 'resend_code'}
              successLabel="New Code Sent!"
              disabled={isBusy || resendCooldown > 0}
              onClick={handleResendCode}
            >
              {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
            </TactileButton>
          </div>
        </form>
      )}

      {/* RECOVERY: NEW PASSWORD */}
      {view === 'forgot_reset' && (
        <form onSubmit={handleForgotResetSave} className="space-y-4 page-enter" noValidate>
          <PasswordField
            id="super-admin-new-pw"
            label="New Super Admin Password"
            value={newPassword}
            onChange={setNewPassword}
            placeholder="10+ chars with upper, lower & number"
            disabled={isBusy}
            autoComplete="new-password"
          />

          <PasswordStrengthMeter password={newPassword} role="super_admin" />

          <PasswordField
            id="super-admin-confirm-new-pw"
            label="Confirm New Password"
            value={confirmNewPassword}
            onChange={setConfirmNewPassword}
            placeholder="Re-enter your new password"
            disabled={isBusy}
            autoComplete="new-password"
            error={resetConfirmError}
          />

          <TactileButton
            type="submit"
            variant="dark"
            size="lg"
            fullWidth
            className="rounded-full"
            loading={activeAction === 'forgot_save'}
            success={successAction === 'forgot_save'}
            successLabel="Password Updated!"
            disabled={
              isBusy || !resetPwReport.meetsMinimum || newPassword !== confirmNewPassword
            }
          >
            Update Super Admin Password
          </TactileButton>
        </form>
      )}

      {/* RECOVERY: SUCCESS */}
      {view === 'forgot_success' && (
        <div className="space-y-5 page-enter">
          <div className="rounded-3xl bg-[#F0FDF4] border border-[#BBF7D0] p-5 space-y-2.5">
            <div className="flex items-center gap-3">
              <span className="h-11 w-11 rounded-2xl bg-[#16A34A] text-white flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-6 h-6" />
              </span>
              <div>
                <p className="font-display text-base font-bold text-[#14532D]">
                  Console Password Reset
                </p>
                <p className="text-xs text-[#15803D]">{pendingEmail}</p>
              </div>
            </div>
            <p className="text-xs text-[#166534] leading-relaxed">
              Your Super Admin credentials have been updated cleanly. Sign in below to enter the Control Room.
            </p>
          </div>

          <TactileButton
            type="button"
            variant="dark"
            size="lg"
            fullWidth
            className="rounded-full"
            onClick={() => navigateView('signin', false, true)}
          >
            Return to Console Sign In
          </TactileButton>
        </div>
      )}
    </AuthPortalShell>
  );
};
