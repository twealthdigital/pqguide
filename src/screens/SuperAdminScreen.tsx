import React, { useState } from 'react';
import { CheckCircle2, ShieldAlert } from 'lucide-react';
import { canAccessScreen } from '../core/permissions';
import type {
  AuthenticatedUser,
  SettingsUiTarget,
  SuperAdminSectionId,
} from '../core/types';
import { useArchiveStore } from '../hooks/useArchiveStore';
import { SurfaceCard } from '../components/ui';
import { SuperAdminOverviewTab } from '../features/admin/super-admin/SuperAdminOverviewTab';
import { StudentsTab } from '../features/admin/super-admin/StudentsTab';
import { UniversityManagementTab } from '../features/admin/super-admin/UniversityManagementTab';
import { AdministratorsTab } from '../features/admin/super-admin/AdministratorsTab';
import { ActivitiesTab } from '../features/admin/super-admin/ActivitiesTab';
import { ModerationActionsTab } from '../features/admin/super-admin/ModerationActionsTab';
import { BroadcastsTab } from '../features/admin/super-admin/BroadcastsTab';
import { SupportInboxTab } from '../features/admin/super-admin/SupportInboxTab';
import { PastQuestionsManagerTab } from '../features/admin/super-admin/PastQuestionsManagerTab';
import { StudyMaterialsManagerTab } from '../features/admin/super-admin/StudyMaterialsManagerTab';
import { DocumentScannerScreen } from './DocumentScannerScreen';
import { DocumentReviewTab } from '../features/admin/super-admin/DocumentReviewTab';
import { PaymentsTab } from '../features/admin/super-admin/PaymentsTab';
import { AdminSettingsTab } from '../features/admin/super-admin/AdminSettingsTab';

interface SuperAdminScreenProps {
  currentUser: AuthenticatedUser;
  activeSection: SuperAdminSectionId;
  onSelectSection: (section: SuperAdminSectionId) => void;
  settingsTarget: SettingsUiTarget;
  onSelectSettingsTarget: (target: SettingsUiTarget) => void;
  onSignedOutReset: () => void;
}

const SECTION_META: Record<
  SuperAdminSectionId,
  { title: string; subtitle: string }
> = {
  overview: {
    title: 'Overview',
    subtitle: 'Live platform metrics, rolling payment windows, daily calendar status, and performance charts.',
  },
  students: {
    title: 'Students',
    subtitle: 'Inspect matric numbers, levels, departments, login verification, and history.',
  },
  universities: {
    title: 'Universities',
    subtitle: 'Add universities, edit institution details, and toggle active visibility.',
  },
  administrators: {
    title: 'Administrators',
    subtitle: 'Manage University Administrators and inspect Company Administrators role desk.',
  },
  activities: {
    title: 'Activities & Visitors',
    subtitle: 'Track website visitors, signed-in/signed-out rosters, and audited governance logs.',
  },
  actions: {
    title: 'Moderation & Actions',
    subtitle: 'Warn, send direct notifications, restrict, suspend, ban, or restore accounts uniformly.',
  },
  announcements: {
    title: 'Announcements & Marquee',
    subtitle: 'Push live scrolling header marquees and targeted platform notifications.',
  },
  support_inbox: {
    title: 'Customer Support Inbox',
    subtitle: 'Read student and admin support messages and send direct notification replies.',
  },
  past_questions: {
    title: 'Past Questions Manager',
    subtitle: 'Upload, edit, publish, unpublish, or remove past question papers.',
  },
  study_materials: {
    title: 'Study Materials Manager',
    subtitle: 'Upload structured lecture notes and reading guides across universities.',
  },
  document_scanner: {
    title: 'Scan Documents',
    subtitle: 'Scan past questions and notes. Every scan waits here for your verification, with an alert if the AI finds a problem.',
  },
  document_review: {
    title: 'Document Review',
    subtitle: 'Verify every scanned document, SHA-256 duplicates, OCR scores, and AI cross-checks.',
  },
  payments: {
    title: 'Payment Verifications',
    subtitle: 'Auto-verified Paystack and Flutterwave receipts with tier breakdown.',
  },
  settings: {
    title: 'UI Edits & Content Settings',
    subtitle: 'Select Normal Website, Uni Administrators, or Company Administrators to update live page content.',
  },
};

export const SuperAdminScreen: React.FC<SuperAdminScreenProps> = ({
  currentUser,
  activeSection,
  onSelectSection,
  settingsTarget,
  onSelectSettingsTarget,
  onSignedOutReset,
}) => {
  const store = useArchiveStore();
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!canAccessScreen(currentUser, 'super_admin')) {
    return (
      <SurfaceCard tone="white" className="p-6 text-center space-y-2">
        <ShieldAlert className="w-6 h-6 text-[#B91C1C] mx-auto" />
        <h1 className="font-display text-lg font-bold text-[#1A1B20]">
          Super Admin Authorization Required
        </h1>
        <p className="text-sm text-[#505460]">
          Only an active Super Administrator session can access platform administration.
        </p>
      </SurfaceCard>
    );
  }

  const handleNotice = (msg: string) => {
    setErrorMsg(null);
    setNotice(msg);
  };

  const handleError = (msg: string) => {
    setNotice(null);
    setErrorMsg(msg);
  };

  const meta = SECTION_META[activeSection] ?? SECTION_META.overview;

  return (
    <div className="space-y-6 page-enter">
      {/* Calm Control Header Banner */}
      <SurfaceCard tone="ash" withWaves className="p-6">
        <p className="text-xs font-medium text-[#A5AAB8]">
          Super Admin Control · {currentUser.fullName}
        </p>
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-white mt-1.5">
          {meta.title}
        </h1>
        <p className="text-sm text-[#B8BCC8] mt-1.5 max-w-2xl">
          {meta.subtitle}
        </p>
      </SurfaceCard>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-2xl bg-[#FEF2F2] border border-[#FECACA] px-4 py-3 text-xs font-medium text-[#B91C1C]"
        >
          {errorMsg}
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="rounded-2xl bg-[#F0FDF4] border border-[#BBF7D0] px-4 py-3 text-xs font-medium text-[#15803D] flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {activeSection === 'overview' && (
        <SuperAdminOverviewTab
          store={store}
          onNavigateSection={onSelectSection}
        />
      )}

      {activeSection === 'students' && (
        <StudentsTab
          currentUser={currentUser}
          store={store}
          onNotice={handleNotice}
          onError={handleError}
        />
      )}

      {activeSection === 'universities' && (
        <UniversityManagementTab
          currentUser={currentUser}
          store={store}
          onNotice={handleNotice}
          onError={handleError}
        />
      )}

      {activeSection === 'administrators' && (
        <AdministratorsTab
          currentUser={currentUser}
          store={store}
          onNotice={handleNotice}
          onError={handleError}
        />
      )}

      {activeSection === 'activities' && <ActivitiesTab store={store} />}

      {activeSection === 'actions' && (
        <ModerationActionsTab
          currentUser={currentUser}
          store={store}
          onNotice={handleNotice}
          onError={handleError}
        />
      )}

      {activeSection === 'announcements' && (
        <BroadcastsTab
          currentUser={currentUser}
          store={store}
          onNotice={handleNotice}
          onError={handleError}
        />
      )}

      {activeSection === 'support_inbox' && (
        <SupportInboxTab
          currentUser={currentUser}
          store={store}
          onNotice={handleNotice}
          onError={handleError}
        />
      )}

      {activeSection === 'past_questions' && (
        <PastQuestionsManagerTab
          currentUser={currentUser}
          store={store}
          onNotice={handleNotice}
          onError={handleError}
        />
      )}

      {activeSection === 'study_materials' && (
        <StudyMaterialsManagerTab
          currentUser={currentUser}
          store={store}
          onNotice={handleNotice}
          onError={handleError}
        />
      )}

      {activeSection === 'document_scanner' && (
        <DocumentScannerScreen
          currentUser={currentUser}
          onOpenReview={() => onSelectSection?.('document_review')}
        />
      )}

      {activeSection === 'document_review' && (
        <DocumentReviewTab
          currentUser={currentUser}
          store={store}
          onNotice={handleNotice}
          onError={handleError}
        />
      )}

      {activeSection === 'payments' && <PaymentsTab store={store} />}

      {activeSection === 'settings' && (
        <AdminSettingsTab
          currentUser={currentUser}
          store={store}
          selectedTarget={settingsTarget}
          onSelectTarget={onSelectSettingsTarget}
          onNotice={handleNotice}
          onError={handleError}
          onSignedOutReset={onSignedOutReset}
        />
      )}
    </div>
  );
};
