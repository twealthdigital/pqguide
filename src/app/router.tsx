import {
  canAccessScreen,
  getDefaultScreenForRole,
  isActiveAccount,
} from '../core/permissions';
import type { AppScreen, AuthenticatedUser } from '../core/types';

export function resolveSafeScreen(
  user: AuthenticatedUser | null,
  requestedScreen: AppScreen
): AppScreen {
  if (!isActiveAccount(user)) {
    return 'home';
  }
  if (canAccessScreen(user, requestedScreen)) {
    return requestedScreen;
  }
  return getDefaultScreenForRole(user.role);
}

export function getInitialScreenForUser(user: AuthenticatedUser | null): AppScreen {
  if (!isActiveAccount(user)) return 'home';
  return getDefaultScreenForRole(user.role);
}
