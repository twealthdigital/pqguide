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
}

export const LogoutConfirmDialog: React.FC<LogoutConfirmDialogProps> = ({
  open,
  user,
  loading = false,
  onCancel,
  onConfirm,
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
        <>
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
        </>
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
