import {
  canAccessScreen,
  getDefaultScreenForRole,
  isActiveAccount,
} from '../core/permissions';
import type { AppScreen, AuthenticatedUser, WorkspaceViewMode } from '../core/types';

export function resolveSafeScreen(
  user: AuthenticatedUser | null,
  requestedScreen: AppScreen,
  workspaceMode?: WorkspaceViewMode
): AppScreen {
  if (!isActiveAccount(user)) {
    return 'home';
  }
  if (canAccessScreen(user, requestedScreen)) {
    return requestedScreen;
  }
  return getDefaultScreenForRole(user.role, workspaceMode);
}

export function getInitialScreenForUser(
  user: AuthenticatedUser | null,
  workspaceMode?: WorkspaceViewMode
): AppScreen {
  if (!isActiveAccount(user)) return 'home';
  return getDefaultScreenForRole(user.role, workspaceMode);
}
