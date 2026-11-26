import React from 'react';
import { Check, Circle } from 'lucide-react';
import type { UserRole } from '../../core/types';
import { evaluatePasswordStrength } from '../../services/auth/passwordPolicy';

interface PasswordStrengthMeterProps {
  password: string;
  role?: UserRole;
}

export const PasswordStrengthMeter: React.FC<PasswordStrengthMeterProps> = ({
  password,
  role = 'student',
}) => {
  const report = evaluatePasswordStrength(password, role);

  const barColor = (segmentIdx: number) => {
    if (report.score === 0 || segmentIdx >= report.score) {
      return 'bg-[#E5E7EB]';
    }
    if (report.score === 1) return 'bg-[#DC2626]';
    if (report.score === 2) return 'bg-[#D97706]';
    if (report.score === 3) return 'bg-[#2563EB]';
    return 'bg-[#16A34A]';
  };

  const labelTone =
    report.score === 0
      ? 'text-[#686C78]'
      : report.score === 1
        ? 'text-[#B91C1C]'
        : report.score === 2
          ? 'text-[#B45309]'
          : report.score === 3
            ? 'text-[#1D4ED8]'
            : 'text-[#15803D]';

  return (
    <div className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/[0.07] px-3.5 py-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-[#505460]">
          Password strength
        </span>
        <span className={`text-[11px] font-bold ${labelTone}`}>
          {report.score === 0 ? 'Not entered' : report.label}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-1.5" aria-hidden="true">
        {[0, 1, 2, 3].map((idx) => (
          <div
            key={idx}
            className={`h-1.5 rounded-full transition-colors duration-200 ${barColor(idx)}`}
          />
        ))}
      </div>

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1 pt-0.5">
        {report.requirements.map((req) => (
          <li
            key={req.id}
            className={`flex items-center gap-1.5 text-[11px] ${
              req.met ? 'text-[#15803D] font-medium' : 'text-[#686C78]'
            }`}
          >
            {req.met ? (
              <Check className="w-3 h-3 shrink-0 text-[#16A34A]" />
            ) : (
              <Circle className="w-2.5 h-2.5 shrink-0 text-[#9AA0AE]" />
            )}
            <span className="truncate">{req.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};
