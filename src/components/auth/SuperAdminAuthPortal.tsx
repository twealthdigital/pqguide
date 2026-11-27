import React, { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  KeyRound,
  Lock,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import type { AuthenticatedUser } from '../../core/types';
import {
  authService,
  evaluatePasswordStrength,
  IS_DEV_BOOTSTRAP_ENV,
  validateEmailAddress,
  type SuperAdminInitStatus,
} from '../../services/authService';
import { TactileButton } from '../ui/TactileButton';
import { AuthPortalShell } from './AuthPortalShell';
import { OtpVerificationStep } from './OtpVerificationStep';
import { PasswordField } from './PasswordField';
import { PasswordStrengthMeter } from './PasswordStrengthMeter';
import type { AuthView, PortalAuthProps } from './types';

type SuperAdminActionKey =
  | 'signin'
  | 'totp_verify'
  | 'dev_bootstrap'
  | 'prod_init_otp'
  | 'prod_verify_otp'
  | 'prod_setup'
  | 'dev_reset'
  | 'resend_code'
  | 'forgot_request'
  | 'forgot_verify'
  | 'forgot_save';

type ProdSetupStep =
  | 'request_otp'
  | 'verify_otp'
  | 'totp_and_password'
  | 'recovery_codes';

const ALLOWED_SUPER_ADMIN_VIEWS = new Set<AuthView>([
  'signin',
  'super_admin_totp',
  'forgot_request',
  'forgot_verify',
  'forgot_reset',
  'forgot_success',
  'dev_super_admin_setup',
  'super_admin_setup',
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

  // Sign-in + 2FA state
  const [signinEmail, setSigninEmail] = useState('');
  const [signinPassword, setSigninPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [pendingMfaToken, setPendingMfaToken] = useState('');
  const [loginUseRecoveryCode, setLoginUseRecoveryCode] = useState(false);
  const [loginTotpCode, setLoginTotpCode] = useState('');
  const [loginRecoveryCode, setLoginRecoveryCode] = useState('');

  // Dev-only bootstrap state
  const [devBootstrapAvailable, setDevBootstrapAvailable] = useState(() =>
    authService.isDevBootstrapAvailable()
  );
  const [serverStatus, setServerStatus] = useState<SuperAdminInitStatus | null>(null);
  const [devFullName, setDevFullName] = useState('');
  const [devEmail, setDevEmail] = useState('');
  const [devPassword, setDevPassword] = useState('');
  const [devConfirmPassword, setDevConfirmPassword] = useState('');
  const [devConfirmPhrase, setDevConfirmPhrase] = useState('');
  const [showDevResetBox, setShowDevResetBox] = useState(false);
  const [devResetPhrase, setDevResetPhrase] = useState('');

  // Production multi-step init state
  const [prodStep, setProdStep] = useState<ProdSetupStep>('request_otp');
  const [prodFullName, setProdFullName] = useState('');
  const [prodEmail, setProdEmail] = useState('');
  const [prodSetupSecret, setProdSetupSecret] = useState('');
  const [prodInitOtpCode, setProdInitOtpCode] = useState('');
  const [prodInitDeliveryMode, setProdInitDeliveryMode] = useState<'email' | 'preview'>('email');
  const [prodInitPreviewCode, setProdInitPreviewCode] = useState('');
  const [prodEnrollmentToken, setProdEnrollmentToken] = useState('');
  const [prodManualSecret, setProdManualSecret] = useState('');
  const [prodQrDataUrl, setProdQrDataUrl] = useState('');
  const [prodTotpCode, setProdTotpCode] = useState('');
  const [prodPassword, setProdPassword] = useState('');
  const [prodConfirmPassword, setProdConfirmPassword] = useState('');
  const [prodConfirmPhrase, setProdConfirmPhrase] = useState('');
  const [initializedAccount, setInitializedAccount] = useState<AuthenticatedUser | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [recoverySavedConfirmed, setRecoverySavedConfirmed] = useState(false);
  const [copiedKey, setCopiedKey] = useState<'secret' | 'recovery' | null>(null);

  // Recovery state
  const [pendingEmail, setPendingEmail] = useState('');
  const [pendingCodePreview, setPendingCodePreview] = useState('');
  const [pendingDeliveryMode, setPendingDeliveryMode] = useState<'email' | 'preview'>('email');
  const [otpCode, setOtpCode] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [forgotEmail, setForgotEmail] = useState('');
  const [pendingResetToken, setPendingResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [resetUseRecoveryCode, setResetUseRecoveryCode] = useState(false);
  const [resetTotpCode, setResetTotpCode] = useState('');
  const [resetRecoveryCode, setResetRecoveryCode] = useState('');

  const timersRef = useRef<number[]>([]);
  const mountedRef = useRef(true);
  const keepNoticeRef = useRef(false);

  const isBusy = activeAction !== null || successAction !== null;

  useEffect(() => {
    onBusyChange?.(isBusy);
  }, [isBusy, onBusyChange]);

  useEffect(() => {
    mountedRef.current = true;
    void authService.getSuperAdminInitStatus().then((status) => {
      if (mountedRef.current) {
        setServerStatus(status);
      }
    });
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

  useEffect(() => {
    if (view === 'super_admin_totp' && !pendingMfaToken) {
      onSwitchView('signin', { replace: true });
      return;
    }
    if (view === 'forgot_verify' && !pendingEmail) {
      onSwitchView('forgot_request', { replace: true });
      return;
    }
    if (view === 'forgot_reset' && (!pendingEmail || !pendingResetToken)) {
      onSwitchView(pendingEmail ? 'forgot_verify' : 'forgot_request', { replace: true });
    }
  }, [onSwitchView, pendingEmail, pendingMfaToken, pendingResetToken, view]);

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

  const handleCopyText = async (text: string, which: 'secret' | 'recovery') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(which);
      const id = window.setTimeout(() => setCopiedKey(null), 1800);
      timersRef.current.push(id);
    } catch {
      // Clipboard restricted
    }
  };

  const devPwReport = useMemo(
    () => evaluatePasswordStrength(devPassword, 'super_admin'),
    [devPassword]
  );
  const devConfirmError =
    devConfirmPassword && devPassword !== devConfirmPassword
      ? 'Passwords do not match.'
      : null;

  const prodPwReport = useMemo(
    () => evaluatePasswordStrength(prodPassword, 'super_admin'),
    [prodPassword]
  );
  const prodConfirmError =
    prodConfirmPassword && prodPassword !== prodConfirmPassword
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

  const isProdFinalizeFormValid =
    prodFullName.trim().length >= 2 &&
    prodEnrollmentToken.length > 10 &&
    /^\d{6}$/.test(prodTotpCode.replace(/\s+/g, '')) &&
    prodPwReport.meetsMinimum &&
    prodPassword === prodConfirmPassword &&
    prodConfirmPhrase.trim().toUpperCase() === 'INITIALIZE SUPER ADMIN';

  const handleSignInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setErrorMsg(null);
    setInfoMsg(null);
    setActiveAction('signin');

    await scheduleDelay(420);
    if (!mountedRef.current) return;

    const result = await authService.beginSuperAdminLogin(
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

    if (result.data.requiresTotp && result.data.mfaToken) {
      setPendingMfaToken(result.data.mfaToken);
      setLoginUseRecoveryCode(false);
      setLoginTotpCode('');
      setLoginRecoveryCode('');
      setActiveAction(null);
      setInfoMsg('Password verified. Enter the 6-digit code from your authenticator app.');
      navigateView('super_admin_totp', true);
      return;
    }

    if (!result.data.account) {
      setActiveAction(null);
      setErrorMsg('Authentication could not be completed.');
      return;
    }

    setActiveAction(null);
    setSuccessAction('signin');
    await scheduleDelay(420);
    if (!mountedRef.current) return;

    setSuccessAction(null);
    onAuthenticated(result.data.account, rememberMe);
  };

  const handleTotpLoginVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setErrorMsg(null);
    setActiveAction('totp_verify');

    await scheduleDelay(380);
    if (!mountedRef.current) return;

    const result = await authService.verifySuperAdminTotp({
      mfaToken: pendingMfaToken,
      ...(loginUseRecoveryCode
        ? { recoveryCode: loginRecoveryCode }
        : { totpCode: loginTotpCode }),
      rememberMe,
    });
    if (!mountedRef.current) return;

    if (!result.ok || !result.data) {
      setActiveAction(null);
      setErrorMsg(result.error ?? 'Invalid authenticator verification code.');
      return;
    }

    setPendingMfaToken('');
    setLoginTotpCode('');
    setLoginRecoveryCode('');
    setActiveAction(null);
    setSuccessAction('totp_verify');
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

  const handleProdSendInitOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setErrorMsg(null);
    setInfoMsg(null);
    setActiveAction('prod_init_otp');

    await scheduleDelay(380);
    if (!mountedRef.current) return;

    const res = await authService.requestSuperAdminInitOtp({
      email: prodEmail,
      setupSecret: prodSetupSecret,
    });
    if (!mountedRef.current) return;

    if (!res.ok || !res.data) {
      setActiveAction(null);
      if (res.retryAfterSeconds) setResendCooldown(res.retryAfterSeconds);
      setErrorMsg(res.error ?? 'Could not send setup verification email.');
      return;
    }

    setActiveAction(null);
    setProdInitDeliveryMode(res.data.deliveryMode);
    setProdInitPreviewCode(res.data.verificationCode ?? '');
    setProdInitOtpCode('');
    setResendCooldown(res.data.cooldownSeconds ?? 30);
    setProdStep('verify_otp');
    setInfoMsg(
      res.data.deliveryMode === 'email'
        ? `6-digit setup verification code emailed to ${res.data.email}.`
        : `6-digit setup verification code prepared for ${res.data.email}.`
    );
  };

  const handleProdVerifyInitOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setErrorMsg(null);
    setActiveAction('prod_verify_otp');

    await scheduleDelay(380);
    if (!mountedRef.current) return;

    const res = await authService.verifySuperAdminInitOtp({
      email: prodEmail,
      setupSecret: prodSetupSecret,
      code: prodInitOtpCode,
    });
    if (!mountedRef.current) return;

    if (!res.ok || !res.data) {
      setActiveAction(null);
      setErrorMsg(res.error ?? 'Could not verify setup email code.');
      return;
    }

    let qrUrl = '';
    try {
      qrUrl = await QRCode.toDataURL(res.data.otpauthUri, {
        width: 220,
        margin: 2,
      });
    } catch {
      qrUrl = '';
    }
    if (!mountedRef.current) return;

    setProdEnrollmentToken(res.data.enrollmentToken);
    setProdManualSecret(res.data.manualSecret);
    setProdQrDataUrl(qrUrl);
    setProdTotpCode('');
    setActiveAction(null);
    setProdStep('totp_and_password');
    setInfoMsg('Email verified. Scan the QR code with your authenticator app, then set your password.');
  };

  const handleProdSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setErrorMsg(null);
    setInfoMsg(null);
    setActiveAction('prod_setup');

    await scheduleDelay(420);
    if (!mountedRef.current) return;

    const result = await authService.initializeProductionSuperAdmin({
      fullName: prodFullName,
      email: prodEmail,
      setupSecret: prodSetupSecret,
      enrollmentToken: prodEnrollmentToken,
      totpCode: prodTotpCode,
      password: prodPassword,
      confirmPassword: prodConfirmPassword,
      confirmationPhrase: prodConfirmPhrase,
      rememberMe,
    });
    if (!mountedRef.current) return;

    if (!result.ok || !result.data) {
      setActiveAction(null);
      setErrorMsg(result.error ?? 'Initialization failed.');
      return;
    }

    setServerStatus((prev) => (prev ? { ...prev, initialized: true } : prev));
    setInitializedAccount(result.data.account);
    setRecoveryCodes(result.data.recoveryCodes);
    setRecoverySavedConfirmed(false);
    setProdSetupSecret('');
    setProdPassword('');
    setProdConfirmPassword('');
    setProdManualSecret('');
    setProdQrDataUrl('');
    setActiveAction(null);
    setProdStep('recovery_codes');
  };

  const handleEnterControlRoomAfterInit = () => {
    if (!initializedAccount || !recoverySavedConfirmed) return;
    const targetAccount = initializedAccount;
    setInitializedAccount(null);
    setRecoveryCodes([]);
    onAuthenticated(targetAccount, rememberMe);
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

    const result = await authService.requestPasswordReset(forgotEmail, 'super_admin');
    if (!mountedRef.current) return;

    if (!result.ok || !result.data) {
      setActiveAction(null);
      if (result.retryAfterSeconds) {
        setResendCooldown(result.retryAfterSeconds);
      }
      setErrorMsg(result.error ?? 'No verified Super Admin matches that email.');
      return;
    }

    setActiveAction(null);
    setSuccessAction('forgot_request');
    await scheduleDelay(450);
    if (!mountedRef.current) return;

    setSuccessAction(null);
    setPendingEmail(result.data.email);
    setPendingResetToken('');
    setPendingDeliveryMode(result.data.deliveryMode);
    setPendingCodePreview(result.data.verificationCode ?? '');
    setOtpCode('');
    setResendCooldown(result.data.cooldownSeconds ?? 30);
    setInfoMsg(
      result.data.deliveryMode === 'email'
        ? `Security recovery code emailed to ${result.data.email}.`
        : `Security recovery code ready for ${result.data.email}.`
    );
    navigateView('forgot_verify', true);
  };

  const handleForgotVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setErrorMsg(null);
    setActiveAction('forgot_verify');

    await scheduleDelay(400);
    if (!mountedRef.current) return;

    const result = await authService.verifyResetCode(pendingEmail, otpCode);
    if (!mountedRef.current) return;

    if (!result.ok) {
      setActiveAction(null);
      if (result.retryAfterSeconds) {
        setResendCooldown(result.retryAfterSeconds);
      }
      setErrorMsg(result.error ?? 'Invalid security code.');
      return;
    }

    setPendingResetToken(result.data?.resetToken ?? '');
    setActiveAction(null);
    setSuccessAction('forgot_verify');
    await scheduleDelay(450);
    if (!mountedRef.current) return;

    setSuccessAction(null);
    setNewPassword('');
    setConfirmNewPassword('');
    setResetTotpCode('');
    setResetRecoveryCode('');
    setResetUseRecoveryCode(false);
    setInfoMsg('Email code verified. Confirm with your authenticator code or a single-use recovery code.');
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
      confirmNewPassword,
      pendingResetToken,
      resetUseRecoveryCode
        ? { recoveryCode: resetRecoveryCode }
        : { totpCode: resetTotpCode }
    );
    if (!mountedRef.current) return;

    if (!result.ok || !result.data) {
      setActiveAction(null);
      setErrorMsg(result.error ?? 'Unable to update password.');
      return;
    }

    setPendingResetToken('');
    setResetTotpCode('');
    setResetRecoveryCode('');
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

    const result = await authService.resendCode(pendingEmail, 'reset');
    if (!mountedRef.current) return;

    if (!result.ok || !result.data) {
      setActiveAction(null);
      if (result.retryAfterSeconds) {
        setResendCooldown(result.retryAfterSeconds);
      }
      setErrorMsg(result.error ?? 'Could not resend code.');
      return;
    }

    setActiveAction(null);
    setSuccessAction('resend_code');
    setPendingDeliveryMode(result.data.deliveryMode);
    setPendingCodePreview(result.data.verificationCode ?? '');
    setOtpCode('');
    setResendCooldown(result.data.cooldownSeconds ?? 30);
    setInfoMsg(
      result.data.deliveryMode === 'email'
        ? `Fresh security code emailed to ${pendingEmail}.`
        : `Fresh security code ready for ${pendingEmail}.`
    );

    await scheduleDelay(550);
    if (!mountedRef.current) return;
    setSuccessAction(null);
  };

  const headingMap: Record<string, string> = {
    signin: 'Super Admin Console',
    super_admin_totp: 'Two-Factor Verification',
    forgot_request: 'Super Admin Recovery',
    forgot_verify: 'Verify Security Code',
    forgot_reset: 'Set New Super Admin Password',
    forgot_success: 'Console Password Updated',
    dev_super_admin_setup: 'Dev Super Admin Bootstrap',
    super_admin_setup:
      prodStep === 'recovery_codes'
        ? 'Save Recovery Codes'
        : 'Initialize Super Admin',
  };

  const subheadingMap: Record<string, string> = {
    signin: 'Restricted platform control authentication. Enter your registered Super Admin credentials.',
    super_admin_totp: 'Confirm sign-in using your authenticator app or a single-use recovery code.',
    forgot_request: 'Enter the registered Super Admin email to initiate recovery verification.',
    forgot_verify: `Enter the 6-digit verification code sent to ${pendingEmail}.`,
    forgot_reset: 'Confirm with 2FA and set a strong 10+ character password.',
    forgot_success: 'Your Super Admin password has been reset successfully.',
    dev_super_admin_setup: 'Development-only one-time initialization for the first local Super Admin account.',
    super_admin_setup:
      prodStep === 'request_otp'
        ? 'Step 1 of 3 · Verify server authorization key and send email OTP.'
        : prodStep === 'verify_otp'
          ? 'Step 2 of 3 · Enter the 6-digit code emailed to your configured bootstrap address.'
          : prodStep === 'totp_and_password'
            ? 'Step 3 of 3 · Enroll authenticator 2FA and set your console password.'
            : 'Store these single-use recovery codes safely. They are shown only once.',
  };

  const handleTopBack = () => {
    if (view === 'super_admin_totp') {
      setPendingMfaToken('');
      navigateBack('signin');
    } else if (view === 'super_admin_setup' && prodStep === 'verify_otp') {
      setProdStep('request_otp');
      setErrorMsg(null);
    } else if (view === 'super_admin_setup' && prodStep === 'totp_and_password') {
      setProdStep('verify_otp');
      setErrorMsg(null);
    } else if (view === 'forgot_reset') navigateBack('forgot_verify');
    else if (view === 'forgot_verify') navigateBack('forgot_request');
    else navigateBack('signin');
  };

  const isResetFactorReady = resetUseRecoveryCode
    ? resetRecoveryCode.replace(/[^a-zA-Z0-9]/g, '').length >= 10
    : /^\d{6}$/.test(resetTotpCode.replace(/\s+/g, ''));

  return (
    <AuthPortalShell
      portalTag="Restricted Console · Super Admin"
      portalTagTone="super_admin"
      brandHeadline="PQGuide Control Room"
      brandDescription="Platform-wide governance, university administration, moderation audits, broadcasts, and payment verification."
      brandFooter="Protected by Email OTP + Authenticator TOTP 2FA · Public registration disabled."
      heading={headingMap[view] ?? 'Super Admin Console'}
      subheading={subheadingMap[view] ?? ''}
      showBackButton={
        view !== 'signin' && !(view === 'super_admin_setup' && prodStep === 'recovery_codes')
      }
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
              Privileged governance gateway. Authenticator 2FA is mandatory for all production Super Admin sessions.
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
                Keep console session active across reloads (max 12 hours)
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
              Continue to 2FA Verification
            </TactileButton>
          </form>

          {/* Server-Authorized One-Time Production Setup */}
          {serverStatus?.serverSupported && !serverStatus.initialized && (
            <div className="mt-5 pt-4 border-t border-[#1A1B20]/[0.08] space-y-2.5">
              {serverStatus.setupConfigured ? (
                <button
                  type="button"
                  onClick={() => {
                    setProdStep('request_otp');
                    navigateView('super_admin_setup');
                  }}
                  className="w-full min-h-[44px] rounded-2xl border border-[#1A1B20]/12 bg-[#F6F7F9] hover:bg-[#ECEEF3] px-3.5 py-2.5 text-left flex items-center justify-between gap-3 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <ShieldCheck className="w-4 h-4 text-[#1D1E23] shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[#1A1B20] truncate">
                        First-Time Setup: Initialize Super Admin
                      </p>
                      <p className="text-[11px] text-[#686C78] truncate">
                        Requires setup key, email OTP, and authenticator QR setup
                      </p>
                    </div>
                  </div>
                </button>
              ) : (
                !(import.meta.env.DEV && IS_DEV_BOOTSTRAP_ENV) && (
                  <div className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3.5 py-2.5 text-[11px] text-[#505460] leading-relaxed">
                    No Super Admin has been initialized yet. Configure{' '}
                    <span className="font-mono-tabular font-semibold text-[#1A1B20]">
                      SUPER_ADMIN_SETUP_SECRET
                    </span>
                    ,{' '}
                    <span className="font-mono-tabular font-semibold text-[#1A1B20]">
                      SUPER_ADMIN_BOOTSTRAP_EMAIL
                    </span>
                    , and{' '}
                    <span className="font-mono-tabular font-semibold text-[#1A1B20]">
                      TOTP_ENCRYPTION_KEY
                    </span>{' '}
                    in server environment variables to unlock setup.
                  </div>
                )
              )}
            </div>
          )}

          {/* Strictly Local Dev Only Bootstrap & Reset */}
          {import.meta.env.DEV && IS_DEV_BOOTSTRAP_ENV && (
            <div className="mt-5 pt-4 border-t border-[#1A1B20]/[0.08] space-y-2.5">
              {devBootstrapAvailable && !serverStatus?.initialized && (
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

      {/* LOGIN: AUTHENTICATOR TOTP / RECOVERY STEP */}
      {view === 'super_admin_totp' && (
        <form onSubmit={handleTotpLoginVerify} className="space-y-4 page-enter" noValidate>
          <div className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-4 py-3 flex items-start gap-2.5 text-xs text-[#505460]">
            <Smartphone className="w-4 h-4 text-[#1D1E23] shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              {loginUseRecoveryCode
                ? 'Enter one unused 12-character single-use recovery code from your initialization sheet.'
                : 'Open Google Authenticator or your TOTP app and enter the current 6-digit PQGuide code.'}
            </p>
          </div>

          {!loginUseRecoveryCode ? (
            <div>
              <label
                htmlFor="sa-login-totp"
                className="block text-xs font-semibold text-[#1A1B20] mb-1.5 pl-1"
              >
                6-Digit Authenticator Code
              </label>
              <input
                id="sa-login-totp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                disabled={isBusy}
                value={loginTotpCode}
                onChange={(e) => setLoginTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                className="h-12 w-full rounded-full border border-[#1A1B20]/15 bg-white px-4 text-center font-mono-tabular text-lg tracking-[0.35em] text-[#1A1B20]"
              />
            </div>
          ) : (
            <div>
              <label
                htmlFor="sa-login-recovery"
                className="block text-xs font-semibold text-[#1A1B20] mb-1.5 pl-1"
              >
                Single-Use Recovery Code
              </label>
              <input
                id="sa-login-recovery"
                type="text"
                autoComplete="off"
                disabled={isBusy}
                value={loginRecoveryCode}
                onChange={(e) => setLoginRecoveryCode(e.target.value.toUpperCase())}
                placeholder="XXXX-XXXX-XXXX"
                className="h-12 w-full rounded-full border border-[#1A1B20]/15 bg-white px-4 text-center font-mono-tabular text-sm tracking-[0.15em] text-[#1A1B20]"
              />
            </div>
          )}

          <div className="text-right">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => {
                setErrorMsg(null);
                setLoginUseRecoveryCode((v) => !v);
              }}
              className="text-xs font-semibold text-[#1D1E23] hover:underline underline-offset-4 cursor-pointer"
            >
              {loginUseRecoveryCode
                ? 'Use 6-digit authenticator code instead'
                : 'Use a single-use recovery code'}
            </button>
          </div>

          <TactileButton
            type="submit"
            variant="dark"
            size="lg"
            fullWidth
            className="rounded-full"
            loading={activeAction === 'totp_verify'}
            success={successAction === 'totp_verify'}
            successLabel="Console Unlocked!"
            disabled={
              isBusy ||
              (loginUseRecoveryCode
                ? loginRecoveryCode.replace(/[^a-zA-Z0-9]/g, '').length < 10
                : loginTotpCode.length !== 6)
            }
          >
            Verify & Unlock Console
          </TactileButton>
        </form>
      )}

      {/* SERVER-AUTHORIZED ONE-TIME SUPER ADMIN SETUP */}
      {view === 'super_admin_setup' && (
        <div className="space-y-4 page-enter">
          {serverStatus?.initialized && prodStep !== 'recovery_codes' ? (
            <div className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/10 p-5 text-center space-y-3">
              <p className="text-sm font-bold text-[#1A1B20]">Setup Permanently Locked</p>
              <p className="text-xs text-[#505460]">
                A Super Admin account has already been initialized for this platform.
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
          ) : prodStep === 'request_otp' ? (
            <form onSubmit={handleProdSendInitOtp} className="space-y-3.5" noValidate>
              <div className="rounded-2xl bg-[#1D1E23] text-white px-4 py-3 text-xs leading-relaxed">
                <p className="font-bold">Step 1 · Bootstrap Email & Setup Key</p>
                <p className="mt-0.5 text-[#D4D7E0]">
                  We send a 6-digit setup verification code directly to your configured{' '}
                  <span className="font-mono-tabular">SUPER_ADMIN_BOOTSTRAP_EMAIL</span>.
                </p>
              </div>

              <div>
                <label
                  htmlFor="prod-sa-email"
                  className="block text-xs font-semibold text-[#1A1B20] mb-1 pl-1"
                >
                  Configured Super Admin Bootstrap Email
                </label>
                <input
                  id="prod-sa-email"
                  type="email"
                  disabled={isBusy}
                  value={prodEmail}
                  onChange={(e) => setProdEmail(e.target.value)}
                  placeholder="superadmin@pqguide.org"
                  className="h-11 w-full rounded-full border border-[#1A1B20]/15 bg-white px-4 text-sm text-[#1A1B20]"
                />
              </div>

              <PasswordField
                id="prod-sa-setup-secret"
                label="Server Setup Key (SUPER_ADMIN_SETUP_SECRET)"
                value={prodSetupSecret}
                onChange={setProdSetupSecret}
                placeholder="Enter server setup secret key"
                disabled={isBusy}
                autoComplete="off"
                compact
              />

              <TactileButton
                type="submit"
                variant="dark"
                size="lg"
                fullWidth
                className="rounded-full"
                loading={activeAction === 'prod_init_otp'}
                disabled={
                  isBusy ||
                  !validateEmailAddress(prodEmail) ||
                  prodSetupSecret.trim().length < 16
                }
              >
                Send Setup Verification Email
              </TactileButton>
            </form>
          ) : prodStep === 'verify_otp' ? (
            <form onSubmit={handleProdVerifyInitOtp} className="space-y-4" noValidate>
              <OtpVerificationStep
                email={prodEmail.trim().toLowerCase()}
                otpCode={prodInitOtpCode}
                onOtpChange={setProdInitOtpCode}
                previewCode={prodInitPreviewCode}
                deliveryMode={prodInitDeliveryMode}
                disabled={isBusy}
                hasError={Boolean(errorMsg)}
                changeEmailLabel="Edit setup details"
                onChangeEmail={() => setProdStep('request_otp')}
              />

              <TactileButton
                type="submit"
                variant="dark"
                size="lg"
                fullWidth
                className="rounded-full"
                loading={activeAction === 'prod_verify_otp'}
                disabled={isBusy || prodInitOtpCode.length !== 6}
              >
                Verify Email & Generate Authenticator QR
              </TactileButton>

              <TactileButton
                type="button"
                variant="light"
                size="md"
                fullWidth
                className="rounded-full"
                icon={<RefreshCw className="w-3.5 h-3.5" />}
                disabled={isBusy || resendCooldown > 0}
                onClick={handleProdSendInitOtp}
              >
                {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend setup code'}
              </TactileButton>
            </form>
          ) : prodStep === 'totp_and_password' ? (
            <form onSubmit={handleProdSetupSubmit} className="space-y-3.5" noValidate>
              <div className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/10 p-4 space-y-3 text-center">
                <p className="text-xs font-bold text-[#1A1B20]">
                  Scan in Google Authenticator / Authy
                </p>
                {prodQrDataUrl && (
                  <img
                    src={prodQrDataUrl}
                    alt="Super Admin TOTP enrollment QR code"
                    className="w-44 h-44 rounded-xl border border-[#1A1B20]/10 bg-white p-2 mx-auto"
                  />
                )}
                <div className="space-y-1">
                  <p className="text-[11px] text-[#686C78]">Manual setup key</p>
                  <div className="flex items-center justify-center gap-2">
                    <code className="px-2.5 py-1 rounded-lg bg-white border border-[#1A1B20]/10 text-xs font-mono-tabular text-[#1A1B20] select-all">
                      {prodManualSecret}
                    </code>
                    <button
                      type="button"
                      onClick={() => void handleCopyText(prodManualSecret, 'secret')}
                      aria-label="Copy manual authenticator key"
                      className="h-8 px-2.5 rounded-lg bg-white border border-[#1A1B20]/10 text-xs font-semibold text-[#1A1B20] hover:bg-[#ECEEF3] inline-flex items-center gap-1 cursor-pointer"
                    >
                      {copiedKey === 'secret' ? (
                        <Check className="w-3.5 h-3.5 text-[#16A34A]" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copiedKey === 'secret' ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label
                  htmlFor="prod-sa-totp-code"
                  className="block text-xs font-semibold text-[#1A1B20] mb-1 pl-1"
                >
                  Confirm 6-Digit Authenticator Code
                </label>
                <input
                  id="prod-sa-totp-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  disabled={isBusy}
                  value={prodTotpCode}
                  onChange={(e) => setProdTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="h-11 w-full rounded-full border border-[#1A1B20]/15 bg-white px-4 text-center font-mono-tabular text-base tracking-[0.3em] text-[#1A1B20]"
                />
              </div>

              <div>
                <label
                  htmlFor="prod-sa-name"
                  className="block text-xs font-semibold text-[#1A1B20] mb-1 pl-1"
                >
                  Super Admin Full Name
                </label>
                <input
                  id="prod-sa-name"
                  type="text"
                  disabled={isBusy}
                  value={prodFullName}
                  onChange={(e) => setProdFullName(e.target.value)}
                  placeholder="e.g. Platform Lead"
                  className="h-11 w-full rounded-full border border-[#1A1B20]/15 bg-white px-4 text-sm text-[#1A1B20]"
                />
              </div>

              <PasswordField
                id="prod-sa-password"
                label="Password (10+ chars, upper, lower & numbers)"
                value={prodPassword}
                onChange={setProdPassword}
                placeholder="Create strong Super Admin password"
                disabled={isBusy}
                autoComplete="new-password"
                compact
              />

              <PasswordStrengthMeter password={prodPassword} role="super_admin" />

              <PasswordField
                id="prod-sa-confirm"
                label="Confirm Password"
                value={prodConfirmPassword}
                onChange={setProdConfirmPassword}
                placeholder="Re-enter password"
                disabled={isBusy}
                autoComplete="new-password"
                error={prodConfirmError}
                compact
              />

              <div>
                <label
                  htmlFor="prod-sa-phrase"
                  className="block text-xs font-semibold text-[#1A1B20] mb-1 pl-1"
                >
                  Type <span className="font-mono-tabular">INITIALIZE SUPER ADMIN</span>
                </label>
                <input
                  id="prod-sa-phrase"
                  type="text"
                  disabled={isBusy}
                  value={prodConfirmPhrase}
                  onChange={(e) => setProdConfirmPhrase(e.target.value)}
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
                loading={activeAction === 'prod_setup'}
                disabled={isBusy || !isProdFinalizeFormValid}
              >
                Enable 2FA & Initialize Super Admin
              </TactileButton>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl bg-[#FFFBEB] border border-[#FDE68A] p-4 text-xs text-[#92400E] leading-relaxed">
                <p className="font-bold">Save Your 10 Single-Use Recovery Codes</p>
                <p className="mt-1">
                  If you ever lose your authenticator device, each code unlocks one sign-in or password recovery. They cannot be viewed again after leaving this screen.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/10 p-3.5">
                {recoveryCodes.map((code) => (
                  <code
                    key={code}
                    className="rounded-lg bg-white border border-[#1A1B20]/10 px-2.5 py-1.5 text-center font-mono-tabular text-xs font-semibold text-[#1A1B20]"
                  >
                    {code}
                  </code>
                ))}
              </div>

              <TactileButton
                type="button"
                variant="light"
                size="md"
                fullWidth
                className="rounded-full"
                icon={
                  copiedKey === 'recovery' ? (
                    <Check className="w-3.5 h-3.5 text-[#16A34A]" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )
                }
                onClick={() => void handleCopyText(recoveryCodes.join('\n'), 'recovery')}
              >
                {copiedKey === 'recovery' ? 'Recovery Codes Copied' : 'Copy All Recovery Codes'}
              </TactileButton>

              <label className="flex items-start gap-2.5 pl-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={recoverySavedConfirmed}
                  onChange={(e) => setRecoverySavedConfirmed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-[#1A1B20]/30 accent-[#1D1E23] cursor-pointer"
                />
                <span className="text-xs font-medium text-[#505460] leading-snug">
                  I have securely stored these single-use recovery codes offline.
                </span>
              </label>

              <TactileButton
                type="button"
                variant="dark"
                size="lg"
                fullWidth
                className="rounded-full"
                disabled={!recoverySavedConfirmed}
                onClick={handleEnterControlRoomAfterInit}
              >
                Enter Super Admin Control Room
              </TactileButton>
            </div>
          )}

          {prodStep !== 'recovery_codes' && (
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
          )}
        </div>
      )}

      {/* DEV-ONLY FIRST SUPER ADMIN BOOTSTRAP */}
      {view === 'dev_super_admin_setup' && import.meta.env.DEV && IS_DEV_BOOTSTRAP_ENV && (
        <div className="space-y-4 page-enter">
          <div className="rounded-2xl bg-[#FFFBEB] border border-[#FDE68A] px-4 py-3 text-xs text-[#92400E] leading-relaxed">
            <p className="font-bold">Local Development Only — Disabled in Production</p>
            <p className="mt-0.5">
              Creates your first local Super Admin in browser storage and locks further bootstrap attempts unless local dev data is reset.
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
            deliveryMode={pendingDeliveryMode}
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

      {/* RECOVERY: NEW PASSWORD + MANDATORY 2FA FACTOR */}
      {view === 'forgot_reset' && (
        <form onSubmit={handleForgotResetSave} className="space-y-4 page-enter" noValidate>
          <div className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3.5 py-2.5 flex items-start gap-2.5 text-xs text-[#505460]">
            <KeyRound className="w-4 h-4 text-[#1D1E23] shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              Authenticator 2FA or a single-use recovery code is required in addition to your verified email OTP.
            </p>
          </div>

          {!resetUseRecoveryCode ? (
            <div>
              <label
                htmlFor="sa-reset-totp"
                className="block text-xs font-semibold text-[#1A1B20] mb-1.5 pl-1"
              >
                6-Digit Authenticator Code
              </label>
              <input
                id="sa-reset-totp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                disabled={isBusy}
                value={resetTotpCode}
                onChange={(e) => setResetTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                className="h-11 w-full rounded-full border border-[#1A1B20]/15 bg-white px-4 text-center font-mono-tabular text-base tracking-[0.3em] text-[#1A1B20]"
              />
            </div>
          ) : (
            <div>
              <label
                htmlFor="sa-reset-recovery"
                className="block text-xs font-semibold text-[#1A1B20] mb-1.5 pl-1"
              >
                Single-Use Recovery Code
              </label>
              <input
                id="sa-reset-recovery"
                type="text"
                autoComplete="off"
                disabled={isBusy}
                value={resetRecoveryCode}
                onChange={(e) => setResetRecoveryCode(e.target.value.toUpperCase())}
                placeholder="XXXX-XXXX-XXXX"
                className="h-11 w-full rounded-full border border-[#1A1B20]/15 bg-white px-4 text-center font-mono-tabular text-sm tracking-[0.15em] text-[#1A1B20]"
              />
            </div>
          )}

          <div className="text-right -mt-1">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => {
                setErrorMsg(null);
                setResetUseRecoveryCode((v) => !v);
              }}
              className="text-xs font-semibold text-[#1D1E23] hover:underline underline-offset-4 cursor-pointer"
            >
              {resetUseRecoveryCode
                ? 'Use 6-digit authenticator code instead'
                : 'Lost authenticator? Use single-use recovery code'}
            </button>
          </div>

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
              isBusy ||
              !isResetFactorReady ||
              !resetPwReport.meetsMinimum ||
              newPassword !== confirmNewPassword
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
              Your Super Admin credentials have been updated and all prior sessions were revoked. Sign in with your new password and authenticator code.
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
