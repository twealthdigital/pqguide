import type { AuthPortal } from '../core/types';

/**
 * Detects which separated sign-in portal the browser URL/hash is pointing to.
 * Supports both pathname (/admin-login, /super-admin-login) and hash
 * (#/admin-login, #/super-admin-login) for Capacitor & static hosting compatibility.
 *
 * SECURITY NOTE: Selecting a portal route only picks which login screen renders;
 * it NEVER grants roles or bypasses credential checks.
 */
export function detectAuthPortal(): AuthPortal {
  if (typeof window === 'undefined') return 'student';

  const combined = `${window.location.pathname} ${window.location.hash}`.toLowerCase();

  if (combined.includes('super-admin-login') || combined.includes('superadmin-login')) {
    return 'super_admin';
  }
  if (combined.includes('admin-login')) {
    return 'school_admin';
  }
  return 'student';
}

export function getPortalPath(portal: AuthPortal): string {
  if (portal === 'super_admin') return '#/super-admin-login';
  if (portal === 'school_admin') return '#/admin-login';
  return '#/';
}
