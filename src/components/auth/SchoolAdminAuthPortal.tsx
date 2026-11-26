import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import type { AuthenticatedUser } from '../../core/types';
import {
  authService,
  evaluatePasswordStrength,
  validateEmailAddress,
} from '../../services/authService';
import { TactileButton } from '../ui/TactileButton';
import { AuthPortalShell } from './AuthPortalShell';
import { OtpVerificationStep } from './OtpVerificationStep';
import { PasswordField } from './PasswordField';
import { PasswordStrengthMeter } from './PasswordStrengthMeter';
import type { AuthView, PortalAuthProps } from './types';

type SchoolAdminActionKey =
  | 'signin'
  | 'admin_activate_request'
  | 'admin_activate_complete'
  | 'resend_code'
  | 'forgot_request'
  | 'forgot_verify'
  | 'forgot_save';

const ALLOWED_SCHOOL_ADMIN_VIEWS = new Set<AuthView>([
  'signin',
  'admin_activate_request',
  'admin_activate_verify',
  'admin_activate_success',
  'forgot_request',
  'forgot_verify',
  'forgot_reset',
  'forgot_success',
]);

export const SchoolAdminAuthPortal: React.FC<PortalAuthProps> = ({
  view: rawView,
  sessionNotice,
  onDismissSessionNotice,
  onSwitchView,
  onGoBack,
  onAuthenticated,
  onBusyChange,
}) => {
  const view: AuthView = ALLOWED_SCHOOL_ADMIN_VIEWS.has(rawView) ? rawView : 'signin';

  const [activeAction, setActiveAction] = useState<SchoolAdminActionKey | null>(null);
  const [successAction, setSuccessAction] = useState<SchoolAdminActionKey | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  // Sign-in state
  const [signinEmail, setSigninEmail] = useState('');
  const [signinPassword, setSigninPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);

  // Activation state
  const [activateEmail, setActivateEmail] = useState('');
  const [activatedSchoolCode, setActivatedSchoolCode] = useState('');
  const [activatedFullName, setActivatedFullName] = useState('');
  const [activatePassword, setActivatePassword] = useState('');
  const [activateConfirmPassword, setActivateConfirmPassword] = useState('');
  const [activatedAccount, setActivatedAccount] = useState<AuthenticatedUser | null>(null);

  // OTP & Recovery state
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

  const activatePwReport = useMemo(
    () => evaluatePasswordStrength(activatePassword, 'school_admin'),
    [activatePassword]
  );
  const activateConfirmError =
    activateConfirmPassword && activatePassword !== activateConfirmPassword
      ? 'Passwords do not match.'
      : null;

  const resetPwReport = useMemo(
    () => evaluatePasswordStrength(newPassword, 'school_admin'),
    [newPassword]
  );
  const resetConfirmError =
    confirmNewPassword && newPassword !== confirmNewPassword ? 'Passwords do not match.' : null;

  const handleSignInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setErrorMsg(null);
    setInfoMsg(null);
    setActiveAction('signin');

    await scheduleDelay(400);
    if (!mountedRef.current) return;

    const result = await authService.signinWithPortal(
      'school_admin',
      signinEmail,
      signinPassword,
      rememberMe
    );
    if (!mountedRef.current) return;

    if (!result.ok || !result.data) {
      setActiveAction(null);
      setErrorMsg(result.error ?? 'Unable to sign into School Admin Desk.');
      return;
    }

    setActiveAction(null);
    setSuccessAction('signin');
    await scheduleDelay(420);
    if (!mountedRef.current) return;

    setSuccessAction(null);
    onAuthenticated(result.data.account, rememberMe);
  };

  const handleActivateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setErrorMsg(null);
    setInfoMsg(null);
    setActiveAction('admin_activate_request');

    await scheduleDelay(400);
    if (!mountedRef.current) return;

    const result = authService.startSchoolAdminActivation(activateEmail);
    if (!mountedRef.current) return;

    if (!result.ok || !result.data) {
      setActiveAction(null);
      setErrorMsg(result.error ?? 'Could not verify approved administrator email.');
      return;
    }

    setActiveAction(null);
    setPendingEmail(result.data.email);
    setActivatedSchoolCode(result.data.schoolCode);
    setActivatedFullName(result.data.fullName);
    setPendingCodePreview(result.data.verificationCode ?? '');
    setOtpCode('');
    setActivatePassword('');
    setActivateConfirmPassword('');
    setResendCooldown(30);
    setInfoMsg(
      `Approved for ${result.data.schoolCode} (${result.data.fullName}). Verify your 6-digit code and set your administrator password.`
    );
    navigateView('admin_activate_verify', true);
  };

  const handleActivateComplete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setErrorMsg(null);
    setActiveAction('admin_activate_complete');

    await scheduleDelay(450);
    if (!mountedRef.current) return;

    const result = await authService.completeSchoolAdminActivation(
      pendingEmail,
      otpCode,
      activatePassword,
      activateConfirmPassword,
      rememberMe
    );
    if (!mountedRef.current) return;

    if (!result.ok || !result.data) {
      setActiveAction(null);
      setErrorMsg(result.error ?? 'Activation failed.');
      return;
    }

    setActiveAction(null);
    setSuccessAction('admin_activate_complete');
    setActivatedAccount(result.data.account);
    await scheduleDelay(450);
    if (!mountedRef.current) return;

    setSuccessAction(null);
    navigateView('admin_activate_success', true, true);
  };

  const handleResendCode = async (purpose: 'admin_activate' | 'reset') => {
    if (isBusy || resendCooldown > 0) return;
    setErrorMsg(null);
    setActiveAction('resend_code');

    await scheduleDelay(380);
    if (!mountedRef.current) return;

    const result = authService.resendCode(pendingEmail, purpose);
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
    setInfoMsg(`A fresh 6-digit code was sent to ${pendingEmail}.`);

    await scheduleDelay(550);
    if (!mountedRef.current) return;
    setSuccessAction(null);
  };

  const handleForgotRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setErrorMsg(null);
    setInfoMsg(null);
    setActiveAction('forgot_request');

    await scheduleDelay(420);
    if (!mountedRef.current) return;

    const result = authService.requestPasswordReset(forgotEmail, 'school_admin');
    if (!mountedRef.current) return;

    if (!result.ok || !result.data) {
      setActiveAction(null);
      setErrorMsg(result.error ?? 'No approved School Admin account matches this email.');
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
    setInfoMsg(`Reset verification code sent to ${result.data.email}.`);
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
      setErrorMsg(result.error ?? 'Invalid reset code.');
      return;
    }

    setActiveAction(null);
    setSuccessAction('forgot_verify');
    await scheduleDelay(450);
    if (!mountedRef.current) return;

    setSuccessAction(null);
    setNewPassword('');
    setConfirmNewPassword('');
    setInfoMsg('Identity verified. Create your new School Admin password.');
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

  const headingMap: Record<string, string> = {
    signin: 'School Admin Sign In',
    admin_activate_request: 'Activate Approved Email',
    admin_activate_verify: 'Verify & Set Admin Password',
    admin_activate_success: 'School Admin Activated',
    forgot_request: 'Recover Admin Password',
    forgot_verify: 'Verify Reset Code',
    forgot_reset: 'Set New Admin Password',
    forgot_success: 'Password Reset Complete',
  };

  const subheadingMap: Record<string, string> = {
    signin: 'Sign in using the official institutional email approved by your Super Admin.',
    admin_activate_request: 'Verify your Super-Admin approved email address before choosing a password.',
    admin_activate_verify: `Enter the 6-digit OTP for ${pendingEmail} and create your password.`,
    admin_activate_success: 'Your institutional administrator credentials are active.',
    forgot_request: 'Enter your approved School Admin email to receive a password reset code.',
    forgot_verify: `Enter the 6-digit reset code sent to ${pendingEmail}.`,
    forgot_reset: 'Set a strong new institutional password.',
    forgot_success: 'Your School Admin password has been updated.',
  };

  const handleTopBack = () => {
    if (view === 'admin_activate_verify') navigateBack('admin_activate_request');
    else if (view === 'forgot_reset') navigateBack('forgot_verify');
    else if (view === 'forgot_verify') navigateBack('forgot_request');
    else navigateBack('signin');
  };

  return (
    <AuthPortalShell
      portalTag="School Admin Portal"
      portalTagTone="school_admin"
      brandHeadline="Institutional Examination Desk"
      brandDescription="Dedicated portal for approved University Examination Officers to manage campus past questions and institutional notices."
      brandFooter="Institution-approved administrator accounts only · Role & campus locked."
      heading={headingMap[view] ?? 'School Admin Sign In'}
      subheading={subheadingMap[view] ?? ''}
      showBackButton={view !== 'signin' && view !== 'admin_activate_success'}
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
          <div className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/[0.08] px-3.5 py-2.5 flex items-start gap-2.5 text-xs text-[#505460]">
            <Building2 className="w-4 h-4 text-[#1D1E23] shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              School Admin accounts are provisioned by a Super Administrator and scoped to one assigned institution. Public signup is disabled.
            </p>
          </div>

          <form onSubmit={handleSignInSubmit} className="space-y-4" noValidate>
            <div>
              <label
                htmlFor="school-admin-email"
                className="block text-xs font-semibold text-[#1A1B20] mb-1.5 pl-1"
              >
                Official Approved Email
              </label>
              <input
                id="school-admin-email"
                type="email"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="email"
                disabled={isBusy}
                value={signinEmail}
                onChange={(e) => setSigninEmail(e.target.value)}
                placeholder="examoffice@university.edu.ng"
                className="h-12 w-full rounded-full border border-[#1A1B20]/15 bg-white px-4 text-sm text-[#1A1B20] placeholder:text-[#9AA0AE] focus:border-[#1D1E23] transition-colors disabled:opacity-60"
              />
            </div>

            <PasswordField
              id="school-admin-password"
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
                Keep this administrator session active for 12 hours
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
              successLabel="Desk Unlocked!"
              disabled={isBusy}
            >
              Sign in to School Admin Desk
            </TactileButton>
          </form>

          <p className="text-center text-xs text-[#686C78] pt-1">
            First time signing in with an approved email?{' '}
            <button
              type="button"
              disabled={isBusy}
              onClick={() => {
                setActivateEmail(signinEmail.includes('@') ? signinEmail : '');
                navigateView('admin_activate_request');
              }}
              className="font-bold text-[#1D1E23] underline underline-offset-4 cursor-pointer disabled:opacity-45"
            >
              Activate approved email
            </button>
          </p>
        </div>
      )}

      {/* ACTIVATION STEP 1 */}
      {view === 'admin_activate_request' && (
        <form onSubmit={handleActivateRequest} className="space-y-4 page-enter" noValidate>
          <div>
            <label
              htmlFor="activate-admin-email"
              className="block text-xs font-semibold text-[#1A1B20] mb-1.5 pl-1"
            >
              Approved School Admin Email
            </label>
            <input
              id="activate-admin-email"
              type="email"
              autoComplete="email"
              disabled={isBusy}
              value={activateEmail}
              onChange={(e) => setActivateEmail(e.target.value)}
              placeholder="examoffice@university.edu.ng"
              className="h-12 w-full rounded-full border border-[#1A1B20]/15 bg-white px-4 text-sm text-[#1A1B20] placeholder:text-[#9AA0AE] focus:border-[#1D1E23] transition-colors disabled:opacity-60"
            />
          </div>

          <TactileButton
            type="submit"
            variant="dark"
            size="lg"
            fullWidth
            className="rounded-full"
            loading={activeAction === 'admin_activate_request'}
            disabled={isBusy || !validateEmailAddress(activateEmail)}
          >
            Verify Approved Email &amp; Send Code
          </TactileButton>

          <div className="text-center pt-1">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => navigateBack('signin')}
              className="text-xs font-semibold text-[#686C78] hover:text-[#1A1B20] inline-flex items-center gap-1 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to School Admin Login</span>
            </button>
          </div>
        </form>
      )}

      {/* ACTIVATION STEP 2 */}
      {view === 'admin_activate_verify' && (
        <form onSubmit={handleActivateComplete} className="space-y-4 page-enter" noValidate>
          {(activatedSchoolCode || activatedFullName) && (
            <div className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/[0.08] px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs">
              <div className="min-w-0">
                <p className="font-bold text-[#1A1B20] truncate">{activatedFullName}</p>
                <p className="text-[11px] text-[#686C78] truncate">
                  Assigned Institution: <span className="font-mono-tabular font-semibold text-[#1A1B20]">{activatedSchoolCode}</span>
                </p>
              </div>
              <ShieldCheck className="w-4 h-4 text-[#16A34A] shrink-0" />
            </div>
          )}

          <OtpVerificationStep
            email={pendingEmail}
            otpCode={otpCode}
            onOtpChange={setOtpCode}
            previewCode={pendingCodePreview}
            disabled={isBusy}
            hasError={Boolean(errorMsg)}
            changeEmailLabel="Change email"
            onChangeEmail={() => navigateBack('admin_activate_request')}
          />

          <PasswordField
            id="activate-admin-pw"
            label="Create Administrator Password"
            value={activatePassword}
            onChange={setActivatePassword}
            placeholder="8+ chars with upper, lower & number"
            disabled={isBusy}
            autoComplete="new-password"
          />

          <PasswordStrengthMeter password={activatePassword} role="school_admin" />

          <PasswordField
            id="activate-admin-pw2"
            label="Confirm Password"
            value={activateConfirmPassword}
            onChange={setActivateConfirmPassword}
            placeholder="Re-enter administrator password"
            disabled={isBusy}
            autoComplete="new-password"
            error={activateConfirmError}
          />

          <div className="space-y-2.5 pt-1">
            <TactileButton
              type="submit"
              variant="dark"
              size="lg"
              fullWidth
              className="rounded-full"
              loading={activeAction === 'admin_activate_complete'}
              success={successAction === 'admin_activate_complete'}
              successLabel="Activated!"
              disabled={
                isBusy ||
                otpCode.length !== 6 ||
                !activatePwReport.meetsMinimum ||
                activatePassword !== activateConfirmPassword
              }
            >
              Verify &amp; Activate Account
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
              onClick={() => handleResendCode('admin_activate')}
            >
              {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
            </TactileButton>
          </div>
        </form>
      )}

      {/* ACTIVATION SUCCESS SCREEN */}
      {view === 'admin_activate_success' && (
        <div className="space-y-5 page-enter">
          <div className="rounded-3xl bg-[#F0FDF4] border border-[#BBF7D0] p-5 space-y-3">
            <div className="flex items-center gap-3">
              <span className="h-11 w-11 rounded-2xl bg-[#16A34A] text-white flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-6 h-6" />
              </span>
              <div className="min-w-0">
                <p className="font-display text-base font-bold text-[#14532D]">
                  School Admin Access Activated
                </p>
                <p className="text-xs text-[#15803D] truncate">
                  {activatedFullName || activatedAccount?.fullName} · Institution {activatedSchoolCode || activatedAccount?.assignedSchoolCode}
                </p>
              </div>
            </div>
            <p className="text-xs text-[#166534] leading-relaxed">
              Your email <span className="font-semibold">{pendingEmail || activatedAccount?.email}</span> is verified and your administrator password is now set. Your account remains locked to your assigned campus.
            </p>
          </div>

          <TactileButton
            type="button"
            variant="dark"
            size="lg"
            fullWidth
            className="rounded-full"
            onClick={() => {
              if (activatedAccount) {
                onAuthenticated(activatedAccount, rememberMe);
              } else {
                navigateView('signin', false, true);
              }
            }}
          >
            Enter School Admin Dashboard
          </TactileButton>
        </div>
      )}

      {/* PASSWORD RECOVERY: REQUEST */}
      {view === 'forgot_request' && (
        <form onSubmit={handleForgotRequestSubmit} className="space-y-4 page-enter" noValidate>
          <div>
            <label
              htmlFor="school-admin-forgot-email"
              className="block text-xs font-semibold text-[#1A1B20] mb-1.5 pl-1"
            >
              Registered School Admin Email
            </label>
            <input
              id="school-admin-forgot-email"
              type="email"
              autoComplete="email"
              disabled={isBusy}
              value={forgotEmail}
              onChange={(e) => setForgotEmail(e.target.value)}
              placeholder="examoffice@university.edu.ng"
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
              <span>Back to School Admin Login</span>
            </button>
          </div>
        </form>
      )}

      {/* PASSWORD RECOVERY: VERIFY OTP */}
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
              successLabel="Code Verified!"
              disabled={isBusy || otpCode.length !== 6}
            >
              Verify Recovery Code
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
              onClick={() => handleResendCode('reset')}
            >
              {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
            </TactileButton>
          </div>
        </form>
      )}

      {/* PASSWORD RECOVERY: SET PASSWORD */}
      {view === 'forgot_reset' && (
        <form onSubmit={handleForgotResetSave} className="space-y-4 page-enter" noValidate>
          <PasswordField
            id="school-admin-new-pw"
            label="New Administrator Password"
            value={newPassword}
            onChange={setNewPassword}
            placeholder="8+ chars with upper, lower & number"
            disabled={isBusy}
            autoComplete="new-password"
          />

          <PasswordStrengthMeter password={newPassword} role="school_admin" />

          <PasswordField
            id="school-admin-confirm-new-pw"
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
            successLabel="Password Saved!"
            disabled={
              isBusy || !resetPwReport.meetsMinimum || newPassword !== confirmNewPassword
            }
          >
            Save Administrator Password
          </TactileButton>
        </form>
      )}

      {/* PASSWORD RECOVERY: SUCCESS */}
      {view === 'forgot_success' && (
        <div className="space-y-5 page-enter">
          <div className="rounded-3xl bg-[#F0FDF4] border border-[#BBF7D0] p-5 space-y-2.5">
            <div className="flex items-center gap-3">
              <span className="h-11 w-11 rounded-2xl bg-[#16A34A] text-white flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-6 h-6" />
              </span>
              <div>
                <p className="font-display text-base font-bold text-[#14532D]">
                  Password Updated
                </p>
                <p className="text-xs text-[#15803D]">{pendingEmail}</p>
              </div>
            </div>
            <p className="text-xs text-[#166534] leading-relaxed">
              Your School Admin password has been reset cleanly. Return to sign in with your new credentials.
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
            Back to School Admin Sign In
          </TactileButton>
        </div>
      )}
    </AuthPortalShell>
  );
};
