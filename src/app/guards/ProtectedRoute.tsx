import React from 'react';
import { ShieldAlert } from 'lucide-react';
import {
  canAccessScreen,
  getDefaultScreenForRole,
  hasPermission,
  isActiveAccount,
  type Permission,
} from '../../core/permissions';
import type { AppScreen, AuthenticatedUser } from '../../core/types';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import { TactileButton } from '../../components/ui/TactileButton';

interface ProtectedRouteProps {
  user: AuthenticatedUser | null;
  screen?: AppScreen;
  requiredPermission?: Permission;
  onFallbackNavigate: (screen: AppScreen) => void;
  children: React.ReactNode;
}

/**
 * Frontend route & screen guard enforcing deny-by-default RBAC rules.
 * NOTE: Client-side route guards protect UI ergonomics only; real authorization
 * must always be enforced on a backend server.
 */
export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  user,
  screen,
  requiredPermission,
  onFallbackNavigate,
  children,
}) => {
  const active = isActiveAccount(user);
  const screenAllowed = active && (!screen || canAccessScreen(user, screen));
  const permissionAllowed =
    active && (!requiredPermission || hasPermission(user, requiredPermission));

  if (!active || !screenAllowed || !permissionAllowed) {
    const safeHome = user ? getDefaultScreenForRole(user.role) : 'home';
    return (
      <div className="max-w-lg mx-auto py-8 page-enter">
        <SurfaceCard tone="white" className="p-6 sm:p-8 text-center space-y-4">
          <div className="h-12 w-12 rounded-2xl bg-[#FEF2F2] text-[#B91C1C] flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div className="space-y-1.5">
            <h1 className="font-display text-xl font-bold text-[#1A1B20]">
              Access Restricted
            </h1>
            <p className="text-sm text-[#505460] leading-relaxed">
              Your current account does not have permission to open this workspace.
            </p>
          </div>
          <div className="pt-1 flex justify-center">
            <TactileButton
              variant="dark"
              size="md"
              onClick={() => onFallbackNavigate(safeHome)}
            >
              Return to Permitted Home
            </TactileButton>
          </div>
        </SurfaceCard>
      </div>
    );
  }

  return <>{children}</>;
};
