import React from 'react';
import { LogOut } from 'lucide-react';
import { ROLE_LABELS } from '../../core/permissions';
import type { AuthenticatedUser } from '../../core/types';
import { DetailDialog } from '../ui/DetailDialog';
import { TactileButton } from '../ui/TactileButton';

interface LogoutConfirmDialogProps {
  open: boolean;
  user: AuthenticatedUser;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onConfirmAllDevices?: () => void;
}

export const LogoutConfirmDialog: React.FC<LogoutConfirmDialogProps> = ({
  open,
  user,
  loading = false,
  onCancel,
  onConfirm,
  onConfirmAllDevices,
}) => {
  return (
    <DetailDialog
      open={open}
      onClose={loading ? () => {} : onCancel}
      title="Confirm Sign Out"
      subtitle={`${user.fullName} · ${ROLE_LABELS[user.role]}`}
      icon={<LogOut className="w-4 h-4" />}
      maxWidthClass="max-w-sm"
      footer={
        <div className="w-full space-y-2">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <TactileButton
              type="button"
              variant="light"
              size="md"
              className="rounded-full"
              disabled={loading}
              onClick={onCancel}
            >
              Stay Signed In
            </TactileButton>
            <TactileButton
              type="button"
              variant="dark"
              size="md"
              className="rounded-full"
              loading={loading}
              icon={<LogOut className="w-4 h-4" />}
              onClick={onConfirm}
            >
              Sign Out
            </TactileButton>
          </div>
          {onConfirmAllDevices && user.role === 'super_admin' && (
            <button
              type="button"
              disabled={loading}
              onClick={onConfirmAllDevices}
              className="w-full py-2 text-center text-xs font-semibold text-[#B91C1C] hover:text-[#991B1B] underline underline-offset-4 cursor-pointer disabled:opacity-50"
            >
              Sign out all active Super Admin devices
            </button>
          )}
        </div>
      }
    >
      <p className="text-sm text-[#505460] leading-relaxed">
        Are you sure you want to end your current session as{' '}
        <span className="font-semibold text-[#1A1B20]">{user.email}</span>? You will be returned to the{' '}
        <span className="font-semibold text-[#1A1B20]">{ROLE_LABELS[user.role]}</span> login portal.
      </p>
    </DetailDialog>
  );
};
