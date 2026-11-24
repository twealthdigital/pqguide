import type { StudentAccount } from '../core/types';

const ACCOUNTS_KEY = 'prepvault_student_accounts_v1';
const OTP_KEY = 'prepvault_student_otp_v1';
const SESSION_KEY = 'prepvault_active_session_v1';
const ONBOARDING_KEY = 'prepvault_onboarding_done_v1';

export const AAUA_FACULTIES: Record<string, string[]> = {
  'Computing & Information Sciences': [
    'Computer Science',
    'Cybersecurity',
    'Information Technology',
    'Software Engineering',
  ],
  Science: [
    'Physics & Electronics',
    'Mathematical Sciences',
    'Chemical Sciences',
    'Microbiology',
    'Biochemistry',
    'Plant Science & Biotechnology',
  ],
  'Social Sciences': [
    'Economics',
    'Political Science',
    'Sociology',
    'Geography & Planning Sciences',
    'Mass Communication',
  ],
  'Management Sciences': [
    'Accounting',
    'Banking & Finance',
    'Business Administration',
    'Public Administration',
  ],
  Law: ['Common & Islamic Law', 'Jurisprudence & International Law'],
  Arts: [
    'English Studies',
    'History & International Studies',
    'Linguistics & Languages',
    'Philosophy',
  ],
  Education: [
    'Science Education',
    'Arts & Social Science Education',
    'Guidance & Counselling',
  ],
  Agriculture: [
    'Agricultural Economics',
    'Animal Science',
    'Crop, Soil & Pest Management',
  ],
};

export interface MatricValidationResult {
  valid: boolean;
  normalized: string;
  error?: string;
}

/**
 * Validates student matric numbers following AAUA cohorts:
 * - 9 digits total
 * - Cohort prefix: 180...–230... (e.g. 230404200 and earlier), 240..., 250..., 260... and stop (no 270+)
 * - Serial suffix (last 3 digits): starts from 001; 000 at the end is rejected
 */
export function validateMatricNumber(raw: string): MatricValidationResult {
  const normalized = raw.replace(/\s+/g, '').trim();

  if (!normalized) {
    return { valid: false, normalized, error: 'Enter your 9-digit matric number.' };
  }

  if (!/^\d+$/.test(normalized)) {
    return { valid: false, normalized, error: 'Matric number must contain digits only.' };
  }

  if (normalized.length !== 9) {
    return {
      valid: false,
      normalized,
      error: 'Matric number must be exactly 9 digits (e.g. 230404001).',
    };
  }

  const cohort = Number(normalized.slice(0, 3));
  const allowedCohorts = new Set([180, 190, 200, 210, 220, 230, 240, 250, 260]);
  if (!allowedCohorts.has(cohort)) {
    return {
      valid: false,
      normalized,
      error: 'Enter a valid matric cohort (260 or earlier).',
    };
  }

  if (normalized.endsWith('000')) {
    return {
      valid: false,
      normalized,
      error: 'Matric number cannot end with 000.',
    };
  }

  return { valid: true, normalized };
}

export function validateEmailAddress(raw: string): boolean {
  const email = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

interface PendingOtpRecord {
  email: string;
  purpose: 'signup' | 'reset';
  code: string;
  expiresAt: number;
}

function readAccounts(): StudentAccount[] {
  try {
    const raw = window.localStorage.getItem(ACCOUNTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAccounts(accounts: StudentAccount[]): void {
  try {
    window.localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch {
    // Ignore storage quota errors cleanly
  }
}

function readOtpRecords(): PendingOtpRecord[] {
  try {
    const raw = window.localStorage.getItem(OTP_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeOtpRecords(records: PendingOtpRecord[]): void {
  try {
    window.localStorage.setItem(OTP_KEY, JSON.stringify(records));
  } catch {
    // Ignore storage quota errors cleanly
  }
}

function generateSalt(): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
}

function generateSixDigitCode(): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return String(100000 + (buf[0] % 900000));
  }
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const input = `${salt}:${password}`;
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoded = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, '0')
    ).join('');
  }

  // Fallback non-subtle deterministic mix for restricted preview origins
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}

function issueOtp(email: string, purpose: 'signup' | 'reset'): string {
  const normalizedEmail = email.trim().toLowerCase();
  const code = generateSixDigitCode();
  const next: PendingOtpRecord = {
    email: normalizedEmail,
    purpose,
    code,
    expiresAt: Date.now() + 10 * 60 * 1000,
  };
  const filtered = readOtpRecords().filter(
    (r) => !(r.email === normalizedEmail && r.purpose === purpose)
  );
  writeOtpRecords([next, ...filtered]);
  return code;
}

export interface SignupInput {
  fullName: string;
  matricNumber: string;
  faculty: string;
  department: string;
  email: string;
  password: string;
}

export interface AuthActionResult<T = void> {
  ok: boolean;
  error?: string;
  data?: T;
}

export const authService = {
  async startSignup(
    input: SignupInput
  ): Promise<AuthActionResult<{ email: string; matricNumber: string; verificationCode: string }>> {
    const fullName = input.fullName.trim();
    const faculty = input.faculty.trim();
    const department = input.department.trim();
    const email = input.email.trim().toLowerCase();
    const matricCheck = validateMatricNumber(input.matricNumber);

    if (fullName.length < 2) {
      return { ok: false, error: 'Please enter your full name.' };
    }
    if (!matricCheck.valid) {
      return { ok: false, error: matricCheck.error };
    }
    if (faculty.length < 2 || department.length < 2) {
      return { ok: false, error: 'Select or enter both your faculty and department.' };
    }
    if (!validateEmailAddress(email)) {
      return { ok: false, error: 'Enter a valid email address.' };
    }
    if (input.password.length < 6) {
      return { ok: false, error: 'Password must be at least 6 characters.' };
    }

    const accounts = readAccounts();
    const existingVerifiedMatric = accounts.find(
      (a) => a.matricNumber === matricCheck.normalized && a.isEmailVerified
    );
    if (existingVerifiedMatric) {
      return {
        ok: false,
        error: 'An account with this matric number already exists. Sign in instead.',
      };
    }

    const existingVerifiedEmail = accounts.find(
      (a) => a.email === email && a.isEmailVerified
    );
    if (existingVerifiedEmail) {
      return {
        ok: false,
        error: 'This email is already registered. Sign in or reset your password.',
      };
    }

    const salt = generateSalt();
    const passwordHash = await hashPassword(input.password, salt);

    const pendingAccount: StudentAccount = {
      id: `stu-${Date.now()}`,
      fullName,
      matricNumber: matricCheck.normalized,
      faculty,
      department,
      email,
      passwordHash,
      passwordSalt: salt,
      isEmailVerified: false,
      createdAt: new Date().toISOString(),
    };

    const cleaned = accounts.filter(
      (a) =>
        !(
          !a.isEmailVerified &&
          (a.matricNumber === matricCheck.normalized || a.email === email)
        )
    );
    writeAccounts([pendingAccount, ...cleaned]);

    const verificationCode = issueOtp(email, 'signup');
    return {
      ok: true,
      data: {
        email,
        matricNumber: matricCheck.normalized,
        verificationCode,
      },
    };
  },

  resendCode(
    email: string,
    purpose: 'signup' | 'reset'
  ): AuthActionResult<{ verificationCode: string }> {
    const normalizedEmail = email.trim().toLowerCase();
    const accounts = readAccounts();
    const exists = accounts.some((a) => a.email === normalizedEmail);
    if (!exists) {
      return { ok: false, error: 'Account session expired. Please try again.' };
    }
    const verificationCode = issueOtp(normalizedEmail, purpose);
    return { ok: true, data: { verificationCode } };
  },

  verifySignupCode(
    email: string,
    rawCode: string
  ): AuthActionResult<{ account: StudentAccount }> {
    const normalizedEmail = email.trim().toLowerCase();
    const code = rawCode.replace(/\s+/g, '').trim();
    if (code.length !== 6) {
      return { ok: false, error: 'Enter the 6-digit code sent to your email.' };
    }

    const records = readOtpRecords();
    const record = records.find(
      (r) => r.email === normalizedEmail && r.purpose === 'signup'
    );
    if (!record || Date.now() > record.expiresAt) {
      return { ok: false, error: 'Verification code expired. Tap Resend code.' };
    }
    if (record.code !== code) {
      return { ok: false, error: 'Incorrect verification code. Check and try again.' };
    }

    const accounts = readAccounts();
    const target = accounts.find((a) => a.email === normalizedEmail);
    if (!target) {
      return { ok: false, error: 'Pending registration not found. Please sign up again.' };
    }

    const verifiedAccount: StudentAccount = { ...target, isEmailVerified: true };
    writeAccounts(
      accounts.map((a) => (a.email === normalizedEmail ? verifiedAccount : a))
    );
    writeOtpRecords(
      records.filter((r) => !(r.email === normalizedEmail && r.purpose === 'signup'))
    );
    this.saveActiveSession(verifiedAccount);

    return { ok: true, data: { account: verifiedAccount } };
  },

  async signinWithMatric(
    rawMatric: string,
    password: string
  ): Promise<AuthActionResult<{ account: StudentAccount }>> {
    const matricCheck = validateMatricNumber(rawMatric);
    if (!matricCheck.valid) {
      return { ok: false, error: matricCheck.error };
    }
    if (!password) {
      return { ok: false, error: 'Enter your password.' };
    }

    const accounts = readAccounts();
    const account = accounts.find(
      (a) => a.matricNumber === matricCheck.normalized && a.isEmailVerified
    );

    if (!account) {
      return {
        ok: false,
        error: 'No verified account found for this matric number. Create one first.',
      };
    }

    const candidateHash = await hashPassword(password, account.passwordSalt);
    if (candidateHash !== account.passwordHash) {
      return { ok: false, error: 'Incorrect matric number or password.' };
    }

    this.saveActiveSession(account);
    return { ok: true, data: { account } };
  },

  saveActiveSession(account: StudentAccount): void {
    try {
      window.localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({
          accountId: account.id,
          matricNumber: account.matricNumber,
        })
      );
      window.localStorage.setItem(ONBOARDING_KEY, 'true');
    } catch {
      // Ignore storage quota errors cleanly
    }
  },

  getActiveSession(): StudentAccount | null {
    try {
      const raw = window.localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as {
        accountId?: string;
        matricNumber?: string;
      } | null;
      if (!parsed?.accountId && !parsed?.matricNumber) return null;

      const accounts = readAccounts();
      const matched = accounts.find(
        (a) =>
          a.isEmailVerified &&
          ((parsed.accountId && a.id === parsed.accountId) ||
            (parsed.matricNumber && a.matricNumber === parsed.matricNumber))
      );
      return matched ?? null;
    } catch {
      return null;
    }
  },

  clearActiveSession(): void {
    try {
      window.localStorage.removeItem(SESSION_KEY);
    } catch {
      // Ignore storage errors cleanly
    }
  },

  hasCompletedOnboarding(): boolean {
    try {
      return window.localStorage.getItem(ONBOARDING_KEY) === 'true';
    } catch {
      return false;
    }
  },

  setOnboardingCompleted(completed: boolean): void {
    try {
      if (completed) {
        window.localStorage.setItem(ONBOARDING_KEY, 'true');
      } else {
        window.localStorage.removeItem(ONBOARDING_KEY);
      }
    } catch {
      // Ignore storage errors cleanly
    }
  },

  requestPasswordReset(
    rawMatricOrEmail: string
  ): AuthActionResult<{ email: string; matricNumber: string; verificationCode: string }> {
    const trimmed = rawMatricOrEmail.trim();
    if (!trimmed) {
      return { ok: false, error: 'Enter your matric number or registered email.' };
    }

    const accounts = readAccounts().filter((a) => a.isEmailVerified);
    const lower = trimmed.toLowerCase();
    const account = accounts.find(
      (a) => a.matricNumber === trimmed || a.email === lower
    );

    if (!account) {
      return {
        ok: false,
        error: 'No verified account matches that matric number or email.',
      };
    }

    const verificationCode = issueOtp(account.email, 'reset');
    return {
      ok: true,
      data: {
        email: account.email,
        matricNumber: account.matricNumber,
        verificationCode,
      },
    };
  },

  verifyResetCode(email: string, rawCode: string): AuthActionResult {
    const normalizedEmail = email.trim().toLowerCase();
    const code = rawCode.replace(/\s+/g, '').trim();
    if (code.length !== 6) {
      return { ok: false, error: 'Enter the 6-digit code sent to your email.' };
    }

    const records = readOtpRecords();
    const record = records.find(
      (r) => r.email === normalizedEmail && r.purpose === 'reset'
    );
    if (!record || Date.now() > record.expiresAt) {
      return { ok: false, error: 'Reset code expired. Tap Resend code.' };
    }
    if (record.code !== code) {
      return { ok: false, error: 'Incorrect reset code. Check and try again.' };
    }

    return { ok: true };
  },

  async completePasswordReset(
    email: string,
    newPassword: string,
    confirmPassword: string
  ): Promise<AuthActionResult<{ matricNumber: string; newPassword: string }>> {
    if (newPassword.length < 6) {
      return { ok: false, error: 'New password must be at least 6 characters.' };
    }
    if (newPassword !== confirmPassword) {
      return { ok: false, error: 'Passwords do not match.' };
    }

    const normalizedEmail = email.trim().toLowerCase();
    const accounts = readAccounts();
    const target = accounts.find(
      (a) => a.email === normalizedEmail && a.isEmailVerified
    );

    if (!target) {
      return { ok: false, error: 'Account could not be found.' };
    }

    const salt = generateSalt();
    const passwordHash = await hashPassword(newPassword, salt);

    writeAccounts(
      accounts.map((a) =>
        a.email === normalizedEmail
          ? { ...a, passwordHash, passwordSalt: salt }
          : a
      )
    );

    writeOtpRecords(
      readOtpRecords().filter(
        (r) => !(r.email === normalizedEmail && r.purpose === 'reset')
      )
    );

    return {
      ok: true,
      data: {
        matricNumber: target.matricNumber,
        newPassword,
      },
    };
  },
};
