import { hasPermission, isActiveAccount } from '../core/permissions';
import { sanitizeIdentifier, sanitizeSingleLine } from '../core/security';
import type {
  AccountStatus,
  AuthenticatedUser,
  AuthPortal,
  StudentAccount,
  StudentLevel,
  UserRole,
} from '../core/types';
import { archiveRepository } from './archiveRepository';
import {
  getGoogleOAuthConfigStatus,
  googleAuthService,
  type VerifiedGoogleStudentIdentity,
} from './auth/googleAuthService';
import {
  evaluatePasswordStrength,
  validatePasswordForRole,
} from './auth/passwordPolicy';
import { sessionService } from './auth/sessionService';
import { localStore } from './storage/localStore';

const ACCOUNTS_KEY = 'pqguide_student_accounts_v1';
const OTP_KEY = 'pqguide_student_otp_v1';
const ONBOARDING_KEY = 'pqguide_onboarding_done_v1';
const BOOTSTRAP_LOCK_KEY = 'pqguide_dev_bootstrap_lock_v1';

export { evaluatePasswordStrength, getGoogleOAuthConfigStatus, validatePasswordForRole };

export const IS_DEV_BOOTSTRAP_ENV: boolean = import.meta.env.DEV;

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
  purpose: 'signup' | 'reset' | 'admin_activate';
  code: string;
  expiresAt: number;
}

function normalizeStoredAccount(raw: StudentAccount): StudentAccount {
  const role: UserRole =
    raw.role === 'school_admin' || raw.role === 'super_admin' ? raw.role : 'student';
  const status: AccountStatus =
    raw.status === 'restricted' ||
    raw.status === 'suspended' ||
    raw.status === 'banned' ||
    raw.status === 'revoked'
      ? raw.status
      : 'active';
  return {
    ...raw,
    role,
    status,
    level: raw.level ?? (role === 'student' ? '100L' : undefined),
    adminVerified: raw.adminVerified ?? true,
    needsPasswordSetup: Boolean(raw.needsPasswordSetup),
    warningsCount: raw.warningsCount ?? 0,
    moderationNote: raw.moderationNote,
    assignedSchoolId:
      raw.assignedSchoolId ?? (role === 'student' ? 'sch-aaua' : undefined),
    assignedSchoolCode:
      raw.assignedSchoolCode ?? (role === 'student' ? 'AAUA' : undefined),
  };
}

function toAuthenticatedUser(account: StudentAccount): AuthenticatedUser {
  const { passwordHash: _h, passwordSalt: _s, ...publicUser } = account;
  return publicUser;
}

function readAccounts(): StudentAccount[] {
  const parsed = localStore.getJson<StudentAccount[]>(ACCOUNTS_KEY);
  if (!Array.isArray(parsed)) return [];
  return parsed.map(normalizeStoredAccount);
}

function writeAccounts(accounts: StudentAccount[]): void {
  localStore.setJson(ACCOUNTS_KEY, accounts);
}

function readOtpRecords(): PendingOtpRecord[] {
  const parsed = localStore.getJson<PendingOtpRecord[]>(OTP_KEY);
  return Array.isArray(parsed) ? parsed : [];
}

function writeOtpRecords(records: PendingOtpRecord[]): void {
  localStore.setJson(OTP_KEY, records);
}

function generateSalt(): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 14)}`;
}

function generateSixDigitCode(): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return String(100000 + (buf[0] % 900000));
  }
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function legacySha256Hash(password: string, salt: string): Promise<string> {
  const input = `${salt}:${password}`;
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoded = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }
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

async function hashPassword(password: string, salt: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.importKey === 'function') {
    try {
      const enc = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        enc.encode(password),
        'PBKDF2',
        false,
        ['deriveBits']
      );
      const bits = await crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          salt: enc.encode(salt),
          iterations: 50000,
          hash: 'SHA-256',
        },
        keyMaterial,
        256
      );
      const hex = Array.from(new Uint8Array(bits), (b) =>
        b.toString(16).padStart(2, '0')
      ).join('');
      return `pbkdf2$${hex}`;
    } catch {
      // Fallback if subtle PBKDF2 is unavailable in constrained runtime
    }
  }
  return legacySha256Hash(password, salt);
}

async function verifyPassword(password: string, salt: string, storedHash: string): Promise<boolean> {
  if (storedHash.startsWith('pbkdf2$')) {
    const candidate = await hashPassword(password, salt);
    return candidate === storedHash;
  }
  const candidateLegacy = await legacySha256Hash(password, salt);
  return candidateLegacy === storedHash;
}

function issueOtp(
  email: string,
  purpose: 'signup' | 'reset' | 'admin_activate'
): string {
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
  level?: StudentLevel;
  faculty: string;
  department: string;
  email: string;
  password: string;
  confirmPassword?: string;
}

export interface SuperAdminBootstrapInput {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
  confirmationPhrase: string;
  rememberMe?: boolean;
}

export interface CreateSchoolAdminInput {
  fullName: string;
  email: string;
  schoolId: string;
  password?: string;
  grantEmailAccessOnly?: boolean;
}

export interface AuthActionResult<T = void> {
  ok: boolean;
  error?: string;
  notConfigured?: boolean;
  data?: T;
}

export const authService = {
  // -------------------------------------------------------------------------
  // Dev-Only First Super Admin Bootstrap
  // -------------------------------------------------------------------------

  isDevBootstrapAvailable(): boolean {
    if (!IS_DEV_BOOTSTRAP_ENV) return false;
    if (localStore.getItem(BOOTSTRAP_LOCK_KEY) === '1') return false;
    const accounts = readAccounts();
    const hasSuperAdmin = accounts.some(
      (a) => a.role === 'super_admin' && a.isEmailVerified
    );
    return !hasSuperAdmin;
  },

  hasSuperAdminAccount(): boolean {
    return readAccounts().some((a) => a.role === 'super_admin' && a.isEmailVerified);
  },

  async bootstrapFirstSuperAdmin(
    input: SuperAdminBootstrapInput
  ): Promise<AuthActionResult<{ account: AuthenticatedUser }>> {
    if (!IS_DEV_BOOTSTRAP_ENV) {
      return {
        ok: false,
        error: 'Local development bootstrap is disabled outside development mode.',
      };
    }

    const currentSessionUser = this.getActiveSession();
    if (currentSessionUser) {
      return {
        ok: false,
        error: 'Signed-in accounts cannot initialize or replace a Super Admin.',
      };
    }

    if (!this.isDevBootstrapAvailable()) {
      return {
        ok: false,
        error: 'A Super Admin account has already been initialized for this environment.',
      };
    }

    const fullName = sanitizeSingleLine(input.fullName, 120);
    const email = sanitizeSingleLine(input.email, 160).toLowerCase();

    if (fullName.length < 2) {
      return { ok: false, error: 'Enter the Super Admin full name.' };
    }
    if (!validateEmailAddress(email)) {
      return { ok: false, error: 'Enter a valid Super Admin email address.' };
    }
    const pwError = validatePasswordForRole(input.password, 'super_admin');
    if (pwError) {
      return { ok: false, error: pwError };
    }
    if (input.password !== input.confirmPassword) {
      return { ok: false, error: 'Passwords do not match.' };
    }
    if (input.confirmationPhrase.trim().toUpperCase() !== 'INITIALIZE SUPER ADMIN') {
      return {
        ok: false,
        error: 'Type INITIALIZE SUPER ADMIN in the confirmation field.',
      };
    }

    const existing = readAccounts();
    if (existing.some((a) => a.email === email && a.isEmailVerified)) {
      return {
        ok: false,
        error: 'This email address is already registered to another account.',
      };
    }

    const salt = generateSalt();
    const passwordHash = await hashPassword(input.password, salt);
    const now = new Date().toISOString();

    const superAdminRecord: StudentAccount = {
      id: `super-${Date.now()}`,
      fullName,
      matricNumber: 'SUPER-ADMIN',
      faculty: 'Platform Administration',
      department: 'Central Security & Operations',
      email,
      role: 'super_admin',
      status: 'active',
      adminVerified: true,
      needsPasswordSetup: false,
      passwordHash,
      passwordSalt: salt,
      isEmailVerified: true,
      authProvider: 'local',
      createdAt: now,
      createdBy: 'local-dev-bootstrap',
    };

    writeAccounts([superAdminRecord, ...existing]);
    localStore.setItem(BOOTSTRAP_LOCK_KEY, '1');

    const publicUser = toAuthenticatedUser(superAdminRecord);
    archiveRepository.syncManagedAccount({
      id: publicUser.id,
      fullName: publicUser.fullName,
      email: publicUser.email,
      role: 'super_admin',
      schoolCode: 'ALL',
      status: 'active',
      adminVerified: true,
      sessionState: 'logged_in',
      lastLoginAt: now,
      lastActiveAt: now,
      createdAt: now,
      createdBy: 'local-dev-bootstrap',
    });
    archiveRepository.appendAuditEvent(
      publicUser,
      'super_admin_bootstrapped',
      'account',
      publicUser.id,
      `Initialized first local-dev Super Admin account (${publicUser.email})`
    );
    archiveRepository.recordUserActivity({
      userId: publicUser.id,
      userName: publicUser.fullName,
      userEmail: publicUser.email,
      userRole: 'super_admin',
      type: 'login',
      detail: 'Initialized and signed into Super Admin console',
    });

    this.saveActiveSession(publicUser, input.rememberMe ?? true);
    return { ok: true, data: { account: publicUser } };
  },

  resetLocalDevData(
    confirmationPhrase: string,
    actor?: AuthenticatedUser | null
  ): AuthActionResult {
    if (!IS_DEV_BOOTSTRAP_ENV) {
      return { ok: false, error: 'Development reset is only permitted in local development mode.' };
    }
    const active = actor ?? this.getActiveSession();
    if (active && active.role !== 'super_admin') {
      return { ok: false, error: 'Ordinary accounts cannot reset local development data.' };
    }
    if (confirmationPhrase.trim().toUpperCase() !== 'RESET DEV DATA') {
      return { ok: false, error: 'Type RESET DEV DATA exactly to confirm local reset.' };
    }

    localStore.removeItem(ACCOUNTS_KEY);
    localStore.removeItem(OTP_KEY);
    localStore.removeItem(BOOTSTRAP_LOCK_KEY);
    sessionService.clearSession();
    archiveRepository.resetAllForDev();
    return { ok: true };
  },

  // -------------------------------------------------------------------------
  // Public Student Registration (Strictly Role-Locked to 'student')
  // -------------------------------------------------------------------------

  isDuplicateMatricOrEmail(params: {
    matricNumber?: string;
    email?: string;
  }): { duplicateMatric: boolean; duplicateEmail: boolean; isAdminEmail: boolean } {
    const cleanMatric = params.matricNumber ? params.matricNumber.replace(/\s+/g, '').trim() : '';
    const cleanEmail = params.email ? params.email.trim().toLowerCase() : '';
    const accounts = readAccounts();
    const repoAccounts = archiveRepository.getSnapshot().accounts;

    const duplicateMatric = Boolean(
      cleanMatric &&
        (accounts.some((a) => a.matricNumber === cleanMatric && a.isEmailVerified) ||
          repoAccounts.some((a) => (a.matricNumber ?? '') === cleanMatric))
    );

    const matchedLocalEmail = cleanEmail
      ? accounts.find((a) => a.email === cleanEmail && a.isEmailVerified)
      : undefined;
    const matchedRepoEmail = cleanEmail
      ? repoAccounts.find((a) => a.email.toLowerCase() === cleanEmail)
      : undefined;

    const isAdminEmail = Boolean(
      (matchedLocalEmail && matchedLocalEmail.role !== 'student') ||
        (matchedRepoEmail && matchedRepoEmail.role !== 'student')
    );
    const duplicateEmail = Boolean(matchedLocalEmail || matchedRepoEmail);

    return { duplicateMatric, duplicateEmail, isAdminEmail };
  },

  async startSignup(
    input: SignupInput
  ): Promise<AuthActionResult<{ email: string; matricNumber: string; verificationCode?: string }>> {
    const fullName = sanitizeSingleLine(input.fullName, 120);
    const faculty = sanitizeSingleLine(input.faculty, 120);
    const department = sanitizeSingleLine(input.department, 120);
    const email = sanitizeSingleLine(input.email, 160).toLowerCase();
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
    const pwError = validatePasswordForRole(input.password, 'student');
    if (pwError) {
      return { ok: false, error: pwError };
    }
    if (input.confirmPassword !== undefined && input.password !== input.confirmPassword) {
      return { ok: false, error: 'Passwords do not match.' };
    }

    const dup = this.isDuplicateMatricOrEmail({
      matricNumber: matricCheck.normalized,
      email,
    });
    if (dup.duplicateMatric) {
      return {
        ok: false,
        error: 'An account with this matric number already exists. Sign in instead.',
      };
    }
    if (dup.isAdminEmail) {
      return {
        ok: false,
        error:
          'This email belongs to an administrator account and cannot be registered on the Student portal.',
      };
    }
    if (dup.duplicateEmail) {
      return {
        ok: false,
        error: 'This email is already registered. Sign in or reset your password.',
      };
    }

    const accounts = readAccounts();
    const salt = generateSalt();
    const passwordHash = await hashPassword(input.password, salt);

    const level: StudentLevel =
      input.level && ['100L', '200L', '300L', '400L', '500L'].includes(input.level)
        ? input.level
        : '100L';

    const pendingAccount: StudentAccount = {
      id: `stu-${Date.now()}`,
      fullName,
      matricNumber: matricCheck.normalized,
      level,
      faculty,
      department,
      email,
      role: 'student',
      status: 'active',
      adminVerified: true,
      needsPasswordSetup: false,
      assignedSchoolId: 'sch-aaua',
      assignedSchoolCode: 'AAUA',
      passwordHash,
      passwordSalt: salt,
      isEmailVerified: false,
      authProvider: 'local',
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
        verificationCode: IS_DEV_BOOTSTRAP_ENV ? verificationCode : undefined,
      },
    };
  },

  resendCode(
    email: string,
    purpose: 'signup' | 'reset' | 'admin_activate'
  ): AuthActionResult<{ verificationCode?: string }> {
    const normalizedEmail = email.trim().toLowerCase();
    const accounts = readAccounts();
    const matched = accounts.find((a) => a.email === normalizedEmail);
    if (!matched) {
      return { ok: false, error: 'Account session expired. Please try again.' };
    }
    if (purpose === 'admin_activate' && matched.role !== 'school_admin') {
      return { ok: false, error: 'This email is not approved for School Admin activation.' };
    }
    const verificationCode = issueOtp(normalizedEmail, purpose);
    return {
      ok: true,
      data: {
        verificationCode: IS_DEV_BOOTSTRAP_ENV ? verificationCode : undefined,
      },
    };
  },

  verifySignupCode(
    email: string,
    rawCode: string,
    rememberMe = true
  ): AuthActionResult<{ account: AuthenticatedUser }> {
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

    const now = new Date().toISOString();
    const verifiedAccount: StudentAccount = {
      ...target,
      role: 'student',
      status: 'active',
      adminVerified: true,
      level: target.level ?? '100L',
      isEmailVerified: true,
    };
    writeAccounts(
      accounts.map((a) => (a.email === normalizedEmail ? verifiedAccount : a))
    );
    writeOtpRecords(
      records.filter((r) => !(r.email === normalizedEmail && r.purpose === 'signup'))
    );

    const publicUser = toAuthenticatedUser(verifiedAccount);
    archiveRepository.syncManagedAccount({
      id: publicUser.id,
      fullName: publicUser.fullName,
      email: publicUser.email,
      matricNumber: publicUser.matricNumber,
      level: publicUser.level ?? '100L',
      faculty: publicUser.faculty,
      department: publicUser.department,
      subscriptionTier: 'free',
      role: 'student',
      schoolId: 'sch-aaua',
      schoolCode: 'AAUA',
      status: 'active',
      adminVerified: true,
      sessionState: 'logged_in',
      lastLoginAt: now,
      lastActiveAt: now,
      createdAt: publicUser.createdAt,
    });
    archiveRepository.recordUserActivity({
      userId: publicUser.id,
      userName: publicUser.fullName,
      userEmail: publicUser.email,
      userRole: 'student',
      matricNumber: publicUser.matricNumber,
      level: publicUser.level,
      type: 'signup',
      detail: `Completed student signup (${publicUser.matricNumber} · ${publicUser.level ?? '100L'} · ${publicUser.department})`,
    });

    this.saveActiveSession(publicUser, rememberMe);
    return { ok: true, data: { account: publicUser } };
  },

  // -------------------------------------------------------------------------
  // Student Google OAuth Integration (Strictly Student Portal Only)
  // -------------------------------------------------------------------------

  async authenticateStudentWithGoogle(
    rememberMe = true
  ): Promise<
    AuthActionResult<{
      account?: AuthenticatedUser;
      needsProfileCompletion?: boolean;
      googleIdentity?: VerifiedGoogleStudentIdentity;
    }>
  > {
    const gisResult = await googleAuthService.authenticateStudent();
    if (!gisResult.ok || !gisResult.identity) {
      return {
        ok: false,
        notConfigured: gisResult.notConfigured,
        error: gisResult.error ?? 'Google authentication could not be completed.',
      };
    }

    const identity = gisResult.identity;
    const email = identity.email.trim().toLowerCase();
    const accounts = readAccounts();
    const repoAccounts = archiveRepository.getSnapshot().accounts;

    // Never allow Google Auth to grant or log into School Admin or Super Admin accounts
    const adminConflict =
      accounts.find((a) => a.email === email && a.role !== 'student') ||
      repoAccounts.find((a) => a.email.toLowerCase() === email && a.role !== 'student');
    if (adminConflict) {
      return {
        ok: false,
        error:
          'This Google email is associated with an administrator account. Google Sign-In is disabled for administrator access; use your designated admin login portal.',
      };
    }

    const existingStudent = accounts.find(
      (a) => a.email === email && a.role === 'student' && a.isEmailVerified
    );
    if (!existingStudent) {
      return {
        ok: true,
        data: {
          needsProfileCompletion: true,
          googleIdentity: identity,
        },
      };
    }

    const repoAcc = repoAccounts.find(
      (a) => a.id === existingStudent.id || a.email.toLowerCase() === email
    );
    const resolvedStatus: AccountStatus = repoAcc?.status ?? existingStudent.status;

    if (resolvedStatus === 'banned') {
      return {
        ok: false,
        error: 'This account has been banned. Contact a Super Administrator.',
      };
    }
    if (resolvedStatus === 'suspended') {
      return {
        ok: false,
        error: 'This account is suspended. Contact a Super Administrator.',
      };
    }
    if (resolvedStatus === 'revoked') {
      return {
        ok: false,
        error: 'Access for this account has been revoked.',
      };
    }
    if (existingStudent.adminVerified === false || repoAcc?.adminVerified === false) {
      return {
        ok: false,
        error: 'Login is pending Super Admin verification.',
      };
    }

    const now = new Date().toISOString();
    const updatedRecord: StudentAccount = {
      ...existingStudent,
      authProvider: 'google',
      updatedAt: now,
    };
    writeAccounts(accounts.map((a) => (a.id === updatedRecord.id ? updatedRecord : a)));

    const publicUser: AuthenticatedUser = {
      ...toAuthenticatedUser(updatedRecord),
      status: resolvedStatus,
      warningsCount: repoAcc?.warningsCount ?? updatedRecord.warningsCount ?? 0,
      moderationNote: repoAcc?.moderationNote ?? updatedRecord.moderationNote,
    };

    archiveRepository.syncManagedAccount({
      id: publicUser.id,
      fullName: publicUser.fullName,
      email: publicUser.email,
      matricNumber: publicUser.matricNumber,
      level: publicUser.level,
      faculty: publicUser.faculty,
      department: publicUser.department,
      role: 'student',
      schoolId: publicUser.assignedSchoolId,
      schoolCode: publicUser.assignedSchoolCode ?? 'AAUA',
      status: publicUser.status,
      adminVerified: publicUser.adminVerified ?? true,
      needsPasswordSetup: false,
      warningsCount: publicUser.warningsCount,
      moderationNote: publicUser.moderationNote,
      sessionState: 'logged_in',
      lastLoginAt: now,
      lastActiveAt: now,
      createdAt: publicUser.createdAt,
      createdBy: publicUser.createdBy,
    });
    archiveRepository.setAccountSessionState(publicUser.id, 'logged_in');
    archiveRepository.recordUserActivity({
      userId: publicUser.id,
      userName: publicUser.fullName,
      userEmail: publicUser.email,
      userRole: 'student',
      matricNumber: publicUser.matricNumber,
      level: publicUser.level,
      type: 'login',
      detail: 'Signed in on student portal via Google',
    });

    this.saveActiveSession(publicUser, rememberMe);
    return { ok: true, data: { account: publicUser } };
  },

  // -------------------------------------------------------------------------
  // Portal-Isolated Sign-In & School Admin Email Activation
  // -------------------------------------------------------------------------

  async signinWithPortal(
    portal: AuthPortal,
    rawIdentifier: string,
    password: string,
    rememberMe = true
  ): Promise<AuthActionResult<{ account: AuthenticatedUser }>> {
    const trimmed = rawIdentifier.trim();
    if (!trimmed) {
      return {
        ok: false,
        error:
          portal === 'student'
            ? 'Enter your matric number or email address.'
            : 'Enter your approved administrator email address.',
      };
    }
    if (!password) {
      return { ok: false, error: 'Enter your password.' };
    }

    const accounts = readAccounts();
    const isEmailInput = trimmed.includes('@');
    let account: StudentAccount | undefined;

    if (portal !== 'student') {
      const normalizedEmail = trimmed.toLowerCase();
      if (!validateEmailAddress(normalizedEmail)) {
        return { ok: false, error: 'Enter a valid administrator email address.' };
      }
      const requiredRole: UserRole = portal === 'super_admin' ? 'super_admin' : 'school_admin';
      account = accounts.find(
        (a) => a.email === normalizedEmail && a.role === requiredRole && a.isEmailVerified
      );
      if (!account) {
        return {
          ok: false,
          error:
            portal === 'super_admin'
              ? 'No verified Super Admin account matches this email address.'
              : 'This email does not have approved School Admin access.',
        };
      }
      if (account.role === 'school_admin' && account.needsPasswordSetup) {
        return {
          ok: false,
          error:
            'Your email access is approved for first-time setup. Tap "Activate approved email" below to verify and create your password.',
        };
      }
    } else if (isEmailInput) {
      const normalizedEmail = trimmed.toLowerCase();
      if (!validateEmailAddress(normalizedEmail)) {
        return { ok: false, error: 'Enter a valid email address.' };
      }
      account = accounts.find(
        (a) => a.email === normalizedEmail && a.role === 'student' && a.isEmailVerified
      );
      if (!account) {
        return {
          ok: false,
          error: 'No verified student account matches this email address.',
        };
      }
    } else {
      const matricCheck = validateMatricNumber(trimmed);
      if (!matricCheck.valid) {
        return { ok: false, error: matricCheck.error };
      }
      account = accounts.find(
        (a) =>
          a.matricNumber === matricCheck.normalized &&
          a.role === 'student' &&
          a.isEmailVerified
      );
      if (!account) {
        return {
          ok: false,
          error: 'No verified account found for this matric number. Create one first.',
        };
      }
    }

    const repoAcc = archiveRepository
      .getSnapshot()
      .accounts.find((a) => a.id === account.id || a.email.toLowerCase() === account.email);
    const resolvedStatus: AccountStatus = repoAcc?.status ?? account.status;

    if (resolvedStatus === 'banned') {
      return {
        ok: false,
        error: 'This account has been banned. Contact a Super Administrator.',
      };
    }
    if (resolvedStatus === 'suspended') {
      return {
        ok: false,
        error: 'This account is suspended. Contact a Super Administrator.',
      };
    }
    if (resolvedStatus === 'revoked') {
      return {
        ok: false,
        error: 'Access for this account has been revoked.',
      };
    }
    if (account.adminVerified === false || repoAcc?.adminVerified === false) {
      return {
        ok: false,
        error: 'Login is pending Super Admin verification.',
      };
    }

    const passwordValid = await verifyPassword(
      password,
      account.passwordSalt,
      account.passwordHash
    );
    if (!passwordValid) {
      return { ok: false, error: 'Incorrect credentials. Check and try again.' };
    }

    const now = new Date().toISOString();
    const publicUser: AuthenticatedUser = {
      ...toAuthenticatedUser(account),
      status: resolvedStatus,
      warningsCount: repoAcc?.warningsCount ?? account.warningsCount ?? 0,
      moderationNote: repoAcc?.moderationNote ?? account.moderationNote,
    };

    archiveRepository.syncManagedAccount({
      id: publicUser.id,
      fullName: publicUser.fullName,
      email: publicUser.email,
      matricNumber: publicUser.matricNumber,
      level: publicUser.level,
      faculty: publicUser.faculty,
      department: publicUser.department,
      role: publicUser.role,
      schoolId: publicUser.assignedSchoolId,
      schoolCode: publicUser.assignedSchoolCode ?? (publicUser.role === 'super_admin' ? 'ALL' : 'AAUA'),
      status: publicUser.status,
      adminVerified: publicUser.adminVerified ?? true,
      needsPasswordSetup: false,
      warningsCount: publicUser.warningsCount,
      moderationNote: publicUser.moderationNote,
      sessionState: 'logged_in',
      lastLoginAt: now,
      lastActiveAt: now,
      createdAt: publicUser.createdAt,
      createdBy: publicUser.createdBy,
    });
    archiveRepository.setAccountSessionState(publicUser.id, 'logged_in');
    archiveRepository.recordUserActivity({
      userId: publicUser.id,
      userName: publicUser.fullName,
      userEmail: publicUser.email,
      userRole: publicUser.role,
      matricNumber: publicUser.matricNumber,
      level: publicUser.level,
      type: 'login',
      detail: `Signed in on ${portal.replace('_', ' ')} portal`,
    });

    this.saveActiveSession(publicUser, rememberMe);
    return { ok: true, data: { account: publicUser } };
  },

  startSchoolAdminActivation(
    rawEmail: string
  ): AuthActionResult<{ email: string; fullName: string; schoolCode: string; verificationCode?: string }> {
    const email = sanitizeSingleLine(rawEmail, 160).toLowerCase();
    if (!validateEmailAddress(email)) {
      return { ok: false, error: 'Enter a valid email address.' };
    }

    const accounts = readAccounts();
    const target = accounts.find(
      (a) => a.email === email && a.role === 'school_admin'
    );
    if (!target) {
      return {
        ok: false,
        error: 'This email has not been granted School Admin access by a Super Admin.',
      };
    }
    if (target.status !== 'active') {
      return {
        ok: false,
        error: 'This School Admin account is suspended or revoked.',
      };
    }
    if (target.adminVerified === false) {
      return {
        ok: false,
        error: 'Your School Admin access is awaiting Super Admin verification.',
      };
    }

    const verificationCode = issueOtp(email, 'admin_activate');
    return {
      ok: true,
      data: {
        email,
        fullName: target.fullName,
        schoolCode: target.assignedSchoolCode ?? 'AAUA',
        verificationCode: IS_DEV_BOOTSTRAP_ENV ? verificationCode : undefined,
      },
    };
  },

  async completeSchoolAdminActivation(
    rawEmail: string,
    rawCode: string,
    newPassword: string,
    confirmPassword: string,
    rememberMe = true
  ): Promise<AuthActionResult<{ account: AuthenticatedUser }>> {
    const normalizedEmail = sanitizeSingleLine(rawEmail, 160).toLowerCase();
    const code = rawCode.replace(/\s+/g, '').trim();
    if (code.length !== 6) {
      return { ok: false, error: 'Enter the 6-digit verification code.' };
    }

    const records = readOtpRecords();
    const record = records.find(
      (r) => r.email === normalizedEmail && r.purpose === 'admin_activate'
    );
    if (!record || Date.now() > record.expiresAt) {
      return { ok: false, error: 'Activation code expired. Request a new code.' };
    }
    if (record.code !== code) {
      return { ok: false, error: 'Incorrect activation code. Check and try again.' };
    }

    const pwError = validatePasswordForRole(newPassword, 'school_admin');
    if (pwError) {
      return { ok: false, error: pwError };
    }
    if (newPassword !== confirmPassword) {
      return { ok: false, error: 'Passwords do not match.' };
    }

    const accounts = readAccounts();
    const target = accounts.find(
      (a) => a.email === normalizedEmail && a.role === 'school_admin'
    );
    if (!target || target.status !== 'active') {
      return { ok: false, error: 'School Admin account is unavailable.' };
    }

    const salt = generateSalt();
    const passwordHash = await hashPassword(newPassword, salt);
    const now = new Date().toISOString();

    const updated: StudentAccount = {
      ...target,
      passwordHash,
      passwordSalt: salt,
      isEmailVerified: true,
      needsPasswordSetup: false,
      adminVerified: target.adminVerified ?? true,
      updatedAt: now,
    };

    writeAccounts(accounts.map((a) => (a.id === target.id ? updated : a)));
    writeOtpRecords(
      records.filter((r) => !(r.email === normalizedEmail && r.purpose === 'admin_activate'))
    );

    const publicUser = toAuthenticatedUser(updated);
    archiveRepository.syncManagedAccount({
      id: publicUser.id,
      fullName: publicUser.fullName,
      email: publicUser.email,
      role: 'school_admin',
      schoolId: publicUser.assignedSchoolId,
      schoolCode: publicUser.assignedSchoolCode ?? 'AAUA',
      status: 'active',
      adminVerified: true,
      needsPasswordSetup: false,
      sessionState: 'logged_in',
      lastLoginAt: now,
      lastActiveAt: now,
      createdAt: publicUser.createdAt,
      createdBy: publicUser.createdBy,
    });
    archiveRepository.appendAuditEvent(
      publicUser,
      'admin_updated',
      'account',
      publicUser.id,
      `School Admin ${publicUser.fullName} activated approved email access (${publicUser.email})`,
      publicUser.assignedSchoolId
    );
    archiveRepository.recordUserActivity({
      userId: publicUser.id,
      userName: publicUser.fullName,
      userEmail: publicUser.email,
      userRole: 'school_admin',
      type: 'login',
      detail: 'Activated School Admin email access and signed in',
    });

    this.saveActiveSession(publicUser, rememberMe);
    return { ok: true, data: { account: publicUser } };
  },

  async signinWithIdentifier(
    rawIdentifier: string,
    password: string,
    rememberMe = true
  ): Promise<AuthActionResult<{ account: AuthenticatedUser }>> {
    return this.signinWithPortal('student', rawIdentifier, password, rememberMe);
  },

  async signinWithMatric(
    rawMatric: string,
    password: string,
    rememberMe = true
  ): Promise<AuthActionResult<{ account: AuthenticatedUser }>> {
    return this.signinWithPortal('student', rawMatric, password, rememberMe);
  },

  saveActiveSession(account: AuthenticatedUser, rememberMe = true): void {
    sessionService.createSession(account.id, rememberMe);
    localStore.setItem(ONBOARDING_KEY, 'true');
  },

  getSessionRemainingMs(): number | null {
    return sessionService.getSessionRemainingMs();
  },

  consumeExpiredSessionNotice(): boolean {
    return sessionService.consumeExpiredNotice();
  },

  getActiveSession(): AuthenticatedUser | null {
    const session = sessionService.readSession();
    if (!session) return null;

    const accounts = readAccounts();
    const matched = accounts.find(
      (a) => a.id === session.userId && a.isEmailVerified
    );

    const isPermittedStatus = (s: AccountStatus) => s === 'active' || s === 'restricted';

    if (!matched || !isPermittedStatus(matched.status) || matched.adminVerified === false) {
      sessionService.clearSession('revoked');
      return null;
    }

    // Re-check repository account status in case account was suspended/banned/revoked/unverified
    const repoAcc = archiveRepository
      .getSnapshot()
      .accounts.find((a) => a.id === matched.id || a.email === matched.email);
    if (repoAcc && (!isPermittedStatus(repoAcc.status) || repoAcc.adminVerified === false)) {
      sessionService.clearSession('revoked');
      return null;
    }

    const baseUser = toAuthenticatedUser(matched);
    return {
      ...baseUser,
      status: repoAcc?.status ?? baseUser.status,
      warningsCount: repoAcc?.warningsCount ?? baseUser.warningsCount ?? 0,
      moderationNote: repoAcc?.moderationNote ?? baseUser.moderationNote,
    };
  },

  clearActiveSession(
    actor?: AuthenticatedUser | null,
    reason: 'manual' | 'expired' | 'revoked' = 'manual'
  ): void {
    const active = actor ?? this.getActiveSession();
    if (active) {
      archiveRepository.setAccountSessionState(active.id, 'logged_out');
      archiveRepository.recordUserActivity({
        userId: active.id,
        userName: active.fullName,
        userEmail: active.email,
        userRole: active.role,
        matricNumber: active.matricNumber,
        level: active.level,
        type: 'logout',
        detail:
          reason === 'expired'
            ? 'Session expired automatically after 12 hours'
            : 'Signed out of account',
      });
    }
    sessionService.clearSession(reason);
  },

  hasCompletedOnboarding(): boolean {
    return localStore.getItem(ONBOARDING_KEY) === 'true';
  },

  setOnboardingCompleted(completed: boolean): void {
    if (completed) {
      localStore.setItem(ONBOARDING_KEY, 'true');
    } else {
      localStore.removeItem(ONBOARDING_KEY);
    }
  },

  // -------------------------------------------------------------------------
  // Super Admin User & School Admin Management
  // -------------------------------------------------------------------------

  async createSchoolAdminAccount(
    actor: AuthenticatedUser | null | undefined,
    input: CreateSchoolAdminInput
  ): Promise<AuthActionResult<{ account: AuthenticatedUser }>> {
    if (!isActiveAccount(actor) || !hasPermission(actor, 'admins:manage')) {
      return {
        ok: false,
        error: 'Only active Super Administrators can create School Admin accounts.',
      };
    }

    const fullName = sanitizeSingleLine(input.fullName, 120);
    const email = sanitizeSingleLine(input.email, 160).toLowerCase();
    const school = archiveRepository
      .getSnapshot()
      .schools.find((s) => s.id === input.schoolId);

    if (fullName.length < 2) {
      return { ok: false, error: 'Enter the School Admin full name.' };
    }
    if (!validateEmailAddress(email)) {
      return { ok: false, error: 'Enter a valid School Admin email address.' };
    }
    if (!school) {
      return { ok: false, error: 'Select one valid university to assign this administrator.' };
    }

    const emailInviteMode = Boolean(input.grantEmailAccessOnly || !input.password?.trim());
    if (!emailInviteMode && (input.password ?? '').length < 8) {
      return {
        ok: false,
        error: 'Initial School Admin password must be at least 8 characters.',
      };
    }

    const accounts = readAccounts();
    const repoAccounts = archiveRepository.getSnapshot().accounts;
    if (
      accounts.some((a) => a.email === email && a.isEmailVerified) ||
      repoAccounts.some((a) => a.email.toLowerCase() === email)
    ) {
      return { ok: false, error: 'An account with this email already exists.' };
    }

    const salt = generateSalt();
    const secretSource = emailInviteMode ? generateSalt() + generateSalt() : (input.password ?? '');
    const passwordHash = await hashPassword(secretSource, salt);
    const now = new Date().toISOString();

    const adminRecord: StudentAccount = {
      id: `sadm-${Date.now()}`,
      fullName,
      matricNumber: `ADMIN-${school.code}`,
      faculty: 'School Administration',
      department: `${school.shortName} Examination Desk`,
      email,
      role: 'school_admin',
      status: 'active',
      adminVerified: true,
      needsPasswordSetup: emailInviteMode,
      assignedSchoolId: school.id,
      assignedSchoolCode: school.code,
      passwordHash,
      passwordSalt: salt,
      isEmailVerified: true,
      createdAt: now,
      createdBy: actor.email,
    };

    writeAccounts([adminRecord, ...accounts]);
    const publicUser = toAuthenticatedUser(adminRecord);

    archiveRepository.syncManagedAccount({
      id: publicUser.id,
      fullName: publicUser.fullName,
      email: publicUser.email,
      role: 'school_admin',
      schoolId: school.id,
      schoolCode: school.code,
      status: 'active',
      adminVerified: true,
      needsPasswordSetup: emailInviteMode,
      sessionState: 'logged_out',
      lastActiveAt: now,
      createdAt: now,
      createdBy: actor.email,
    });

    archiveRepository.appendAuditEvent(
      actor,
      emailInviteMode ? 'admin_invited' : 'admin_created',
      'account',
      publicUser.id,
      emailInviteMode
        ? `Granted School Admin email access to ${publicUser.fullName} (${publicUser.email}) for ${school.code}`
        : `Created School Admin ${publicUser.fullName} (${publicUser.email}) assigned to ${school.code}`,
      school.id
    );

    return { ok: true, data: { account: publicUser } };
  },

  setAccountVerification(
    actor: AuthenticatedUser | null | undefined,
    accountId: string,
    verified: boolean
  ): AuthActionResult {
    if (!isActiveAccount(actor) || !hasPermission(actor, 'accounts:manage')) {
      return { ok: false, error: 'Only Super Administrators can verify accounts.' };
    }

    const dirAccounts = readAccounts();
    const targetDir = dirAccounts.find((a) => a.id === accountId);
    if (targetDir?.role === 'super_admin') {
      return { ok: false, error: 'Super Admin verification is protected.' };
    }

    if (targetDir) {
      writeAccounts(
        dirAccounts.map((a) =>
          a.id === accountId
            ? { ...a, adminVerified: verified, updatedAt: new Date().toISOString() }
            : a
        )
      );
    }

    try {
      archiveRepository.setAccountAdminVerified(actor, accountId, verified);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to update verification.',
      };
    }
  },

  updateSchoolAdminDetails(
    actor: AuthenticatedUser | null | undefined,
    accountId: string,
    patch: { fullName?: string; email?: string; schoolId?: string }
  ): AuthActionResult {
    if (!isActiveAccount(actor) || !hasPermission(actor, 'admins:manage')) {
      return { ok: false, error: 'Only Super Administrators can edit administrator accounts.' };
    }

    const repoAcc = archiveRepository
      .getSnapshot()
      .accounts.find((a) => a.id === accountId);
    if (!repoAcc || repoAcc.role === 'super_admin') {
      return { ok: false, error: 'Target School Admin record not found or protected.' };
    }

    const nextName =
      patch.fullName !== undefined
        ? sanitizeSingleLine(patch.fullName, 120)
        : repoAcc.fullName;
    const nextEmail =
      patch.email !== undefined
        ? sanitizeSingleLine(patch.email, 160).toLowerCase()
        : repoAcc.email.toLowerCase();

    if (nextName.length < 2) {
      return { ok: false, error: 'Administrator name cannot be empty.' };
    }
    if (!validateEmailAddress(nextEmail)) {
      return { ok: false, error: 'Enter a valid email address.' };
    }

    let nextSchoolId = repoAcc.schoolId;
    let nextSchoolCode = repoAcc.schoolCode;
    const schoolChanged = Boolean(patch.schoolId && patch.schoolId !== repoAcc.schoolId);

    if (patch.schoolId) {
      const targetSchool = archiveRepository
        .getSnapshot()
        .schools.find((s) => s.id === patch.schoolId);
      if (!targetSchool) {
        return { ok: false, error: 'Selected university does not exist.' };
      }
      nextSchoolId = targetSchool.id;
      nextSchoolCode = targetSchool.code;
    }

    const accounts = readAccounts();
    if (
      accounts.some((a) => a.email === nextEmail && a.id !== accountId && a.isEmailVerified)
    ) {
      return { ok: false, error: 'Another account already uses this email.' };
    }

    writeAccounts(
      accounts.map((a) =>
        a.id === accountId
          ? {
              ...a,
              fullName: nextName,
              email: nextEmail,
              assignedSchoolId: nextSchoolId ?? a.assignedSchoolId,
              assignedSchoolCode: nextSchoolCode ?? a.assignedSchoolCode,
              updatedAt: new Date().toISOString(),
            }
          : a
      )
    );

    archiveRepository.updateManagedAccountSchoolAndRole(
      actor,
      accountId,
      {
        fullName: nextName,
        email: nextEmail,
        schoolId: nextSchoolId,
        schoolCode: nextSchoolCode,
      },
      schoolChanged ? 'admin_university_changed' : 'admin_updated',
      schoolChanged
        ? `Reassigned ${nextName} to university ${nextSchoolCode}`
        : `Updated administrator details for ${nextName} (${nextEmail})`
    );

    return { ok: true };
  },

  setAccountStatus(
    actor: AuthenticatedUser | null | undefined,
    accountId: string,
    nextStatus: AccountStatus
  ): AuthActionResult {
    if (!isActiveAccount(actor) || !hasPermission(actor, 'accounts:manage')) {
      return { ok: false, error: 'Only Super Administrators can suspend or reactivate accounts.' };
    }

    if (actor.id === accountId) {
      return { ok: false, error: 'You cannot suspend or revoke your own Super Admin account.' };
    }

    const repoAcc = archiveRepository
      .getSnapshot()
      .accounts.find((a) => a.id === accountId);
    const dirAccounts = readAccounts();
    const dirAcc = dirAccounts.find((a) => a.id === accountId);
    const target = repoAcc ?? (dirAcc ? { ...dirAcc, schoolCode: dirAcc.assignedSchoolCode ?? 'AAUA' } : null);

    if (!target) {
      return { ok: false, error: 'Account not found.' };
    }
    if (target.role === 'super_admin') {
      return { ok: false, error: 'Super Admin accounts cannot be suspended from this control.' };
    }

    const finalRole: UserRole =
      nextStatus === 'revoked' && target.role === 'school_admin'
        ? 'student'
        : target.role;

    writeAccounts(
      dirAccounts.map((a) =>
        a.id === accountId
          ? {
              ...a,
              status: nextStatus,
              role: finalRole,
              updatedAt: new Date().toISOString(),
            }
          : a
      )
    );

    const action =
      nextStatus === 'revoked'
        ? 'admin_revoked'
        : nextStatus === 'suspended'
        ? target.role === 'school_admin'
          ? 'admin_suspended'
          : 'account_suspended'
        : target.role === 'school_admin'
        ? 'admin_reactivated'
        : 'account_reactivated';

    const verb =
      nextStatus === 'revoked'
        ? 'Revoked administrator access for'
        : nextStatus === 'suspended'
        ? 'Suspended'
        : 'Reactivated';

    if (nextStatus === 'revoked') {
      archiveRepository.updateManagedAccountSchoolAndRole(
        actor,
        accountId,
        { status: 'revoked', role: 'student' },
        action,
        `${verb} ${target.fullName} (${target.email})`
      );
    } else {
      archiveRepository.setManagedAccountStatusDirect(
        actor,
        accountId,
        nextStatus,
        action,
        `${verb} ${target.role === 'school_admin' ? 'School Admin' : 'Student'} ${target.fullName} (${target.email})`
      );
    }

    return { ok: true };
  },

  moderateAccount(
    actor: AuthenticatedUser | null | undefined,
    accountId: string,
    mode: 'warn' | 'notify' | 'restrict' | 'suspend' | 'ban' | 'activate',
    rawReason: string,
    customTitle?: string
  ): AuthActionResult {
    if (!isActiveAccount(actor) || !hasPermission(actor, 'accounts:manage')) {
      return { ok: false, error: 'Only Super Administrators can perform moderation actions.' };
    }
    if (actor.id === accountId) {
      return { ok: false, error: 'You cannot moderate your own Super Admin account.' };
    }

    const repoAcc = archiveRepository
      .getSnapshot()
      .accounts.find((a) => a.id === accountId);
    const dirAccounts = readAccounts();
    const dirAcc = dirAccounts.find((a) => a.id === accountId);
    const target =
      repoAcc ?? (dirAcc ? { ...dirAcc, schoolCode: dirAcc.assignedSchoolCode ?? 'AAUA' } : null);

    if (!target) {
      return { ok: false, error: 'Account not found.' };
    }
    if (target.role === 'super_admin') {
      return { ok: false, error: 'Super Admin accounts are protected from moderation.' };
    }

    const cleanReason = sanitizeSingleLine(rawReason, 260);
    if (mode !== 'activate' && !cleanReason) {
      return { ok: false, error: 'Enter a clear message or reason for this action.' };
    }

    if (mode === 'notify') {
      try {
        archiveRepository.sendDirectNotification(actor, {
          targetUserId: accountId,
          title: sanitizeSingleLine(customTitle || 'Direct Notice from Super Admin', 120),
          message: cleanReason,
          category: 'system',
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Unable to send notification.' };
      }
    }

    const now = new Date().toISOString();
    const nextWarningsCount =
      mode === 'warn' ? (target.warningsCount ?? 0) + 1 : target.warningsCount ?? 0;

    const nextStatus: AccountStatus =
      mode === 'restrict'
        ? 'restricted'
        : mode === 'suspend'
          ? 'suspended'
          : mode === 'ban'
            ? 'banned'
            : mode === 'activate'
              ? 'active'
              : target.status;

    const nextNote = mode === 'activate' ? cleanReason || '' : cleanReason;

    if (dirAcc) {
      writeAccounts(
        dirAccounts.map((a) =>
          a.id === accountId
            ? {
                ...a,
                status: nextStatus,
                warningsCount: nextWarningsCount,
                moderationNote: nextNote || undefined,
                updatedAt: now,
              }
            : a
        )
      );
    }

    if (mode === 'suspend' || mode === 'ban') {
      archiveRepository.setAccountSessionState(accountId, 'logged_out');
    }

    const actionMap = {
      warn: 'account_warned',
      restrict: 'account_restricted',
      suspend: target.role === 'school_admin' ? 'admin_suspended' : 'account_suspended',
      ban: 'account_banned',
      activate: target.role === 'school_admin' ? 'admin_reactivated' : 'account_reactivated',
    } as const;

    const summaryMap = {
      warn: `Issued warning #${nextWarningsCount} to ${target.fullName} (${target.email}): ${cleanReason}`,
      restrict: `Restricted ${target.fullName} (${target.email}): ${cleanReason}`,
      suspend: `Suspended ${target.fullName} (${target.email}): ${cleanReason}`,
      ban: `Banned ${target.fullName} (${target.email}): ${cleanReason}`,
      activate: `Restored active status for ${target.fullName} (${target.email})${cleanReason ? `: ${cleanReason}` : ''}`,
    };

    const alertTitleMap = {
      warn: customTitle || `Official Warning (#${nextWarningsCount})`,
      restrict: customTitle || 'Account Restricted',
      suspend: customTitle || 'Account Suspended',
      ban: customTitle || 'Account Banned',
      activate: customTitle || 'Account Restored to Active',
    };

    archiveRepository.recordModerationAction(
      actor,
      accountId,
      {
        status: nextStatus,
        warningsCount: nextWarningsCount,
        moderationNote: nextNote,
      },
      actionMap[mode],
      summaryMap[mode],
      {
        title: alertTitleMap[mode],
        message: cleanReason || 'Your account access has been restored.',
      }
    );

    return { ok: true };
  },

  // -------------------------------------------------------------------------
  // Password Change (Authenticated Account) & Password Reset Flow
  // -------------------------------------------------------------------------

  async changePassword(
    actor: AuthenticatedUser | null | undefined,
    currentPassword: string,
    newPassword: string,
    confirmPassword: string
  ): Promise<AuthActionResult> {
    if (!isActiveAccount(actor)) {
      return { ok: false, error: 'You must be signed in to change your password.' };
    }
    if (!currentPassword) {
      return { ok: false, error: 'Enter your current password.' };
    }

    const accounts = readAccounts();
    const target = accounts.find((a) => a.id === actor.id && a.isEmailVerified);
    if (!target) {
      return { ok: false, error: 'Account record could not be located.' };
    }

    const currentValid = await verifyPassword(
      currentPassword,
      target.passwordSalt,
      target.passwordHash
    );
    if (!currentValid) {
      return { ok: false, error: 'Current password is incorrect.' };
    }

    const pwError = validatePasswordForRole(newPassword, target.role);
    if (pwError) {
      return { ok: false, error: pwError };
    }
    if (newPassword === currentPassword) {
      return {
        ok: false,
        error: 'New password must be different from your current password.',
      };
    }
    if (newPassword !== confirmPassword) {
      return { ok: false, error: 'New passwords do not match.' };
    }

    const salt = generateSalt();
    const passwordHash = await hashPassword(newPassword, salt);
    const now = new Date().toISOString();

    writeAccounts(
      accounts.map((a) =>
        a.id === target.id
          ? {
              ...a,
              passwordHash,
              passwordSalt: salt,
              needsPasswordSetup: false,
              updatedAt: now,
            }
          : a
      )
    );
    writeOtpRecords(
      readOtpRecords().filter(
        (r) => !(r.email === target.email && (r.purpose === 'reset' || r.purpose === 'admin_activate'))
      )
    );

    return { ok: true };
  },

  requestPasswordReset(
    rawMatricOrEmail: string,
    portal: AuthPortal = 'student'
  ): AuthActionResult<{ email: string; matricNumber: string; verificationCode?: string }> {
    const trimmed = sanitizeIdentifier(rawMatricOrEmail, 160);
    if (!trimmed) {
      return {
        ok: false,
        error:
          portal === 'student'
            ? 'Enter your matric number or registered email.'
            : 'Enter your registered administrator email.',
      };
    }

    const accounts = readAccounts().filter(
      (a) =>
        a.isEmailVerified &&
        (portal === 'student'
          ? a.role === 'student'
          : portal === 'school_admin'
            ? a.role === 'school_admin'
            : a.role === 'super_admin')
    );
    const lower = trimmed.toLowerCase();
    const account = accounts.find(
      (a) => a.matricNumber === trimmed || a.email === lower
    );

    if (!account) {
      return {
        ok: false,
        error:
          portal === 'student'
            ? 'No verified student account matches that matric number or email.'
            : 'No verified administrator account matches that email.',
      };
    }

    const verificationCode = issueOtp(account.email, 'reset');
    return {
      ok: true,
      data: {
        email: account.email,
        matricNumber: account.matricNumber,
        verificationCode: IS_DEV_BOOTSTRAP_ENV ? verificationCode : undefined,
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
  ): Promise<AuthActionResult<{ identifier: string; matricNumber: string }>> {
    const normalizedEmail = email.trim().toLowerCase();
    const accounts = readAccounts();
    const target = accounts.find(
      (a) => a.email === normalizedEmail && a.isEmailVerified
    );

    if (!target) {
      return { ok: false, error: 'Account could not be found.' };
    }

    const pwError = validatePasswordForRole(newPassword, target.role);
    if (pwError) {
      return { ok: false, error: pwError };
    }
    if (newPassword !== confirmPassword) {
      return { ok: false, error: 'Passwords do not match.' };
    }

    const salt = generateSalt();
    const passwordHash = await hashPassword(newPassword, salt);
    const now = new Date().toISOString();

    writeAccounts(
      accounts.map((a) =>
        a.email === normalizedEmail
          ? {
              ...a,
              passwordHash,
              passwordSalt: salt,
              needsPasswordSetup: false,
              updatedAt: now,
            }
          : a
      )
    );

    writeOtpRecords(
      readOtpRecords().filter(
        (r) => !(r.email === normalizedEmail && r.purpose === 'reset')
      )
    );

    const identifier = target.role === 'student' ? target.matricNumber : target.email;
    return {
      ok: true,
      data: {
        identifier,
        matricNumber: target.matricNumber,
      },
    };
  },
};
