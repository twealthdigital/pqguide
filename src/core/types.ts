export type SemesterType = 'First Semester' | 'Second Semester';

export type DocumentSourceType = 'scanned_image' | 'typed_document';

export type UserRole = 'student' | 'school_admin' | 'super_admin';

export type SubscriptionCadence = 'monthly' | 'semester' | 'session';

export type SubscriptionTierId =
  | 'free'
  | 'monthly_500'
  | 'monthly_1000'
  | 'semester_2000'
  | 'semester_3500'
  | 'session_5000'
  | 'session_8500';

export type AppScreen =
  | 'home'
  | 'reader'
  | 'notifications'
  | 'subscription'
  | 'school_admin'
  | 'super_admin';

export interface School {
  id: string;
  code: string;
  name: string;
  shortName: string;
  location: string;
  isActive: boolean;
  isPrimaryLaunch: boolean;
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
  level: '100L' | '200L' | '300L' | '400L' | '500L';
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
  isFreePreview: boolean;
  uploadedBy: string;
  uploadedAt: string; // ISO string
  viewsCount: number;
  status: 'published' | 'review';
}

export interface SubscriptionPlan {
  id: SubscriptionTierId;
  cadence: SubscriptionCadence;
  name: string;
  audience: string;
  priceNaira: number;
  periodLabel: string;
  includesFullArchive: boolean;
  includesAiAccess: boolean;
  aiNote?: string;
  features: string[];
  highlighted?: boolean;
}

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  category: 'upload' | 'access' | 'billing' | 'system';
  createdAt: string;
  isRead: boolean;
  targetDocId?: string;
}

export interface ManagedAccount {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  schoolCode: string;
  tierId: SubscriptionTierId;
  status: 'active' | 'suspended';
  lastActiveAt: string;
}

export interface ArchiveFilter {
  schoolId: string;
  session: string;
  semester: SemesterType | 'All';
  level: string;
  query: string;
}

export interface StudentAccount {
  id: string;
  fullName: string;
  matricNumber: string;
  faculty: string;
  department: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  isEmailVerified: boolean;
  createdAt: string;
}
