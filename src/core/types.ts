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
  | 'document_scanner'
  | 'document_review'
  | 'document_library'
  | 'payments'
  | 'settings';

export type SchoolAdminSectionId =
  | 'overview'
  | 'students'
  | 'upload'
  | 'document_library'
  | 'catalog'
  | 'notices';

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
  reconstructedPages?: ExtractedPageContent[];
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
  reconstructedPages?: ExtractedPageContent[];
  uploadedBy: string;
  uploadedById?: string;
  uploadedAt: string; // ISO string
  updatedAt?: string;
  viewsCount: number;
  status: ContentStatus;
}

export type NotificationApprovalStatus =
  | 'approved'
  | 'pending_verification'
  | 'rejected';

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  category: 'upload' | 'access' | 'system';
  audience?: BroadcastAudience;
  targetUserId?: string;
  /** Hide this notice from one person who already got a more specific one. */
  exceptUserId?: string;
  /**
   * Automatic upload, approval, rejection or removal notice (not an announcement
   * written by an admin). These are for admins only and never reach students.
   */
  uploadActivity?: boolean;
  /**
   * Explicit recipients chosen by the Super Admin when publishing or updating a
   * document. When set it overrides `audience` (students only, School Admins only,
   * or both). The Super Admin always sees everything.
   */
  recipients?: DocumentAlertRecipients;
  createdAt: string;
  updatedAt?: string;
  isRead: boolean;
  targetDocId?: string;
  createdBy?: string;
  approvalStatus?: NotificationApprovalStatus;
  schoolId?: string;
  schoolCode?: string;
  submittedById?: string;
  submittedByName?: string;
  submittedByRole?: UserRole;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
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
  tierId: 'standard';
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
  isEmailVerified?: boolean;
  needsPasswordSetup?: boolean;
  level?: StudentLevel;
  faculty?: string;
  department?: string;
  subscriptionTier?: 'free' | 'standard' | 'infinity';
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
  authProvider?: 'local';
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
  rememberMe?: boolean;
  authMode?: 'standard' | 'dev_super_admin_bootstrap';
}

export type SessionClearReason = 'manual' | 'expired' | 'revoked';

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
  | 'notification_submitted'
  | 'notification_verified'
  | 'notification_rejected'
  | 'notification_updated'
  | 'marquee_updated'
  | 'support_replied'
  | 'cms_updated'
  | 'payment_verified'
  | 'doc_scanned'
  | 'doc_auto_approved'
  | 'doc_flagged'
  | 'doc_ai_alert'
  | 'doc_review_approved'
  | 'doc_review_rejected'
  | 'doc_resubmission_requested'
  | 'doc_deleted'
  | 'doc_edited'
  | 'doc_upload_failed'
  | 'dev_data_reset';

export type AcademicDocFormat = 'pdf' | 'image' | 'docx' | 'text' | 'zip';

export type AcademicDocCategory =
  | 'past_question'
  | 'study_material'
  | 'lecture_note'
  | 'lab_diagram'
  | 'reference';

/** Where a published document appears on the student side. */
export type DocumentDestination = 'past_question' | 'study_material';

/** Who is alerted when a document is published. */
export type DocumentAlertRecipients = 'students' | 'school_admins' | 'both';

export interface DocumentPublishOptions {
  /** `auto` lets the scanner's detected category decide. */
  destination: 'auto' | DocumentDestination;
  /** `none` publishes quietly. */
  notify: DocumentAlertRecipients | 'none';
}

export type DocumentPipelineDecision =
  | 'auto_approved'
  | 'flagged'
  | 'rejected'
  | 'pending_review';

export type DocumentPublicationStatus =
  | 'published'
  | 'flagged'
  | 'pending_review'
  | 'rejected'
  | 'resubmission_requested'
  | 'archived';

export type DocumentRiskLevel = 'low' | 'medium' | 'high';

export interface StorageObjectRef {
  adapter: 'indexeddb' | 'memory' | 'object_storage';
  key: string;
  sizeBytes: number;
  mimeType: string;
  storedAt: string;
}

export type ScannerModuleName =
  | 'quality_inspector'
  | 'layout_reconstruction'
  | 'handwriting_htr'
  | 'advanced_tables'
  | 'math_formulas'
  | 'diagram_recognition'
  | 'omr_recognition'
  | 'form_checkbox'
  | 'barcode_qr'
  | 'signature_detection'
  | 'stamp_seal_detection'
  | 'language_detection'
  | 'document_classifier'
  | 'document_integrity'
  | 'academic_metadata';

export type ModuleExecutionStatus =
  | 'executed'
  | 'skipped_not_applicable'
  | 'model_unavailable_partial'
  | 'failed';

export interface ScannerModuleRunReport {
  module: ScannerModuleName;
  status: ModuleExecutionStatus;
  durationMs: number;
  detail?: string;
  missingRequirement?: string;
}

export type DiagramSemanticType =
  | 'flowchart'
  | 'uml_class'
  | 'uml_sequence'
  | 'uml_use_case'
  | 'erd'
  | 'circuit'
  | 'network'
  | 'math_graph'
  | 'geometric'
  | 'scientific_illustration'
  | 'engineering'
  | 'general_diagram';

export interface DiagramNodeItem {
  id: string;
  shape: 'rectangle' | 'circle' | 'diamond' | 'triangle' | 'oval' | 'unknown';
  label?: string;
  bbox: { x: number; y: number; width: number; height: number };
}

export interface DiagramEdgeItem {
  id: string;
  fromNodeId?: string;
  toNodeId?: string;
  directed: boolean;
  dashed?: boolean;
  label?: string;
  points: Array<[number, number]>;
}

export interface VectorDiagramScene {
  width: number;
  height: number;
  diagramType?: DiagramSemanticType;
  nodes?: DiagramNodeItem[];
  edges?: DiagramEdgeItem[];
  measurements?: string[];
  polylines: Array<{
    points: Array<[number, number]>;
    closed?: boolean;
    dashed?: boolean;
    fill?: boolean;
  }>;
  labels?: Array<{
    x: number;
    y: number;
    text: string;
    fontSize?: number;
  }>;
}

export interface ExtractedDiagramAsset {
  id: string;
  pageNumber: number;
  caption: string;
  kind: 'diagram' | 'chart' | 'illustration' | 'table_snapshot' | 'image';
  diagramType?: DiagramSemanticType;
  mimeType?: string;
  dataUrl?: string;
  originalCropDataUrl?: string;
  storageRef?: StorageObjectRef;
  width?: number;
  height?: number;
  bbox?: { x: number; y: number; width: number; height: number };
  vectorScene?: VectorDiagramScene;
  extractedNodes?: DiagramNodeItem[];
  extractedEdges?: DiagramEdgeItem[];
  extractedMeasurements?: string[];
  extractedLabels?: string[];
}

export interface MergedTableCellSpan {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  value: string;
}

export interface ExtractedTable {
  id: string;
  pageNumber: number;
  caption?: string;
  headers: string[];
  rows: string[][];
  rowHeaders?: string[];
  columnHeaderCount?: number;
  columnAlignments?: Array<'left' | 'center' | 'right'>;
  borderStyle?: 'bordered' | 'borderless' | 'mixed';
  hasMergedCells?: boolean;
  mergedCells?: MergedTableCellSpan[];
  continuedFromPage?: number;
  continuesOnPage?: number;
  uncertainStructure?: boolean;
  uncertaintyReason?: string;
  bbox?: { x: number; y: number; width: number; height: number };
  markdown?: string;
  jsonRows?: Array<Record<string, string>>;
}

export type MathExpressionKind =
  | 'fraction'
  | 'power_superscript'
  | 'subscript'
  | 'radical'
  | 'integral_summation'
  | 'matrix'
  | 'algebraic'
  | 'greek_notation'
  | 'scientific_notation'
  | 'general_equation';

export interface ExtractedFormula {
  id: string;
  pageNumber: number;
  rawText: string;
  latex: string;
  displayMode: boolean;
  kind?: MathExpressionKind;
  uncertain?: boolean;
  uncertaintyReason?: string;
  sourceMethod?: 'text_regex' | '2d_layout_ocr' | 'omml_xml' | 'math_adapter';
  confidence?: number;
  bbox?: { x: number; y: number; width: number; height: number };
}

export interface HandwritingRegion {
  id: string;
  pageNumber: number;
  bbox: { x: number; y: number; width: number; height: number };
  classification: 'handwritten' | 'mixed' | 'uncertain_stroke';
  extractedText: string;
  confidence: number | null;
  uncertainWords: string[];
  unreadable: boolean;
  note?: string;
}

export interface HandwritingAnalysisResult {
  detected: boolean;
  engineUsed: 'morphological_detector_plus_tesseract_assist' | 'external_htr_adapter' | 'none';
  engineStatus: ModuleExecutionStatus;
  missingModelNote?: string;
  regions: HandwritingRegion[];
  uncertainCount: number;
  unreadableCount: number;
}

export interface OmrBubbleCell {
  option: string;
  fillRatio: number;
  filled: boolean;
  bbox: { x: number; y: number; width: number; height: number };
}

export interface OmrQuestionResult {
  questionNumber: number;
  pageNumber: number;
  selectedOptions: string[];
  status: 'answered' | 'unanswered' | 'multiple_selected' | 'ambiguous';
  confidence: number;
  bubbles: OmrBubbleCell[];
}

export interface OmrTemplateConfig {
  templateId: string;
  name: string;
  options: string[]; // e.g. ['A','B','C','D','E']
  questionsCount?: number;
  studentIdDigits?: number;
}

export interface OmrScanResult {
  detected: boolean;
  pageNumbers: number[];
  templateUsed: string;
  studentIdGridDetected?: boolean;
  studentIdDigits?: Array<{ column: number; digit: string | null; status: 'detected' | 'ambiguous' | 'blank'; confidence: number }>;
  studentIdValue?: string;
  questions: OmrQuestionResult[];
  summary: {
    totalQuestions: number;
    answered: number;
    unanswered: number;
    multipleSelected: number;
    ambiguous: number;
  };
  needsAdminReview: boolean;
  warnings: string[];
}

export interface FormFieldItem {
  id: string;
  pageNumber: number;
  kind: 'checkbox' | 'radio' | 'text_field';
  label: string;
  checked?: boolean;
  value?: string;
  status: 'filled' | 'unfilled' | 'ambiguous';
  entrySource: 'printed' | 'handwritten' | 'mark' | 'unknown';
  confidence: number;
  uncertain: boolean;
  bbox?: { x: number; y: number; width: number; height: number };
}

export interface FormExtractionResult {
  detected: boolean;
  fields: FormFieldItem[];
  totalFields: number;
  filledCount: number;
  unfilledCount: number;
  ambiguousCount: number;
  isIncompleteForm: boolean;
  warnings: string[];
}

export interface SignatureDetection {
  id: string;
  pageNumber: number;
  status: 'present' | 'absent' | 'uncertain';
  confidence: number;
  bbox?: { x: number; y: number; width: number; height: number };
  anchorLabel?: string;
  note: string; // Presence detection only, never biometric verification
}

export interface StampDetection {
  id: string;
  pageNumber: number;
  shape: 'circular' | 'rectangular' | 'irregular';
  colorTone: 'colored' | 'monochrome';
  extractedText?: string;
  confidence: number;
  uncertain: boolean;
  bbox?: { x: number; y: number; width: number; height: number };
  note: string;
}

export type DetailedAcademicCategory =
  | 'past_question'
  | 'lecture_note'
  | 'course_material'
  | 'handout'
  | 'assignment'
  | 'examination_paper'
  | 'answer_sheet'
  | 'study_guide'
  | 'academic_timetable'
  | 'other_academic_document';

export interface ClassificationCandidate {
  category: DetailedAcademicCategory;
  label: string;
  score: number; // 0..1
  matchedSignals: string[];
}

export interface DocumentClassificationResult {
  primaryCategory: DetailedAcademicCategory;
  primaryLabel: string;
  mappedLegacyCategory: AcademicDocCategory;
  confidence: number; // 0..1
  uncertain: boolean;
  candidates: ClassificationCandidate[];
  reason: string;
  overriddenByAdmin?: boolean;
}

export interface DocumentIntegrityReport {
  isComplete: boolean;
  hasDuplicatePages: boolean;
  duplicatePagePairs: Array<{ pageA: number; pageB: number; similarity: number }>;
  missingPageNumbers: number[];
  outOfOrderDetected: boolean;
  inconsistentNumberingDetected: boolean;
  printedPageNumbers: Array<{ pageIndex: number; printedNumber: number | null; rawMarker?: string }>;
  blankPages: number[];
  incompleteOrCroppedPages: number[];
  damagedOrCorruptedPages: number[];
  warnings: string[];
}

export interface LanguageAnalysisResult {
  primaryLanguage: string;
  detectedLanguages: Array<{
    code: string;
    name: string;
    confidence: number;
    script: string;
    installedInOcrEngine: boolean;
  }>;
  installedOcrModels: string[];
  unsupportedLanguages: string[];
  preservesDiacritics: boolean;
  warnings: string[];
}

export interface MetadataFieldResult {
  value: string | null;
  status: 'extracted' | 'uncertain' | 'not_found';
  confidence: number;
  sourcePage?: number;
  sourceExcerpt?: string;
}

export interface ExtractedAcademicMetadata {
  institution: MetadataFieldResult;
  faculty: MetadataFieldResult;
  department: MetadataFieldResult;
  courseTitle: MetadataFieldResult;
  courseCode: MetadataFieldResult;
  courseUnit: MetadataFieldResult;
  academicSession: MetadataFieldResult;
  semester: MetadataFieldResult;
  examinationType: MetadataFieldResult;
  examinationDate: MetadataFieldResult;
  examinationDuration: MetadataFieldResult;
  instructions: MetadataFieldResult;
  totalMarks: MetadataFieldResult;
  examinerName: MetadataFieldResult;
}

export type PageExtractionMethod =
  | 'native_text'
  | 'ocr'
  | 'hybrid_native_plus_ocr'
  | 'docx_xml'
  | 'plain_text'
  | 'skipped';

export type ExtractionQualityStatus =
  | 'completed'
  | 'completed_with_warnings'
  | 'needs_review'
  | 'failed';

export interface PageImageQualityMetrics {
  width?: number;
  height?: number;
  sharpnessScore?: number;
  contrastScore?: number;
  shadowVariance?: number;
  skewAngleDeg?: number;
  blankRatio?: number;
  isBlurry?: boolean;
  isLowResolution?: boolean;
  isUnevenLighting?: boolean;
  isTornOrDamaged?: boolean;
  isFadedPrinting?: boolean;
  hasStrongShadows?: boolean;
  hasStainsOrMarks?: boolean;
  excessiveRotationDeg?: number;
  hasCroppedEdgeText?: boolean;
  hasFoldLinesOrCreases?: boolean;
  isIncompleteCapture?: boolean;
  unreadableRegionsCount?: number;
  actionableWarnings?: string[];
}

export interface UncertainSpan {
  text: string;
  confidence: number;
  reason: string;
  bbox?: { x0: number; y0: number; x1: number; y1: number };
}

export type ReconstructedBlockKind =
  | 'header'
  | 'footer'
  | 'heading'
  | 'subheading'
  | 'paragraph'
  | 'question'
  | 'subquestion'
  | 'table'
  | 'formula'
  | 'diagram'
  | 'uncertain';

export interface ReconstructedBlock {
  id: string;
  kind: ReconstructedBlockKind;
  pageNumber: number;
  text?: string;
  label?: string;
  headingLevel?: 1 | 2 | 3;
  alignment?: 'left' | 'center' | 'right';
  indentLevel?: number;
  latex?: string;
  displayMode?: boolean;
  table?: ExtractedTable;
  diagram?: ExtractedDiagramAsset;
  uncertain?: boolean;
  uncertainReason?: string;
  bbox?: { x: number; y: number; width: number; height: number };
}

export interface ExtractedPageContent {
  pageNumber: number;
  text: string;
  wordCount: number;
  charCount?: number;
  extractionMethod?: PageExtractionMethod;
  ocrApplied: boolean;
  ocrConfidence: number | null;
  processingStatus?: ExtractionQualityStatus;
  isIncomplete?: boolean;
  wasTruncated?: boolean;
  qualityMetrics?: PageImageQualityMetrics;
  preprocessingApplied?: string[];
  errors?: string[];
  renderedPreviewUrl?: string;
  ocrEngineUsed?: 'tesseract' | 'vision' | 'hybrid_tesseract_vision';
  visionFallbackUsed?: boolean;
  visionFallbackError?: string;
  uncertainSpans?: UncertainSpan[];
  perspectiveCorrected?: boolean;
  handwritingRegions?: HandwritingRegion[];
  omrResult?: OmrQuestionResult[];
  formFields?: FormFieldItem[];
  signatures?: SignatureDetection[];
  stamps?: StampDetection[];
  diagrams: ExtractedDiagramAsset[];
  tables: ExtractedTable[];
  formulas: ExtractedFormula[];
  headerLines?: string[];
  footerLines?: string[];
  blocks?: ReconstructedBlock[];
  warnings: string[];
}

export interface QrCodeMatch {
  pageNumber: number;
  payload: string;
  isSafeUrl: boolean;
  format?: string;
  bbox?: { x: number; y: number; width: number; height: number };
  rotationDeg?: number;
  unreadableDetected?: boolean;
  warning?: string;
}

export interface DeterministicCheckResult {
  id: string;
  label: string;
  category:
    | 'integrity'
    | 'duplicate'
    | 'quality'
    | 'structure'
    | 'security'
    | 'qr_code'
    | 'omr'
    | 'handwriting'
    | 'language';
  passed: boolean;
  severity: 'info' | 'warning' | 'blocker';
  detail: string;
  pageNumbers?: number[];
}

export interface AiCrossCheckEvidence {
  pageNumber?: number;
  excerpt: string;
  checkType: string;
}

export interface AiCrossCheckFindings {
  riskLevel: DocumentRiskLevel;
  reason: string;
  evidence: AiCrossCheckEvidence[];
  confidence: number;
  recommendedAction: 'auto_approve' | 'manual_review' | 'request_resubmission' | 'reject';
  isOfficialCredentialSuspected?: boolean;
  providerAvailable: boolean;
  modelUsed?: string;
  checkedAt: string;
}

export interface ProcessingHistoryEntry {
  id: string;
  timestamp: string;
  stage: string;
  status: 'completed' | 'warning' | 'failed';
  actorName?: string;
  actorRole?: UserRole;
  detail: string;
}

export interface DocumentReviewNote {
  id: string;
  authorId: string;
  authorName: string;
  createdAt: string;
  note: string;
}

export interface AcademicDocumentRecord {
  id: string;
  title: string;
  courseCode: string;
  courseTitle: string;
  department: string;
  faculty: string;
  level: StudentLevel;
  schoolId: string;
  schoolCode: string;
  session: string;
  semester: SemesterType;
  category: AcademicDocCategory;
  submittedById: string;
  submittedByName: string;
  submittedByRole: UserRole;
  submittedAt: string;
  updatedAt: string;
  originalFileName: string;
  mimeType: string;
  detectedFormat: AcademicDocFormat;
  fileSizeBytes: number;
  sha256: string;
  duplicateOfDocId?: string;
  originalFileRef?: StorageObjectRef;
  optimizedPreviewUrl?: string;
  pageCount: number;
  extractedText: string;
  summary: string;
  headings: string[];
  pages: ExtractedPageContent[];
  diagrams: ExtractedDiagramAsset[];
  tables: ExtractedTable[];
  formulas: ExtractedFormula[];
  qrCodesFound: QrCodeMatch[];
  averageOcrConfidence: number | null;
  extractionQualityStatus?: ExtractionQualityStatus;
  processedPages?: number[];
  unprocessedPages?: number[];
  extractionWarnings?: string[];
  deterministicChecks: DeterministicCheckResult[];
  aiFindings?: AiCrossCheckFindings;
  /** Which OCR engine(s) read this document, e.g. "tesseract" or "hybrid_tesseract_vision". */
  ocrEngineSummary?: string;
  /** Pages with uncertain text that need a human to check them. */
  uncertainPageNumbers?: number[];
  decision: DocumentPipelineDecision;
  publicationStatus: DocumentPublicationStatus;
  /** Where the live copy appears for students once published. */
  publishedTo?: DocumentDestination;
  riskLevel: DocumentRiskLevel;
  reviewerId?: string;
  reviewerName?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  internalNotes: DocumentReviewNote[];
  processingHistory: ProcessingHistoryEntry[];
  parentZipName?: string;
  academicMetadata?: ExtractedAcademicMetadata;
  classification?: DocumentClassificationResult;
  integrityReport?: DocumentIntegrityReport;
  languageAnalysis?: LanguageAnalysisResult;
  omrResults?: OmrScanResult;
  formResults?: FormExtractionResult;
  handwritingAnalysis?: HandwritingAnalysisResult;
  signatures?: SignatureDetection[];
  stamps?: StampDetection[];
  moduleReports?: ScannerModuleRunReport[];
  processingDurationMs?: number;
}

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
    | 'academic_document'
    | 'broadcast'
    | 'payment'
    | 'support'
    | 'cms'
    | 'system';
  targetId: string;
  summary: string;
  schoolId?: string;
}
