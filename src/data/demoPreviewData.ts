import type {
  AuditLogEntry,
  ManagedAccount,
  PaymentProvider,
  PaymentTransaction,
  StudentLevel,
  SupportTicket,
  UserActivityEvent,
} from '../core/types';
import { localStore } from '../services/storage/localStore';

/**
 * TEMPORARY REALISTIC DEMO PREVIEW DATASET
 * ----------------------------------------
 * Provides realistic non-hardwired student, payment, activity, support, and audit
 * records so overview rolling windows, custom calendar, performance charts, and admin
 * tables respond naturally as live operational data.
 *
 * To remove completely:
 * 1) Delete this file (src/data/demoPreviewData.ts)
 * 2) Remove the single `applyDemoPreviewDataset` import/call in src/services/archiveRepository.ts
 */

export const DEMO_PREVIEW_FLAG_KEY = 'pqguide_demo_preview_seeded_v1';

interface DemoDatasetBundle {
  accounts: ManagedAccount[];
  payments: PaymentTransaction[];
  userActivities: UserActivityEvent[];
  supportTickets: SupportTicket[];
  auditLogs: AuditLogEntry[];
  extraVisitsCount: number;
  visitorIds: string[];
}

interface DemoStudentProfile {
  id: string;
  fullName: string;
  email: string;
  matricNumber: string;
  level: StudentLevel;
  faculty: string;
  department: string;
  subscriptionTier: 'free' | 'standard';
  sessionState: 'logged_in' | 'logged_out';
  hoursSinceActive: number;
}

const DEMO_STUDENT_PROFILES: DemoStudentProfile[] = [
  {
    id: 'demo-acc-stu-1',
    fullName: 'Oluwadamilare Ayodele',
    email: 'o.ayodele@aaua.edu.ng',
    matricNumber: '230404018',
    level: '200L',
    faculty: 'Computing & Information Sciences',
    department: 'Computer Science',
    subscriptionTier: 'standard',
    sessionState: 'logged_in',
    hoursSinceActive: 0.4,
  },
  {
    id: 'demo-acc-stu-2',
    fullName: 'Zainab Abdullahi',
    email: 'z.abdullahi@aaua.edu.ng',
    matricNumber: '240201062',
    level: '100L',
    faculty: 'Management Sciences',
    department: 'Accounting',
    subscriptionTier: 'standard',
    sessionState: 'logged_in',
    hoursSinceActive: 1.2,
  },
  {
    id: 'demo-acc-stu-3',
    fullName: 'Chukwuemeka Nwosu',
    email: 'c.nwosu@aaua.edu.ng',
    matricNumber: '220301035',
    level: '300L',
    faculty: 'Social Sciences',
    department: 'Economics',
    subscriptionTier: 'standard',
    sessionState: 'logged_out',
    hoursSinceActive: 5.5,
  },
  {
    id: 'demo-acc-stu-4',
    fullName: 'Motunrayo Alabi',
    email: 'm.alabi@aaua.edu.ng',
    matricNumber: '210502014',
    level: '400L',
    faculty: 'Law',
    department: 'Common & Islamic Law',
    subscriptionTier: 'standard',
    sessionState: 'logged_in',
    hoursSinceActive: 2.8,
  },
  {
    id: 'demo-acc-stu-5',
    fullName: 'Ibrahim Suleiman',
    email: 'i.suleiman@aaua.edu.ng',
    matricNumber: '240404091',
    level: '100L',
    faculty: 'Science',
    department: 'Microbiology',
    subscriptionTier: 'free',
    sessionState: 'logged_out',
    hoursSinceActive: 14,
  },
  {
    id: 'demo-acc-stu-6',
    fullName: 'Favour Olawale',
    email: 'f.olawale@aaua.edu.ng',
    matricNumber: '230305027',
    level: '200L',
    faculty: 'Social Sciences',
    department: 'Mass Communication',
    subscriptionTier: 'standard',
    sessionState: 'logged_out',
    hoursSinceActive: 27,
  },
  {
    id: 'demo-acc-stu-7',
    fullName: 'Temitope Babatunde',
    email: 't.babatunde@aaua.edu.ng',
    matricNumber: '220103073',
    level: '300L',
    faculty: 'Science',
    department: 'Biochemistry',
    subscriptionTier: 'standard',
    sessionState: 'logged_out',
    hoursSinceActive: 52,
  },
  {
    id: 'demo-acc-stu-8',
    fullName: 'Daniel Etim',
    email: 'd.etim@aaua.edu.ng',
    matricNumber: '240102049',
    level: '100L',
    faculty: 'Arts',
    department: 'English Studies',
    subscriptionTier: 'free',
    sessionState: 'logged_in',
    hoursSinceActive: 0.9,
  },
];

interface PaymentSeedSpec {
  studentIdx: number;
  hoursAgo: number;
  provider: PaymentProvider;
  billingPeriod: 'monthly' | 'semester' | 'yearly';
  status: PaymentTransaction['status'];
}

const AMOUNT_BY_PERIOD: Record<'monthly' | 'semester' | 'yearly', number> = {
  monthly: 1000,
  semester: 3200,
  yearly: 5500,
};

const PAYMENT_SPECS: PaymentSeedSpec[] = [
  // Last 24 Hours (Today & yesterday evening — immediate live window & Today calendar)
  { studentIdx: 0, hoursAgo: 1.5, provider: 'paystack', billingPeriod: 'semester', status: 'verified_auto' },
  { studentIdx: 1, hoursAgo: 3.4, provider: 'flutterwave', billingPeriod: 'monthly', status: 'verified_auto' },
  { studentIdx: 7, hoursAgo: 5.2, provider: 'paystack', billingPeriod: 'monthly', status: 'pending' },
  { studentIdx: 3, hoursAgo: 9.0, provider: 'paystack', billingPeriod: 'yearly', status: 'verified_auto' },
  { studentIdx: 4, hoursAgo: 15.5, provider: 'flutterwave', billingPeriod: 'semester', status: 'failed' },

  // Days 2–7 ago (Last 7 Days window + 7-day chart + calendar week)
  { studentIdx: 2, hoursAgo: 31, provider: 'paystack', billingPeriod: 'semester', status: 'verified_auto' },
  { studentIdx: 5, hoursAgo: 44, provider: 'flutterwave', billingPeriod: 'yearly', status: 'verified_auto' },
  { studentIdx: 6, hoursAgo: 56, provider: 'paystack', billingPeriod: 'monthly', status: 'pending' },
  { studentIdx: 0, hoursAgo: 78, provider: 'paystack', billingPeriod: 'monthly', status: 'verified_auto' },
  { studentIdx: 1, hoursAgo: 99, provider: 'flutterwave', billingPeriod: 'semester', status: 'verified_auto' },
  { studentIdx: 4, hoursAgo: 122, provider: 'paystack', billingPeriod: 'monthly', status: 'failed' },
  { studentIdx: 3, hoursAgo: 138, provider: 'flutterwave', billingPeriod: 'semester', status: 'verified_auto' },
  { studentIdx: 2, hoursAgo: 155, provider: 'paystack', billingPeriod: 'yearly', status: 'verified_auto' },

  // Days 8–30 ago (Month window + historical calendar days with non-today banner)
  { studentIdx: 5, hoursAgo: 9 * 24 + 4, provider: 'paystack', billingPeriod: 'semester', status: 'verified_auto' },
  { studentIdx: 6, hoursAgo: 10 * 24 + 7, provider: 'flutterwave', billingPeriod: 'monthly', status: 'verified_auto' },
  { studentIdx: 7, hoursAgo: 12 * 24 + 3, provider: 'paystack', billingPeriod: 'monthly', status: 'failed' },
  { studentIdx: 1, hoursAgo: 14 * 24 + 5, provider: 'paystack', billingPeriod: 'yearly', status: 'verified_auto' },
  { studentIdx: 0, hoursAgo: 15 * 24 + 8, provider: 'flutterwave', billingPeriod: 'semester', status: 'pending' },
  { studentIdx: 3, hoursAgo: 18 * 24 + 2, provider: 'paystack', billingPeriod: 'semester', status: 'verified_auto' },
  { studentIdx: 2, hoursAgo: 21 * 24 + 6, provider: 'flutterwave', billingPeriod: 'yearly', status: 'verified_auto' },
  { studentIdx: 5, hoursAgo: 23 * 24 + 4, provider: 'paystack', billingPeriod: 'monthly', status: 'verified_auto' },
  { studentIdx: 6, hoursAgo: 26 * 24 + 9, provider: 'paystack', billingPeriod: 'semester', status: 'verified_auto' },
  { studentIdx: 4, hoursAgo: 28 * 24 + 3, provider: 'flutterwave', billingPeriod: 'monthly', status: 'failed' },

  // Past 2–11 months (Year rolling window + 12 Months / 52 Weeks / 365 Days chart)
  { studentIdx: 0, hoursAgo: 42 * 24, provider: 'paystack', billingPeriod: 'yearly', status: 'verified_auto' },
  { studentIdx: 2, hoursAgo: 58 * 24, provider: 'flutterwave', billingPeriod: 'semester', status: 'verified_auto' },
  { studentIdx: 1, hoursAgo: 74 * 24, provider: 'paystack', billingPeriod: 'semester', status: 'verified_auto' },
  { studentIdx: 3, hoursAgo: 98 * 24, provider: 'paystack', billingPeriod: 'yearly', status: 'verified_auto' },
  { studentIdx: 6, hoursAgo: 112 * 24, provider: 'flutterwave', billingPeriod: 'monthly', status: 'pending' },
  { studentIdx: 5, hoursAgo: 135 * 24, provider: 'paystack', billingPeriod: 'semester', status: 'verified_auto' },
  { studentIdx: 4, hoursAgo: 162 * 24, provider: 'flutterwave', billingPeriod: 'yearly', status: 'verified_auto' },
  { studentIdx: 2, hoursAgo: 194 * 24, provider: 'paystack', billingPeriod: 'semester', status: 'verified_auto' },
  { studentIdx: 0, hoursAgo: 224 * 24, provider: 'flutterwave', billingPeriod: 'monthly', status: 'verified_auto' },
  { studentIdx: 7, hoursAgo: 256 * 24, provider: 'paystack', billingPeriod: 'semester', status: 'failed' },
  { studentIdx: 1, hoursAgo: 285 * 24, provider: 'paystack', billingPeriod: 'yearly', status: 'verified_auto' },
  { studentIdx: 3, hoursAgo: 318 * 24, provider: 'flutterwave', billingPeriod: 'semester', status: 'verified_auto' },
  { studentIdx: 6, hoursAgo: 344 * 24, provider: 'paystack', billingPeriod: 'monthly', status: 'verified_auto' },
];

export function buildDemoPreviewDataset(nowMs: number = Date.now()): DemoDatasetBundle {
  const isoAgo = (hoursAgo: number) =>
    new Date(nowMs - Math.round(hoursAgo * 3_600_000)).toISOString();

  const accounts: ManagedAccount[] = DEMO_STUDENT_PROFILES.map((s) => {
    const activeIso = isoAgo(s.hoursSinceActive);
    return {
      id: s.id,
      fullName: s.fullName,
      email: s.email,
      role: 'student',
      schoolId: 'sch-aaua',
      schoolCode: 'AAUA',
      status: 'active',
      adminVerified: true,
      needsPasswordSetup: false,
      level: s.level,
      faculty: s.faculty,
      department: s.department,
      subscriptionTier: s.subscriptionTier,
      sessionState: s.sessionState,
      lastLoginAt: activeIso,
      lastLogoutAt: s.sessionState === 'logged_out' ? activeIso : undefined,
      lastActiveAt: activeIso,
      matricNumber: s.matricNumber,
      createdAt: isoAgo(24 * 45),
    };
  });

  const payments: PaymentTransaction[] = PAYMENT_SPECS.map((spec, idx) => {
    const stu = DEMO_STUDENT_PROFILES[spec.studentIdx];
    const tsIso = isoAgo(spec.hoursAgo);
    const amountNaira = AMOUNT_BY_PERIOD[spec.billingPeriod];
    const prefix = spec.provider === 'paystack' ? 'PSK' : 'FLW';
    const refNum = String(409100 + idx * 37);

    return {
      id: `demo-pay-${idx + 1}`,
      reference: `${prefix}-AAUA-${refNum}`,
      provider: spec.provider,
      userId: stu.id,
      userName: stu.fullName,
      userEmail: stu.email,
      matricNumber: stu.matricNumber,
      level: stu.level,
      tierId: 'standard' as const,
      tierName: 'Standard Pass',
      billingPeriod: spec.billingPeriod,
      amountNaira,
      status: spec.status,
      autoActivated: spec.status === 'verified_auto',
      createdAt: tsIso,
      verifiedAt: spec.status === 'verified_auto' ? tsIso : undefined,
    };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const activitySpecs: Array<{
    studentIdx: number;
    hoursAgo: number;
    type: UserActivityEvent['type'];
    detail: string;
  }> = [
    { studentIdx: 0, hoursAgo: 0.4, type: 'exam_completed', detail: 'Completed GNS 101 CBT Practice Exam (85%)' },
    { studentIdx: 1, hoursAgo: 1.2, type: 'doc_opened', detail: 'Opened AAUA GNS 102 (2023/2024) Past Question' },
    { studentIdx: 7, hoursAgo: 1.9, type: 'site_visit', detail: 'Visited AAUA Past Questions home directory' },
    { studentIdx: 3, hoursAgo: 2.8, type: 'material_opened', detail: 'Read GNS 103 Library & ICT Study Guide' },
    { studentIdx: 0, hoursAgo: 4.1, type: 'login', detail: 'Signed in on Web Portal (AAUA)' },
    { studentIdx: 2, hoursAgo: 7.5, type: 'exam_completed', detail: 'Completed GNS 102 Objective Exam (78%)' },
    { studentIdx: 4, hoursAgo: 11.2, type: 'signup', detail: 'Created student account (240404091 · 100L)' },
    { studentIdx: 5, hoursAgo: 27, type: 'exam_completed', detail: 'Completed GNS 103 Practice Exam (90%)' },
    { studentIdx: 1, hoursAgo: 38, type: 'doc_opened', detail: 'Opened GNS 101 Harmattan Past Questions' },
    { studentIdx: 6, hoursAgo: 52, type: 'login', detail: 'Signed in to review 300L study guides' },
    { studentIdx: 3, hoursAgo: 74, type: 'exam_completed', detail: 'Completed GNS 101 Theory Practice (82%)' },
    { studentIdx: 2, hoursAgo: 96, type: 'material_opened', detail: 'Opened GNS 101 Use of English Reading Guide' },
    { studentIdx: 7, hoursAgo: 120, type: 'signup', detail: 'Created student account (240102049 · 100L)' },
    { studentIdx: 0, hoursAgo: 152, type: 'doc_opened', detail: 'Opened GNS 103 2024/2025 Harmattan paper' },
    { studentIdx: 5, hoursAgo: 196, type: 'exam_completed', detail: 'Completed GNS 102 Practice Exam (88%)' },
    { studentIdx: 4, hoursAgo: 260, type: 'site_visit', detail: 'Browsed AAUA 100L General Studies catalog' },
    { studentIdx: 1, hoursAgo: 340, type: 'exam_completed', detail: 'Completed GNS 101 True/False Sprint (95%)' },
    { studentIdx: 6, hoursAgo: 450, type: 'doc_opened', detail: 'Opened GNS 102 Rain Semester Past Question' },
    { studentIdx: 2, hoursAgo: 620, type: 'signup', detail: 'Created student account (220301035 · 300L)' },
    { studentIdx: 3, hoursAgo: 940, type: 'exam_completed', detail: 'Completed GNS 103 Full Mock (80%)' },
    { studentIdx: 0, hoursAgo: 1380, type: 'login', detail: 'Signed in on Web Portal (AAUA)' },
  ];

  const paymentActivities: UserActivityEvent[] = payments
    .filter((p) => p.status === 'verified_auto')
    .slice(0, 12)
    .map((p, idx) => ({
      id: `demo-act-pay-${idx + 1}`,
      timestamp: p.verifiedAt ?? p.createdAt,
      userId: p.userId,
      userName: p.userName,
      userEmail: p.userEmail,
      userRole: 'student',
      matricNumber: p.matricNumber,
      level: p.level,
      type: 'payment_verified',
      detail: `${p.provider === 'paystack' ? 'Paystack' : 'Flutterwave'} auto-verified ${p.tierName} (₦${p.amountNaira.toLocaleString()}) · Ref ${p.reference}`,
    }));

  const userActivities: UserActivityEvent[] = [
    ...activitySpecs.map((spec, idx) => {
      const stu = DEMO_STUDENT_PROFILES[spec.studentIdx];
      return {
        id: `demo-act-${idx + 1}`,
        timestamp: isoAgo(spec.hoursAgo),
        userId: stu.id,
        userName: stu.fullName,
        userEmail: stu.email,
        userRole: 'student' as const,
        matricNumber: stu.matricNumber,
        level: stu.level,
        type: spec.type,
        detail: spec.detail,
      };
    }),
    ...paymentActivities,
  ].sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const supportTickets: SupportTicket[] = [
    {
      id: 'demo-sup-1',
      senderUserId: DEMO_STUDENT_PROFILES[1].id,
      senderRole: 'student',
      senderName: DEMO_STUDENT_PROFILES[1].fullName,
      senderEmail: DEMO_STUDENT_PROFILES[1].email,
      senderMatric: DEMO_STUDENT_PROFILES[1].matricNumber,
      senderLevel: DEMO_STUDENT_PROFILES[1].level,
      kind: 'Missing Paper',
      message: 'Please could the 2022/2023 ACC 102 Rain Semester past question be uploaded for 100L Accounting?',
      status: 'new',
      createdAt: isoAgo(4.5),
    },
    {
      id: 'demo-sup-2',
      senderUserId: DEMO_STUDENT_PROFILES[4].id,
      senderRole: 'student',
      senderName: DEMO_STUDENT_PROFILES[4].fullName,
      senderEmail: DEMO_STUDENT_PROFILES[4].email,
      senderMatric: DEMO_STUDENT_PROFILES[4].matricNumber,
      senderLevel: DEMO_STUDENT_PROFILES[4].level,
      kind: 'Question',
      message: 'My Flutterwave checkout timed out earlier before redirecting. How soon can I retry Standard Pass?',
      status: 'new',
      createdAt: isoAgo(15),
    },
    {
      id: 'demo-sup-3',
      senderUserId: DEMO_STUDENT_PROFILES[2].id,
      senderRole: 'student',
      senderName: DEMO_STUDENT_PROFILES[2].fullName,
      senderEmail: DEMO_STUDENT_PROFILES[2].email,
      senderMatric: DEMO_STUDENT_PROFILES[2].matricNumber,
      senderLevel: DEMO_STUDENT_PROFILES[2].level,
      kind: 'Report Issue',
      message: 'GNS 102 worked step notes are super helpful, thank you for adding the grammar rules summary.',
      status: 'resolved',
      adminReply: 'Glad it helped! Keep checking Materials for new 300L guides.',
      repliedBy: 'AAUA Support Desk',
      repliedAt: isoAgo(42),
      createdAt: isoAgo(48),
    },
  ];

  const auditLogs: AuditLogEntry[] = [
    {
      id: 'demo-audit-1',
      timestamp: isoAgo(1.5),
      actorId: DEMO_STUDENT_PROFILES[0].id,
      actorName: DEMO_STUDENT_PROFILES[0].fullName,
      actorEmail: DEMO_STUDENT_PROFILES[0].email,
      actorRole: 'student',
      action: 'payment_verified',
      targetType: 'payment',
      targetId: 'demo-pay-1',
      summary: 'Paystack auto-verified ₦3,200 for Oluwadamilare Ayodele (230404018) · Ref PSK-AAUA-409100',
    },
    {
      id: 'demo-audit-2',
      timestamp: isoAgo(6.5),
      actorId: 'acc-2',
      actorName: 'Dr. Femi Ogunleye (Exam Unit)',
      actorEmail: 'examoffice@aaua.edu.ng',
      actorRole: 'school_admin',
      action: 'pq_published',
      targetType: 'past_question',
      targetId: 'pq-aaua-gns103-2425',
      summary: 'Published GNS 103 (2024/2025 Harmattan) past question & worked answers · AAUA',
      schoolId: 'sch-aaua',
    },
    {
      id: 'demo-audit-3',
      timestamp: isoAgo(22),
      actorId: 'acc-2',
      actorName: 'Dr. Femi Ogunleye (Exam Unit)',
      actorEmail: 'examoffice@aaua.edu.ng',
      actorRole: 'school_admin',
      action: 'material_uploaded',
      targetType: 'study_material',
      targetId: 'mat-gns103',
      summary: 'Updated GNS 103 Library & ICT study guide sections · AAUA',
      schoolId: 'sch-aaua',
    },
    {
      id: 'demo-audit-4',
      timestamp: isoAgo(42),
      actorId: 'acc-2',
      actorName: 'Dr. Femi Ogunleye (Exam Unit)',
      actorEmail: 'examoffice@aaua.edu.ng',
      actorRole: 'school_admin',
      action: 'support_replied',
      targetType: 'support',
      targetId: 'demo-sup-3',
      summary: 'Replied to student ticket from Chukwuemeka Nwosu (Economics 300L)',
      schoolId: 'sch-aaua',
    },
  ];

  const visitorIds = Array.from({ length: 64 }, (_, i) => `demo-vis-${i + 1}`);

  return {
    accounts,
    payments,
    userActivities,
    supportTickets,
    auditLogs,
    extraVisitsCount: 184,
    visitorIds,
  };
}

export function isDemoPreviewId(id: string): boolean {
  return id.startsWith('demo-');
}

export function hasAppliedDemoPreview(): boolean {
  return Boolean(localStore.getItem(DEMO_PREVIEW_FLAG_KEY));
}

export function markDemoPreviewApplied(stateValue: '1' | 'cleared' = '1'): void {
  localStore.setItem(DEMO_PREVIEW_FLAG_KEY, stateValue);
}

export function resetDemoPreviewFlag(): void {
  localStore.removeItem(DEMO_PREVIEW_FLAG_KEY);
}
