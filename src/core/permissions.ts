import type { AppScreen, AuthenticatedUser, UserRole } from './types';

export type Permission =
  | 'pq:read'
  | 'pq:upload_school'
  | 'pq:manage_school'
  | 'pq:upload_any'
  | 'pq:manage_all'
  | 'materials:read'
  | 'materials:manage'
  | 'schools:manage'
  | 'admins:manage'
  | 'accounts:manage'
  | 'audit:read'
  | 'dev:reset';

export const ROLE_LABELS: Readonly<Record<UserRole, string>> = {
  student: 'Student',
  school_admin: 'School Admin',
  super_admin: 'Super Admin',
};

export const ROLE_PERMISSIONS: Readonly<Record<UserRole, ReadonlySet<Permission>>> = {
  student: new Set<Permission>(['pq:read', 'materials:read']),
  school_admin: new Set<Permission>([
    'pq:read',
    'pq:upload_school',
    'pq:manage_school',
    'materials:read',
  ]),
  super_admin: new Set<Permission>([
    'pq:read',
    'pq:upload_any',
    'pq:manage_all',
    'materials:read',
    'materials:manage',
    'schools:manage',
    'admins:manage',
    'accounts:manage',
    'audit:read',
    'dev:reset',
  ]),
};

export function isActiveAccount(user: AuthenticatedUser | null | undefined): user is AuthenticatedUser {
  if (!user) return false;
  return user.status === 'active' && user.isEmailVerified;
}

export function hasPermission(
  user: AuthenticatedUser | null | undefined,
  permission: Permission
): boolean {
  if (!isActiveAccount(user)) return false;
  const set = ROLE_PERMISSIONS[user.role];
  return Boolean(set && set.has(permission));
}

export function hasAnyPermission(
  user: AuthenticatedUser | null | undefined,
  permissions: Permission[]
): boolean {
  return permissions.some((p) => hasPermission(user, p));
}

export function canManageSchoolDocument(
  user: AuthenticatedUser | null | undefined,
  schoolId: string
): boolean {
  if (!isActiveAccount(user)) return false;
  if (hasPermission(user, 'pq:manage_all')) return true;
  if (hasPermission(user, 'pq:manage_school')) {
    return Boolean(user.assignedSchoolId && user.assignedSchoolId === schoolId);
  }
  return false;
}

export function canAccessScreen(
  user: AuthenticatedUser | null | undefined,
  screen: AppScreen
): boolean {
  if (!isActiveAccount(user)) return false;

  if (screen === 'school_admin') {
    return (
      user.role === 'school_admin' &&
      hasPermission(user, 'pq:manage_school') &&
      Boolean(user.assignedSchoolId)
    );
  }

  if (screen === 'super_admin') {
    return (
      user.role === 'super_admin' &&
      hasPermission(user, 'admins:manage') &&
      hasPermission(user, 'schools:manage')
    );
  }

  return true;
}

export function getDefaultScreenForRole(role: UserRole): AppScreen {
  if (role === 'super_admin') return 'super_admin';
  if (role === 'school_admin') return 'school_admin';
  return 'home';
}
