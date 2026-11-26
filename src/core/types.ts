export type SemesterType = 'First Semester' | 'Second Semester';

export type DocumentSourceType = 'scanned_image' | 'typed_document';

export type UserRole = 'student' | 'school_admin' | 'super_admin';

export type WorkspaceViewMode = 'super_admin' | 'school_admin' | 'student';

export type AuthPortal = 'student' | 'school_admin' | 'super_admin';

export type StudentLevel = '100L' | '200L' | '300L' | '400L' | '500L';

export type AccountStatus =
  | 'active'
  | 'restricted'
  | 'suspended'
  | 'banned'
  | 'revoked';

export type ContentStatus = 'published' | 'draft' | 'review';

export type BroadcastAudience = 'all' | 'students' | 'admins';

export type SuperAdminSectionId =
  | 'overview'
  | 'students'
  | 'universities'
  | 'administrators'
  | 'activities'
  | 'actions'
  | 'announcements'
  | 'support_inbox'
  | 'past_questions'
  | 'study_materials'
  | 'payments'
  | 'settings';

export type AppScreen =
  | 'home'
  | 'past_questions'
  | 'reader'
  | 'notifications'
  | 'materials'
  | 'about'
  | 'services'
  | 'help'
  | 'support'
  | 'material_reader'
  | 'mock_exam'
  | 'performance'
  | 'school_admin'
  | 'super_admin'
  | 'subscription';

export interface School {
  id: string;
  code: string;
  name: string;
  shortName: string;
  location: string;
  isActive: boolean;
  isPrimaryLaunch: boolean;
}

export interface MaterialSection {
  heading: string;
  paragraphs?: string[];
  /** Short bullet points, shown under the paragraphs. */
  points?: string[];
}

/**
 * Dedicated data model for Study Materials / Reading Guides.
 * Intentionally separated from PastQuestionDoc so guides, uploaded lecture notes,
 * and structured study sections follow their own lifecycle.
 */
export interface StudyMaterial {
  id: string;
  schoolId?: string;
  schoolCode?: string;
  faculty?: string;
  department?: string;
  courseCode: string;
  courseTitle: string;
  level: string;
  title: string;
  summary: string;
  readMinutes: number;
  sections: MaterialSection[];
  sourceType?: DocumentSourceType;
  originalFileName?: string;
  extractedText?: string;
  attachmentPreviewUrl?: string;
  status?: 'published' | 'draft';
  uploadedBy?: string;
  uploadedAt?: string;
  updatedAt?: string;
}

export interface QuestionSolution {
  /** The short, final answer shown in the dark answer card. */
  answer: string;
  /** Step-by-step working, one entry per step (line breaks are preserved). */
  explanation: string[];
}

export interface PastQuestionDoc {
  id: string;
  schoolId: string;
  schoolCode: string;
  courseCode: string;
  courseTitle: string;
  department: string;
  faculty: string;
  level: StudentLevel;
  session: string; // e.g. "2023/2024"
  year: number; // e.g. 2024
  semester: SemesterType;
  sourceType: DocumentSourceType;
  originalFileName: string;
  scannedPagePreviewUrl?: string;
  extractedText: string;
  questions: string[];
  /** Optional worked answers, index-aligned with `questions` (null = not added yet). */
  solutions?: Array<QuestionSolution | null>;
  uploadedBy: string;
  uploadedById?: string;
  uploadedAt: string; // ISO string
  updatedAt?: string;
  viewsCount: number;
  status: ContentStatus;
}

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  category: 'upload' | 'access' | 'system';
  audience?: BroadcastAudience;
  targetUserId?: string;
  createdAt: string;
  isRead: boolean;
  targetDocId?: string;
  createdBy?: string;
}

export interface SuperAdminNotification {
  id: string;
  title: string;
  message: string;
  actorName: string;
  actorRoleLabel: string;
  schoolCode?: string;
  categoryLabel: string;
  detail: string;
  createdAt: string;
  isRead: boolean;
}

export interface HeaderMarqueeConfig {
  enabled: boolean;
  message: string;
  audience: BroadcastAudience;
  tone: 'neutral' | 'important' | 'urgent';
  updatedAt: string;
  updatedBy: string;
}

export type PaymentProvider = 'paystack' | 'flutterwave';

export interface PaymentTransaction {
  id: string;
  reference: string;
  provider: PaymentProvider;
  userId: string;
  userName: string;
  userEmail: string;
  matricNumber?: string;
  level?: StudentLevel;
  tierId: 'standard' | 'pro_ai';
  tierName: string;
  billingPeriod: 'monthly' | 'semester' | 'yearly';
  amountNaira: number;
  status: 'verified_auto' | 'pending' | 'failed';
  autoActivated: boolean;
  createdAt: string;
  verifiedAt?: string;
}

export interface UserActivityEvent {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  userEmail: string;
  userRole: UserRole;
  matricNumber?: string;
  level?: StudentLevel;
  type:
    | 'site_visit'
    | 'signup'
    | 'login'
    | 'logout'
    | 'doc_opened'
    | 'material_opened'
    | 'exam_completed'
    | 'payment_verified';
  detail: string;
}

export interface VisitorTelemetry {
  totalVisits: number;
  uniqueVisitorIds: string[];
  lastVisitAt?: string;
}

export interface ManagedAccount {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  schoolId?: string;
  schoolCode: string;
  status: AccountStatus;
  adminVerified?: boolean;
  needsPasswordSetup?: boolean;
  level?: StudentLevel;
  faculty?: string;
  department?: string;
  subscriptionTier?: 'free' | 'standard' | 'pro_ai' | 'infinity';
  sessionState?: 'logged_in' | 'logged_out';
  lastLoginAt?: string;
  lastLogoutAt?: string;
  lastActiveAt: string;
  createdBy?: string;
  createdAt?: string;
  matricNumber?: string;
  warningsCount?: number;
  moderationNote?: string;
  lastModeratedAt?: string;
}

export interface SupportTicket {
  id: string;
  senderUserId?: string;
  senderRole: UserRole;
  senderName: string;
  senderEmail: string;
  senderMatric?: string;
  senderLevel?: StudentLevel;
  kind: 'Question' | 'Missing Paper' | 'Report Issue';
  message: string;
  status: 'new' | 'reviewed' | 'resolved';
  adminReply?: string;
  repliedBy?: string;
  repliedAt?: string;
  createdAt: string;
}

export interface SiteCmsServiceItem {
  title: string;
  description: string;
}

export interface SiteCmsFaqItem {
  question: string;
  answer: string;
}

export type SettingsUiTarget = 'normal_website' | 'uni_admins' | 'company_admins';

export interface SiteCmsConfig {
  studentUi: {
    homeHeroTitle: string;
    homeSearchPlaceholder: string;
    featuredHeading: string;
    guideTitle: string;
    guideStep1: string;
    guideStep2: string;
    guideStep3: string;
    pastQuestionsHeading: string;
    pastQuestionsTitle: string;
    pastQuestionsSubtitle: string;
    materialsTitle: string;
    materialsSubtitle: string;
    mockExamEyebrow: string;
    mockExamHeadline: string;
    mockExamDescription: string;
  };
  performancePage: {
    heading: string;
    emptyTitle: string;
    emptyBody: string;
    combinedLabel: string;
    overallHeading: string;
    overallSubtitle: string;
  };
  notificationsPage: {
    heading: string;
    emptyTitle: string;
    emptyBody: string;
  };
  subscriptionPage: {
    heading: string;
    subtitle: string;
    freeTierName: string;
    standardTierName: string;
    aiTierName: string;
    checkoutNote: string;
  };
  schoolAdminUi: {
    deskLabel: string;
    deskHeadline: string;
    deskDescription: string;
    uploadPanelTitle: string;
    uploadPanelHint: string;
    catalogPanelTitle: string;
    draftNotice: string;
  };
  aboutPage: {
    eyebrow: string;
    heading: string;
    lead: string;
    card1Title: string;
    card1Body: string;
    card2Title: string;
    card2Body: string;
    card3Title: string;
    card3Body: string;
  };
  servicesPage: {
    eyebrow: string;
    heading: string;
    lead: string;
    items: SiteCmsServiceItem[];
  };
  helpPage: {
    eyebrow: string;
    heading: string;
    lead: string;
    howItWorks: string[];
    faqs: SiteCmsFaqItem[];
  };
  supportPage: {
    eyebrow: string;
    heading: string;
    lead: string;
    email: string;
    whatsappNumber: string;
    whatsappLabel: string;
    phone: string;
    hours: string;
    formTitle: string;
    formSubtitle: string;
  };
  updatedAt?: string;
  updatedBy?: string;
}

export interface ArchiveFilter {
  schoolId: string;
  session: string;
  semester: SemesterType | 'All';
  level: string;
  query: string;
}

/**
 * Internal credential record persisted in the local auth directory.
 * Never store passwordHash or passwordSalt inside active session payloads.
 */
export interface StudentAccount {
  id: string;
  fullName: string;
  matricNumber: string;
  level?: StudentLevel;
  faculty: string;
  department: string;
  email: string;
  role: UserRole;
  status: AccountStatus;
  adminVerified?: boolean;
  needsPasswordSetup?: boolean;
  assignedSchoolId?: string;
  assignedSchoolCode?: string;
  warningsCount?: number;
  moderationNote?: string;
  passwordHash: string;
  passwordSalt: string;
  isEmailVerified: boolean;
  createdAt: string;
  createdBy?: string;
  updatedAt?: string;
}

/**
 * Safe public user representation exposed to React components and guards.
 * Excludes passwordHash and passwordSalt.
 */
export type AuthenticatedUser = Omit<StudentAccount, 'passwordHash' | 'passwordSalt'>;

export interface ActiveSessionRecord {
  sessionId: string;
  userId: string;
  issuedAt: number;
  expiresAt: number;
}

export type AuditActionType =
  | 'super_admin_bootstrapped'
  | 'admin_created'
  | 'admin_invited'
  | 'admin_updated'
  | 'admin_verified'
  | 'admin_university_changed'
  | 'admin_suspended'
  | 'admin_reactivated'
  | 'admin_revoked'
  | 'account_verified'
  | 'account_warned'
  | 'account_restricted'
  | 'account_suspended'
  | 'account_banned'
  | 'account_reactivated'
  | 'role_changed'
  | 'university_created'
  | 'university_updated'
  | 'university_status_changed'
  | 'pq_uploaded'
  | 'pq_updated'
  | 'pq_published'
  | 'pq_unpublished'
  | 'pq_deleted'
  | 'material_uploaded'
  | 'material_updated'
  | 'material_published'
  | 'material_unpublished'
  | 'material_deleted'
  | 'broadcast_sent'
  | 'marquee_updated'
  | 'support_replied'
  | 'cms_updated'
  | 'payment_verified'
  | 'dev_data_reset';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actorId: string;
  actorName: string;
  actorEmail: string;
  actorRole: UserRole;
  action: AuditActionType;
  targetType:
    | 'account'
    | 'school'
    | 'past_question'
    | 'study_material'
    | 'broadcast'
    | 'payment'
    | 'support'
    | 'cms'
    | 'system';
  targetId: string;
  summary: string;
  schoolId?: string;
}
