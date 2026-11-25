import React, { useState } from 'react';
import {
  Bell,
  BookOpen,
  CheckCircle2,
  FileText,
  Headphones,
  Mail,
  MessageCircle,
  ScanLine,
  Search,
  Sparkles,
} from 'lucide-react';
import type { AppScreen } from '../core/types';
import { SITE_INFO } from '../data/siteInfo';
import { DarkHeaderCard } from '../components/ui/DarkHeaderCard';
import { TactileButton } from '../components/ui/TactileButton';

export type InfoPage = 'about' | 'services' | 'help' | 'support';

interface InfoScreenProps {
  page: InfoPage;
  onNavigate: (screen: AppScreen) => void;
}

const HEADERS: Record<InfoPage, { title: string; subtitle: string }> = {
  about: { title: 'About pqguide', subtitle: 'The Past Questions Guide' },
  services: { title: 'Services', subtitle: 'What you can do on pqguide' },
  help: { title: 'Help', subtitle: 'Quick answers to get you going' },
  support: { title: 'Customer Support', subtitle: 'We are here to help' },
};

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

const AboutPage: React.FC = () => (
  <div className="space-y-4">
    <div className={card}>
      <p className="text-sm sm:text-base text-[#3A3D47] leading-relaxed">
        pqguide is a fast, simple home for university past questions. Search a course code, open the
        past question and revise with worked answers, all in one place and quick even on a slow connection.
      </p>
    </div>
    <FeatureRow
      icon={<CheckCircle2 className="w-5 h-5" />}
      title="Verified past questions"
      text="Past questions are added by school admins and checked before they are published."
    />
    <FeatureRow
      icon={<Sparkles className="w-5 h-5" />}
      title="Built to be quick"
      text="Light pages, clear search and an app-like feel that works well on any phone."
    />
    <FeatureRow
      icon={<BookOpen className="w-5 h-5" />}
      title="Free to read"
      text="Reading guides for general courses are free for every student."
    />
  </div>
);

const ServicesPage: React.FC<{ onNavigate: (s: AppScreen) => void }> = ({ onNavigate }) => (
  <div className="space-y-4">
    <FeatureRow
      icon={<Search className="w-5 h-5" />}
      title="Past question archive"
      text="Find past questions by course code, keyword, session, semester and level."
      action={{ label: 'Open the archive', onClick: () => onNavigate('home') }}
    />
    <FeatureRow
      icon={<FileText className="w-5 h-5" />}
      title="Worked answers"
      text="Open a past question, then tap View answer under a question to see how it is solved."
      action={{ label: 'Browse past questions', onClick: () => onNavigate('past_questions') }}
    />
    <FeatureRow
      icon={<BookOpen className="w-5 h-5" />}
      title="Reading guides"
      text="Free study notes to help you prepare for your exams."
      action={{ label: 'Open materials', onClick: () => onNavigate('materials') }}
    />
    <FeatureRow
      icon={<Bell className="w-5 h-5" />}
      title="Alerts"
      text="Get notified when new past questions are added to the archive."
      action={{ label: 'See alerts', onClick: () => onNavigate('notifications') }}
    />
    <FeatureRow
      icon={<ScanLine className="w-5 h-5" />}
      title="Scan-to-PDF uploads for schools"
      text="School admins can scan or upload past questions and have them indexed automatically."
      action={{ label: 'School admin', onClick: () => onNavigate('school_admin') }}
    />
  </div>
);

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: 'I cannot find a past question',
    a: 'Search with just the course code (for example GNS 101) and clear any session, semester or level filters. If it is still missing, it may not have been uploaded yet.',
  },
  {
    q: 'How do I see the answer to a question?',
    a: 'Open the past question, then tap View answer under the question. Answers are added by admins, so a few questions may not have one yet.',
  },
  {
    q: 'Where are the past questions I opened recently?',
    a: 'Tap PQs on the bottom bar (Past Questions on desktop). Your recently opened past questions are listed at the top.',
  },
  {
    q: 'How do I go back?',
    a: 'Use the Back button at the top of a past question or guide. It takes you to the screen you came from.',
  },
  {
    q: 'How do I know when a new past question is added?',
    a: 'Tap the bell at the top of the screen to see your alerts.',
  },
];

const HelpPage: React.FC<{ onNavigate: (s: AppScreen) => void }> = ({ onNavigate }) => (
  <div className="space-y-5">
    <section aria-label="Quick start" className={card}>
      <h2 className="font-display text-base font-bold text-[#1A1B20]">Quick start</h2>
      <ol className="mt-3 space-y-3">
        {[
          'Pick your academic session and semester.',
          'Search a course code or keyword, for example GNS 101.',
          'Open a past question, then tap View answer under any question.',
        ].map((step, i) => (
          <li key={step} className="flex items-start gap-3 text-sm text-[#3A3D47]">
            <span className="h-6 w-6 rounded-full bg-[#1D1E23] text-white text-xs font-bold flex items-center justify-center shrink-0 mt-px">
              {i + 1}
            </span>
            <span className="leading-relaxed">{step}</span>
          </li>
        ))}
      </ol>
    </section>

    <section aria-label="Common questions" className="space-y-2.5">
      <h2 className="font-display text-base font-bold text-[#1A1B20]">Common questions</h2>
      {FAQ.map((item) => (
        <details
          key={item.q}
          className="group rounded-2xl bg-white border border-[#1A1B20]/[0.06] shadow-[0_2px_10px_-4px_rgba(24,25,30,0.06)] open:shadow-[0_8px_20px_-6px_rgba(24,25,30,0.1)]"
        >
          <summary className="cursor-pointer list-none px-4 py-3.5 flex items-center justify-between gap-3 text-sm font-semibold text-[#1A1B20] [&::-webkit-details-marker]:hidden">
            {item.q}
            <span
              aria-hidden="true"
              className="text-[#686C78] text-lg leading-none transition-transform group-open:rotate-45"
            >
              +
            </span>
          </summary>
          <p className="px-4 pb-4 -mt-1 text-sm text-[#505460] leading-relaxed">{item.a}</p>
        </details>
      ))}
    </section>

    <div className={`${card} flex items-center justify-between gap-3`}>
      <p className="text-sm text-[#3A3D47]">Still stuck? Our support team can help.</p>
      <TactileButton variant="dark" size="sm" onClick={() => onNavigate('support')}>
        Contact support
      </TactileButton>
    </div>
  </div>
);

const TOPICS = ['Cannot find a past question', 'Problem with an answer', 'Account or login', 'Something else'];

const SupportPage: React.FC<{ onNavigate: (s: AppScreen) => void }> = ({ onNavigate }) => {
  const { supportEmail, supportWhatsApp } = SITE_INFO;
  const [topic, setTopic] = useState(TOPICS[0]);
  const [message, setMessage] = useState('');
  const hasContact = Boolean(supportEmail || supportWhatsApp);

  const mailHref = supportEmail
    ? `mailto:${supportEmail}?subject=${encodeURIComponent(`pqguide support: ${topic}`)}&body=${encodeURIComponent(message)}`
    : '';
  const whatsappHref = supportWhatsApp
    ? `https://wa.me/${supportWhatsApp.replace(/\D/g, '')}?text=${encodeURIComponent(
        `pqguide support (${topic}): ${message}`.trim()
      )}`
    : '';

  return (
    <div className="space-y-4">
      {!hasContact ? (
        <div className={card}>
          <div className="flex items-start gap-3.5">
            <div className="h-11 w-11 rounded-xl bg-[#1D1E23] text-white flex items-center justify-center shrink-0">
              <Headphones className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-base font-bold text-[#1A1B20]">
                Support is being set up
              </h2>
              <p className="mt-1 text-sm text-[#505460] leading-relaxed">
                Contact options will appear here soon. In the meantime, the Help page answers the
                most common questions.
              </p>
              <div className="mt-3">
                <TactileButton variant="dark" size="sm" onClick={() => onNavigate('help')}>
                  Go to Help
                </TactileButton>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className={`${card} space-y-4`}>
          <div>
            <label htmlFor="support-topic" className="text-xs font-semibold text-[#686C78]">
              What do you need help with?
            </label>
            <select
              id="support-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="mt-1.5 w-full rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/[0.08] px-3.5 py-2.5 text-sm text-[#1A1B20] focus:outline-none focus:ring-2 focus:ring-[#1D1E23]/20"
            >
              {TOPICS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="support-message" className="text-xs font-semibold text-[#686C78]">
              Your message
            </label>
            <textarea
              id="support-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder="Tell us what happened..."
              className="mt-1.5 w-full rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/[0.08] px-3.5 py-2.5 text-sm text-[#1A1B20] placeholder:text-[#8E93A2] focus:outline-none focus:ring-2 focus:ring-[#1D1E23]/20 resize-none"
            />
          </div>

          <div className="flex flex-wrap gap-2.5">
            {whatsappHref && (
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-[#1D1E23] px-5 text-sm font-semibold text-white hover:bg-[#2B2D35] transition-colors"
              >
                <MessageCircle className="w-4 h-4" />
                Chat on WhatsApp
              </a>
            )}
            {mailHref && (
              <a
                href={mailHref}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-[#F6F7F9] border border-[#1A1B20]/[0.08] px-5 text-sm font-semibold text-[#1A1B20] hover:bg-[#ECEEF3] transition-colors"
              >
                <Mail className="w-4 h-4" />
                Send an email
              </a>
            )}
          </div>
        </div>
      )}

      <div className={`${card} flex items-center justify-between gap-3`}>
        <p className="text-sm text-[#3A3D47]">Looking for a quick answer first?</p>
        <TactileButton variant="light" size="sm" onClick={() => onNavigate('help')}>
          Open Help
        </TactileButton>
      </div>
    </div>
  );
};

export const InfoScreen: React.FC<InfoScreenProps> = ({ page, onNavigate }) => {
  const header = HEADERS[page];
  return (
    <div className="space-y-5 page-enter lg:mx-auto lg:max-w-3xl">
      <DarkHeaderCard>
        <h1 className="font-display text-xl sm:text-2xl font-bold leading-snug">{header.title}</h1>
        <p className="mt-1.5 text-xs text-[#C3C7D2]">{header.subtitle}</p>
      </DarkHeaderCard>

      {page === 'about' && <AboutPage />}
      {page === 'services' && <ServicesPage onNavigate={onNavigate} />}
      {page === 'help' && <HelpPage onNavigate={onNavigate} />}
      {page === 'support' && <SupportPage onNavigate={onNavigate} />}
    </div>
  );
};
