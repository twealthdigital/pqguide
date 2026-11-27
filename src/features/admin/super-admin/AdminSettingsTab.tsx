import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  BookOpen,
  Building2,
  ChevronRight,
  ClipboardCheck,
  CreditCard,
  FileText,
  Globe,
  HelpCircle,
  Home,
  Info,
  Layers,
  Lock,
  MessageSquare,
  RotateCcw,
  Save,
  Settings,
  TrendingUp,
  UploadCloud,
  Wrench,
} from 'lucide-react';
import { useBackHandler } from '../../../core/navGuard';
import type {
  AuthenticatedUser,
  SettingsUiTarget,
  SiteCmsConfig,
} from '../../../core/types';
import { archiveRepository, type AppStoreState } from '../../../services/archiveRepository';
import { authService, IS_DEV_BOOTSTRAP_ENV } from '../../../services/authService';
import {
  SectionHeadingBar,
  SurfaceCard,
  TactileButton,
  TooltipBubble,
} from '../../../components/ui';

interface AdminSettingsTabProps {
  currentUser: AuthenticatedUser;
  store: AppStoreState;
  selectedTarget: SettingsUiTarget;
  onSelectTarget: (target: SettingsUiTarget) => void;
  onNotice: (msg: string) => void;
  onError: (msg: string) => void;
  onSignedOutReset: () => void;
}

type NormalWebsitePageKey =
  | 'home'
  | 'past_questions'
  | 'materials'
  | 'mock_exam'
  | 'performance'
  | 'notifications'
  | 'subscription'
  | 'about'
  | 'services'
  | 'help'
  | 'support';

type UniAdminSectionKey = 'desk' | 'upload' | 'catalog';

const NORMAL_PAGES: Array<{
  key: NormalWebsitePageKey;
  title: string;
  subtitle: string;
  fieldsSummary: string;
  icon: React.ReactNode;
}> = [
  {
    key: 'home',
    title: 'Home',
    subtitle: 'Hero headline, search bar text, featured label & 3 quick-guide steps',
    fieldsSummary: '7 content fields',
    icon: <Home className="w-4 h-4" />,
  },
  {
    key: 'past_questions',
    title: 'Past Questions',
    subtitle: 'Directory page heading and descriptive subtitle',
    fieldsSummary: '2 content fields',
    icon: <FileText className="w-4 h-4" />,
  },
  {
    key: 'materials',
    title: 'Study Materials',
    subtitle: 'Study library title and intro subtitle',
    fieldsSummary: '2 content fields',
    icon: <BookOpen className="w-4 h-4" />,
  },
  {
    key: 'mock_exam',
    title: 'Practice Exam',
    subtitle: 'Intro eyebrow, main headline, and Take Exam intro write-up',
    fieldsSummary: '3 content fields',
    icon: <ClipboardCheck className="w-4 h-4" />,
  },
  {
    key: 'performance',
    title: 'Performance',
    subtitle: 'Exam history headings, empty state, and overall rating labels',
    fieldsSummary: '6 content fields',
    icon: <TrendingUp className="w-4 h-4" />,
  },
  {
    key: 'notifications',
    title: 'Notifications',
    subtitle: 'Student notification inbox heading and empty notice copy',
    fieldsSummary: '3 content fields',
    icon: <Bell className="w-4 h-4" />,
  },
  {
    key: 'subscription',
    title: 'Subscription Plans',
    subtitle: 'Plan heading, tier titles, and payment notice text',
    fieldsSummary: '6 content fields',
    icon: <CreditCard className="w-4 h-4" />,
  },
  {
    key: 'about',
    title: 'About',
    subtitle: 'Platform overview heading, lead text, and 3 story sections',
    fieldsSummary: '8 content fields',
    icon: <Info className="w-4 h-4" />,
  },
  {
    key: 'services',
    title: 'Services',
    subtitle: 'Services heading, lead text, and service item descriptions',
    fieldsSummary: '7 content fields',
    icon: <Layers className="w-4 h-4" />,
  },
  {
    key: 'help',
    title: 'Help',
    subtitle: 'Help title, step-by-step walkthrough lines, and FAQs',
    fieldsSummary: 'Steps & FAQs',
    icon: <HelpCircle className="w-4 h-4" />,
  },
  {
    key: 'support',
    title: 'Customer Support',
    subtitle: 'Contact email, WhatsApp, phone, hours, and form text',
    fieldsSummary: '8 content fields',
    icon: <MessageSquare className="w-4 h-4" />,
  },
];

const UNI_ADMIN_SECTIONS: Array<{
  key: UniAdminSectionKey;
  title: string;
  subtitle: string;
  fieldsSummary: string;
  icon: React.ReactNode;
}> = [
  {
    key: 'desk',
    title: 'School Desk Banner',
    subtitle: 'Top greeting label, headline ({SCHOOL} supported), and summary',
    fieldsSummary: '3 content fields',
    icon: <Building2 className="w-4 h-4" />,
  },
  {
    key: 'upload',
    title: 'Upload Panel',
    subtitle: 'Paper ingestion panel heading and supported file formats hint',
    fieldsSummary: '2 content fields',
    icon: <UploadCloud className="w-4 h-4" />,
  },
  {
    key: 'catalog',
    title: 'Past Questions Catalog',
    subtitle: 'Catalog section title ({SCHOOL} supported) and draft notice text',
    fieldsSummary: '2 content fields',
    icon: <FileText className="w-4 h-4" />,
  },
];

export const AdminSettingsTab: React.FC<AdminSettingsTabProps> = ({
  currentUser,
  store,
  selectedTarget,
  onSelectTarget,
  onNotice,
  onError,
  onSignedOutReset,
}) => {
  const [selectedPageKey, setSelectedPageKey] =
    useState<NormalWebsitePageKey | null>(null);
  const [selectedUniSection, setSelectedUniSection] =
    useState<UniAdminSectionKey | null>(null);
  const [draft, setDraft] = useState<SiteCmsConfig>(() => store.siteCms);
  const [devResetPhrase, setDevResetPhrase] = useState('');
  const [showDevReset, setShowDevReset] = useState(false);

  useEffect(() => {
    setDraft(store.siteCms);
  }, [store.siteCms]);

  useEffect(() => {
    setSelectedPageKey(null);
    setSelectedUniSection(null);
  }, [selectedTarget]);

  useBackHandler(
    selectedTarget === 'normal_website' && selectedPageKey !== null,
    () => setSelectedPageKey(null)
  );

  useBackHandler(
    selectedTarget === 'uni_admins' && selectedUniSection !== null,
    () => setSelectedUniSection(null)
  );

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      archiveRepository.updateSiteCms(currentUser, draft);
      onNotice('Saved live content updates across the selected website view.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unable to save content changes.');
    }
  };

  const handleReset = () => {
    try {
      const defaults = archiveRepository.resetSiteCms(currentUser);
      setDraft(defaults);
      onNotice('Restored default live copy across all website pages.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unable to reset defaults.');
    }
  };

  const handleClearSamples = () => {
    try {
      archiveRepository.clearSeedSamples(currentUser);
      onNotice('Starter demo samples cleared from archive.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Action denied.');
    }
  };

  const handleRestoreSamples = () => {
    try {
      archiveRepository.restoreDefaultCatalog(currentUser);
      onNotice('Default past questions and study materials catalog restored.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Action denied.');
    }
  };

  const handleDevReset = (e: React.FormEvent) => {
    e.preventDefault();
    const res = authService.resetLocalDevData(devResetPhrase, currentUser);
    if (!res.ok) {
      onError(res.error ?? 'Could not reset local dev data.');
      return;
    }
    setDevResetPhrase('');
    setShowDevReset(false);
    onSignedOutReset();
  };

  const inputCls =
    'w-full min-h-[42px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3.5 text-xs font-medium text-[#1A1B20]';
  const areaCls =
    'w-full rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 p-3 text-xs font-medium text-[#1A1B20] resize-y';

  const activeNormalPageMeta = NORMAL_PAGES.find((p) => p.key === selectedPageKey);
  const activeUniMeta = UNI_ADMIN_SECTIONS.find((s) => s.key === selectedUniSection);

  return (
    <div className="space-y-6">
      <form onSubmit={handleSave} className="space-y-5">
        {/* Dark Top Workspace Target Switcher */}
        <div className="rounded-3xl bg-[#1D1E23] p-5 sm:p-6 space-y-4 shadow-[0_14px_34px_-14px_rgba(20,21,28,0.45)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="h-9 w-9 rounded-xl bg-white/10 text-white flex items-center justify-center shrink-0">
                <Settings className="w-4 h-4" />
              </span>
              <div>
                <h2 className="font-display text-sm sm:text-base font-bold text-white">
                  UI Edits · Live Content Editor
                </h2>
                <p className="text-[11px] text-[#A5AAB8]">
                  Edit visible text and copy per page (layout styling and AI settings stay locked)
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <TooltipBubble label="Restore default copy across all pages">
                <TactileButton
                  type="button"
                  variant="light"
                  size="sm"
                  icon={<RotateCcw className="w-3.5 h-3.5" />}
                  onClick={handleReset}
                >
                  Reset
                </TactileButton>
              </TooltipBubble>

              <TooltipBubble label="Publish all edited content live">
                <TactileButton
                  type="submit"
                  variant="light"
                  size="sm"
                  icon={<Save className="w-3.5 h-3.5" />}
                >
                  Save Live
                </TactileButton>
              </TooltipBubble>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <button
              type="button"
              onClick={() => onSelectTarget('normal_website')}
              className={`min-h-[54px] rounded-2xl border px-4 py-2.5 text-left flex items-center gap-3 cursor-pointer transition-colors ${
                selectedTarget === 'normal_website'
                  ? 'border-white bg-white text-[#1A1B20]'
                  : 'border-white/10 bg-white/[0.06] text-white hover:bg-white/10'
              }`}
            >
              <Globe className="w-4 h-4 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-bold truncate">Normal Website</p>
                <p
                  className={`text-[11px] truncate ${
                    selectedTarget === 'normal_website' ? 'text-[#505460]' : 'text-[#A5AAB8]'
                  }`}
                >
                  11 student &amp; public pages
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => onSelectTarget('uni_admins')}
              className={`min-h-[54px] rounded-2xl border px-4 py-2.5 text-left flex items-center gap-3 cursor-pointer transition-colors ${
                selectedTarget === 'uni_admins'
                  ? 'border-white bg-white text-[#1A1B20]'
                  : 'border-white/10 bg-white/[0.06] text-white hover:bg-white/10'
              }`}
            >
              <UploadCloud className="w-4 h-4 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-bold truncate">Uni Administrators</p>
                <p
                  className={`text-[11px] truncate ${
                    selectedTarget === 'uni_admins' ? 'text-[#505460]' : 'text-[#A5AAB8]'
                  }`}
                >
                  3 school admin workspace panels
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => onSelectTarget('company_admins')}
              className={`min-h-[54px] rounded-2xl border px-4 py-2.5 text-left flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                selectedTarget === 'company_admins'
                  ? 'border-white bg-white text-[#1A1B20]'
                  : 'border-white/10 bg-white/[0.06] text-white hover:bg-white/10'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <Lock className="w-4 h-4 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-bold truncate">Company Administrators</p>
                  <p
                    className={`text-[11px] truncate ${
                      selectedTarget === 'company_admins' ? 'text-[#505460]' : 'text-[#A5AAB8]'
                    }`}
                  >
                    Locked for now
                  </p>
                </div>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold shrink-0 ${
                  selectedTarget === 'company_admins'
                    ? 'bg-[#1D1E23] text-white'
                    : 'bg-white/10 text-[#C3C7D2]'
                }`}
              >
                Locked
              </span>
            </button>
          </div>

          {store.siteCms.updatedAt && (
            <p className="text-[11px] text-[#A5AAB8] font-mono-tabular px-1">
              Last published {new Date(store.siteCms.updatedAt).toLocaleString()}
              {store.siteCms.updatedBy ? ` by ${store.siteCms.updatedBy}` : ''}
            </p>
          )}
        </div>

        {/* TARGET 1: NORMAL WEBSITE */}
        {selectedTarget === 'normal_website' && (
          <SurfaceCard tone="white" className="p-5 sm:p-6 space-y-5">
            {!selectedPageKey ? (
              <>
                <SectionHeadingBar
                  icon={<Globe className="w-4 h-4" />}
                  title="Normal Website Pages (11)"
                />
                <p className="text-xs text-[#686C78]">
                  Click any page below to open and edit its headings, labels, and readable text content.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {NORMAL_PAGES.map((pg) => (
                    <button
                      key={pg.key}
                      type="button"
                      onClick={() => setSelectedPageKey(pg.key)}
                      className="rounded-2xl bg-[#F6F7F9] hover:bg-[#ECEEF3] border border-[#1A1B20]/[0.07] p-4 text-left flex items-start justify-between gap-3 cursor-pointer transition-colors"
                    >
                      <div className="space-y-1.5 min-w-0">
                        <div className="flex items-center gap-2 text-[#1A1B20]">
                          <span className="h-7 w-7 rounded-xl bg-white border border-[#1A1B20]/[0.08] flex items-center justify-center shrink-0">
                            {pg.icon}
                          </span>
                          <p className="font-display text-sm font-bold truncate">
                            {pg.title}
                          </p>
                        </div>
                        <p className="text-xs text-[#505460] leading-relaxed">
                          {pg.subtitle}
                        </p>
                        <p className="text-[11px] font-mono-tabular text-[#686C78]">
                          {pg.fieldsSummary}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#686C78] shrink-0 mt-1" />
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#1A1B20]/[0.07]">
                  <button
                    type="button"
                    onClick={() => setSelectedPageKey(null)}
                    className="min-h-[38px] px-3.5 rounded-xl bg-[#F6F7F9] hover:bg-[#ECEEF3] text-xs font-bold text-[#1A1B20] inline-flex items-center gap-2 cursor-pointer transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>All Normal Website Pages</span>
                  </button>

                  {activeNormalPageMeta && (
                    <div className="flex items-center gap-2 text-xs font-bold text-[#1A1B20]">
                      {activeNormalPageMeta.icon}
                      <span>{activeNormalPageMeta.title} Content</span>
                    </div>
                  )}
                </div>

                {selectedPageKey === 'home' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Hero Headline
                      </label>
                      <input
                        type="text"
                        value={draft.studentUi.homeHeroTitle}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            studentUi: { ...p.studentUi, homeHeroTitle: e.target.value },
                          }))
                        }
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Search Bar Placeholder
                      </label>
                      <input
                        type="text"
                        value={draft.studentUi.homeSearchPlaceholder}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            studentUi: {
                              ...p.studentUi,
                              homeSearchPlaceholder: e.target.value,
                            },
                          }))
                        }
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Featured Courses Heading
                      </label>
                      <input
                        type="text"
                        value={draft.studentUi.featuredHeading}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            studentUi: { ...p.studentUi, featuredHeading: e.target.value },
                          }))
                        }
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Quick Guide Card Title
                      </label>
                      <input
                        type="text"
                        value={draft.studentUi.guideTitle}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            studentUi: { ...p.studentUi, guideTitle: e.target.value },
                          }))
                        }
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Guide Step 1
                      </label>
                      <input
                        type="text"
                        value={draft.studentUi.guideStep1}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            studentUi: { ...p.studentUi, guideStep1: e.target.value },
                          }))
                        }
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Guide Step 2
                      </label>
                      <input
                        type="text"
                        value={draft.studentUi.guideStep2}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            studentUi: { ...p.studentUi, guideStep2: e.target.value },
                          }))
                        }
                        className={inputCls}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Guide Step 3
                      </label>
                      <input
                        type="text"
                        value={draft.studentUi.guideStep3}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            studentUi: { ...p.studentUi, guideStep3: e.target.value },
                          }))
                        }
                        className={inputCls}
                      />
                    </div>
                  </div>
                )}

                {selectedPageKey === 'past_questions' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Past Questions Page Title
                      </label>
                      <input
                        type="text"
                        value={draft.studentUi.pastQuestionsTitle}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            studentUi: {
                              ...p.studentUi,
                              pastQuestionsTitle: e.target.value,
                              pastQuestionsHeading: e.target.value,
                            },
                          }))
                        }
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Past Questions Subtitle
                      </label>
                      <textarea
                        rows={2}
                        value={draft.studentUi.pastQuestionsSubtitle}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            studentUi: {
                              ...p.studentUi,
                              pastQuestionsSubtitle: e.target.value,
                            },
                          }))
                        }
                        className={areaCls}
                      />
                    </div>
                  </div>
                )}

                {selectedPageKey === 'materials' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Study Materials Title
                      </label>
                      <input
                        type="text"
                        value={draft.studentUi.materialsTitle}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            studentUi: { ...p.studentUi, materialsTitle: e.target.value },
                          }))
                        }
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Study Materials Subtitle
                      </label>
                      <textarea
                        rows={2}
                        value={draft.studentUi.materialsSubtitle}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            studentUi: {
                              ...p.studentUi,
                              materialsSubtitle: e.target.value,
                            },
                          }))
                        }
                        className={areaCls}
                      />
                    </div>
                  </div>
                )}

                {selectedPageKey === 'mock_exam' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Intro Eyebrow Label
                      </label>
                      <input
                        type="text"
                        value={draft.studentUi.mockExamEyebrow}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            studentUi: { ...p.studentUi, mockExamEyebrow: e.target.value },
                          }))
                        }
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Practice Exam Main Heading
                      </label>
                      <input
                        type="text"
                        value={draft.studentUi.mockExamHeadline}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            studentUi: { ...p.studentUi, mockExamHeadline: e.target.value },
                          }))
                        }
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Intro Write-up (shown before Take Exam)
                      </label>
                      <textarea
                        rows={3}
                        value={draft.studentUi.mockExamDescription}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            studentUi: {
                              ...p.studentUi,
                              mockExamDescription: e.target.value,
                            },
                          }))
                        }
                        className={areaCls}
                      />
                    </div>
                  </div>
                )}

                {selectedPageKey === 'performance' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Page Heading
                      </label>
                      <input
                        type="text"
                        value={draft.performancePage.heading}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            performancePage: {
                              ...p.performancePage,
                              heading: e.target.value,
                            },
                          }))
                        }
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Combined Rating Label
                      </label>
                      <input
                        type="text"
                        value={draft.performancePage.combinedLabel}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            performancePage: {
                              ...p.performancePage,
                              combinedLabel: e.target.value,
                            },
                          }))
                        }
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Empty State Title
                      </label>
                      <input
                        type="text"
                        value={draft.performancePage.emptyTitle}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            performancePage: {
                              ...p.performancePage,
                              emptyTitle: e.target.value,
                            },
                          }))
                        }
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Overall Rating Heading
                      </label>
                      <input
                        type="text"
                        value={draft.performancePage.overallHeading}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            performancePage: {
                              ...p.performancePage,
                              overallHeading: e.target.value,
                            },
                          }))
                        }
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Empty State Description
                      </label>
                      <textarea
                        rows={2}
                        value={draft.performancePage.emptyBody}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            performancePage: {
                              ...p.performancePage,
                              emptyBody: e.target.value,
                            },
                          }))
                        }
                        className={areaCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Overall Rating Subtitle
                      </label>
                      <textarea
                        rows={2}
                        value={draft.performancePage.overallSubtitle}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            performancePage: {
                              ...p.performancePage,
                              overallSubtitle: e.target.value,
                            },
                          }))
                        }
                        className={areaCls}
                      />
                    </div>
                  </div>
                )}

                {selectedPageKey === 'notifications' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Student Notifications Heading
                      </label>
                      <input
                        type="text"
                        value={draft.notificationsPage.heading}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            notificationsPage: {
                              ...p.notificationsPage,
                              heading: e.target.value,
                            },
                          }))
                        }
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Empty State Title
                      </label>
                      <input
                        type="text"
                        value={draft.notificationsPage.emptyTitle}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            notificationsPage: {
                              ...p.notificationsPage,
                              emptyTitle: e.target.value,
                            },
                          }))
                        }
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Empty State Message
                      </label>
                      <textarea
                        rows={2}
                        value={draft.notificationsPage.emptyBody}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            notificationsPage: {
                              ...p.notificationsPage,
                              emptyBody: e.target.value,
                            },
                          }))
                        }
                        className={areaCls}
                      />
                    </div>
                  </div>
                )}

                {selectedPageKey === 'subscription' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Plans Heading
                      </label>
                      <input
                        type="text"
                        value={draft.subscriptionPage.heading}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            subscriptionPage: {
                              ...p.subscriptionPage,
                              heading: e.target.value,
                            },
                          }))
                        }
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Plans Subtitle
                      </label>
                      <input
                        type="text"
                        value={draft.subscriptionPage.subtitle}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            subscriptionPage: {
                              ...p.subscriptionPage,
                              subtitle: e.target.value,
                            },
                          }))
                        }
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Tier 1 Title (Free Access)
                      </label>
                      <input
                        type="text"
                        value={draft.subscriptionPage.freeTierName}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            subscriptionPage: {
                              ...p.subscriptionPage,
                              freeTierName: e.target.value,
                            },
                          }))
                        }
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Tier 2 Title (Standard Dark Card)
                      </label>
                      <input
                        type="text"
                        value={draft.subscriptionPage.standardTierName}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            subscriptionPage: {
                              ...p.subscriptionPage,
                              standardTierName: e.target.value,
                            },
                          }))
                        }
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Tier 3 Title (AI Companion)
                      </label>
                      <input
                        type="text"
                        value={draft.subscriptionPage.aiTierName}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            subscriptionPage: {
                              ...p.subscriptionPage,
                              aiTierName: e.target.value,
                            },
                          }))
                        }
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Checkout Verification Note
                      </label>
                      <input
                        type="text"
                        value={draft.subscriptionPage.checkoutNote}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            subscriptionPage: {
                              ...p.subscriptionPage,
                              checkoutNote: e.target.value,
                            },
                          }))
                        }
                        className={inputCls}
                      />
                    </div>
                  </div>
                )}

                {selectedPageKey === 'about' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                      <div>
                        <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                          Eyebrow
                        </label>
                        <input
                          type="text"
                          value={draft.aboutPage.eyebrow}
                          onChange={(e) =>
                            setDraft((p) => ({
                              ...p,
                              aboutPage: { ...p.aboutPage, eyebrow: e.target.value },
                            }))
                          }
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                          Heading
                        </label>
                        <input
                          type="text"
                          value={draft.aboutPage.heading}
                          onChange={(e) =>
                            setDraft((p) => ({
                              ...p,
                              aboutPage: { ...p.aboutPage, heading: e.target.value },
                            }))
                          }
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                          Lead Subtitle
                        </label>
                        <input
                          type="text"
                          value={draft.aboutPage.lead}
                          onChange={(e) =>
                            setDraft((p) => ({
                              ...p,
                              aboutPage: { ...p.aboutPage, lead: e.target.value },
                            }))
                          }
                          className={inputCls}
                        />
                      </div>
                    </div>

                    {(
                      [
                        ['card1Title', 'card1Body', 'Section 1'],
                        ['card2Title', 'card2Body', 'Section 2'],
                        ['card3Title', 'card3Body', 'Section 3'],
                      ] as const
                    ).map(([titleKey, bodyKey, label]) => (
                      <div
                        key={label}
                        className="rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/[0.06] p-3.5 space-y-2.5"
                      >
                        <p className="text-[11px] font-bold text-[#686C78] uppercase">
                          {label}
                        </p>
                        <input
                          type="text"
                          value={draft.aboutPage[titleKey]}
                          onChange={(e) =>
                            setDraft((p) => ({
                              ...p,
                              aboutPage: { ...p.aboutPage, [titleKey]: e.target.value },
                            }))
                          }
                          className="w-full min-h-[38px] rounded-xl bg-white border border-[#1A1B20]/10 px-3 text-xs font-semibold"
                        />
                        <textarea
                          rows={2}
                          value={draft.aboutPage[bodyKey]}
                          onChange={(e) =>
                            setDraft((p) => ({
                              ...p,
                              aboutPage: { ...p.aboutPage, [bodyKey]: e.target.value },
                            }))
                          }
                          className="w-full rounded-xl bg-white border border-[#1A1B20]/10 p-2.5 text-xs resize-y"
                        />
                      </div>
                    ))}
                  </div>
                )}

                {selectedPageKey === 'services' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                      <div>
                        <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                          Eyebrow
                        </label>
                        <input
                          type="text"
                          value={draft.servicesPage.eyebrow}
                          onChange={(e) =>
                            setDraft((p) => ({
                              ...p,
                              servicesPage: { ...p.servicesPage, eyebrow: e.target.value },
                            }))
                          }
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                          Services Heading
                        </label>
                        <input
                          type="text"
                          value={draft.servicesPage.heading}
                          onChange={(e) =>
                            setDraft((p) => ({
                              ...p,
                              servicesPage: { ...p.servicesPage, heading: e.target.value },
                            }))
                          }
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                          Lead Subtitle
                        </label>
                        <input
                          type="text"
                          value={draft.servicesPage.lead}
                          onChange={(e) =>
                            setDraft((p) => ({
                              ...p,
                              servicesPage: { ...p.servicesPage, lead: e.target.value },
                            }))
                          }
                          className={inputCls}
                        />
                      </div>
                    </div>

                    <div className="space-y-2.5">
                      {draft.servicesPage.items.map((item, idx) => (
                        <div
                          key={idx}
                          className="rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/[0.06] p-3.5 space-y-2"
                        >
                          <input
                            type="text"
                            value={item.title}
                            onChange={(e) =>
                              setDraft((p) => ({
                                ...p,
                                servicesPage: {
                                  ...p.servicesPage,
                                  items: p.servicesPage.items.map((it, i) =>
                                    i === idx ? { ...it, title: e.target.value } : it
                                  ),
                                },
                              }))
                            }
                            className="w-full min-h-[38px] rounded-xl bg-white border border-[#1A1B20]/10 px-3 text-xs font-semibold"
                          />
                          <textarea
                            rows={2}
                            value={item.description}
                            onChange={(e) =>
                              setDraft((p) => ({
                                ...p,
                                servicesPage: {
                                  ...p.servicesPage,
                                  items: p.servicesPage.items.map((it, i) =>
                                    i === idx
                                      ? { ...it, description: e.target.value }
                                      : it
                                  ),
                                },
                              }))
                            }
                            className="w-full rounded-xl bg-white border border-[#1A1B20]/10 p-2.5 text-xs resize-y"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedPageKey === 'help' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                      <div>
                        <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                          Eyebrow
                        </label>
                        <input
                          type="text"
                          value={draft.helpPage.eyebrow}
                          onChange={(e) =>
                            setDraft((p) => ({
                              ...p,
                              helpPage: { ...p.helpPage, eyebrow: e.target.value },
                            }))
                          }
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                          Help Heading
                        </label>
                        <input
                          type="text"
                          value={draft.helpPage.heading}
                          onChange={(e) =>
                            setDraft((p) => ({
                              ...p,
                              helpPage: { ...p.helpPage, heading: e.target.value },
                            }))
                          }
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                          Subtitle
                        </label>
                        <input
                          type="text"
                          value={draft.helpPage.lead}
                          onChange={(e) =>
                            setDraft((p) => ({
                              ...p,
                              helpPage: { ...p.helpPage, lead: e.target.value },
                            }))
                          }
                          className={inputCls}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        How It Works Steps (one step per line)
                      </label>
                      <textarea
                        rows={5}
                        value={draft.helpPage.howItWorks.join('\n')}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            helpPage: {
                              ...p.helpPage,
                              howItWorks: e.target.value.split(/\r?\n/),
                            },
                          }))
                        }
                        className={areaCls}
                      />
                    </div>

                    <div className="space-y-2.5">
                      <p className="text-xs font-bold text-[#1A1B20]">
                        Frequently Asked Questions
                      </p>
                      {draft.helpPage.faqs.map((faq, idx) => (
                        <div
                          key={idx}
                          className="rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/[0.06] p-3.5 space-y-2"
                        >
                          <input
                            type="text"
                            value={faq.question}
                            onChange={(e) =>
                              setDraft((p) => ({
                                ...p,
                                helpPage: {
                                  ...p.helpPage,
                                  faqs: p.helpPage.faqs.map((f, i) =>
                                    i === idx ? { ...f, question: e.target.value } : f
                                  ),
                                },
                              }))
                            }
                            className="w-full min-h-[38px] rounded-xl bg-white border border-[#1A1B20]/10 px-3 text-xs font-semibold"
                          />
                          <textarea
                            rows={2}
                            value={faq.answer}
                            onChange={(e) =>
                              setDraft((p) => ({
                                ...p,
                                helpPage: {
                                  ...p.helpPage,
                                  faqs: p.helpPage.faqs.map((f, i) =>
                                    i === idx ? { ...f, answer: e.target.value } : f
                                  ),
                                },
                              }))
                            }
                            className="w-full rounded-xl bg-white border border-[#1A1B20]/10 p-2.5 text-xs resize-y"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedPageKey === 'support' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Support Heading
                      </label>
                      <input
                        type="text"
                        value={draft.supportPage.heading}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            supportPage: { ...p.supportPage, heading: e.target.value },
                          }))
                        }
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Lead Subtitle
                      </label>
                      <input
                        type="text"
                        value={draft.supportPage.lead}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            supportPage: { ...p.supportPage, lead: e.target.value },
                          }))
                        }
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Support Email
                      </label>
                      <input
                        type="email"
                        value={draft.supportPage.email}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            supportPage: { ...p.supportPage, email: e.target.value },
                          }))
                        }
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        WhatsApp Number
                      </label>
                      <input
                        type="text"
                        value={draft.supportPage.whatsappNumber}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            supportPage: {
                              ...p.supportPage,
                              whatsappNumber: e.target.value,
                            },
                          }))
                        }
                        placeholder="2348012345678"
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Phone Number
                      </label>
                      <input
                        type="text"
                        value={draft.supportPage.phone}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            supportPage: { ...p.supportPage, phone: e.target.value },
                          }))
                        }
                        placeholder="+234 800 000 0000"
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Support Hours
                      </label>
                      <input
                        type="text"
                        value={draft.supportPage.hours}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            supportPage: { ...p.supportPage, hours: e.target.value },
                          }))
                        }
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Form Heading
                      </label>
                      <input
                        type="text"
                        value={draft.supportPage.formTitle}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            supportPage: { ...p.supportPage, formTitle: e.target.value },
                          }))
                        }
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Form Subtitle
                      </label>
                      <input
                        type="text"
                        value={draft.supportPage.formSubtitle}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            supportPage: {
                              ...p.supportPage,
                              formSubtitle: e.target.value,
                            },
                          }))
                        }
                        className={inputCls}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </SurfaceCard>
        )}

        {/* TARGET 2: UNI ADMINISTRATORS */}
        {selectedTarget === 'uni_admins' && (
          <SurfaceCard tone="white" className="p-5 sm:p-6 space-y-5">
            {!selectedUniSection ? (
              <>
                <SectionHeadingBar
                  icon={<UploadCloud className="w-4 h-4" />}
                  title="Uni Administrators Workspace Panels"
                />
                <p className="text-xs text-[#686C78]">
                  Select any School Administrator panel below to edit its headings and helper messages.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {UNI_ADMIN_SECTIONS.map((sec) => (
                    <button
                      key={sec.key}
                      type="button"
                      onClick={() => setSelectedUniSection(sec.key)}
                      className="rounded-2xl bg-[#F6F7F9] hover:bg-[#ECEEF3] border border-[#1A1B20]/[0.07] p-4 text-left flex items-start justify-between gap-3 cursor-pointer transition-colors"
                    >
                      <div className="space-y-1.5 min-w-0">
                        <div className="flex items-center gap-2 text-[#1A1B20]">
                          <span className="h-7 w-7 rounded-xl bg-white border border-[#1A1B20]/[0.08] flex items-center justify-center shrink-0">
                            {sec.icon}
                          </span>
                          <p className="font-display text-sm font-bold truncate">
                            {sec.title}
                          </p>
                        </div>
                        <p className="text-xs text-[#505460] leading-relaxed">
                          {sec.subtitle}
                        </p>
                        <p className="text-[11px] font-mono-tabular text-[#686C78]">
                          {sec.fieldsSummary}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#686C78] shrink-0 mt-1" />
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#1A1B20]/[0.07]">
                  <button
                    type="button"
                    onClick={() => setSelectedUniSection(null)}
                    className="min-h-[38px] px-3.5 rounded-xl bg-[#F6F7F9] hover:bg-[#ECEEF3] text-xs font-bold text-[#1A1B20] inline-flex items-center gap-2 cursor-pointer transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>All Uni Admin Panels</span>
                  </button>

                  {activeUniMeta && (
                    <div className="flex items-center gap-2 text-xs font-bold text-[#1A1B20]">
                      {activeUniMeta.icon}
                      <span>{activeUniMeta.title} Content</span>
                    </div>
                  )}
                </div>

                {selectedUniSection === 'desk' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Desk Label
                      </label>
                      <input
                        type="text"
                        value={draft.schoolAdminUi.deskLabel}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            schoolAdminUi: {
                              ...p.schoolAdminUi,
                              deskLabel: e.target.value,
                            },
                          }))
                        }
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Desk Headline ({'{SCHOOL}'} shows school code)
                      </label>
                      <input
                        type="text"
                        value={draft.schoolAdminUi.deskHeadline}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            schoolAdminUi: {
                              ...p.schoolAdminUi,
                              deskHeadline: e.target.value,
                            },
                          }))
                        }
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Desk Description
                      </label>
                      <textarea
                        rows={2}
                        value={draft.schoolAdminUi.deskDescription}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            schoolAdminUi: {
                              ...p.schoolAdminUi,
                              deskDescription: e.target.value,
                            },
                          }))
                        }
                        className={areaCls}
                      />
                    </div>
                  </div>
                )}

                {selectedUniSection === 'upload' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Upload Panel Title
                      </label>
                      <input
                        type="text"
                        value={draft.schoolAdminUi.uploadPanelTitle}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            schoolAdminUi: {
                              ...p.schoolAdminUi,
                              uploadPanelTitle: e.target.value,
                            },
                          }))
                        }
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Supported Formats Hint
                      </label>
                      <input
                        type="text"
                        value={draft.schoolAdminUi.uploadPanelHint}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            schoolAdminUi: {
                              ...p.schoolAdminUi,
                              uploadPanelHint: e.target.value,
                            },
                          }))
                        }
                        className={inputCls}
                      />
                    </div>
                  </div>
                )}

                {selectedUniSection === 'catalog' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Catalog Panel Heading ({'{SCHOOL}'} shows school code)
                      </label>
                      <input
                        type="text"
                        value={draft.schoolAdminUi.catalogPanelTitle}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            schoolAdminUi: {
                              ...p.schoolAdminUi,
                              catalogPanelTitle: e.target.value,
                            },
                          }))
                        }
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#505460] mb-1.5">
                        Draft Visibility Notice
                      </label>
                      <textarea
                        rows={2}
                        value={draft.schoolAdminUi.draftNotice}
                        onChange={(e) =>
                          setDraft((p) => ({
                            ...p,
                            schoolAdminUi: {
                              ...p.schoolAdminUi,
                              draftNotice: e.target.value,
                            },
                          }))
                        }
                        className={areaCls}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </SurfaceCard>
        )}

        {/* TARGET 3: COMPANY ADMINISTRATORS (LOCKED) */}
        {selectedTarget === 'company_admins' && (
          <SurfaceCard tone="white" className="p-8 text-center space-y-3">
            <span className="h-12 w-12 rounded-2xl bg-[#1D1E23] text-white inline-flex items-center justify-center mx-auto">
              <Lock className="w-5 h-5" />
            </span>
            <h3 className="font-display text-base sm:text-lg font-bold text-[#1A1B20]">
              Company Administrators UI Edits Locked
            </h3>
            <p className="text-xs sm:text-sm text-[#505460] max-w-md mx-auto leading-relaxed">
              This section stays locked for now. You can edit all live text for Normal Website and Uni Administrators while Company Administrator controls await activation.
            </p>
          </SurfaceCard>
        )}
      </form>

      {/* Dataset & Development Controls (moved out of Overview into Settings) */}
      <SurfaceCard tone="white" className="p-5 sm:p-6 space-y-4">
        <SectionHeadingBar
          icon={<Wrench className="w-4 h-4" />}
          title="Dataset &amp; Development Controls"
          right={
            <div className="flex flex-wrap gap-2">
              <TooltipBubble label="Remove starter sample past questions & materials">
                <TactileButton variant="light" size="sm" onClick={handleClearSamples}>
                  Clear Samples
                </TactileButton>
              </TooltipBubble>
              <TooltipBubble label="Restore starter past question & material catalog">
                <TactileButton variant="light" size="sm" onClick={handleRestoreSamples}>
                  Restore Catalog
                </TactileButton>
              </TooltipBubble>
            </div>
          }
        />

        {import.meta.env.DEV && IS_DEV_BOOTSTRAP_ENV && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-bold text-[#1A1B20]">
                Reset Local Development Data
              </p>
              <button
                type="button"
                onClick={() => setShowDevReset((v) => !v)}
                className="min-h-[36px] px-3 rounded-xl bg-[#FEF2F2] text-[#B91C1C] text-xs font-semibold inline-flex items-center gap-1 cursor-pointer shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{showDevReset ? 'Cancel' : 'Reset Dev'}</span>
              </button>
            </div>

            {showDevReset && (
              <form
                onSubmit={handleDevReset}
                className="rounded-2xl bg-[#F6F7F9] border border-[#1A1B20]/10 p-3.5 space-y-2.5"
              >
                <p className="text-[11px] text-[#505460]">
                  Type{' '}
                  <span className="font-mono-tabular font-bold text-[#1A1B20]">
                    RESET DEV DATA
                  </span>{' '}
                  to confirm.
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={devResetPhrase}
                    onChange={(e) => setDevResetPhrase(e.target.value)}
                    placeholder="RESET DEV DATA"
                    className="flex-1 min-h-[38px] rounded-xl bg-white border border-[#1A1B20]/15 px-3 text-xs font-mono-tabular"
                  />
                  <TactileButton type="submit" variant="dark" size="sm">
                    Confirm
                  </TactileButton>
                </div>
              </form>
            )}
          </div>
        )}
      </SurfaceCard>
    </div>
  );
};
