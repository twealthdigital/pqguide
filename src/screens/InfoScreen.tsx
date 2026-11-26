import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Bell,
  BookOpen,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Crown,
  FileText,
  Headphones,
  Loader2,
  Mail,
  MessageCircle,
  Phone,
  ScanLine,
  Search,
  Send,
  Sparkles,
} from 'lucide-react';
import type { AppScreen } from '../core/types';
import { SITE_INFO } from '../data/siteInfo';
import { submitFeedback } from '../services/feedbackService';
import { DarkHeaderCard } from '../components/ui/DarkHeaderCard';
import { SearchField } from '../components/ui/SearchField';
import { TactileButton } from '../components/ui/TactileButton';

export type InfoPage = 'about' | 'services' | 'help' | 'support';

interface InfoScreenProps {
  page: InfoPage;
  onNavigate: (screen: AppScreen) => void;
}

const HEADERS: Record<InfoPage, { title: string; subtitle: string }> = {
  about: { title: 'About pqguide', subtitle: 'The Past Questions Guide' },
  services: { title: 'Services', subtitle: 'What you can do on pqguide' },
  help: { title: 'Help', subtitle: 'How it works, and quick answers' },
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
    <FeatureRow
      icon={<ClipboardCheck className="w-5 h-5" />}
      title="Practice exams made for you"
      text="Pick OBJ Paper, Theory Paper, True / False, or CBT, set your own question count and timer, or tap Suggest for focus topics. Every submission is saved so you can track your score out of 100%."
    />
    <div className={card}>
      <h2 className="font-display text-sm sm:text-base font-bold text-[#1A1B20]">
        How the exam prediction works
      </h2>
      <div className="mt-2 space-y-2.5 text-xs sm:text-sm text-[#505460] leading-relaxed">
        <p>
          There is no guessing game behind it. pqguide looks through the past questions on
          Home for the course you pick and chooses the ones most likely to matter: themes that
          keep coming back across sessions, questions from the latest session, and anything that
          matches the topic you ask to focus on.
        </p>
        <p>
          When you submit, your attempt is saved to Performance. You can inspect missed answers,
          mark Theory responses against model answers, and check your overall rating out of 100%
          across all questions taken.
        </p>
      </div>
    </div>
  </div>
);

const ServicesPage: React.FC<{ onNavigate: (s: AppScreen) => void }> = ({ onNavigate }) => (
  <div className="space-y-4">
    <FeatureRow
      icon={<Search className="w-5 h-5" />}
      title="Past questions home"
      text="Find past questions by course code, keyword, session, semester and level."
      action={{ label: 'Open Home', onClick: () => onNavigate('home') }}
    />
    <FeatureRow
      icon={<FileText className="w-5 h-5" />}
      title="Worked answers"
      text="Open a past question, then tap View answer under a question to see how it is solved."
      action={{ label: 'Browse past questions', onClick: () => onNavigate('past_questions') }}
    />
    <FeatureRow
      icon={<ClipboardCheck className="w-5 h-5" />}
      title="Practice exams"
      text="Choose OBJ Paper, Theory Paper, True / False, or CBT (one question at a time). Set custom question counts and exam timers, tap Suggest for topics, and submit to record your attempt."
      action={{ label: 'Start a practice exam', onClick: () => onNavigate('mock_exam') }}
    />
    <FeatureRow
      icon={<BarChart3 className="w-5 h-5" />}
      title="Performance & overall rating"
      text="Review every submitted exam, inspect the questions you took and answers you missed, and open Check overall rating to see your combined score out of 100%."
      action={{ label: 'Open Performance', onClick: () => onNavigate('performance') }}
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
      text="Get notified when new past questions are added to Home."
      action={{ label: 'See alerts', onClick: () => onNavigate('notifications') }}
    />
    <FeatureRow
      icon={<Crown className="w-5 h-5" />}
      title="Subscription plans & AI Scholar"
      text="View Monthly, Semester, and Yearly plans across Free, Standard Pass, and upcoming AI Scholar (Tier 3) from the side menu."
      action={{ label: 'View plans', onClick: () => onNavigate('subscription') }}
    />
    <FeatureRow
      icon={<ScanLine className="w-5 h-5" />}
      title="Scan-to-PDF uploads for schools"
      text="School admins can scan or upload past questions and have them indexed automatically."
      action={{ label: 'School admin', onClick: () => onNavigate('school_admin') }}
    />
  </div>
);

interface HelpAction {
  label: string;
  screen: AppScreen;
}

interface HelpItem {
  id: string;
  title: string;
  text: string;
  /** Extra words people might search for. */
  keywords?: string;
  action?: HelpAction;
}

const HOW_IT_WORKS: HelpItem[] = [
  {
    id: 'find',
    title: 'Find a past question',
    text: 'On the home page, pick your academic session and semester, then search a course code (for example GNS 101) or a keyword. Results update as you type.',
    keywords: 'search find filter session semester level course code home',
    action: { label: 'Open Home', screen: 'home' },
  },
  {
    id: 'open',
    title: 'Open it and read',
    text: 'Tap a past question to open it. Every question is laid out clearly, and you can use the search bar at the top to find words inside it.',
    keywords: 'open read view inside search',
    action: { label: 'Browse past questions', screen: 'past_questions' },
  },
  {
    id: 'answer',
    title: 'See how it is solved',
    text: 'Under each question, tap View answer. You get the answer and a step-by-step explanation. If a question has no answer yet, it will say so.',
    keywords: 'answer solution explanation worked steps view answer',
  },
  {
    id: 'guides',
    title: 'Study with reading guides',
    text: 'Materials has free reading guides for general courses. Open one and search inside it to jump to what you need.',
    keywords: 'materials guides notes study read learn',
    action: { label: 'Open materials', screen: 'materials' },
  },
  {
    id: 'exam',
    title: 'Set up and take a practice exam',
    text: 'Open Practice Exam, pick a course, and choose your format: OBJ (full question sheet with A–D options), Theory (full paper with answer boxes underneath), True / False, or CBT (one question at a time). Use the Custom buttons to type your own question count or minutes, and tap Suggest to pick focus topics.',
    keywords: 'exam practice mock test timer predict obj theory cbt true false custom suggest topic',
    action: { label: 'Start a practice exam', screen: 'mock_exam' },
  },
  {
    id: 'performance',
    title: 'Review your performance and overall rating',
    text: 'When you submit an exam, it saves to Performance (found right after Practice Exam in the desktop sidebar and mobile side menu). Tap any exam to see every question you took, the answers you missed, and your total score. Tap Check overall rating to view your combined percentage out of 100% across all graded questions.',
    keywords: 'performance score missed rating overall 100 percentage review history',
    action: { label: 'Open Performance', screen: 'performance' },
  },
  {
    id: 'alerts',
    title: 'Get alerts',
    text: 'Tap the bell at the top of the screen to see when new past questions are added.',
    keywords: 'alerts notifications bell new added',
    action: { label: 'See alerts', screen: 'notifications' },
  },
  {
    id: 'back',
    title: 'Go back',
    text: 'Use the Back button at the top of a past question, guide or exam. It takes you to the screen you came from.',
    keywords: 'back return previous navigate',
  },
];

const FAQ: HelpItem[] = [
  {
    id: 'faq-missing',
    title: 'I cannot find a past question',
    text: 'Search with just the course code (for example GNS 101) and clear any session, semester or level filters. If it is still missing, it may not have been uploaded yet.',
    keywords: 'missing not found search cannot find course code filters',
  },
  {
    id: 'faq-answer',
    title: 'How do I see the answer to a question?',
    text: 'Open the past question, then tap View answer under the question. Answers are added by admins, so a few questions may not have one yet.',
    keywords: 'answer solution view answer explanation',
  },
  {
    id: 'faq-recent',
    title: 'Where are the past questions I opened recently?',
    text: 'Tap PQs on the bottom bar (Past Questions on desktop). Your recently opened past questions are listed at the top.',
    keywords: 'recent history opened pqs',
  },
  {
    id: 'faq-alerts',
    title: 'How do I know when a new past question is added?',
    text: 'Tap the bell at the top of the screen to see your alerts.',
    keywords: 'alerts notifications bell new',
  },
  {
    id: 'faq-exam-types',
    title: 'What exam types can I choose from?',
    text: 'You can take OBJ (Paper) for a full multiple-choice sheet, Theory (Paper) to write full answers directly under each question, True / False for statement checks, or CBT to answer multiple-choice questions one at a time.',
    keywords: 'exam types obj theory cbt true false boolean paper',
    action: { label: 'Start a practice exam', screen: 'mock_exam' },
  },
  {
    id: 'faq-exam-custom',
    title: 'Can I set my own number of questions, time, and focus topics?',
    text: 'Yes. Tap Custom under Number of questions or Time allowed to enter your own values. Under Topic to focus on, tap Suggest to generate clickable topic chips from the selected course.',
    keywords: 'custom number questions time minutes suggest topic focus',
  },
  {
    id: 'faq-exam-accurate',
    title: 'Will the real exam look like the practice exam?',
    text: 'It is a prediction, not a promise. Questions are chosen from past questions, favouring themes that keep coming back and the latest session. Use it to practise and find weak spots, and keep studying your notes and guides too.',
    keywords: 'exam prediction accurate real predict likely',
  },
  {
    id: 'faq-exam-saved',
    title: 'Where do I see my scores and missed answers after submitting?',
    text: 'Submitting automatically opens Performance (also available in the desktop sidebar and mobile side drawer right after Practice Exam). Tap any attempt to inspect every question, missed answers, and explanations, or mark Theory answers yourself.',
    keywords: 'exam answers saved performance history score missed keep drawer',
    action: { label: 'Open Performance', screen: 'performance' },
  },
  {
    id: 'faq-overall-rating',
    title: 'How does Check overall rating calculate my score out of 100%?',
    text: 'No matter how many questions were in each exam, 100% is shared evenly across all graded questions you have taken. Your overall rating divides your total earned points by the total graded questions so every question counts fairly.',
    keywords: 'overall rating 100 percent percentage calculation share questions',
    action: { label: 'Open Performance', screen: 'performance' },
  },
  {
    id: 'faq-exam-time',
    title: 'What happens when the time runs out?',
    text: 'Your exam is submitted automatically with the answers you have entered and saved to Performance.',
    keywords: 'exam time up timer ends submit automatic',
  },
  {
    id: 'faq-subscriptions',
    title: 'How do subscriptions and Tier 3 AI Scholar work?',
    text: 'Open Subscription Plans in the side menu to compare Monthly, Semester, and Yearly options across Tier 1 (Free), Tier 2 (Standard Pass for all core webapp features), and Tier 3 (AI Scholar for upcoming AI tutoring and smart predictions).',
    keywords: 'subscription premium paywall tier pricing monthly semester yearly ai scholar',
    action: { label: 'View plans', screen: 'subscription' },
  },
];

const matchesQuery = (item: HelpItem, needle: string) => {
  const haystack = `${item.title} ${item.text} ${item.keywords ?? ''}`.toLowerCase();
  return needle
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
};

const HelpActionLink: React.FC<{ action?: HelpAction; onNavigate: (s: AppScreen) => void }> = ({
  action,
  onNavigate,
}) =>
  action ? (
    <button
      type="button"
      onClick={() => onNavigate(action.screen)}
      className="mt-2.5 text-xs font-semibold text-[#1A1B20] underline underline-offset-4 decoration-[#1A1B20]/30 hover:decoration-[#1A1B20] cursor-pointer"
    >
      {action.label}
    </button>
  ) : null;

const StepCard: React.FC<{
  item: HelpItem;
  number?: number;
  onNavigate: (s: AppScreen) => void;
}> = ({ item, number, onNavigate }) => (
  <li className={`${card} flex items-start gap-3.5`}>
    {number !== undefined && (
      <span className="h-8 w-8 rounded-full bg-[#1D1E23] text-white text-xs font-bold flex items-center justify-center shrink-0">
        {number}
      </span>
    )}
    <div className="min-w-0 flex-1">
      <h3 className="font-display text-sm sm:text-base font-bold text-[#1A1B20]">{item.title}</h3>
      <p className="mt-0.5 text-xs sm:text-sm text-[#505460] leading-relaxed">{item.text}</p>
      <HelpActionLink action={item.action} onNavigate={onNavigate} />
    </div>
  </li>
);

const FaqItem: React.FC<{
  item: HelpItem;
  defaultOpen?: boolean;
  onNavigate: (s: AppScreen) => void;
}> = ({ item, defaultOpen, onNavigate }) => (
  <details
    open={defaultOpen}
    className="group rounded-2xl bg-white border border-[#1A1B20]/[0.06] shadow-[0_2px_10px_-4px_rgba(24,25,30,0.06)] open:shadow-[0_8px_20px_-6px_rgba(24,25,30,0.1)]"
  >
    <summary className="cursor-pointer list-none px-4 py-3.5 flex items-center justify-between gap-3 text-sm font-semibold text-[#1A1B20] [&::-webkit-details-marker]:hidden">
      {item.title}
      <span
        aria-hidden="true"
        className="text-[#686C78] text-lg leading-none transition-transform group-open:rotate-45"
      >
        +
      </span>
    </summary>
    <div className="px-4 pb-4 -mt-1">
      <p className="text-sm text-[#505460] leading-relaxed">{item.text}</p>
      <HelpActionLink action={item.action} onNavigate={onNavigate} />
    </div>
  </details>
);

const HelpPage: React.FC<{ query: string; onNavigate: (s: AppScreen) => void }> = ({
  query,
  onNavigate,
}) => {
  const needle = query.trim().toLowerCase();

  const steps = useMemo(
    () => HOW_IT_WORKS.filter((item) => !needle || matchesQuery(item, needle)),
    [needle]
  );
  const faqs = useMemo(
    () => FAQ.filter((item) => !needle || matchesQuery(item, needle)),
    [needle]
  );
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
                  <StepCard
                    key={item.id}
                    item={item}
                    number={needle ? undefined : i + 1}
                    onNavigate={onNavigate}
                  />
                ))}
              </ol>
            </section>
          )}

          {faqs.length > 0 && (
            <section aria-label="Common questions" className="space-y-2.5">
              <h2 className="font-display text-base font-bold text-[#1A1B20]">Common questions</h2>
              {faqs.map((item) => (
                <FaqItem
                  key={item.id}
                  item={item}
                  defaultOpen={Boolean(needle)}
                  onNavigate={onNavigate}
                />
              ))}
            </section>
          )}
        </>
      )}

      <div className={`${card} flex items-center justify-between gap-3`}>
        <p className="text-sm text-[#3A3D47]">
          {nothing ? 'Cannot find what you need? Ask our support team.' : 'Still stuck? Our support team can help.'}
        </p>
        <TactileButton variant="dark" size="sm" onClick={() => onNavigate('support')}>
          Contact support
        </TactileButton>
      </div>
    </div>
  );
};

type SendState = 'idle' | 'sending' | 'sent';

const FeedbackForm: React.FC = () => {
  const [message, setMessage] = useState('');
  const [state, setState] = useState<SendState>('idle');
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const canSend = message.trim().length > 0 && state === 'idle';

  const handleSend = async () => {
    if (!canSend) return;
    setState('sending');
    const minSpin = new Promise((r) => timers.current.push(window.setTimeout(r, 900)));
    await Promise.all([submitFeedback(message), minSpin]);
    setMessage('');
    setState('sent');
    timers.current.push(window.setTimeout(() => setState('idle'), 3000));
  };

  const busy = state !== 'idle';

  return (
    <div className={`${card} space-y-3`}>
      <div>
        <h2 className="font-display text-base font-bold text-[#1A1B20]">Send us feedback</h2>
        <p className="mt-1 text-sm text-[#505460] leading-relaxed">
          Found a problem or have an idea? Tell us below.
        </p>
      </div>

      <div>
        <label htmlFor="support-feedback" className="sr-only">
          Your feedback
        </label>
        <textarea
          id="support-feedback"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={busy}
          rows={4}
          maxLength={1000}
          placeholder="Write your feedback here..."
          className="w-full rounded-xl bg-[#F6F7F9] border border-[#1A1B20]/[0.08] px-3.5 py-2.5 text-sm text-[#1A1B20] placeholder:text-[#8E93A2] focus:outline-none focus:ring-2 focus:ring-[#1D1E23]/20 resize-none disabled:opacity-60"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          aria-label={state === 'sent' ? 'Feedback sent' : state === 'sending' ? 'Sending feedback' : 'Send feedback'}
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
          {state === 'sent' ? 'Thanks! Your feedback has been sent.' : ''}
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

const SupportPage: React.FC<{ onNavigate: (s: AppScreen) => void }> = ({ onNavigate }) => {
  const { supportEmail, supportWhatsApp, supportPhone } = SITE_INFO;
  const hasContact = Boolean(supportEmail || supportWhatsApp || supportPhone);

  return (
    <div className="space-y-4">
      <div className={`${card} space-y-3`}>
        <h2 className="font-display text-base font-bold text-[#1A1B20]">Contact us</h2>
        {hasContact ? (
          <div className="space-y-2.5">
            {supportWhatsApp && (
              <ContactRow
                icon={<MessageCircle className="w-4 h-4" />}
                label="WhatsApp"
                value={`+${supportWhatsApp.replace(/\D/g, '')}`}
                href={`https://wa.me/${supportWhatsApp.replace(/\D/g, '')}`}
                external
              />
            )}
            {supportEmail && (
              <ContactRow
                icon={<Mail className="w-4 h-4" />}
                label="Email"
                value={supportEmail}
                href={`mailto:${supportEmail}?subject=${encodeURIComponent('pqguide support')}`}
              />
            )}
            {supportPhone && (
              <ContactRow
                icon={<Phone className="w-4 h-4" />}
                label="Phone"
                value={supportPhone}
                href={`tel:${supportPhone.replace(/[^\d+]/g, '')}`}
              />
            )}
          </div>
        ) : (
          <p className="text-sm text-[#505460] leading-relaxed">
            Contact details will appear here soon. In the meantime, leave your feedback below or
            check the Help page.
          </p>
        )}
      </div>

      <FeedbackForm />

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
  const [helpQuery, setHelpQuery] = useState('');

  // Each visit to Help starts with an empty search.
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
      {page === 'services' && <ServicesPage onNavigate={onNavigate} />}
      {page === 'help' && <HelpPage query={helpQuery} onNavigate={onNavigate} />}
      {page === 'support' && <SupportPage onNavigate={onNavigate} />}
    </div>
  );
};
