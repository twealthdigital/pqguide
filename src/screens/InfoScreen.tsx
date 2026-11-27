import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Bell,
  BookOpen,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Crown,
  FileText,
  Loader2,
  Mail,
  MessageCircle,
  Phone,
  ScanLine,
  Search,
  Send,
} from 'lucide-react';
import { PqGuideAiIcon } from '../components/ui/PqGuideAiIcon';
import type { AppScreen, AuthenticatedUser, SupportTicket } from '../core/types';
import { useArchiveStore } from '../hooks/useArchiveStore';
import { submitFeedback } from '../services/feedbackService';
import { DarkHeaderCard } from '../components/ui/DarkHeaderCard';
import { SearchField } from '../components/ui/SearchField';
import { TactileButton } from '../components/ui/TactileButton';

export type InfoPage = 'about' | 'services' | 'help' | 'support';

interface InfoScreenProps {
  page: InfoPage;
  currentUser?: AuthenticatedUser | null;
  restrictedAdminView?: boolean;
  onNavigate: (screen: AppScreen) => void;
}

const card =
  'rounded-2xl bg-white p-4 sm:p-5 border border-[#1A1B20]/[0.06] shadow-[0_2px_10px_-4px_rgba(24,25,30,0.06)]';

const FeatureRow: React.FC<{
  icon: React.ReactNode;
  title: string;
  text: string;
  action?: { label: string; onClick: () => void };
}> = ({ icon, title, text, action }) => (
  <div className={`${card} flex items-start gap-3.5`}>
    <div className="h-11 w-11 rounded-xl bg-[#1D1E23] text-white flex items-center justify-center shrink-0">
      {icon}
    </div>
    <div className="min-w-0 flex-1">
      <h2 className="font-display text-sm sm:text-base font-bold text-[#1A1B20]">{title}</h2>
      <p className="mt-0.5 text-xs sm:text-sm text-[#505460] leading-relaxed">{text}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-2.5 text-xs font-semibold text-[#1A1B20] underline underline-offset-4 decoration-[#1A1B20]/30 hover:decoration-[#1A1B20] cursor-pointer"
        >
          {action.label}
        </button>
      )}
    </div>
  </div>
);

const AboutPage: React.FC = () => {
  const { siteCms } = useArchiveStore();
  const about = siteCms.aboutPage;

  return (
    <div className="space-y-4">
      <FeatureRow
        icon={<PqGuideAiIcon size="sm" />}
        title={about.card1Title}
        text={about.card1Body}
      />
      <FeatureRow
        icon={<CheckCircle2 className="w-5 h-5" />}
        title={about.card2Title}
        text={about.card2Body}
      />
      <div className={card}>
        <h2 className="font-display text-sm sm:text-base font-bold text-[#1A1B20]">
          {about.card3Title}
        </h2>
        <p className="mt-2 text-xs sm:text-sm text-[#505460] leading-relaxed">{about.card3Body}</p>
      </div>
    </div>
  );
};

const SERVICE_ICONS = [
  <Search className="w-5 h-5" key="search" />,
  <FileText className="w-5 h-5" key="file" />,
  <ClipboardCheck className="w-5 h-5" key="exam" />,
  <BarChart3 className="w-5 h-5" key="perf" />,
  <BookOpen className="w-5 h-5" key="book" />,
  <ScanLine className="w-5 h-5" key="scan" />,
];

function inferServiceAction(
  title: string,
  onNavigate: (s: AppScreen) => void,
  restrictedAdminView: boolean
): { label: string; onClick: () => void } | undefined {
  const lower = title.toLowerCase();
  if (lower.includes('alert') || lower.includes('notif')) {
    return { label: 'See alerts', onClick: () => onNavigate('notifications') };
  }
  if (restrictedAdminView) return undefined;
  if (lower.includes('past questions home') || lower.includes('search')) {
    return { label: 'Open Home', onClick: () => onNavigate('home') };
  }
  if (lower.includes('worked answer')) {
    return { label: 'Browse past questions', onClick: () => onNavigate('past_questions') };
  }
  if (lower.includes('practice exam') || lower.includes('mock')) {
    return { label: 'Start a practice exam', onClick: () => onNavigate('mock_exam') };
  }
  if (lower.includes('performance') || lower.includes('rating')) {
    return { label: 'Open Performance', onClick: () => onNavigate('performance') };
  }
  if (lower.includes('guide') || lower.includes('material')) {
    return { label: 'Open materials', onClick: () => onNavigate('materials') };
  }
  if (lower.includes('subscription') || lower.includes('plan')) {
    return { label: 'View plans', onClick: () => onNavigate('subscription') };
  }
  return undefined;
}

const ServicesPage: React.FC<{
  onNavigate: (s: AppScreen) => void;
  restrictedAdminView?: boolean;
}> = ({ onNavigate, restrictedAdminView = false }) => {
  const { siteCms } = useArchiveStore();
  const items = siteCms.servicesPage.items;

  return (
    <div className="space-y-4">
      {items.map((item, idx) => (
        <FeatureRow
          key={`${item.title}-${idx}`}
          icon={SERVICE_ICONS[idx % SERVICE_ICONS.length]}
          title={item.title}
          text={item.description}
          action={inferServiceAction(item.title, onNavigate, restrictedAdminView)}
        />
      ))}
      <FeatureRow
        icon={<Bell className="w-5 h-5" />}
        title="Alerts & Broadcasts"
        text="Get notified when new past questions and system broadcasts are published."
        action={{ label: 'See alerts', onClick: () => onNavigate('notifications') }}
      />
      {!restrictedAdminView && (
        <FeatureRow
          icon={<Crown className="w-5 h-5" />}
          title="Subscription plans & AI Scholar"
          text="View Monthly, Semester, and Yearly plans across Free Starter, Standard Pass, and AI Scholar from the side menu."
          action={{ label: 'View plans', onClick: () => onNavigate('subscription') }}
        />
      )}
    </div>
  );
};

interface ParsedHelpStep {
  id: string;
  title: string;
  text: string;
}

function parseHelpStep(raw: string, index: number): ParsedHelpStep {
  const colonIdx = raw.indexOf(':');
  if (colonIdx > 0 && colonIdx < 56) {
    return {
      id: `step-${index}`,
      title: raw.slice(0, colonIdx).trim(),
      text: raw.slice(colonIdx + 1).trim(),
    };
  }
  return {
    id: `step-${index}`,
    title: `Step ${index + 1}`,
    text: raw,
  };
}

const HelpPage: React.FC<{
  query: string;
  onNavigate: (s: AppScreen) => void;
  restrictedAdminView?: boolean;
}> = ({ query, onNavigate }) => {
  const { siteCms } = useArchiveStore();
  const needle = query.trim().toLowerCase();

  const allSteps = useMemo(
    () => siteCms.helpPage.howItWorks.map((item, idx) => parseHelpStep(item, idx)),
    [siteCms.helpPage.howItWorks]
  );

  const steps = useMemo(() => {
    if (!needle) return allSteps;
    const words = needle.split(/\s+/).filter(Boolean);
    return allSteps.filter((step) => {
      const hay = `${step.title} ${step.text}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [allSteps, needle]);

  const faqs = useMemo(() => {
    const words = needle.split(/\s+/).filter(Boolean);
    return siteCms.helpPage.faqs.filter((faq) => {
      if (words.length === 0) return true;
      const hay = `${faq.question} ${faq.answer}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [siteCms.helpPage.faqs, needle]);

  const nothing = needle && steps.length === 0 && faqs.length === 0;

  return (
    <div className="space-y-5">
      {nothing ? (
        <div className={`${card} text-center py-8`} role="status">
          <p className="text-sm font-semibold text-[#1A1B20]">
            Nothing found for &ldquo;{query.trim()}&rdquo;
          </p>
          <p className="mt-1 text-sm text-[#505460]">
            Try a simpler word like exam, answer, search or login.
          </p>
        </div>
      ) : (
        <>
          {steps.length > 0 && (
            <section aria-label="How it works" className="space-y-2.5">
              <h2 className="font-display text-base font-bold text-[#1A1B20]">How it works</h2>
              <ol className="space-y-2.5">
                {steps.map((item, i) => (
                  <li key={item.id} className={`${card} flex items-start gap-3.5`}>
                    {!needle && (
                      <span className="h-8 w-8 rounded-full bg-[#1D1E23] text-white text-xs font-bold font-mono-tabular flex items-center justify-center shrink-0">
                        {i + 1}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <h3 className="font-display text-sm sm:text-base font-bold text-[#1A1B20]">
                        {item.title}
                      </h3>
                      <p className="mt-0.5 text-xs sm:text-sm text-[#505460] leading-relaxed">
                        {item.text}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {faqs.length > 0 && (
            <section aria-label="Common questions" className="space-y-2.5">
              <h2 className="font-display text-base font-bold text-[#1A1B20]">Common questions</h2>
              {faqs.map((item, idx) => (
                <details
                  key={`${item.question}-${idx}`}
                  open={Boolean(needle)}
                  className="group rounded-2xl bg-white border border-[#1A1B20]/[0.06] shadow-[0_2px_10px_-4px_rgba(24,25,30,0.06)] open:shadow-[0_8px_20px_-6px_rgba(24,25,30,0.1)]"
                >
                  <summary className="cursor-pointer list-none px-4 py-3.5 flex items-center justify-between gap-3 text-sm font-semibold text-[#1A1B20] [&::-webkit-details-marker]:hidden">
                    {item.question}
                    <span
                      aria-hidden="true"
                      className="text-[#686C78] text-lg leading-none transition-transform group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <div className="px-4 pb-4 -mt-1">
                    <p className="text-sm text-[#505460] leading-relaxed">{item.answer}</p>
                  </div>
                </details>
              ))}
            </section>
          )}
        </>
      )}

      <div className={`${card} flex items-center justify-between gap-3`}>
        <p className="text-sm text-[#3A3D47]">
          {nothing
            ? 'Cannot find what you need? Ask our support team.'
            : 'Still stuck? Our support team can help.'}
        </p>
        <TactileButton variant="dark" size="sm" onClick={() => onNavigate('support')}>
          Contact support
        </TactileButton>
      </div>
    </div>
  );
};

type SendState = 'idle' | 'sending' | 'sent';

const SUPPORT_KINDS: SupportTicket['kind'][] = ['Question', 'Missing Paper', 'Report Issue'];

const FeedbackForm: React.FC<{
  currentUser?: AuthenticatedUser | null;
  formTitle: string;
  formSubtitle: string;
}> = ({ currentUser, formTitle, formSubtitle }) => {
  const [kind, setKind] = useState<SupportTicket['kind']>('Question');
  const [message, setMessage] = useState('');
  const [state, setState] = useState<SendState>('idle');
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const canSend = message.trim().length > 0 && state === 'idle';

  const handleSend = async () => {
    if (!canSend) return;
    setState('sending');
    const minSpin = new Promise((r) => timers.current.push(window.setTimeout(r, 900)));
    await Promise.all([
      submitFeedback(message, {
        userId: currentUser?.id,
        role: currentUser?.role,
        fullName: currentUser?.fullName,
        email: currentUser?.email,
        matricNumber: currentUser?.matricNumber,
        level: currentUser?.level,
        kind,
      }),
      minSpin,
    ]);
    setMessage('');
    setState('sent');
    timers.current.push(window.setTimeout(() => setState('idle'), 3000));
  };

  const busy = state !== 'idle';

  return (
    <div className={`${card} space-y-3`}>
      <div>
        <h2 className="font-display text-base font-bold text-[#1A1B20]">{formTitle}</h2>
        <p className="mt-1 text-sm text-[#505460] leading-relaxed">{formSubtitle}</p>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Message topic">
        {SUPPORT_KINDS.map((item) => {
          const active = kind === item;
          return (
            <button
              key={item}
              type="button"
              disabled={busy}
              onClick={() => setKind(item)}
              className={`min-h-[36px] px-3 rounded-xl text-xs font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
                active
                  ? 'bg-[#1D1E23] text-white border-[#1D1E23]'
                  : 'bg-[#F6F7F9] text-[#505460] border-[#1A1B20]/10 hover:text-[#1A1B20]'
              }`}
            >
              {item}
            </button>
          );
        })}
      </div>

      <div>
        <label htmlFor="support-feedback" className="sr-only">
          Your support message
        </label>
        <textarea
          id="support-feedback"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={busy}
          rows={4}
          maxLength={1000}
          placeholder="Write your support message here..."
          className="w-full rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/[0.08] px-3.5 py-2.5 text-sm text-[#1A1B20] placeholder:text-[#8E93A2] focus:outline-none focus:ring-2 focus:ring-[#1D1E23]/20 resize-none disabled:opacity-60"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          aria-label={
            state === 'sent' ? 'Message sent' : state === 'sending' ? 'Sending message' : 'Send message'
          }
          aria-busy={state === 'sending'}
          className={`feedback-send inline-flex h-11 items-center justify-center overflow-hidden font-semibold text-sm text-white select-none cursor-pointer transition-[width,background-color,border-radius,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] disabled:cursor-default ${
            busy ? 'w-11 rounded-full' : 'w-28 rounded-full'
          } ${state === 'sent' ? 'bg-[#16A34A]' : 'bg-[#1D1E23] hover:bg-[#2B2D35]'} ${
            state === 'idle' && !canSend ? 'opacity-45' : ''
          }`}
        >
          {state === 'idle' && (
            <span className="inline-flex items-center gap-2">
              <Send className="w-4 h-4" />
              Send
            </span>
          )}
          {state === 'sending' && <Loader2 className="w-5 h-5 feedback-roll" />}
          {state === 'sent' && <Check className="w-5 h-5 feedback-check" strokeWidth={3} />}
        </button>
        <p className="text-xs text-[#686C78]" role="status" aria-live="polite">
          {state === 'sent' ? 'Sent! Your message is now in the Support Inbox.' : ''}
        </p>
      </div>
    </div>
  );
};

const ContactRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  href: string;
  external?: boolean;
}> = ({ icon, label, value, href, external }) => (
  <a
    href={href}
    {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    className="flex items-center gap-3 rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/[0.06] px-3.5 py-3 hover:bg-[#ECEEF3] transition-colors"
  >
    <span className="h-9 w-9 rounded-lg bg-[#1D1E23] text-white flex items-center justify-center shrink-0">
      {icon}
    </span>
    <span className="min-w-0">
      <span className="block text-xs font-semibold text-[#686C78]">{label}</span>
      <span className="block text-sm font-semibold text-[#1A1B20] truncate">{value}</span>
    </span>
  </a>
);

const SupportPage: React.FC<{
  currentUser?: AuthenticatedUser | null;
  onNavigate: (s: AppScreen) => void;
}> = ({ currentUser, onNavigate }) => {
  const { siteCms } = useArchiveStore();
  const support = siteCms.supportPage;
  const hasContact = Boolean(support.email || support.whatsappNumber || support.phone);

  return (
    <div className="space-y-4">
      <div className={`${card} space-y-3`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-base font-bold text-[#1A1B20]">Contact us</h2>
          {support.hours && (
            <span className="inline-flex items-center gap-1.5 text-xs font-mono-tabular text-[#686C78]">
              <Clock className="w-3.5 h-3.5" />
              {support.hours}
            </span>
          )}
        </div>
        {hasContact ? (
          <div className="space-y-2.5">
            {support.whatsappNumber && (
              <ContactRow
                icon={<MessageCircle className="w-4 h-4" />}
                label={support.whatsappLabel || 'WhatsApp'}
                value={`+${support.whatsappNumber.replace(/\D/g, '')}`}
                href={`https://wa.me/${support.whatsappNumber.replace(/\D/g, '')}`}
                external
              />
            )}
            {support.email && (
              <ContactRow
                icon={<Mail className="w-4 h-4" />}
                label="Email"
                value={support.email}
                href={`mailto:${support.email}?subject=${encodeURIComponent('pqguide support')}`}
              />
            )}
            {support.phone && (
              <ContactRow
                icon={<Phone className="w-4 h-4" />}
                label="Phone"
                value={support.phone}
                href={`tel:${support.phone.replace(/[^\d+]/g, '')}`}
              />
            )}
          </div>
        ) : (
          <p className="text-sm text-[#505460] leading-relaxed">
            Contact details will appear here soon. In the meantime, send a direct message below or
            check the Help page.
          </p>
        )}
      </div>

      <FeedbackForm
        currentUser={currentUser}
        formTitle={support.formTitle}
        formSubtitle={support.formSubtitle}
      />

      <div className={`${card} flex items-center justify-between gap-3`}>
        <p className="text-sm text-[#3A3D47]">Looking for a quick answer first?</p>
        <TactileButton variant="light" size="sm" onClick={() => onNavigate('help')}>
          Open Help
        </TactileButton>
      </div>
    </div>
  );
};

export const InfoScreen: React.FC<InfoScreenProps> = ({
  page,
  currentUser = null,
  restrictedAdminView = false,
  onNavigate,
}) => {
  const { siteCms } = useArchiveStore();
  const [helpQuery, setHelpQuery] = useState('');

  const header =
    page === 'about'
      ? { title: siteCms.aboutPage.heading, subtitle: siteCms.aboutPage.lead }
      : page === 'services'
        ? { title: siteCms.servicesPage.heading, subtitle: siteCms.servicesPage.lead }
        : page === 'help'
          ? { title: siteCms.helpPage.heading, subtitle: siteCms.helpPage.lead }
          : { title: siteCms.supportPage.heading, subtitle: siteCms.supportPage.lead };

  useEffect(() => {
    setHelpQuery('');
  }, [page]);

  return (
    <div className="space-y-5 page-enter lg:mx-auto lg:max-w-3xl">
      <DarkHeaderCard>
        <h1 className="font-display text-xl sm:text-2xl font-bold leading-snug">{header.title}</h1>
        <p className="mt-1.5 text-xs text-[#C3C7D2]">{header.subtitle}</p>
        {page === 'help' && (
          <SearchField
            value={helpQuery}
            onChange={setHelpQuery}
            placeholder="Search help (e.g. exam, answer, alerts)..."
            ariaLabel="Search help"
          />
        )}
      </DarkHeaderCard>

      {page === 'about' && <AboutPage />}
      {page === 'services' && (
        <ServicesPage onNavigate={onNavigate} restrictedAdminView={restrictedAdminView} />
      )}
      {page === 'help' && (
        <HelpPage
          query={helpQuery}
          onNavigate={onNavigate}
          restrictedAdminView={restrictedAdminView}
        />
      )}
      {page === 'support' && (
        <SupportPage currentUser={currentUser} onNavigate={onNavigate} />
      )}
    </div>
  );
};
