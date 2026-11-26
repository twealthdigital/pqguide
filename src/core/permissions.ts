import type {
  AppScreen,
  AuthenticatedUser,
  UserRole,
  WorkspaceViewMode,
} from './types';

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
  | 'broadcasts:manage'
  | 'payments:read'
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
    'broadcasts:manage',
    'payments:read',
    'audit:read',
    'dev:reset',
  ]),
};

const CONSTANT_ADMIN_SCREENS = new Set<AppScreen>([
  'school_admin',
  'notifications',
  'about',
  'services',
  'help',
  'support',
]);

const READ_ONLY_PERMISSIONS = new Set<Permission>(['pq:read', 'materials:read']);

export function isRestrictedAccount(
  user: AuthenticatedUser | null | undefined
): boolean {
  return Boolean(user && user.status === 'restricted');
}

export function isActiveAccount(
  user: AuthenticatedUser | null | undefined
): user is AuthenticatedUser {
  if (!user || !user.isEmailVerified) return false;
  return user.status === 'active' || user.status === 'restricted';
}

export function hasPermission(
  user: AuthenticatedUser | null | undefined,
  permission: Permission
): boolean {
  if (!isActiveAccount(user)) return false;
  if (user.status === 'restricted' && !READ_ONLY_PERMISSIONS.has(permission)) {
    return false;
  }
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
  if (user.status === 'restricted') return false;
  if (hasPermission(user, 'pq:manage_all')) return true;
  if (hasPermission(user, 'pq:manage_school')) {
    return Boolean(user.assignedSchoolId && user.assignedSchoolId === schoolId);
  }
  return false;
}

/**
 * Checks whether a user can open a screen:
 * - Students: normal student website + info/support screens ONLY (never admin screens).
 * - School Admins: ONLY School Admin Desk + Notifications + About/Services/Help/Customer Support
 *   (cannot switch to or open normal student website screens or Super Admin).
 * - Super Admins: full access across Super Admin console, School Admin view, and Student website view.
 */
export function canAccessScreen(
  user: AuthenticatedUser | null | undefined,
  screen: AppScreen
): boolean {
  if (!isActiveAccount(user)) return false;

  if (user.role === 'super_admin') {
    return (
      hasPermission(user, 'admins:manage') && hasPermission(user, 'schools:manage')
    );
  }

  if (user.role === 'school_admin') {
    if (!hasPermission(user, 'pq:manage_school') || !user.assignedSchoolId) {
      return false;
    }
    return CONSTANT_ADMIN_SCREENS.has(screen);
  }

  // Student
  if (screen === 'school_admin' || screen === 'super_admin') {
    return false;
  }
  return true;
}

export function getDefaultScreenForRole(
  role: UserRole,
  workspaceMode?: WorkspaceViewMode
): AppScreen {
  if (role === 'super_admin') {
    if (workspaceMode === 'school_admin') return 'school_admin';
    if (workspaceMode === 'student') return 'home';
    return 'super_admin';
  }
  if (role === 'school_admin') return 'school_admin';
  return 'home';
}
