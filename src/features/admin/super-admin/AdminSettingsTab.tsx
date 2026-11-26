import React, { useEffect, useState } from 'react';
import { Globe, Layers, RotateCcw, Save, Settings, UploadCloud } from 'lucide-react';
import type { AuthenticatedUser, SiteCmsConfig } from '../../../core/types';
import { archiveRepository, type AppStoreState } from '../../../services/archiveRepository';
import { SectionHeadingBar, SurfaceCard, TactileButton } from '../../../components/ui';

interface AdminSettingsTabProps {
  currentUser: AuthenticatedUser;
  store: AppStoreState;
  onNotice: (msg: string) => void;
  onError: (msg: string) => void;
}

type SettingsArea = 'student_ui' | 'school_admin_ui' | 'shared_pages';
type SharedSubPage = 'about' | 'services' | 'help' | 'support';

export const AdminSettingsTab: React.FC<AdminSettingsTabProps> = ({
  currentUser,
  store,
  onNotice,
  onError,
}) => {
  const [area, setArea] = useState<SettingsArea>('student_ui');
  const [sharedPage, setSharedPage] = useState<SharedSubPage>('about');
  const [draft, setDraft] = useState<SiteCmsConfig>(() => store.siteCms);

  useEffect(() => {
    setDraft(store.siteCms);
  }, [store.siteCms]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      archiveRepository.updateSiteCms(currentUser, draft);
      onNotice('Saved live Website UI & constant page settings across all views.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unable to save UI settings.');
    }
  };

  const handleReset = () => {
    try {
      const defaults = archiveRepository.resetSiteCms(currentUser);
      setDraft(defaults);
      onNotice('Restored default Student UI, School Admin UI, and constant pages.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unable to reset defaults.');
    }
  };

  const inputCls =
    'w-full min-h-[40px] rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 px-3 text-xs font-medium text-[#1A1B20]';
  const areaCls =
    'w-full rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/10 p-3 text-xs font-medium text-[#1A1B20] resize-y';

  return (
    <form onSubmit={handleSave} className="space-y-5">
      <SurfaceCard tone="white" className="p-5 sm:p-6 space-y-4">
        <SectionHeadingBar
          icon={<Settings className="w-4 h-4" />}
          title="Live Website UI & Constant Pages"
          right={
            <div className="flex flex-wrap gap-2">
              <TactileButton
                type="button"
                variant="light"
                size="sm"
                icon={<RotateCcw className="w-3.5 h-3.5" />}
                onClick={handleReset}
              >
                Reset
              </TactileButton>
              <TactileButton
                type="submit"
                variant="light"
                size="sm"
                icon={<Save className="w-3.5 h-3.5" />}
              >
                Save Live
              </TactileButton>
            </div>
          }
        />

        {/* Switch between the 2 Separate Website UIs & Shared Constant Pages */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
          <button
            type="button"
            onClick={() => setArea('student_ui')}
            className={`min-h-[54px] rounded-2xl border px-4 py-2.5 text-left flex items-center gap-3 cursor-pointer transition-colors ${
              area === 'student_ui'
                ? 'border-[#1D1E23] bg-[#1D1E23] text-white'
                : 'border-[#1A1B20]/10 bg-[#F6F7F9] text-[#1A1B20] hover:bg-[#ECEEF3]'
            }`}
          >
            <Globe className="w-4 h-4 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-bold truncate">1. Student Website UI</p>
              <p className={`text-[11px] truncate ${area === 'student_ui' ? 'text-[#C3C7D2]' : 'text-[#686C78]'}`}>
                Home, PQs, Materials &amp; Mock Exam
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setArea('school_admin_ui')}
            className={`min-h-[54px] rounded-2xl border px-4 py-2.5 text-left flex items-center gap-3 cursor-pointer transition-colors ${
              area === 'school_admin_ui'
                ? 'border-[#1D1E23] bg-[#1D1E23] text-white'
                : 'border-[#1A1B20]/10 bg-[#F6F7F9] text-[#1A1B20] hover:bg-[#ECEEF3]'
            }`}
          >
            <UploadCloud className="w-4 h-4 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-bold truncate">2. School Admin Website UI</p>
              <p className={`text-[11px] truncate ${area === 'school_admin_ui' ? 'text-[#C3C7D2]' : 'text-[#686C78]'}`}>
                Ingestion desk banners &amp; hints
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setArea('shared_pages')}
            className={`min-h-[54px] rounded-2xl border px-4 py-2.5 text-left flex items-center gap-3 cursor-pointer transition-colors ${
              area === 'shared_pages'
                ? 'border-[#1D1E23] bg-[#1D1E23] text-white'
                : 'border-[#1A1B20]/10 bg-[#F6F7F9] text-[#1A1B20] hover:bg-[#ECEEF3]'
            }`}
          >
            <Layers className="w-4 h-4 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-bold truncate">Shared Pages (Constant)</p>
              <p className={`text-[11px] truncate ${area === 'shared_pages' ? 'text-[#C3C7D2]' : 'text-[#686C78]'}`}>
                About · Services · Help · Support
              </p>
            </div>
          </button>
        </div>

        {store.siteCms.updatedAt && (
          <p className="text-[11px] text-[#686C78] font-mono-tabular">
            Last saved {new Date(store.siteCms.updatedAt).toLocaleString()}
            {store.siteCms.updatedBy ? ` by ${store.siteCms.updatedBy}` : ''}
          </p>
        )}
      </SurfaceCard>

      {area === 'student_ui' && (
        <SurfaceCard tone="white" className="p-5 sm:p-6 space-y-4">
          <SectionHeadingBar
            icon={<Globe className="w-4 h-4" />}
            title="Student Website Copy & Headings"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-medium text-[#686C78] mb-1">
                Home Hero Title
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
              <label className="block text-xs font-medium text-[#686C78] mb-1">
                Home Search Placeholder
              </label>
              <input
                type="text"
                value={draft.studentUi.homeSearchPlaceholder}
                onChange={(e) =>
                  setDraft((p) => ({
                    ...p,
                    studentUi: { ...p.studentUi, homeSearchPlaceholder: e.target.value },
                  }))
                }
                className={inputCls}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#686C78] mb-1">
                Featured Section Heading
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
              <label className="block text-xs font-medium text-[#686C78] mb-1">
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

            <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#686C78] mb-1">
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
                <label className="block text-xs font-medium text-[#686C78] mb-1">
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
              <div>
                <label className="block text-xs font-medium text-[#686C78] mb-1">
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

            <div>
              <label className="block text-xs font-medium text-[#686C78] mb-1">
                Past Questions Header Title
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
              <label className="block text-xs font-medium text-[#686C78] mb-1">
                Materials Header Title
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
              <label className="block text-xs font-medium text-[#686C78] mb-1">
                Practice Exam Banner Title
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
              <label className="block text-xs font-medium text-[#686C78] mb-1">
                Materials Subtitle
              </label>
              <input
                type="text"
                value={draft.studentUi.materialsSubtitle}
                onChange={(e) =>
                  setDraft((p) => ({
                    ...p,
                    studentUi: { ...p.studentUi, materialsSubtitle: e.target.value },
                  }))
                }
                className={inputCls}
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-[#686C78] mb-1">
                Practice Exam Intro Description (shown before Take Exam)
              </label>
              <textarea
                rows={2}
                value={draft.studentUi.mockExamDescription}
                onChange={(e) =>
                  setDraft((p) => ({
                    ...p,
                    studentUi: { ...p.studentUi, mockExamDescription: e.target.value },
                  }))
                }
                className={areaCls}
              />
            </div>
          </div>
        </SurfaceCard>
      )}

      {area === 'school_admin_ui' && (
        <SurfaceCard tone="white" className="p-5 sm:p-6 space-y-4">
          <SectionHeadingBar
            icon={<UploadCloud className="w-4 h-4" />}
            title="School Admin Website Copy"
          />
          <div className="space-y-3.5">
            <div>
              <label className="block text-xs font-medium text-[#686C78] mb-1">
                Desk Label
              </label>
              <input
                type="text"
                value={draft.schoolAdminUi.deskLabel}
                onChange={(e) =>
                  setDraft((p) => ({
                    ...p,
                    schoolAdminUi: { ...p.schoolAdminUi, deskLabel: e.target.value },
                  }))
                }
                className={inputCls}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#686C78] mb-1">
                Desk Headline (use {'{SCHOOL}'} for university code placeholder)
              </label>
              <input
                type="text"
                value={draft.schoolAdminUi.deskHeadline}
                onChange={(e) =>
                  setDraft((p) => ({
                    ...p,
                    schoolAdminUi: { ...p.schoolAdminUi, deskHeadline: e.target.value },
                  }))
                }
                className={inputCls}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#686C78] mb-1">
                Desk Description
              </label>
              <textarea
                rows={2}
                value={draft.schoolAdminUi.deskDescription}
                onChange={(e) =>
                  setDraft((p) => ({
                    ...p,
                    schoolAdminUi: { ...p.schoolAdminUi, deskDescription: e.target.value },
                  }))
                }
                className={areaCls}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#686C78] mb-1">
                  Upload Panel Title
                </label>
                <input
                  type="text"
                  value={draft.schoolAdminUi.uploadPanelTitle}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      schoolAdminUi: { ...p.schoolAdminUi, uploadPanelTitle: e.target.value },
                    }))
                  }
                  className={inputCls}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#686C78] mb-1">
                  Upload Accepted Formats Hint
                </label>
                <input
                  type="text"
                  value={draft.schoolAdminUi.uploadPanelHint}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      schoolAdminUi: { ...p.schoolAdminUi, uploadPanelHint: e.target.value },
                    }))
                  }
                  className={inputCls}
                />
              </div>
            </div>
          </div>
        </SurfaceCard>
      )}

      {/* Area 3: Shared Constant Pages (About, Services, Help, Customer Support) */}
      {area === 'shared_pages' && (
        <SurfaceCard tone="white" className="p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { id: 'about', label: 'About' },
                { id: 'services', label: 'Services' },
                { id: 'help', label: 'Help' },
                { id: 'support', label: 'Customer Support' },
              ] as const
            ).map((pg) => (
              <button
                key={pg.id}
                type="button"
                onClick={() => setSharedPage(pg.id)}
                className={`min-h-[38px] px-3.5 rounded-xl text-xs font-semibold cursor-pointer ${
                  sharedPage === pg.id
                    ? 'bg-[#1D1E23] text-white'
                    : 'bg-[#F6F7F9] text-[#505460] hover:bg-[#ECEEF3]'
                }`}
              >
                {pg.label}
              </button>
            ))}
          </div>

          {sharedPage === 'about' && (
            <div className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#686C78] mb-1">
                    Page Heading
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
                  <label className="block text-xs font-medium text-[#686C78] mb-1">
                    Subtitle
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
                <div key={label} className="rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/[0.06] p-3.5 space-y-2">
                  <p className="text-[11px] font-bold text-[#686C78] uppercase">{label}</p>
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

          {sharedPage === 'services' && (
            <div className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#686C78] mb-1">
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
                  <label className="block text-xs font-medium text-[#686C78] mb-1">
                    Subtitle
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
                              i === idx ? { ...it, description: e.target.value } : it
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

          {sharedPage === 'help' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#686C78] mb-1">
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
                  <label className="block text-xs font-medium text-[#686C78] mb-1">
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
                <label className="block text-xs font-medium text-[#686C78] mb-1">
                  How It Works Steps (one line per step)
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
                <p className="text-xs font-bold text-[#1A1B20]">Frequently Asked Questions</p>
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

          {sharedPage === 'support' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-medium text-[#686C78] mb-1">
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
                <label className="block text-xs font-medium text-[#686C78] mb-1">
                  Subtitle
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
                <label className="block text-xs font-medium text-[#686C78] mb-1">
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
                <label className="block text-xs font-medium text-[#686C78] mb-1">
                  WhatsApp Number (digits with country code)
                </label>
                <input
                  type="text"
                  value={draft.supportPage.whatsappNumber}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      supportPage: { ...p.supportPage, whatsappNumber: e.target.value },
                    }))
                  }
                  placeholder="e.g. 2348012345678"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#686C78] mb-1">
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
                  placeholder="e.g. +234 800 000 0000"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#686C78] mb-1">
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
                <label className="block text-xs font-medium text-[#686C78] mb-1">
                  Feedback Form Title
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
                <label className="block text-xs font-medium text-[#686C78] mb-1">
                  Feedback Form Subtitle
                </label>
                <input
                  type="text"
                  value={draft.supportPage.formSubtitle}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      supportPage: { ...p.supportPage, formSubtitle: e.target.value },
                    }))
                  }
                  className={inputCls}
                />
              </div>
            </div>
          )}
        </SurfaceCard>
      )}
    </form>
  );
};
