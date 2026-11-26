import type { SiteCmsConfig } from '../core/types';

/**
 * Fallback public contact details for Customer Support.
 * Live editable values are stored in archiveRepository.getSnapshot().siteCms.supportPage.
 */
export const SITE_INFO = {
  supportEmail: 'support@pqguide.ng',
  supportWhatsApp: '',
  supportPhone: '',
};

export function createDefaultSiteCms(): SiteCmsConfig {
  return {
    studentUi: {
      homeHeroTitle: 'Find past questions in seconds',
      homeSearchPlaceholder: 'Search course code or topic (e.g. GNS 101)...',
      featuredHeading: 'Featured & Quick Actions',
      guideTitle: 'New here? 3-Step Guide',
      guideStep1: 'Select your Academic Session & Semester above.',
      guideStep2: 'Search any course code (e.g. GNS 101) or keyword.',
      guideStep3: 'Open a past question, then tap View answer under any question.',
      pastQuestionsHeading: 'Past Questions',
      pastQuestionsTitle: 'Past Questions',
      pastQuestionsSubtitle: 'Search verified university exam papers and worked solutions',
      materialsTitle: 'Materials',
      materialsSubtitle: 'Read structured study notes here or download to study offline',
      mockExamEyebrow: 'Practice Exam',
      mockExamHeadline: 'Practice Exam',
      mockExamDescription:
        'Practice under real exam timing with questions drawn from past papers and course guides. Pick your course, format, and question count to start.',
    },
    performancePage: {
      heading: 'Performance',
      emptyTitle: 'No exam performances yet',
      emptyBody:
        'Take a practice exam (OBJ, Theory, True/False, or CBT) and submit it to inspect your missed answers and overall rating out of 100%.',
      combinedLabel: 'Combined progress',
      overallHeading: 'Overall rating',
      overallSubtitle: 'Combined score out of 100% across all graded questions',
    },
    notificationsPage: {
      heading: 'Notifications',
      emptyTitle: 'You are all caught up',
      emptyBody: 'New past question uploads, system notices, and direct replies appear here.',
    },
    subscriptionPage: {
      heading: 'Choose your plan',
      subtitle: 'Select a billing cycle, then tap a plan below.',
      freeTierName: 'Free Starter',
      standardTierName: 'Standard Pass',
      aiTierName: 'AI Scholar',
      checkoutNote: 'Verified automatically on callback and logged for Super Admin reconciliation.',
    },
    schoolAdminUi: {
      deskLabel: 'School Admin Panel · Ingestion Desk',
      deskHeadline: 'Upload & Manage {SCHOOL} Past Questions',
      deskDescription:
        'Your administrator account is scoped strictly to your assigned university. Upload PDF, DOCX, TXT, or scanned exam pages to preview, save as draft, or publish.',
      uploadPanelTitle: '1. Upload Past Question File',
      uploadPanelHint:
        'Accepts JPG, PNG, WEBP, PDF, DOCX, DOC, TXT, MD, CSV (max 10 MB; SVG/HTML/executables blocked)',
      catalogPanelTitle: '{SCHOOL} Past Questions',
      draftNotice: 'Draft papers stay private inside your university desk until published.',
    },
    aboutPage: {
      eyebrow: 'About pqguide',
      heading: 'About pqguide',
      lead: 'The Past Questions Guide',
      card1Title: 'Built for fast university revision',
      card1Body:
        'pqguide is a fast, simple home for university past questions. Search a course code, open the past question and revise with worked answers, all in one place and quick even on a slow connection.',
      card2Title: 'Verified past questions',
      card2Body:
        'Past questions are uploaded by authorized school administrators and verified before they appear to students.',
      card3Title: 'How the practice exam prediction works',
      card3Body:
        'pqguide analyzes available past questions across sessions for your chosen course, prioritizes recurring themes and recent papers, and saves every submission to Performance for score tracking out of 100%.',
    },
    servicesPage: {
      eyebrow: 'Services',
      heading: 'Services',
      lead: 'What you can do on pqguide',
      items: [
        {
          title: 'Past questions home',
          description: 'Find past questions by course code, keyword, session, semester and level.',
        },
        {
          title: 'Worked answers',
          description:
            'Open a past question, then tap View answer under a question to see step-by-step solutions.',
        },
        {
          title: 'Practice exams',
          description:
            'Choose OBJ Paper, Theory Paper, True / False, or CBT with custom question counts and timers.',
        },
        {
          title: 'Performance & overall rating',
          description:
            'Review every submitted exam, inspect missed answers, and view your combined rating out of 100%.',
        },
        {
          title: 'Reading guides',
          description: 'Structured course study materials you can read online or download offline.',
        },
        {
          title: 'Scan-to-PDF uploads for schools',
          description:
            'Authorized school administrators verify and upload past questions so students get clean, searchable papers.',
        },
      ],
    },
    helpPage: {
      eyebrow: 'Help',
      heading: 'Help',
      lead: 'How it works, and quick answers',
      howItWorks: [
        'Find a past question: Pick your academic session and semester on Home, then search any course code or keyword.',
        'Open and read: Tap a paper to view all indexed questions and search inside the paper.',
        'See worked solutions: Tap View answer beneath any question for the final answer and steps.',
        'Practice exams: Pick your course, exam format (OBJ, Theory, T/F, or CBT), question count, and timer to start.',
        'Track scores: Submitted exams save to Performance automatically for answer review and overall rating.',
      ],
      faqs: [
        {
          question: 'I cannot find a past question',
          answer:
            'Search with just the course code (for example GNS 101) and clear any session, semester, or level filters. If it is still missing, reach out via Customer Support.',
        },
        {
          question: 'How do I see the answer to a question?',
          answer:
            'Open the past question, then tap View answer under any question to open the solution sheet.',
        },
        {
          question: 'Where do I see my scores after submitting an exam?',
          answer:
            'Submitting an exam automatically opens Performance, where you can review missed questions and your overall percentage rating.',
        },
        {
          question: 'How do subscriptions and Tier 3 AI Scholar work?',
          answer:
            'Open Subscription Plans from the side panel to compare Free Starter, Standard Pass, and AI Scholar across Monthly, Semester, and Yearly cycles.',
        },
      ],
    },
    supportPage: {
      eyebrow: 'Customer Support',
      heading: 'Customer Support',
      lead: 'We are here to help',
      email: 'support@pqguide.ng',
      whatsappNumber: '',
      whatsappLabel: 'WhatsApp Support',
      phone: '',
      hours: 'Mon – Sat · 8:00 AM – 6:00 PM WAT',
      formTitle: 'Send us a message',
      formSubtitle:
        'Found a missing paper, account issue, or question? Message the Super Admin desk directly below.',
    },
  };
}
