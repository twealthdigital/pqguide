export type SemesterType = 'First Semester' | 'Second Semester';

export type DocumentSourceType = 'scanned_image' | 'typed_document';

export type UserRole = 'student' | 'school_admin' | 'super_admin';

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

export interface MaterialSection {
  heading: string;
  paragraphs?: string[];
  /** Short bullet points, shown under the paragraphs. */
  points?: string[];
}

/** A reading guide students can study from before an exam. */
export interface StudyMaterial {
  id: string;
  courseCode: string;
  courseTitle: string;
  level: string;
  title: string;
  summary: string;
  readMinutes: number;
  sections: MaterialSection[];
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
  uploadedBy: string;
  uploadedAt: string; // ISO string
  viewsCount: number;
  status: 'published' | 'review';
}

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  category: 'upload' | 'access' | 'system';
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
