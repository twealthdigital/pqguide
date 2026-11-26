import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  Eye,
  EyeOff,
  Mail,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import type {
  AuthenticatedUser,
  AuthPortal,
  StudentLevel,
} from '../core/types';
import {
  AAUA_FACULTIES,
  authService,
  IS_DEV_BOOTSTRAP_ENV,
  validateMatricNumber,
} from '../services/authService';
import { BrandLockup } from '../components/ui/BrandLockup';
import { CreatableSelectInput } from '../components/ui/CreatableSelectInput';
import { TactileButton } from '../components/ui/TactileButton';

export type AuthView =
  | 'signin'
  | 'signup'
  | 'verify_signup'
  | 'forgot_request'
  | 'forgot_verify'
  | 'forgot_reset'
  | 'admin_activate_request'
  | 'admin_activate_verify'
  | 'dev_super_admin_setup';

type ButtonActionKey =
  | 'signin'
  | 'signup'
  | 'verify_signup'
  | 'resend_code'
  | 'forgot_request'
  | 'forgot_verify'
  | 'forgot_save'
  | 'admin_activate_request'
  | 'admin_activate_complete'
  | 'dev_bootstrap'
  | 'dev_reset';

const STUDENT_LEVELS: StudentLevel[] = ['100L', '200L', '300L', '400L', '500L'];

interface AuthScreenProps {
  portal?: AuthPortal;
  view?: AuthView;
  onViewChange?: (next: AuthView, options?: { replace?: boolean }) => void;
  onAuthBack?: (fallbackView: AuthView) => void;
  onAuthenticated: (account: AuthenticatedUser) => void;
  onBackToOnboarding?: () => void;
}

interface OtpCodeInputProps {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

const OtpCodeInput: React.FC<OtpCodeInputProps> = ({
  value,
  onChange,
  disabled = false,
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
    <div className="grid grid-cols-6 gap-2 sm:gap-2.5" role="group" aria-label="6-digit verification code">
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
          className="h-12 sm:h-13 w-full rounded-2xl border border-[#1A1B20]/15 bg-[#F8F9FB] focus:bg-white focus:border-[#1D1E23] text-center font-mono-tabular text-lg font-bold text-[#1A1B20] transition-colors disabled:opacity-55"
        />
      ))}
    </div>
  );
};

export const AuthScreen: React.FC<AuthScreenProps> = ({
  portal = 'student',
  view: controlledView,
  onViewChange,
  onAuthBack,
  onAuthenticated,
  onBackToOnboarding,
}) => {
  const [localView, setLocalView] = useState<AuthView>('signin');
  const view = controlledView ?? localView;
  const [activeAction, setActiveAction] = useState<ButtonActionKey | null>(null);
  const [successAction, setSuccessAction] = useState<ButtonActionKey | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  // Dev-only Super Admin bootstrap fields
  const [devBootstrapAvailable, setDevBootstrapAvailable] = useState(() =>
    authService.isDevBootstrapAvailable()
  );
  const [devFullName, setDevFullName] = useState('');
  const [devEmail, setDevEmail] = useState('');
  const [devPassword, setDevPassword] = useState('');
  const [devConfirmPassword, setDevConfirmPassword] = useState('');
  const [devConfirmPhrase, setDevConfirmPhrase] = useState('');
  const [showDevPassword, setShowDevPassword] = useState(false);
  const [showDevResetBox, setShowDevResetBox] = useState(false);
  const [devResetPhrase, setDevResetPhrase] = useState('');

  // Sign In fields (Portal-isolated)
  const [signinMatric, setSigninMatric] = useState('');
  const [signinPassword, setSigninPassword] = useState('');
  const [showSigninPassword, setShowSigninPassword] = useState(false);

  // Sign Up fields (Student only)
  const [fullName, setFullName] = useState('');
  const [signupMatric, setSignupMatric] = useState('');
  const [signupLevel, setSignupLevel] = useState<StudentLevel>('100L');
  const [faculty, setFaculty] = useState('');
  const [department, setDepartment] = useState('');
  const [extraFaculties, setExtraFaculties] = useState<string[]>([]);
  const [extraDepartmentsByFaculty, setExtraDepartmentsByFaculty] = useState<
    Record<string, string[]>
  >({});
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [showSignupPassword, setShowSignupPassword] = useState(false);

  // School Admin email activation fields
  const [activateEmail, setActivateEmail] = useState('');
  const [activatePassword, setActivatePassword] = useState('');
  const [activateConfirmPassword, setActivateConfirmPassword] = useState('');
  const [showActivatePassword, setShowActivatePassword] = useState(false);

  // Verification / Reset OTP state
  const [pendingEmail, setPendingEmail] = useState('');
  const [pendingCodePreview, setPendingCodePreview] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [copiedCode, setCopiedCode] = useState(false);

  // Forgot Password fields
  const [forgotIdentifier, setForgotIdentifier] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);

  const timersRef = useRef<number[]>([]);
  const mountedRef = useRef(true);
  const keepNoticeRef = useRef(false);

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

  const isBusy = activeAction !== null || successAction !== null;

  const facultyOptions = useMemo(() => {
    const merged = [...Object.keys(AAUA_FACULTIES), ...extraFaculties];
    const seen = new Set<string>();
    return merged.filter((item) => {
      const key = item.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [extraFaculties]);

  const normalizedFacultyKey = faculty.trim().toLowerCase();

  const departmentOptions = useMemo(() => {
    const matchedPresetKey = normalizedFacultyKey
      ? Object.keys(AAUA_FACULTIES).find(
          (k) => k.toLowerCase() === normalizedFacultyKey
        )
      : undefined;
    const presetDepts = matchedPresetKey
      ? AAUA_FACULTIES[matchedPresetKey]
      : normalizedFacultyKey
      ? []
      : Object.values(AAUA_FACULTIES).flat();
    const sessionDepts = extraDepartmentsByFaculty[normalizedFacultyKey] ?? [];
    const merged = [...presetDepts, ...sessionDepts];
    const seen = new Set<string>();
    return merged.filter((item) => {
      const key = item.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [extraDepartmentsByFaculty, normalizedFacultyKey]);

  const handleFacultyChange = (nextFaculty: string) => {
    setFaculty(nextFaculty);
    const matchedPresetKey = Object.keys(AAUA_FACULTIES).find(
      (k) => k.toLowerCase() === nextFaculty.trim().toLowerCase()
    );
    if (matchedPresetKey && department.trim()) {
      const nextDepts = AAUA_FACULTIES[matchedPresetKey];
      const belongsToOtherPreset = Object.entries(AAUA_FACULTIES).some(
        ([fac, depts]) =>
          fac !== matchedPresetKey &&
          depts.some((d) => d.toLowerCase() === department.trim().toLowerCase())
      );
      if (
        belongsToOtherPreset &&
        !nextDepts.some((d) => d.toLowerCase() === department.trim().toLowerCase())
      ) {
        setDepartment('');
      }
    }
  };

  const handleAddFacultyOption = (newFaculty: string) => {
    const cleaned = newFaculty.trim();
    if (cleaned.length < 2) return;
    setExtraFaculties((prev) => {
      const lower = cleaned.toLowerCase();
      const existsInPreset = Object.keys(AAUA_FACULTIES).some(
        (k) => k.toLowerCase() === lower
      );
      const existsInExtra = prev.some((k) => k.toLowerCase() === lower);
      if (existsInPreset || existsInExtra) return prev;
      return [...prev, cleaned];
    });
  };

  const handleAddDepartmentOption = (newDepartment: string) => {
    const cleaned = newDepartment.trim();
    if (cleaned.length < 2) return;
    const facKey = normalizedFacultyKey || '__general__';
    setExtraDepartmentsByFaculty((prev) => {
      const existing = prev[facKey] ?? [];
      const lower = cleaned.toLowerCase();
      const matchedPresetKey = Object.keys(AAUA_FACULTIES).find(
        (k) => k.toLowerCase() === facKey
      );
      const existsInPreset = matchedPresetKey
        ? AAUA_FACULTIES[matchedPresetKey].some((d) => d.toLowerCase() === lower)
        : false;
      const existsInExtra = existing.some((d) => d.toLowerCase() === lower);
      if (existsInPreset || existsInExtra) return prev;
      return {
        ...prev,
        [facKey]: [...existing, cleaned],
      };
    });
  };

  const switchView = (next: AuthView, keepNotices = false, replace = false) => {
    if (isBusy) return;
    keepNoticeRef.current = keepNotices;
    setErrorMsg(null);
    if (!keepNotices) {
      setInfoMsg(null);
    }
    if (onViewChange) {
      onViewChange(next, { replace });
    } else {
      setLocalView(next);
    }
  };

  const goBackAuth = (fallbackView: AuthView) => {
    if (isBusy) return;
    keepNoticeRef.current = false;
    setErrorMsg(null);
    setInfoMsg(null);
    if (onAuthBack) {
      onAuthBack(fallbackView);
    } else {
      setLocalView(fallbackView);
    }
  };

  const liveMatricFeedback = useMemo(() => {
    if (signupMatric.length !== 9) return null;
    const check = validateMatricNumber(signupMatric);
    return {
      valid: check.valid,
      text: check.valid ? 'Valid matric number' : check.error ?? 'Invalid matric number',
    };
  }, [signupMatric]);

  const handleSignInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setErrorMsg(null);
    setInfoMsg(null);
    setActiveAction('signin');

    await scheduleDelay(450);
    if (!mountedRef.current) return;

    const result = await authService.signinWithPortal(
      portal,
      signinMatric,
      signinPassword
    );
    if (!mountedRef.current) return;

    if (!result.ok || !result.data) {
      setActiveAction(null);
      setErrorMsg(result.error ?? 'Unable to sign in.');
      return;
    }

    setActiveAction(null);
    setSuccessAction('signin');
    await scheduleDelay(500);
    if (!mountedRef.current) return;

    setSuccessAction(null);
    onAuthenticated(result.data.account);
  };

  const handleAdminActivateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setErrorMsg(null);
    setInfoMsg(null);
    setActiveAction('admin_activate_request');

    await scheduleDelay(450);
    if (!mountedRef.current) return;

    const result = authService.startSchoolAdminActivation(activateEmail);
    if (!result.ok || !result.data) {
      setActiveAction(null);
      setErrorMsg(result.error ?? 'Could not verify approved email.');
      return;
    }

    setActiveAction(null);
    setPendingEmail(result.data.email);
    setPendingCodePreview(result.data.verificationCode);
    setOtpCode('');
    setActivatePassword('');
    setActivateConfirmPassword('');
    setResendCooldown(30);
    setInfoMsg(
      `Approved for ${result.data.schoolCode} (${result.data.fullName}). Enter the 6-digit code and set your password.`
    );
    switchView('admin_activate_verify', true);
  };

  const handleAdminActivateComplete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setErrorMsg(null);
    setActiveAction('admin_activate_complete');

    await scheduleDelay(500);
    if (!mountedRef.current) return;

    const result = await authService.completeSchoolAdminActivation(
      pendingEmail,
      otpCode,
      activatePassword,
      activateConfirmPassword
    );
    if (!mountedRef.current) return;

    if (!result.ok || !result.data) {
      setActiveAction(null);
      setErrorMsg(result.error ?? 'Activation failed.');
      return;
    }

    setActiveAction(null);
    setSuccessAction('admin_activate_complete');
    await scheduleDelay(550);
    if (!mountedRef.current) return;

    setSuccessAction(null);
    onAuthenticated(result.data.account);
  };

  const handleDevBootstrapSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setErrorMsg(null);
    setInfoMsg(null);
    setActiveAction('dev_bootstrap');

    await scheduleDelay(450);
    if (!mountedRef.current) return;

    const result = await authService.bootstrapFirstSuperAdmin({
      fullName: devFullName,
      email: devEmail,
      password: devPassword,
      confirmPassword: devConfirmPassword,
      confirmationPhrase: devConfirmPhrase,
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
    await scheduleDelay(500);
    if (!mountedRef.current) return;

    setSuccessAction(null);
    onAuthenticated(result.data.account);
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
      setErrorMsg(result.error ?? 'Could not reset local data.');
      return;
    }

    setDevBootstrapAvailable(authService.isDevBootstrapAvailable());
    setDevResetPhrase('');
    setShowDevResetBox(false);
    setInfoMsg('Local development data cleared. You can initialize a new Super Admin now.');
  };

  const handleSignUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setErrorMsg(null);
    setInfoMsg(null);
    setActiveAction('signup');

    await scheduleDelay(600);
    if (!mountedRef.current) return;

    const result = await authService.startSignup({
      fullName,
      matricNumber: signupMatric,
      level: signupLevel,
      faculty: faculty.trim(),
      department: department.trim(),
      email: signupEmail,
      password: signupPassword,
    });
    if (!mountedRef.current) return;

    if (!result.ok || !result.data) {
      setActiveAction(null);
      setErrorMsg(result.error ?? 'Could not create account.');
      return;
    }

    setActiveAction(null);
    setSuccessAction('signup');
    await scheduleDelay(650);
    if (!mountedRef.current) return;

    setSuccessAction(null);
    setPendingEmail(result.data.email);
    setPendingCodePreview(result.data.verificationCode);
    setOtpCode('');
    setResendCooldown(30);
    setInfoMsg(`Verification code sent to ${result.data.email}`);
    switchView('verify_signup', true);
  };

  const handleVerifySignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setErrorMsg(null);
    setActiveAction('verify_signup');

    await scheduleDelay(550);
    if (!mountedRef.current) return;

    const result = authService.verifySignupCode(pendingEmail, otpCode);
    if (!result.ok || !result.data) {
      setActiveAction(null);
      setErrorMsg(result.error ?? 'Verification failed.');
      return;
    }

    setActiveAction(null);
    setSuccessAction('verify_signup');
    await scheduleDelay(700);
    if (!mountedRef.current) return;

    setSuccessAction(null);
    onAuthenticated(result.data.account);
  };

  const handleResendCode = async (purpose: 'signup' | 'reset' | 'admin_activate') => {
    if (isBusy || resendCooldown > 0) return;
    setErrorMsg(null);
    setActiveAction('resend_code');

    await scheduleDelay(500);
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
    setPendingCodePreview(result.data.verificationCode);
    setOtpCode('');
    setResendCooldown(30);
    setInfoMsg(`A fresh 6-digit code has been sent to ${pendingEmail}.`);

    await scheduleDelay(650);
    if (!mountedRef.current) return;
    setSuccessAction(null);
  };

  const handleForgotRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setErrorMsg(null);
    setInfoMsg(null);
    setActiveAction('forgot_request');

    await scheduleDelay(550);
    if (!mountedRef.current) return;

    const result = authService.requestPasswordReset(forgotIdentifier, portal);
    if (!mountedRef.current) return;

    if (!result.ok || !result.data) {
      setActiveAction(null);
      setErrorMsg(result.error ?? 'Account not found.');
      return;
    }

    setActiveAction(null);
    setSuccessAction('forgot_request');
    await scheduleDelay(650);
    if (!mountedRef.current) return;

    setSuccessAction(null);
    setPendingEmail(result.data.email);
    setPendingCodePreview(result.data.verificationCode);
    setOtpCode('');
    setResendCooldown(30);
    setInfoMsg(`Reset code sent to ${result.data.email}`);
    switchView('forgot_verify', true);
  };

  const handleForgotVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setErrorMsg(null);
    setActiveAction('forgot_verify');

    await scheduleDelay(550);
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
    await scheduleDelay(650);
    if (!mountedRef.current) return;

    setSuccessAction(null);
    setNewPassword('');
    setConfirmNewPassword('');
    setInfoMsg('Code verified. Create your new password below.');
    switchView('forgot_reset', true);
  };

  const handleForgotResetSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setErrorMsg(null);
    setActiveAction('forgot_save');

    await scheduleDelay(600);
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
    await scheduleDelay(750);
    if (!mountedRef.current) return;

    // Auto-fill identifier & new password on Login so user only presses Login
    setSuccessAction(null);
    setSigninMatric(result.data.identifier);
    setSigninPassword(result.data.newPassword);
    setShowSigninPassword(false);
    setInfoMsg('Password updated! Your credentials are ready — tap Login.');
    switchView('signin', true, true);
  };

  const handleCopyPreviewCode = () => {
    if (!pendingCodePreview) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(pendingCodePreview).catch(() => {});
    }
    setOtpCode(pendingCodePreview);
    setCopiedCode(true);
    const id = window.setTimeout(() => setCopiedCode(false), 1400);
    timersRef.current.push(id);
  };

  const viewHeading =
    view === 'signin'
      ? portal === 'super_admin'
        ? 'Super Admin Login'
        : portal === 'school_admin'
          ? 'School Admin Login'
          : 'Sign in'
      : view === 'signup'
      ? 'Sign up'
      : view === 'verify_signup'
      ? 'Verify Email'
      : view === 'forgot_request'
      ? 'Forgot Password'
      : view === 'forgot_verify'
      ? 'Enter Reset Code'
      : view === 'admin_activate_request'
      ? 'Activate School Admin'
      : view === 'admin_activate_verify'
      ? 'Set Admin Password'
      : view === 'dev_super_admin_setup'
      ? 'Dev Super Admin Setup'
      : 'Set New Password';

  const viewSubheading =
    view === 'signin'
      ? portal === 'super_admin'
        ? 'Restricted platform control console.'
        : portal === 'school_admin'
          ? 'Sign in with the university admin email approved by Super Admin.'
          : 'Sign in with your matric number or registered student email.'
      : view === 'signup'
      ? 'Create your verified student account with your matric number.'
      : view === 'verify_signup'
      ? `Enter the 6-digit verification key sent to ${pendingEmail}.`
      : view === 'forgot_request'
      ? portal === 'student'
        ? 'Enter your matric number or email to receive a reset code.'
        : 'Enter your registered administrator email to receive a reset code.'
      : view === 'forgot_verify'
      ? `Enter the 6-digit reset code sent to ${pendingEmail}.`
      : view === 'admin_activate_request'
      ? 'Enter the email granted School Admin access to confirm ownership and choose your password.'
      : view === 'admin_activate_verify'
      ? `Verify the 6-digit code sent to ${pendingEmail} and create your password.`
      : view === 'dev_super_admin_setup'
      ? 'Local development bootstrap for initializing the first Super Admin account.'
      : 'Choose a new password for your account.';

  return (
    <div className="min-h-[100dvh] w-full bg-[#1D1E23] text-[#1A1B20] flex flex-col lg:grid lg:grid-cols-12 page-enter">
      {/* Dark Ash Brand Top Section (Mobile) & Left Panel (Desktop) */}
      <div className="relative bg-[#1D1E23] text-white lg:col-span-5 flex flex-col justify-between overflow-hidden shrink-0">
        {/* Subtle organic wave texture */}
        <svg
          aria-hidden="true"
          viewBox="0 0 800 500"
          className="pointer-events-none absolute inset-0 h-full w-full opacity-25"
          preserveAspectRatio="none"
        >
          <path
            d="M-40,340 C160,210 380,410 620,250 C720,180 790,230 840,190"
            fill="none"
            stroke="#464A58"
            strokeWidth="1.5"
          />
          <path
            d="M-40,390 C180,260 400,450 640,290 C740,220 800,270 840,235"
            fill="none"
            stroke="#363946"
            strokeWidth="1.2"
          />
        </svg>

        {/* Top Utility Control */}
        <div className="relative z-10 flex items-center justify-between px-4 sm:px-8 pt-[calc(1rem+env(safe-area-inset-top))] sm:pt-[calc(1.75rem+env(safe-area-inset-top))] min-h-[52px]">
          {(view !== 'signin' || onBackToOnboarding) ? (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => {
                if (view === 'verify_signup') goBackAuth('signup');
                else if (view === 'forgot_reset') goBackAuth('forgot_verify');
                else if (view === 'forgot_verify') goBackAuth('forgot_request');
                else if (view === 'admin_activate_verify') goBackAuth('admin_activate_request');
                else if (
                  view === 'signup' ||
                  view === 'forgot_request' ||
                  view === 'admin_activate_request' ||
                  view === 'dev_super_admin_setup'
                ) {
                  goBackAuth('signin');
                } else {
                  onBackToOnboarding?.();
                }
              }}
              aria-label="Go back"
              className="h-10 w-10 rounded-full bg-[#2B2E38] hover:bg-[#353946] text-white inline-flex items-center justify-center cursor-pointer transition-colors disabled:opacity-45"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          ) : (
            <div className="h-10" aria-hidden="true" />
          )}
        </div>

        {/* Centered Brand Lockup */}
        <div className="relative z-10 flex flex-col items-center lg:items-start text-center lg:text-left px-6 pt-5 pb-11 sm:pt-7 sm:pb-14 lg:px-12 lg:py-0 lg:my-auto">
          <div className="text-white">
            <BrandLockup className="h-12 lg:h-16 w-auto" />
          </div>

          <p className="mt-3 text-xs lg:text-sm text-[#A5AAB8] max-w-xs leading-relaxed">
            {portal === 'super_admin'
              ? 'Platform Governance, University Management, Payments & Broadcasts.'
              : portal === 'school_admin'
                ? 'University Examination Desk for verified School Administrators.'
                : 'University past questions indexed by session, semester, faculty, and course code.'}
          </p>
        </div>

        {/* Desktop quiet footer */}
        <div className="hidden lg:block relative z-10 px-12 pb-8 text-xs text-[#7E8392]">
          {portal === 'super_admin'
            ? 'Authorized Super Administrator access only.'
            : portal === 'school_admin'
              ? 'Authorized University Administrators only.'
              : 'Currently open to AAUA students via verified matriculation number.'}
        </div>
      </div>

      {/* White Curved Sheet Body */}
      <div className="relative flex-1 bg-white lg:col-span-7 flex flex-col justify-center px-5 sm:px-10 pt-7 pb-8 sm:pt-9 sm:pb-10 lg:py-10 rounded-t-[36px] sm:rounded-t-[44px] -mt-5 sm:-mt-6 lg:mt-0 lg:rounded-tr-none lg:rounded-l-[44px] lg:-ml-6 z-20">
        <div className="w-full max-w-md mx-auto">
          {/* Header */}
          <div className="mb-6">
            <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-[#1A1B20]">
              {viewHeading}
            </h1>
            <p className="mt-1.5 text-xs sm:text-sm text-[#686C78] leading-relaxed">
              {viewSubheading}
            </p>
          </div>

          {/* Inline Error or Info Notice */}
          {errorMsg && (
            <div
              role="alert"
              className="mb-4 rounded-2xl bg-[#FEF2F2] border border-[#FECACA] px-4 py-3 text-xs font-medium text-[#B91C1C] page-enter"
            >
              {errorMsg}
            </div>
          )}

          {infoMsg && (
            <div
              role="status"
              className="mb-4 rounded-2xl bg-[#F0FDF4] border border-[#BBF7D0] px-4 py-3 text-xs font-medium text-[#15803D] flex items-center gap-2 page-enter"
            >
              <Check className="w-4 h-4 shrink-0" />
              <span>{infoMsg}</span>
            </div>
          )}

          {/* VIEW 1: SIGN IN */}
          {view === 'signin' && (
            <div className="space-y-4 page-enter">
              <form onSubmit={handleSignInSubmit} className="space-y-4" noValidate>
                <div>
                  <label
                    htmlFor="signin-matric"
                    className="block text-xs font-semibold text-[#1A1B20] mb-1.5 pl-1"
                  >
                    {portal === 'student'
                      ? 'Matric Number or Email'
                      : portal === 'school_admin'
                        ? 'Approved Admin Email'
                        : 'Super Admin Email'}
                  </label>
                  <input
                    id="signin-matric"
                    type={portal === 'student' ? 'text' : 'email'}
                    inputMode={portal === 'student' ? 'text' : 'email'}
                    autoCapitalize="none"
                    autoCorrect="off"
                    disabled={isBusy}
                    value={signinMatric}
                    onChange={(e) => setSigninMatric(e.target.value)}
                    placeholder={
                      portal === 'student'
                        ? 'e.g. 230404001 or student@aaua.edu.ng'
                        : portal === 'school_admin'
                          ? 'coordinator@university.edu.ng'
                          : 'superadmin@pqguide.local'
                    }
                    className="h-12 w-full rounded-full border border-[#1A1B20]/15 bg-white px-4 text-sm text-[#1A1B20] placeholder:text-[#9AA0AE] focus:border-[#1D1E23] transition-colors disabled:opacity-60"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5 px-1">
                    <label
                      htmlFor="signin-password"
                      className="block text-xs font-semibold text-[#1A1B20]"
                    >
                      Password
                    </label>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => {
                        setForgotIdentifier(signinMatric);
                        switchView('forgot_request');
                      }}
                      className="text-xs font-semibold text-[#1D1E23] hover:underline underline-offset-4 cursor-pointer disabled:opacity-45"
                    >
                      Forgot password?
                    </button>
                  </div>

                  <div className="relative">
                    <input
                      id="signin-password"
                      type={showSigninPassword ? 'text' : 'password'}
                      disabled={isBusy}
                      value={signinPassword}
                      onChange={(e) => setSigninPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="h-12 w-full rounded-full border border-[#1A1B20]/15 bg-white pl-4 pr-12 text-sm text-[#1A1B20] placeholder:text-[#9AA0AE] focus:border-[#1D1E23] transition-colors disabled:opacity-60"
                    />
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => setShowSigninPassword((s) => !s)}
                      aria-label={showSigninPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full flex items-center justify-center text-[#686C78] hover:text-[#1A1B20] cursor-pointer"
                    >
                      {showSigninPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="pt-2">
                  <TactileButton
                    type="submit"
                    variant="dark"
                    size="lg"
                    fullWidth
                    className="rounded-full"
                    loading={activeAction === 'signin'}
                    success={successAction === 'signin'}
                    successLabel="Signed in!"
                    disabled={isBusy}
                  >
                    {portal === 'student' ? 'Login' : 'Sign in to Console'}
                  </TactileButton>
                </div>

                {portal === 'student' && (
                  <p className="text-center text-xs text-[#686C78] pt-2">
                    New student here?{' '}
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => switchView('signup')}
                      className="font-bold text-[#1D1E23] underline underline-offset-4 cursor-pointer disabled:opacity-45"
                    >
                      Create an account
                    </button>
                  </p>
                )}

                {portal === 'school_admin' && (
                  <p className="text-center text-xs text-[#686C78] pt-2">
                    Granted email access by Super Admin?{' '}
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => {
                        setActivateEmail(signinMatric.includes('@') ? signinMatric : '');
                        switchView('admin_activate_request');
                      }}
                      className="font-bold text-[#1D1E23] underline underline-offset-4 cursor-pointer disabled:opacity-45"
                    >
                      Activate approved email
                    </button>
                  </p>
                )}
              </form>

              {/* Dev Super Admin Bootstrap & Reset strictly restricted to Super Admin Portal */}
              {portal === 'super_admin' && IS_DEV_BOOTSTRAP_ENV && (
                <div className="mt-5 pt-4 border-t border-[#1A1B20]/[0.08] space-y-2.5">
                  {devBootstrapAvailable && (
                    <button
                      type="button"
                      onClick={() => switchView('dev_super_admin_setup')}
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
                        Clears local accounts, sessions, and bootstrap lock in development storage only. Type <span className="font-mono-tabular font-bold text-[#1A1B20]">RESET DEV DATA</span> to confirm.
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

          {/* VIEW 2: SIGN UP (Student Portal Only) */}
          {view === 'signup' && portal === 'student' && (
            <form onSubmit={handleSignUpSubmit} className="space-y-3.5 page-enter" noValidate>
              <div>
                <label
                  htmlFor="signup-name"
                  className="block text-xs font-semibold text-[#1A1B20] mb-1.5 pl-1"
                >
                  Full Name
                </label>
                <input
                  id="signup-name"
                  type="text"
                  disabled={isBusy}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Adeola Adetola"
                  className="h-12 w-full rounded-full border border-[#1A1B20]/15 bg-white px-4 text-sm text-[#1A1B20] placeholder:text-[#9AA0AE] focus:border-[#1D1E23] transition-colors disabled:opacity-60"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label
                    htmlFor="signup-matric"
                    className="block text-xs font-semibold text-[#1A1B20] mb-1.5 pl-1"
                  >
                    Matric Number
                  </label>
                  <input
                    id="signup-matric"
                    type="text"
                    inputMode="numeric"
                    maxLength={9}
                    disabled={isBusy}
                    value={signupMatric}
                    onChange={(e) =>
                      setSignupMatric(e.target.value.replace(/\D/g, '').slice(0, 9))
                    }
                    placeholder="e.g. 230404001"
                    className="h-12 w-full rounded-full border border-[#1A1B20]/15 bg-white px-4 font-mono-tabular text-sm text-[#1A1B20] placeholder:text-[#9AA0AE] focus:border-[#1D1E23] transition-colors disabled:opacity-60"
                  />
                </div>

                <div>
                  <label
                    htmlFor="signup-level"
                    className="block text-xs font-semibold text-[#1A1B20] mb-1.5 pl-1"
                  >
                    Level
                  </label>
                  <select
                    id="signup-level"
                    disabled={isBusy}
                    value={signupLevel}
                    onChange={(e) => setSignupLevel(e.target.value as StudentLevel)}
                    className="h-12 w-full rounded-full border border-[#1A1B20]/15 bg-white px-3.5 text-sm font-mono-tabular text-[#1A1B20] focus:border-[#1D1E23] transition-colors disabled:opacity-60"
                  >
                    {STUDENT_LEVELS.map((lvl) => (
                      <option key={lvl} value={lvl}>
                        {lvl}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {liveMatricFeedback && (
                <p
                  className={`-mt-2 pl-2 text-[11px] ${
                    liveMatricFeedback.valid ? 'text-[#15803D]' : 'text-[#B91C1C]'
                  }`}
                >
                  {liveMatricFeedback.text}
                </p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <CreatableSelectInput
                  id="signup-faculty"
                  label="Faculty"
                  value={faculty}
                  options={facultyOptions}
                  onChange={handleFacultyChange}
                  onAddOption={handleAddFacultyOption}
                  placeholder="Type or select faculty"
                  disabled={isBusy}
                />
                <CreatableSelectInput
                  id="signup-department"
                  label="Department"
                  value={department}
                  options={departmentOptions}
                  onChange={setDepartment}
                  onAddOption={handleAddDepartmentOption}
                  placeholder="Type or select department"
                  disabled={isBusy}
                />
              </div>

              <div>
                <label
                  htmlFor="signup-email"
                  className="block text-xs font-semibold text-[#1A1B20] mb-1.5 pl-1"
                >
                  Email Address
                </label>
                <input
                  id="signup-email"
                  type="email"
                  disabled={isBusy}
                  value={signupEmail}
                  onChange={(e) => setSignupEmail(e.target.value)}
                  placeholder="student@aaua.edu.ng"
                  className="h-12 w-full rounded-full border border-[#1A1B20]/15 bg-white px-4 text-sm text-[#1A1B20] placeholder:text-[#9AA0AE] focus:border-[#1D1E23] transition-colors disabled:opacity-60"
                />
              </div>

              <div>
                <label
                  htmlFor="signup-password"
                  className="block text-xs font-semibold text-[#1A1B20] mb-1.5 pl-1"
                >
                  Password
                </label>
                <div className="relative">
                  <input
                    id="signup-password"
                    type={showSignupPassword ? 'text' : 'password'}
                    disabled={isBusy}
                    value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    className="h-12 w-full rounded-full border border-[#1A1B20]/15 bg-white pl-4 pr-12 text-sm text-[#1A1B20] placeholder:text-[#9AA0AE] focus:border-[#1D1E23] transition-colors disabled:opacity-60"
                  />
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => setShowSignupPassword((s) => !s)}
                    aria-label={showSignupPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full flex items-center justify-center text-[#686C78] hover:text-[#1A1B20] cursor-pointer"
                  >
                    {showSignupPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="pt-2">
                <TactileButton
                  type="submit"
                  variant="dark"
                  size="lg"
                  fullWidth
                  className="rounded-full"
                  loading={activeAction === 'signup'}
                  success={successAction === 'signup'}
                  successLabel="Code Sent!"
                  disabled={isBusy}
                >
                  Create Account
                </TactileButton>
              </div>

              <p className="text-center text-xs text-[#686C78] pt-1">
                Already have an account?{' '}
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => goBackAuth('signin')}
                  className="font-bold text-[#1D1E23] underline underline-offset-4 cursor-pointer disabled:opacity-45"
                >
                  Log in
                </button>
              </p>
            </form>
          )}

          {/* VIEW 3 & VIEW 5: 6-DIGIT EMAIL VERIFICATION CODE (Signup & Forgot Password) */}
          {(view === 'verify_signup' || view === 'forgot_verify') && (
            <form
              onSubmit={
                view === 'verify_signup'
                  ? handleVerifySignupSubmit
                  : handleForgotVerifySubmit
              }
              className="space-y-4 page-enter"
              noValidate
            >
              {/* Simulated Email Inbox Delivery Card so verification works smoothly */}
              <div className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/[0.08] p-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-9 w-9 rounded-xl bg-[#1D1E23] text-white flex items-center justify-center shrink-0">
                    <Mail className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-[#686C78]">
                      Email Inbox Preview
                    </p>
                    <p className="font-mono-tabular text-sm font-bold text-[#1A1B20] truncate">
                      Code: {pendingCodePreview}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={handleCopyPreviewCode}
                  className="min-h-[36px] px-3 rounded-xl bg-white border border-[#1A1B20]/10 text-xs font-semibold text-[#1A1B20] inline-flex items-center gap-1.5 shrink-0 cursor-pointer hover:bg-[#EFF1F5] disabled:opacity-45"
                >
                  {copiedCode ? (
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

              <div>
                <label className="block text-xs font-semibold text-[#1A1B20] mb-2 pl-1">
                  Enter 6-Digit Key Code
                </label>
                <OtpCodeInput
                  value={otpCode}
                  onChange={setOtpCode}
                  disabled={isBusy}
                />
              </div>

              <div className="pt-1 space-y-2.5">
                <TactileButton
                  type="submit"
                  variant="dark"
                  size="lg"
                  fullWidth
                  className="rounded-full"
                  loading={
                    activeAction ===
                    (view === 'verify_signup' ? 'verify_signup' : 'forgot_verify')
                  }
                  success={
                    successAction ===
                    (view === 'verify_signup' ? 'verify_signup' : 'forgot_verify')
                  }
                  successLabel="Email Verified!"
                  disabled={isBusy}
                >
                  Verify Code
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
                  onClick={() =>
                    handleResendCode(view === 'verify_signup' ? 'signup' : 'reset')
                  }
                >
                  {resendCooldown > 0
                    ? `Resend code in ${resendCooldown}s`
                    : 'Resend code'}
                </TactileButton>
              </div>

              <div className="text-center pt-1">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() =>
                    goBackAuth(view === 'verify_signup' ? 'signup' : 'forgot_request')
                  }
                  className="text-xs font-semibold text-[#686C78] hover:text-[#1A1B20] inline-flex items-center gap-1 cursor-pointer disabled:opacity-45"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>
                    {view === 'verify_signup'
                      ? 'Edit registration details'
                      : 'Change matric or email'}
                  </span>
                </button>
              </div>
            </form>
          )}

          {/* VIEW 4: FORGOT PASSWORD REQUEST */}
          {view === 'forgot_request' && (
            <form onSubmit={handleForgotRequestSubmit} className="space-y-4 page-enter" noValidate>
              <div>
                <label
                  htmlFor="forgot-identifier"
                  className="block text-xs font-semibold text-[#1A1B20] mb-1.5 pl-1"
                >
                  {portal === 'student'
                    ? 'Matric Number or Registered Email'
                    : 'Registered Administrator Email'}
                </label>
                <input
                  id="forgot-identifier"
                  type={portal === 'student' ? 'text' : 'email'}
                  disabled={isBusy}
                  value={forgotIdentifier}
                  onChange={(e) => setForgotIdentifier(e.target.value)}
                  placeholder={
                    portal === 'student'
                      ? 'e.g. 230404001 or student@aaua.edu.ng'
                      : 'coordinator@university.edu.ng'
                  }
                  className="h-12 w-full rounded-full border border-[#1A1B20]/15 bg-white px-4 text-sm text-[#1A1B20] placeholder:text-[#9AA0AE] focus:border-[#1D1E23] transition-colors disabled:opacity-60"
                />
              </div>

              <div className="pt-1 space-y-2.5">
                <TactileButton
                  type="submit"
                  variant="dark"
                  size="lg"
                  fullWidth
                  className="rounded-full"
                  loading={activeAction === 'forgot_request'}
                  success={successAction === 'forgot_request'}
                  successLabel="Code Sent!"
                  disabled={isBusy}
                >
                  Send Verification Code
                </TactileButton>
              </div>

              <div className="text-center pt-1">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => goBackAuth('signin')}
                  className="text-xs font-semibold text-[#686C78] hover:text-[#1A1B20] inline-flex items-center gap-1 cursor-pointer disabled:opacity-45"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to Sign in</span>
                </button>
              </div>
            </form>
          )}

          {/* VIEW 6: SET NEW PASSWORD AFTER RESET VERIFICATION */}
          {view === 'forgot_reset' && (
            <form onSubmit={handleForgotResetSave} className="space-y-4 page-enter" noValidate>
              <div>
                <label
                  htmlFor="new-password"
                  className="block text-xs font-semibold text-[#1A1B20] mb-1.5 pl-1"
                >
                  New Password
                </label>
                <div className="relative">
                  <input
                    id="new-password"
                    type={showNewPassword ? 'text' : 'password'}
                    disabled={isBusy}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    className="h-12 w-full rounded-full border border-[#1A1B20]/15 bg-white pl-4 pr-12 text-sm text-[#1A1B20] placeholder:text-[#9AA0AE] focus:border-[#1D1E23] transition-colors disabled:opacity-60"
                  />
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => setShowNewPassword((s) => !s)}
                    aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full flex items-center justify-center text-[#686C78] hover:text-[#1A1B20] cursor-pointer"
                  >
                    {showNewPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor="confirm-new-password"
                  className="block text-xs font-semibold text-[#1A1B20] mb-1.5 pl-1"
                >
                  Confirm New Password
                </label>
                <input
                  id="confirm-new-password"
                  type={showNewPassword ? 'text' : 'password'}
                  disabled={isBusy}
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  placeholder="Re-enter your new password"
                  className="h-12 w-full rounded-full border border-[#1A1B20]/15 bg-white px-4 text-sm text-[#1A1B20] placeholder:text-[#9AA0AE] focus:border-[#1D1E23] transition-colors disabled:opacity-60"
                />
              </div>

              <div className="pt-1">
                <TactileButton
                  type="submit"
                  variant="dark"
                  size="lg"
                  fullWidth
                  className="rounded-full"
                  loading={activeAction === 'forgot_save'}
                  success={successAction === 'forgot_save'}
                  successLabel="Password Saved!"
                  disabled={isBusy}
                >
                  Save New Password
                </TactileButton>
              </div>
            </form>
          )}

          {/* VIEW 6B: SCHOOL ADMIN FIRST-TIME EMAIL ACTIVATION (REQUEST CODE) */}
          {view === 'admin_activate_request' && portal === 'school_admin' && (
            <form onSubmit={handleAdminActivateRequest} className="space-y-4 page-enter" noValidate>
              <div>
                <label
                  htmlFor="activate-admin-email"
                  className="block text-xs font-semibold text-[#1A1B20] mb-1.5 pl-1"
                >
                  Super-Admin Approved Email
                </label>
                <input
                  id="activate-admin-email"
                  type="email"
                  disabled={isBusy}
                  value={activateEmail}
                  onChange={(e) => setActivateEmail(e.target.value)}
                  placeholder="coordinator@university.edu.ng"
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
                disabled={isBusy}
              >
                Send Activation Code
              </TactileButton>

              <div className="text-center pt-1">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => goBackAuth('signin')}
                  className="text-xs font-semibold text-[#686C78] hover:text-[#1A1B20] inline-flex items-center gap-1 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to School Admin Login</span>
                </button>
              </div>
            </form>
          )}

          {/* VIEW 6C: SCHOOL ADMIN FIRST-TIME EMAIL ACTIVATION (VERIFY + SET PASSWORD) */}
          {view === 'admin_activate_verify' && portal === 'school_admin' && (
            <form onSubmit={handleAdminActivateComplete} className="space-y-4 page-enter" noValidate>
              <div className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/[0.08] p-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-9 w-9 rounded-xl bg-[#1D1E23] text-white flex items-center justify-center shrink-0">
                    <Mail className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-[#686C78]">
                      Email Inbox Preview
                    </p>
                    <p className="font-mono-tabular text-sm font-bold text-[#1A1B20] truncate">
                      Code: {pendingCodePreview}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={handleCopyPreviewCode}
                  className="min-h-[36px] px-3 rounded-xl bg-white border border-[#1A1B20]/10 text-xs font-semibold text-[#1A1B20] inline-flex items-center gap-1.5 shrink-0 cursor-pointer hover:bg-[#EFF1F5]"
                >
                  {copiedCode ? <Check className="w-3.5 h-3.5 text-[#16A34A]" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedCode ? 'Filled' : 'Auto-fill'}</span>
                </button>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1A1B20] mb-2 pl-1">
                  Enter 6-Digit Key Code
                </label>
                <OtpCodeInput value={otpCode} onChange={setOtpCode} disabled={isBusy} />
              </div>

              <div>
                <label
                  htmlFor="activate-admin-pw"
                  className="block text-xs font-semibold text-[#1A1B20] mb-1.5 pl-1"
                >
                  Create Password (min. 8 characters)
                </label>
                <div className="relative">
                  <input
                    id="activate-admin-pw"
                    type={showActivatePassword ? 'text' : 'password'}
                    disabled={isBusy}
                    value={activatePassword}
                    onChange={(e) => setActivatePassword(e.target.value)}
                    placeholder="Choose strong password"
                    className="h-12 w-full rounded-full border border-[#1A1B20]/15 bg-white pl-4 pr-12 text-sm text-[#1A1B20]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowActivatePassword((s) => !s)}
                    aria-label={showActivatePassword ? 'Hide password' : 'Show password'}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full flex items-center justify-center text-[#686C78] hover:text-[#1A1B20] cursor-pointer"
                  >
                    {showActivatePassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor="activate-admin-pw2"
                  className="block text-xs font-semibold text-[#1A1B20] mb-1.5 pl-1"
                >
                  Confirm Password
                </label>
                <input
                  id="activate-admin-pw2"
                  type={showActivatePassword ? 'text' : 'password'}
                  disabled={isBusy}
                  value={activateConfirmPassword}
                  onChange={(e) => setActivateConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  className="h-12 w-full rounded-full border border-[#1A1B20]/15 bg-white px-4 text-sm text-[#1A1B20]"
                />
              </div>

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
                  disabled={isBusy}
                >
                  Verify &amp; Enter School Admin
                </TactileButton>

                <TactileButton
                  type="button"
                  variant="light"
                  size="md"
                  fullWidth
                  className="rounded-full"
                  icon={<RefreshCw className="w-3.5 h-3.5" />}
                  loading={activeAction === 'resend_code'}
                  disabled={isBusy || resendCooldown > 0}
                  onClick={() => handleResendCode('admin_activate')}
                >
                  {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
                </TactileButton>
              </div>
            </form>
          )}

          {/* VIEW 7: DEV-ONLY FIRST SUPER ADMIN BOOTSTRAP (Super Admin Portal Only) */}
          {view === 'dev_super_admin_setup' && portal === 'super_admin' && (
            <div className="space-y-4 page-enter">
              <div className="rounded-2xl bg-[#FFFBEB] border border-[#FDE68A] px-4 py-3 text-xs text-[#92400E] leading-relaxed">
                <p className="font-bold">Local Development Only — Not Production Auth</p>
                <p className="mt-0.5">
                  This setup creates your first Super Admin locally in browser storage so you can administer PQGuide during development. Production deployments must provision Super Admins server-side with MFA.
                </p>
              </div>

              {!devBootstrapAvailable ? (
                <div className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/10 p-5 text-center space-y-3">
                  <p className="text-sm font-bold text-[#1A1B20]">
                    Bootstrap Interface Disabled
                  </p>
                  <p className="text-xs text-[#505460]">
                    A Super Admin account is already initialized or this build is not running in development mode.
                  </p>
                  <TactileButton
                    type="button"
                    variant="dark"
                    size="md"
                    onClick={() => goBackAuth('signin')}
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

                  <div>
                    <label
                      htmlFor="dev-sa-password"
                      className="block text-xs font-semibold text-[#1A1B20] mb-1 pl-1"
                    >
                      Password (10+ chars, letters &amp; numbers)
                    </label>
                    <div className="relative">
                      <input
                        id="dev-sa-password"
                        type={showDevPassword ? 'text' : 'password'}
                        disabled={isBusy}
                        value={devPassword}
                        onChange={(e) => setDevPassword(e.target.value)}
                        placeholder="Create strong local dev password"
                        className="h-11 w-full rounded-full border border-[#1A1B20]/15 bg-white pl-4 pr-12 text-sm text-[#1A1B20]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowDevPassword((s) => !s)}
                        aria-label={showDevPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full flex items-center justify-center text-[#686C78] hover:text-[#1A1B20] cursor-pointer"
                      >
                        {showDevPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="dev-sa-confirm"
                      className="block text-xs font-semibold text-[#1A1B20] mb-1 pl-1"
                    >
                      Confirm Password
                    </label>
                    <input
                      id="dev-sa-confirm"
                      type={showDevPassword ? 'text' : 'password'}
                      disabled={isBusy}
                      value={devConfirmPassword}
                      onChange={(e) => setDevConfirmPassword(e.target.value)}
                      placeholder="Re-enter password"
                      className="h-11 w-full rounded-full border border-[#1A1B20]/15 bg-white px-4 text-sm text-[#1A1B20]"
                    />
                  </div>

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

                  <div className="pt-1">
                    <TactileButton
                      type="submit"
                      variant="dark"
                      size="lg"
                      fullWidth
                      className="rounded-full"
                      loading={activeAction === 'dev_bootstrap'}
                      success={successAction === 'dev_bootstrap'}
                      successLabel="Super Admin Ready!"
                      disabled={isBusy}
                    >
                      Initialize Dev Super Admin
                    </TactileButton>
                  </div>
                </form>
              )}

              <div className="text-center pt-1">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => goBackAuth('signin')}
                  className="text-xs font-semibold text-[#686C78] hover:text-[#1A1B20] inline-flex items-center gap-1 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to Sign in</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
