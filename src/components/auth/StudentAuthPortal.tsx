import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  GraduationCap,
  RefreshCw,
} from 'lucide-react';
import type { AuthenticatedUser, StudentLevel } from '../../core/types';
import {
  AAUA_FACULTIES,
  authService,
  evaluatePasswordStrength,
  validateEmailAddress,
  validateMatricNumber,
} from '../../services/authService';
import { CreatableSelectInput } from '../ui/CreatableSelectInput';
import { CustomSelect } from '../ui/CustomSelect';
import { TactileButton } from '../ui/TactileButton';
import { AuthPortalShell } from './AuthPortalShell';
import { GoogleAuthButton } from './GoogleAuthButton';
import { OtpVerificationStep } from './OtpVerificationStep';
import { PasswordField } from './PasswordField';
import { PasswordStrengthMeter } from './PasswordStrengthMeter';
import type { AuthView, PortalAuthProps } from './types';

type StudentActionKey =
  | 'signin'
  | 'signup'
  | 'verify_signup'
  | 'resend_code'
  | 'forgot_request'
  | 'forgot_verify'
  | 'forgot_save'
  | 'google_auth';

const STUDENT_LEVELS: StudentLevel[] = ['100L', '200L', '300L', '400L', '500L'];

const ALLOWED_STUDENT_VIEWS = new Set<AuthView>([
  'signin',
  'signup',
  'signup_success',
  'verify_signup',
  'forgot_request',
  'forgot_verify',
  'forgot_reset',
  'forgot_success',
]);

export const StudentAuthPortal: React.FC<PortalAuthProps> = ({
  view: rawView,
  sessionNotice,
  onDismissSessionNotice,
  onSwitchView,
  onGoBack,
  onAuthenticated,
  onBackToOnboarding,
  onBusyChange,
}) => {
  const view: AuthView = ALLOWED_STUDENT_VIEWS.has(rawView) ? rawView : 'signin';

  const [activeAction, setActiveAction] = useState<StudentActionKey | null>(null);
  const [successAction, setSuccessAction] = useState<StudentActionKey | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  // Sign-In state
  const [signinIdentifier, setSigninIdentifier] = useState('');
  const [signinPassword, setSigninPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);

  // Google Auth state (strictly Student Portal)
  const [googleStatus, setGoogleStatus] = useState<{
    tone: 'error' | 'warning' | 'success';
    text: string;
  } | null>(null);

  // Sign-Up state
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
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('');
  const [touchedSignup, setTouchedSignup] = useState(false);

  // OTP / Reset state
  const [pendingEmail, setPendingEmail] = useState('');
  const [pendingMatric, setPendingMatric] = useState('');
  const [pendingCodePreview, setPendingCodePreview] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  // Forgot Password state
  const [forgotIdentifier, setForgotIdentifier] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [resetIdentifierResult, setResetIdentifierResult] = useState('');

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
    setGoogleStatus(null);
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

  // Faculty & Department options
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
      ? Object.keys(AAUA_FACULTIES).find((k) => k.toLowerCase() === normalizedFacultyKey)
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
      const existsInPreset = Object.keys(AAUA_FACULTIES).some((k) => k.toLowerCase() === lower);
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
      const matchedPresetKey = Object.keys(AAUA_FACULTIES).find((k) => k.toLowerCase() === facKey);
      const existsInPreset = matchedPresetKey
        ? AAUA_FACULTIES[matchedPresetKey].some((d) => d.toLowerCase() === lower)
        : false;
      const existsInExtra = existing.some((d) => d.toLowerCase() === lower);
      if (existsInPreset || existsInExtra) return prev;
      return { ...prev, [facKey]: [...existing, cleaned] };
    });
  };

  // Field-level live validation for Registration
  const signupValidation = useMemo(() => {
    const cleanName = fullName.trim();
    const matricCheck = validateMatricNumber(signupMatric);
    const cleanEmail = signupEmail.trim().toLowerCase();
    const emailValid = validateEmailAddress(cleanEmail);
    const pwReport = evaluatePasswordStrength(signupPassword, 'student');
    const passwordsMatch =
      Boolean(signupConfirmPassword) && signupPassword === signupConfirmPassword;

    const dup = authService.isDuplicateMatricOrEmail({
      matricNumber: matricCheck.valid ? matricCheck.normalized : undefined,
      email: emailValid ? cleanEmail : undefined,
    });

    const nameError =
      touchedSignup && cleanName.length < 2 ? 'Enter your full name (at least 2 characters).' : null;

    const matricFeedback = !signupMatric
      ? touchedSignup
        ? { valid: false, text: 'Enter your 9-digit matric number.' }
        : null
      : signupMatric.length === 9 || touchedSignup
        ? !matricCheck.valid
          ? { valid: false, text: matricCheck.error ?? 'Invalid matric number.' }
          : dup.duplicateMatric
            ? { valid: false, text: 'This matric number is already registered.' }
            : { valid: true, text: 'Valid matric number' }
        : null;

    const emailFeedback = !cleanEmail
      ? touchedSignup
        ? { valid: false, text: 'Enter your email address.' }
        : null
      : !emailValid
        ? touchedSignup || cleanEmail.includes('@')
          ? { valid: false, text: 'Enter a valid email address.' }
          : null
        : dup.isAdminEmail
          ? { valid: false, text: 'Administrator emails cannot be registered here.' }
          : dup.duplicateEmail
            ? { valid: false, text: 'This email is already registered.' }
            : null;

    const confirmError =
      signupConfirmPassword && !passwordsMatch ? 'Passwords do not match.' : null;

    const isFormValid =
      cleanName.length >= 2 &&
      matricCheck.valid &&
      !dup.duplicateMatric &&
      faculty.trim().length >= 2 &&
      department.trim().length >= 2 &&
      emailValid &&
      !dup.duplicateEmail &&
      !dup.isAdminEmail &&
      pwReport.meetsMinimum &&
      passwordsMatch;

    return {
      nameError,
      matricFeedback,
      emailFeedback,
      confirmError,
      pwReport,
      isFormValid,
    };
  }, [
    fullName,
    signupMatric,
    faculty,
    department,
    signupEmail,
    signupPassword,
    signupConfirmPassword,
    touchedSignup,
  ]);

  // Reset password live validation
  const resetPwReport = useMemo(
    () => evaluatePasswordStrength(newPassword, 'student'),
    [newPassword]
  );
  const resetConfirmError =
    confirmNewPassword && newPassword !== confirmNewPassword ? 'Passwords do not match.' : null;

  // Handlers
  const handleSignInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setErrorMsg(null);
    setInfoMsg(null);
    setGoogleStatus(null);
    setActiveAction('signin');

    await scheduleDelay(380);
    if (!mountedRef.current) return;

    const result = await authService.signinWithPortal(
      'student',
      signinIdentifier,
      signinPassword,
      rememberMe
    );
    if (!mountedRef.current) return;

    if (!result.ok || !result.data) {
      setActiveAction(null);
      setErrorMsg(result.error ?? 'Unable to sign in.');
      return;
    }

    setActiveAction(null);
    setSuccessAction('signin');
    await scheduleDelay(420);
    if (!mountedRef.current) return;

    setSuccessAction(null);
    onAuthenticated(result.data.account, rememberMe);
  };

  const handleGoogleContinue = async () => {
    if (isBusy) return;
    setErrorMsg(null);
    setInfoMsg(null);
    setGoogleStatus(null);
    setActiveAction('google_auth');

    const result = await authService.authenticateStudentWithGoogle(rememberMe);
    if (!mountedRef.current) return;

    if (!result.ok || !result.data) {
      setActiveAction(null);
      setGoogleStatus({
        tone: result.notConfigured ? 'warning' : 'error',
        text: result.error ?? 'Unable to continue with Google.',
      });
      return;
    }

    if (result.data.account) {
      setActiveAction(null);
      setSuccessAction('google_auth');
      setGoogleStatus({
        tone: 'success',
        text: 'Google account verified. Redirecting to your Student Dashboard...',
      });
      await scheduleDelay(450);
      if (!mountedRef.current) return;
      setSuccessAction(null);
      onAuthenticated(result.data.account, rememberMe);
      return;
    }

    if (result.data.needsProfileCompletion && result.data.googleIdentity) {
      const id = result.data.googleIdentity;
      setActiveAction(null);
      setFullName((prev) => prev || id.fullName);
      setSignupEmail(id.email);
      setInfoMsg(
        `Verified Google email (${id.email}). Complete your matric number and department details below.`
      );
      if (view !== 'signup') {
        navigateView('signup', true);
      }
      return;
    }

    setActiveAction(null);
  };

  const handleSignUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setTouchedSignup(true);
    setErrorMsg(null);
    setInfoMsg(null);
    if (!signupValidation.isFormValid) {
      setErrorMsg('Please review the highlighted fields before continuing.');
      return;
    }

    setActiveAction('signup');
    await scheduleDelay(450);
    if (!mountedRef.current) return;

    const result = await authService.startSignup({
      fullName,
      matricNumber: signupMatric,
      level: signupLevel,
      faculty: faculty.trim(),
      department: department.trim(),
      email: signupEmail,
      password: signupPassword,
      confirmPassword: signupConfirmPassword,
    });
    if (!mountedRef.current) return;

    if (!result.ok || !result.data) {
      setActiveAction(null);
      setErrorMsg(result.error ?? 'Could not create student account.');
      return;
    }

    setActiveAction(null);
    setSuccessAction('signup');
    setPendingEmail(result.data.email);
    setPendingMatric(result.data.matricNumber);
    setPendingCodePreview(result.data.verificationCode ?? '');
    setOtpCode('');
    setResendCooldown(30);

    await scheduleDelay(450);
    if (!mountedRef.current) return;

    setSuccessAction(null);
    navigateView('signup_success', true);
  };

  const handleVerifySignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    setErrorMsg(null);
    setActiveAction('verify_signup');

    await scheduleDelay(400);
    if (!mountedRef.current) return;

    const result = authService.verifySignupCode(pendingEmail, otpCode, rememberMe);
    if (!result.ok || !result.data) {
      setActiveAction(null);
      setErrorMsg(result.error ?? 'Verification failed.');
      return;
    }

    setActiveAction(null);
    setSuccessAction('verify_signup');
    await scheduleDelay(550);
    if (!mountedRef.current) return;

    setSuccessAction(null);
    onAuthenticated(result.data.account, rememberMe);
  };

  const handleResendCode = async (purpose: 'signup' | 'reset') => {
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
    setInfoMsg(`A new 6-digit verification code has been issued to ${pendingEmail}.`);

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

    const result = authService.requestPasswordReset(forgotIdentifier, 'student');
    if (!mountedRef.current) return;

    if (!result.ok || !result.data) {
      setActiveAction(null);
      setErrorMsg(result.error ?? 'No student account found.');
      return;
    }

    setActiveAction(null);
    setSuccessAction('forgot_request');
    await scheduleDelay(450);
    if (!mountedRef.current) return;

    setSuccessAction(null);
    setPendingEmail(result.data.email);
    setPendingMatric(result.data.matricNumber);
    setPendingCodePreview(result.data.verificationCode ?? '');
    setOtpCode('');
    setResendCooldown(30);
    setInfoMsg(`Reset code dispatched to ${result.data.email}.`);
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
    await scheduleDelay(480);
    if (!mountedRef.current) return;

    setSuccessAction(null);
    setNewPassword('');
    setConfirmNewPassword('');
    setInfoMsg('Email verified. Choose your new student password below.');
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
    setResetIdentifierResult(result.data.identifier);
    setSigninIdentifier(result.data.identifier);
    setSigninPassword('');
    await scheduleDelay(450);
    if (!mountedRef.current) return;

    setSuccessAction(null);
    navigateView('forgot_success', true, true);
  };

  const headingMap: Record<string, string> = {
    signin: 'Student Sign In',
    signup: 'Create Student Account',
    signup_success: 'Registration Created',
    verify_signup: 'Verify Your Email',
    forgot_request: 'Reset Student Password',
    forgot_verify: 'Enter Reset Code',
    forgot_reset: 'Set New Password',
    forgot_success: 'Password Updated',
  };

  const subheadingMap: Record<string, string> = {
    signin: 'Access AAUA past questions, study guides, and CBT practice exams.',
    signup: 'Register once using your 9-digit matriculation number and academic details.',
    signup_success: 'One quick step left — verify your email address to unlock your dashboard.',
    verify_signup: `Confirm the 6-digit verification code for ${pendingEmail}.`,
    forgot_request: 'Enter your matric number or registered email to receive a reset code.',
    forgot_verify: `Enter the 6-digit code sent to ${pendingEmail}.`,
    forgot_reset: 'Create a strong new password for your student account.',
    forgot_success: 'Your student account password has been changed successfully.',
  };

  const handleTopBack = () => {
    if (view === 'verify_signup') navigateBack('signup');
    else if (view === 'signup_success') navigateBack('signup');
    else if (view === 'forgot_reset') navigateBack('forgot_verify');
    else if (view === 'forgot_verify') navigateBack('forgot_request');
    else if (view === 'signup' || view === 'forgot_request' || view === 'forgot_success') {
      navigateBack('signin');
    } else {
      onBackToOnboarding?.();
    }
  };

  return (
    <AuthPortalShell
      portalTag="Student Portal"
      portalTagTone="student"
      brandHeadline="University Student Archive"
      brandDescription="Verified past questions, course study materials, and timed CBT practice exams indexed by faculty and session."
      brandFooter="Currently open to AAUA students via verified matriculation number."
      heading={headingMap[view] ?? 'Student Sign In'}
      subheading={subheadingMap[view] ?? ''}
      showBackButton={view !== 'signin' || Boolean(onBackToOnboarding)}
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
          <form onSubmit={handleSignInSubmit} className="space-y-4" noValidate>
            <div>
              <label
                htmlFor="student-signin-id"
                className="block text-xs font-semibold text-[#1A1B20] mb-1.5 pl-1"
              >
                Matric Number or Registered Email
              </label>
              <input
                id="student-signin-id"
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
                disabled={isBusy}
                value={signinIdentifier}
                onChange={(e) => setSigninIdentifier(e.target.value)}
                placeholder="e.g. 230404001 or student@aaua.edu.ng"
                className="h-12 w-full rounded-full border border-[#1A1B20]/15 bg-white px-4 text-sm text-[#1A1B20] placeholder:text-[#9AA0AE] focus:border-[#1D1E23] transition-colors disabled:opacity-60"
              />
            </div>

            <PasswordField
              id="student-signin-password"
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
                    setForgotIdentifier(signinIdentifier);
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
                Remember me on this device (12-hour session)
              </span>
            </label>

            <div className="pt-1">
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
                Login to Student Portal
              </TactileButton>
            </div>
          </form>

          <GoogleAuthButton
            mode="signin"
            loading={activeAction === 'google_auth'}
            success={successAction === 'google_auth'}
            disabled={isBusy}
            statusMessage={googleStatus}
            onClick={handleGoogleContinue}
          />

          <p className="text-center text-xs text-[#686C78] pt-1">
            New student here?{' '}
            <button
              type="button"
              disabled={isBusy}
              onClick={() => navigateView('signup')}
              className="font-bold text-[#1D1E23] underline underline-offset-4 cursor-pointer disabled:opacity-45"
            >
              Create an account
            </button>
          </p>
        </div>
      )}

      {/* REGISTRATION */}
      {view === 'signup' && (
        <div className="space-y-4 page-enter">
          <form onSubmit={handleSignUpSubmit} className="space-y-3.5" noValidate>
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
                autoComplete="name"
                disabled={isBusy}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Toluwanimi Adeyemi"
                aria-invalid={Boolean(signupValidation.nameError)}
                className={`h-12 w-full rounded-full border bg-white px-4 text-sm text-[#1A1B20] placeholder:text-[#9AA0AE] transition-colors disabled:opacity-60 ${
                  signupValidation.nameError
                    ? 'border-[#DC2626]'
                    : 'border-[#1A1B20]/15 focus:border-[#1D1E23]'
                }`}
              />
              {signupValidation.nameError && (
                <p className="mt-1 pl-2 text-[11px] text-[#B91C1C]">
                  {signupValidation.nameError}
                </p>
              )}
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
                  placeholder="230404001"
                  aria-invalid={Boolean(
                    signupValidation.matricFeedback && !signupValidation.matricFeedback.valid
                  )}
                  className={`h-12 w-full rounded-full border bg-white px-4 font-mono-tabular text-sm text-[#1A1B20] placeholder:text-[#9AA0AE] transition-colors disabled:opacity-60 ${
                    signupValidation.matricFeedback && !signupValidation.matricFeedback.valid
                      ? 'border-[#DC2626]'
                      : 'border-[#1A1B20]/15 focus:border-[#1D1E23]'
                  }`}
                />
              </div>

              <CustomSelect
                id="signup-level"
                label="Level"
                labelClassName="block text-xs font-semibold text-[#1A1B20] mb-1.5 pl-1"
                shape="pill"
                mono
                disabled={isBusy}
                value={signupLevel}
                options={STUDENT_LEVELS.map((lvl) => ({ value: lvl, label: lvl }))}
                onChange={(val) => setSignupLevel(val as StudentLevel)}
              />
            </div>

            {signupValidation.matricFeedback && (
              <p
                className={`-mt-2 pl-2 text-[11px] font-medium ${
                  signupValidation.matricFeedback.valid ? 'text-[#15803D]' : 'text-[#B91C1C]'
                }`}
              >
                {signupValidation.matricFeedback.text}
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
                placeholder="Pick faculty"
                disabled={isBusy}
              />
              <CreatableSelectInput
                id="signup-department"
                label="Department"
                value={department}
                options={departmentOptions}
                onChange={setDepartment}
                onAddOption={handleAddDepartmentOption}
                placeholder="Pick department"
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
                autoComplete="email"
                disabled={isBusy}
                value={signupEmail}
                onChange={(e) => setSignupEmail(e.target.value)}
                placeholder="you@aaua.edu.ng"
                aria-invalid={Boolean(
                  signupValidation.emailFeedback && !signupValidation.emailFeedback.valid
                )}
                className={`h-12 w-full rounded-full border bg-white px-4 text-sm text-[#1A1B20] placeholder:text-[#9AA0AE] transition-colors disabled:opacity-60 ${
                  signupValidation.emailFeedback && !signupValidation.emailFeedback.valid
                    ? 'border-[#DC2626]'
                    : 'border-[#1A1B20]/15 focus:border-[#1D1E23]'
                }`}
              />
              {signupValidation.emailFeedback && (
                <p className="mt-1 pl-2 text-[11px] font-medium text-[#B91C1C]">
                  {signupValidation.emailFeedback.text}
                </p>
              )}
            </div>

            <PasswordField
              id="signup-password"
              label="Password"
              value={signupPassword}
              onChange={setSignupPassword}
              placeholder="At least 8 characters with letter & number"
              disabled={isBusy}
              autoComplete="new-password"
            />

            <PasswordStrengthMeter password={signupPassword} role="student" />

            <PasswordField
              id="signup-confirm-password"
              label="Confirm Password"
              value={signupConfirmPassword}
              onChange={setSignupConfirmPassword}
              placeholder="Re-enter your password"
              disabled={isBusy}
              autoComplete="new-password"
              error={signupValidation.confirmError}
            />

            <div className="pt-1">
              <TactileButton
                type="submit"
                variant="dark"
                size="lg"
                fullWidth
                className="rounded-full"
                loading={activeAction === 'signup'}
                success={successAction === 'signup'}
                successLabel="Account Created!"
                disabled={isBusy || !signupValidation.isFormValid}
              >
                Create Student Account
              </TactileButton>
            </div>
          </form>

          <GoogleAuthButton
            mode="signup"
            loading={activeAction === 'google_auth'}
            success={successAction === 'google_auth'}
            disabled={isBusy}
            statusMessage={googleStatus}
            onClick={handleGoogleContinue}
          />

          <p className="text-center text-xs text-[#686C78] pt-1">
            Already registered?{' '}
            <button
              type="button"
              disabled={isBusy}
              onClick={() => navigateBack('signin')}
              className="font-bold text-[#1D1E23] underline underline-offset-4 cursor-pointer disabled:opacity-45"
            >
              Sign in
            </button>
          </p>
        </div>
      )}

      {/* REGISTRATION SUCCESS STATE BEFORE VERIFICATION */}
      {view === 'signup_success' && (
        <div className="space-y-5 page-enter">
          <div className="rounded-3xl bg-[#F0FDF4] border border-[#BBF7D0] p-5 space-y-3">
            <div className="flex items-center gap-3">
              <span className="h-11 w-11 rounded-2xl bg-[#16A34A] text-white flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-6 h-6" />
              </span>
              <div className="min-w-0">
                <p className="font-display text-base font-bold text-[#14532D]">
                  Student Profile Ready
                </p>
                <p className="text-xs text-[#15803D]">
                  Matric {pendingMatric || signupMatric} · {signupLevel}
                </p>
              </div>
            </div>
            <p className="text-xs text-[#166534] leading-relaxed">
              We created your registration for <span className="font-bold">{pendingEmail || signupEmail}</span> and generated a 6-digit verification code. Verify your email next to sign into your archive.
            </p>
          </div>

          <TactileButton
            type="button"
            variant="dark"
            size="lg"
            fullWidth
            className="rounded-full"
            icon={<ArrowRight className="w-4 h-4" />}
            onClick={() => {
              setInfoMsg(`Verification code sent to ${pendingEmail || signupEmail}`);
              navigateView('verify_signup', true);
            }}
          >
            Continue to Email Verification
          </TactileButton>

          <div className="text-center">
            <button
              type="button"
              onClick={() => navigateBack('signup')}
              className="text-xs font-semibold text-[#686C78] hover:text-[#1A1B20] inline-flex items-center gap-1 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Edit registration details</span>
            </button>
          </div>
        </div>
      )}

      {/* VERIFY SIGNUP OR FORGOT OTP */}
      {(view === 'verify_signup' || view === 'forgot_verify') && (
        <form
          onSubmit={
            view === 'verify_signup' ? handleVerifySignupSubmit : handleForgotVerifySubmit
          }
          className="space-y-4 page-enter"
          noValidate
        >
          <OtpVerificationStep
            email={pendingEmail}
            otpCode={otpCode}
            onOtpChange={setOtpCode}
            previewCode={pendingCodePreview}
            disabled={isBusy}
            hasError={Boolean(errorMsg)}
            changeEmailLabel={view === 'verify_signup' ? 'Edit details' : 'Change account'}
            onChangeEmail={() =>
              navigateBack(view === 'verify_signup' ? 'signup' : 'forgot_request')
            }
          />

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
              disabled={isBusy || otpCode.length !== 6}
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
              {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
            </TactileButton>
          </div>
        </form>
      )}

      {/* FORGOT REQUEST */}
      {view === 'forgot_request' && (
        <form onSubmit={handleForgotRequestSubmit} className="space-y-4 page-enter" noValidate>
          <div>
            <label
              htmlFor="student-forgot-id"
              className="block text-xs font-semibold text-[#1A1B20] mb-1.5 pl-1"
            >
              Matric Number or Registered Email
            </label>
            <input
              id="student-forgot-id"
              type="text"
              disabled={isBusy}
              value={forgotIdentifier}
              onChange={(e) => setForgotIdentifier(e.target.value)}
              placeholder="e.g. 230404001 or student@aaua.edu.ng"
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
            disabled={isBusy || !forgotIdentifier.trim()}
          >
            Send Reset Code
          </TactileButton>

          <div className="text-center pt-1">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => navigateBack('signin')}
              className="text-xs font-semibold text-[#686C78] hover:text-[#1A1B20] inline-flex items-center gap-1 cursor-pointer disabled:opacity-45"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Student Sign In</span>
            </button>
          </div>
        </form>
      )}

      {/* FORGOT RESET PASSWORD */}
      {view === 'forgot_reset' && (
        <form onSubmit={handleForgotResetSave} className="space-y-4 page-enter" noValidate>
          <PasswordField
            id="student-new-pw"
            label="New Password"
            value={newPassword}
            onChange={setNewPassword}
            placeholder="Minimum 8 characters with letter & number"
            disabled={isBusy}
            autoComplete="new-password"
          />

          <PasswordStrengthMeter password={newPassword} role="student" />

          <PasswordField
            id="student-confirm-new-pw"
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
            Save New Password
          </TactileButton>
        </form>
      )}

      {/* FORGOT PASSWORD RESET SUCCESS */}
      {view === 'forgot_success' && (
        <div className="space-y-5 page-enter">
          <div className="rounded-3xl bg-[#F0FDF4] border border-[#BBF7D0] p-5 space-y-2.5">
            <div className="flex items-center gap-3">
              <span className="h-11 w-11 rounded-2xl bg-[#16A34A] text-white flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-6 h-6" />
              </span>
              <div>
                <p className="font-display text-base font-bold text-[#14532D]">
                  Password Reset Complete
                </p>
                <p className="text-xs font-mono-tabular text-[#15803D]">
                  {resetIdentifierResult || pendingEmail}
                </p>
              </div>
            </div>
            <p className="text-xs text-[#166534] leading-relaxed">
              Your new student password is active. Use it now to sign into your Student Archive.
            </p>
          </div>

          <TactileButton
            type="button"
            variant="dark"
            size="lg"
            fullWidth
            className="rounded-full"
            icon={<GraduationCap className="w-4 h-4" />}
            onClick={() => navigateView('signin', false, true)}
          >
            Back to Student Sign In
          </TactileButton>
        </div>
      )}
    </AuthPortalShell>
  );
};
