import type { UserRole } from '../../core/types';

export interface PasswordRequirementCheck {
  id: string;
  label: string;
  met: boolean;
}

export interface PasswordStrengthReport {
  score: 0 | 1 | 2 | 3 | 4;
  label: 'Empty' | 'Too weak' | 'Weak' | 'Fair' | 'Strong' | 'Very strong';
  meetsMinimum: boolean;
  requirements: PasswordRequirementCheck[];
}

export function getMinimumLengthForRole(role: UserRole): number {
  return role === 'super_admin' ? 10 : 8;
}

export function evaluatePasswordStrength(
  password: string,
  role: UserRole = 'student'
): PasswordStrengthReport {
  const minLength = getMinimumLengthForRole(role);
  const hasMinLength = password.length >= minLength;
  const hasLetter = /[A-Za-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);

  const requirements: PasswordRequirementCheck[] =
    role === 'student'
      ? [
          {
            id: 'min_length',
            label: `At least ${minLength} characters`,
            met: hasMinLength,
          },
          { id: 'letter', label: 'Contains a letter', met: hasLetter },
          { id: 'number', label: 'Contains a number', met: hasNumber },
          {
            id: 'mixed_or_symbol',
            label: 'Uppercase or symbol (recommended)',
            met: (hasUpper && hasLower) || hasSymbol,
          },
        ]
      : [
          {
            id: 'min_length',
            label: `At least ${minLength} characters`,
            met: hasMinLength,
          },
          {
            id: 'upper_lower',
            label: 'Uppercase & lowercase letters',
            met: hasUpper && hasLower,
          },
          { id: 'number', label: 'Contains a number', met: hasNumber },
          {
            id: 'symbol',
            label: 'Special character (recommended)',
            met: hasSymbol,
          },
        ];

  const meetsMinimum =
    role === 'student'
      ? hasMinLength && hasLetter && hasNumber
      : hasMinLength && hasUpper && hasLower && hasNumber;

  if (!password) {
    return {
      score: 0,
      label: 'Empty',
      meetsMinimum: false,
      requirements,
    };
  }

  let points = 0;
  if (hasMinLength) points += 1;
  if (hasUpper && hasLower) points += 1;
  else if (hasLetter) points += 0.5;
  if (hasNumber) points += 1;
  if (hasSymbol) points += 1;
  if (password.length >= minLength + 4) points += 0.5;

  let score: 0 | 1 | 2 | 3 | 4 = 1;
  if (!meetsMinimum && points < 2) {
    score = 1;
  } else if (!meetsMinimum) {
    score = 2;
  } else if (points >= 4) {
    score = 4;
  } else if (points >= 3) {
    score = 3;
  } else {
    score = 2;
  }

  const label: PasswordStrengthReport['label'] =
    score === 1
      ? meetsMinimum
        ? 'Weak'
        : 'Too weak'
      : score === 2
        ? meetsMinimum
          ? 'Fair'
          : 'Weak'
        : score === 3
          ? 'Strong'
          : 'Very strong';

  return {
    score,
    label,
    meetsMinimum,
    requirements,
  };
}

export function validatePasswordForRole(
  password: string,
  role: UserRole = 'student'
): string | null {
  const minLength = getMinimumLengthForRole(role);
  if (!password) {
    return 'Enter a password.';
  }
  if (password.length < minLength) {
    return role === 'super_admin'
      ? `Super Admin password must be at least ${minLength} characters.`
      : role === 'school_admin'
        ? `Administrator password must be at least ${minLength} characters.`
        : `Password must be at least ${minLength} characters.`;
  }
  if (role === 'student') {
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      return 'Password must include at least one letter and one number.';
    }
    return null;
  }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
    return role === 'super_admin'
      ? 'Super Admin password must include uppercase letters, lowercase letters, and numbers.'
      : 'Administrator password must include uppercase letters, lowercase letters, and numbers.';
  }
  return null;
}
