import React, { useState } from 'react';
import type { AuthenticatedUser, AuthPortal } from '../core/types';
import { SchoolAdminAuthPortal } from '../components/auth/SchoolAdminAuthPortal';
import { StudentAuthPortal } from '../components/auth/StudentAuthPortal';
import { SuperAdminAuthPortal } from '../components/auth/SuperAdminAuthPortal';
import type { AuthNotice, AuthView } from '../components/auth/types';

export type { AuthNotice, AuthView };

interface AuthScreenProps {
  portal?: AuthPortal;
  view?: AuthView;
  sessionNotice?: AuthNotice | null;
  onDismissSessionNotice?: () => void;
  onViewChange?: (next: AuthView, options?: { replace?: boolean }) => void;
  onAuthBack?: (fallbackView: AuthView) => void;
  onAuthenticated: (account: AuthenticatedUser, rememberMe?: boolean) => void;
  onBackToOnboarding?: () => void;
}

/**
 * Isolated Authentication Portal Dispatcher.
 * Renders three strictly separated portal experiences with zero shared role switchers:
 *  - 'student'      -> StudentAuthPortal (sign-in, validated registration, Google OAuth, OTP, recovery)
 *  - 'school_admin' -> SchoolAdminAuthPortal (approved email login, email activation, recovery)
 *  - 'super_admin'  -> SuperAdminAuthPortal (restricted console login, dev-only bootstrap, recovery)
 */
export const AuthScreen: React.FC<AuthScreenProps> = ({
  portal = 'student',
  view: controlledView,
  sessionNotice,
  onDismissSessionNotice,
  onViewChange,
  onAuthBack,
  onAuthenticated,
  onBackToOnboarding,
}) => {
  const [localView, setLocalView] = useState<AuthView>('signin');
  const [portalBusy, setPortalBusy] = useState(false);

  const view = controlledView ?? localView;

  const handleSwitchView = (next: AuthView, options?: { replace?: boolean }) => {
    if (portalBusy) return;
    if (onViewChange) {
      onViewChange(next, options);
    } else {
      setLocalView(next);
    }
  };

  const handleGoBack = (fallbackView: AuthView) => {
    if (portalBusy) return;
    if (onAuthBack) {
      onAuthBack(fallbackView);
    } else {
      setLocalView(fallbackView);
    }
  };

  if (portal === 'super_admin') {
    return (
      <SuperAdminAuthPortal
        key="portal-super-admin"
        view={view}
        isBusy={portalBusy}
        onBusyChange={setPortalBusy}
        sessionNotice={sessionNotice}
        onDismissSessionNotice={onDismissSessionNotice}
        onSwitchView={handleSwitchView}
        onGoBack={handleGoBack}
        onAuthenticated={onAuthenticated}
      />
    );
  }

  if (portal === 'school_admin') {
    return (
      <SchoolAdminAuthPortal
        key="portal-school-admin"
        view={view}
        isBusy={portalBusy}
        onBusyChange={setPortalBusy}
        sessionNotice={sessionNotice}
        onDismissSessionNotice={onDismissSessionNotice}
        onSwitchView={handleSwitchView}
        onGoBack={handleGoBack}
        onAuthenticated={onAuthenticated}
      />
    );
  }

  return (
    <StudentAuthPortal
      key="portal-student"
      view={view}
      isBusy={portalBusy}
      onBusyChange={setPortalBusy}
      sessionNotice={sessionNotice}
      onDismissSessionNotice={onDismissSessionNotice}
      onSwitchView={handleSwitchView}
      onGoBack={handleGoBack}
      onAuthenticated={onAuthenticated}
      onBackToOnboarding={onBackToOnboarding}
    />
  );
};
