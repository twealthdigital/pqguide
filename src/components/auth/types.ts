import type { AuthenticatedUser } from '../../core/types';

export type AuthView =
  | 'signin'
  | 'signup'
  | 'signup_success'
  | 'verify_signup'
  | 'forgot_request'
  | 'forgot_verify'
  | 'forgot_reset'
  | 'forgot_success'
  | 'admin_activate_request'
  | 'admin_activate_verify'
  | 'admin_activate_success'
  | 'dev_super_admin_setup'
  | 'super_admin_setup'
  | 'super_admin_totp';

export interface AuthNotice {
  tone: 'warning' | 'error' | 'info' | 'success';
  message: string;
}

export interface PortalAuthProps {
  view: AuthView;
  isBusy: boolean;
  onBusyChange?: (busy: boolean) => void;
  sessionNotice?: AuthNotice | null;
  onDismissSessionNotice?: () => void;
  onSwitchView: (next: AuthView, options?: { replace?: boolean }) => void;
  onGoBack: (fallbackView: AuthView) => void;
  onAuthenticated: (account: AuthenticatedUser, rememberMe: boolean) => void;
  onBackToOnboarding?: () => void;
}
