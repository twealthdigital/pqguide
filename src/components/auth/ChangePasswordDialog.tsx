import React, { useEffect, useMemo, useState } from 'react';
import { Check, KeyRound } from 'lucide-react';
import type { AuthenticatedUser } from '../../core/types';
import { authService, evaluatePasswordStrength } from '../../services/authService';
import { DetailDialog } from '../ui/DetailDialog';
import { TactileButton } from '../ui/TactileButton';
import { PasswordField } from './PasswordField';
import { PasswordStrengthMeter } from './PasswordStrengthMeter';

interface ChangePasswordDialogProps {
  open: boolean;
  user: AuthenticatedUser;
  onClose: () => void;
}

export const ChangePasswordDialog: React.FC<ChangePasswordDialogProps> = ({
  open,
  user,
  onClose,
}) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSaving(false);
      setSaved(false);
      setErrorMsg(null);
    }
  }, [open]);

  const pwReport = useMemo(
    () => evaluatePasswordStrength(newPassword, user.role),
    [newPassword, user.role]
  );

  const confirmError =
    confirmPassword && newPassword !== confirmPassword ? 'Passwords do not match.' : null;

  const sameAsCurrentError =
    currentPassword && newPassword && newPassword === currentPassword
      ? 'New password must differ from current password.'
      : null;

  const canSubmit =
    !saving &&
    !saved &&
    Boolean(currentPassword) &&
    pwReport.meetsMinimum &&
    newPassword !== currentPassword &&
    newPassword === confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setErrorMsg(null);
    setSaving(true);

    const res = await authService.changePassword(
      user,
      currentPassword,
      newPassword,
      confirmPassword
    );
    setSaving(false);
    if (!res.ok) {
      setErrorMsg(res.error ?? 'Unable to change password.');
      return;
    }

    setSaved(true);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  return (
    <DetailDialog
      open={open}
      onClose={onClose}
      title="Change Password"
      subtitle={`Update credentials for ${user.email}`}
      icon={<KeyRound className="w-4 h-4" />}
      maxWidthClass="max-w-md"
      footer={
        saved ? (
          <TactileButton
            type="button"
            variant="dark"
            size="md"
            className="rounded-full"
            onClick={onClose}
          >
            Done
          </TactileButton>
        ) : (
          <>
            <TactileButton
              type="button"
              variant="light"
              size="md"
              className="rounded-full"
              disabled={saving}
              onClick={onClose}
            >
              Cancel
            </TactileButton>
            <TactileButton
              type="submit"
              form="pq-change-password-form"
              variant="dark"
              size="md"
              className="rounded-full"
              loading={saving}
              disabled={!canSubmit}
            >
              Update Password
            </TactileButton>
          </>
        )
      }
    >
      {saved ? (
        <div className="rounded-2xl bg-[#F0FDF4] border border-[#BBF7D0] p-4 flex items-start gap-3">
          <span className="h-9 w-9 rounded-xl bg-[#16A34A] text-white flex items-center justify-center shrink-0">
            <Check className="w-5 h-5" />
          </span>
          <div className="space-y-1">
            <p className="text-sm font-bold text-[#14532D]">Password Updated</p>
            <p className="text-xs text-[#166534] leading-relaxed">
              Your new password is active immediately for future sign-ins.
            </p>
          </div>
        </div>
      ) : (
        <form
          id="pq-change-password-form"
          onSubmit={handleSubmit}
          className="space-y-3.5"
          noValidate
        >
          {errorMsg && (
            <div
              role="alert"
              className="rounded-2xl bg-[#FEF2F2] border border-[#FECACA] px-3.5 py-2.5 text-xs font-medium text-[#B91C1C]"
            >
              {errorMsg}
            </div>
          )}

          <PasswordField
            id="change-pw-current"
            label="Current Password"
            value={currentPassword}
            onChange={setCurrentPassword}
            placeholder="Enter current password"
            disabled={saving}
            autoComplete="current-password"
            compact
          />

          <PasswordField
            id="change-pw-new"
            label="New Password"
            value={newPassword}
            onChange={setNewPassword}
            placeholder={
              user.role === 'super_admin'
                ? '10+ chars with upper, lower & number'
                : '8+ chars with letter & number'
            }
            disabled={saving}
            autoComplete="new-password"
            error={sameAsCurrentError}
            compact
          />

          <PasswordStrengthMeter password={newPassword} role={user.role} />

          <PasswordField
            id="change-pw-confirm"
            label="Confirm New Password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            placeholder="Re-enter new password"
            disabled={saving}
            autoComplete="new-password"
            error={confirmError}
            compact
          />
        </form>
      )}
    </DetailDialog>
  );
};
