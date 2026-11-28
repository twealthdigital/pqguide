import {
  canManageSchoolDocument,
  hasPermission,
  isActiveAccount,
  isRestrictedAccount,
} from '../core/permissions';
import {
  sanitizeIdentifier,
  sanitizePlainText,
  sanitizeSafeUrl,
  sanitizeSingleLine,
} from '../core/security';
import { courseHeading } from '../core/docTitle';
import {
  AUDIT_ACTION_META,
  formatAuditHeadline,
  formatRoleLabel,
  resolveSchoolCode,
} from '../core/auditMeta';
import type {
  AcademicDocCategory,
  AcademicDocumentRecord,
  AccountStatus,
  AppNotification,
  ArchiveFilter,
  AuditActionType,
  AuditLogEntry,
  AuthenticatedUser,
  BroadcastAudience,
  ContentStatus,
  HeaderMarqueeConfig,
  ManagedAccount,
  PastQuestionDoc,
  PaymentTransaction,
  School,
  SemesterType,
  SiteCmsConfig,
  StudentLevel,
  StudyMaterial,
  SuperAdminNotification,
  SupportTicket,
  UserActivityEvent,
  UserRole,
  VisitorTelemetry,
  WorkspaceViewMode,
} from '../core/types';
import { STUDY_MATERIALS } from '../data/materials';
import { createDefaultSiteCms } from '../data/siteInfo';
import {
  SEED_NOTIFICATIONS,
  SEED_PAST_QUESTIONS,
  SEED_SCHOOLS,
  SEED_SESSIONS,
} from '../data/seedCatalog';
import { extractQuestionsFromText } from './intelligence/structuredParser';
import { localStore } from './storage/localStore';

const STORAGE_KEY = 'pqguide_aaua_store_v1';
const LEGACY_DEMO_FLAG_KEY = 'pqguide_demo_preview_seeded_v1';

const LEGACY_SEED_ACCOUNT_EMAIL_BY_ID = new Map<string, string>([
  ['acc-1', 't.adeyemi@aaua.edu.ng'],
  ['acc-2', 'examoffice@aaua.edu.ng'],
  ['acc-3', 'c.okafor@aaua.edu.ng'],
  ['acc-4', 'a.rotimi@aaua.edu.ng'],
]);

function isDemoId(id: string | undefined): boolean {
  return typeof id === 'string' && id.startsWith('demo-');
}

function isLegacySeedAccount(acc: Pick<ManagedAccount, 'id' | 'email'>): boolean {
  const expectedEmail = LEGACY_SEED_ACCOUNT_EMAIL_BY_ID.get(acc.id);
  return Boolean(expectedEmail && acc.email.toLowerCase() === expectedEmail);
}

export interface AppStoreState {
  schools: School[];
  sessions: string[];
  documents: PastQuestionDoc[];
  materials: StudyMaterial[];
  academicDocuments: AcademicDocumentRecord[];
  notifications: AppNotification[];
  accounts: ManagedAccount[];
  auditLogs: AuditLogEntry[];
  payments: PaymentTransaction[];
  userActivities: UserActivityEvent[];
  supportTickets: SupportTicket[];
  siteCms: SiteCmsConfig;
  telemetry: VisitorTelemetry;
  marquee: HeaderMarqueeConfig;
  selectedSchoolId: string;
  /** Most recently opened past question ids, newest first. */
  recentDocIds: string[];
  readSuperAdminNotifIds: string[];
}

function getDefaultMarquee(): HeaderMarqueeConfig {
  return {
    enabled: false,
    message: '',
    audience: 'all',
    tone: 'neutral',
    updatedAt: '',
    updatedBy: '',
  };
}

function getDefaultState(): AppStoreState {
  return {
    schools: SEED_SCHOOLS,
    sessions: SEED_SESSIONS,
    documents: SEED_PAST_QUESTIONS,
    materials: STUDY_MATERIALS,
    academicDocuments: [],
    notifications: SEED_NOTIFICATIONS,
    accounts: [],
    auditLogs: [],
    payments: [],
    userActivities: [],
    supportTickets: [],
    siteCms: createDefaultSiteCms(),
    telemetry: {
      totalVisits: 0,
      uniqueVisitorIds: [],
    },
    marquee: getDefaultMarquee(),
    selectedSchoolId: 'sch-aaua',
    recentDocIds: [],
    readSuperAdminNotifIds: [],
  };
}

const RETIRED_SEED_DOC_IDS = new Set([
  'pq-aaua-csc201-2324',
  'pq-aaua-mth202-2324',
  'pq-aaua-eco102-2223',
  'pq-aaua-law301-2425',
  'pq-aaua-chm101-2425',
]);

function normalizeMaterial(m: StudyMaterial): StudyMaterial {
  return {
    ...m,
    schoolId: m.schoolId ?? 'sch-aaua',
    schoolCode: m.schoolCode ?? 'AAUA',
    status: m.status === 'draft' ? 'draft' : 'published',
    attachmentPreviewUrl: sanitizeSafeUrl(m.attachmentPreviewUrl),
  };
}

function mergeSiteCms(raw?: Partial<SiteCmsConfig> | null): SiteCmsConfig {
  const base = createDefaultSiteCms();
  if (!raw || typeof raw !== 'object') return base;
  return {
    studentUi: { ...base.studentUi, ...(raw.studentUi ?? {}) },
    performancePage: { ...base.performancePage, ...(raw.performancePage ?? {}) },
    notificationsPage: { ...base.notificationsPage, ...(raw.notificationsPage ?? {}) },
    subscriptionPage: { ...base.subscriptionPage, ...(raw.subscriptionPage ?? {}) },
    schoolAdminUi: { ...base.schoolAdminUi, ...(raw.schoolAdminUi ?? {}) },
    aboutPage: { ...base.aboutPage, ...(raw.aboutPage ?? {}) },
    servicesPage: {
      ...base.servicesPage,
      ...(raw.servicesPage ?? {}),
      items:
        Array.isArray(raw.servicesPage?.items) && raw.servicesPage.items.length > 0
          ? raw.servicesPage.items
          : base.servicesPage.items,
    },
    helpPage: {
      ...base.helpPage,
      ...(raw.helpPage ?? {}),
      howItWorks:
        Array.isArray(raw.helpPage?.howItWorks) && raw.helpPage.howItWorks.length > 0
          ? raw.helpPage.howItWorks
          : base.helpPage.howItWorks,
      faqs:
        Array.isArray(raw.helpPage?.faqs) && raw.helpPage.faqs.length > 0
          ? raw.helpPage.faqs
          : base.helpPage.faqs,
    },
    supportPage: { ...base.supportPage, ...(raw.supportPage ?? {}) },
    updatedAt: raw.updatedAt,
    updatedBy: raw.updatedBy,
  };
}

function loadState(): AppStoreState {
  localStore.removeItem(LEGACY_DEMO_FLAG_KEY);
  try {
    const parsed = localStore.getJson<Partial<AppStoreState>>(STORAGE_KEY);
    if (!parsed) return getDefaultState();

    const defaults = getDefaultState();
    const storedDocs = Array.isArray(parsed.documents) ? parsed.documents : null;
    const hadRetiredSeeds = Boolean(storedDocs?.some((d) => RETIRED_SEED_DOC_IDS.has(d.id)));
    let documents = storedDocs
      ? storedDocs.filter((d) => !RETIRED_SEED_DOC_IDS.has(d.id))
      : defaults.documents;

    if (hadRetiredSeeds) {
      const have = new Set(documents.map((d) => d.id));
      documents = [...documents, ...defaults.documents.filter((d) => !have.has(d.id))];
    }

    const seedById = new Map(defaults.documents.map((d) => [d.id, d]));
    documents = documents.map((d) => {
      const seed = seedById.get(d.id);
      const safePreview = sanitizeSafeUrl(d.scannedPagePreviewUrl);
      const base = seed?.solutions && !d.solutions ? { ...d, solutions: seed.solutions } : d;
      return {
        ...base,
        scannedPagePreviewUrl: safePreview,
      };
    });

    const seedNotifById = new Map(defaults.notifications.map((n) => [n.id, n]));
    const notifications = (
      Array.isArray(parsed.notifications) ? parsed.notifications : defaults.notifications
    )
      .filter((n) => !(n.targetDocId && RETIRED_SEED_DOC_IDS.has(n.targetDocId)))
      .map((n) => ((n.category as string) === 'billing' ? seedNotifById.get(n.id) ?? n : n))
      .filter((n) => (n.category as string) !== 'billing');

    const storedMaterials = Array.isArray(parsed.materials) && parsed.materials.length > 0
      ? parsed.materials.map(normalizeMaterial)
      : defaults.materials.map(normalizeMaterial);

    const schools =
      Array.isArray(parsed.schools) && parsed.schools.length > 0
        ? parsed.schools
        : defaults.schools;

    const rawAccounts = Array.isArray(parsed.accounts) ? parsed.accounts : [];
    const accounts = rawAccounts
      .filter((a) => !isDemoId(a.id) && !isLegacySeedAccount(a))
      .map((a) => ({
        ...a,
        adminVerified: a.adminVerified ?? true,
        isEmailVerified: a.isEmailVerified ?? true,
        schoolId:
          a.schoolId ??
          schools.find((s) => s.code.toUpperCase() === (a.schoolCode || '').toUpperCase())?.id,
      }));

    const marquee: HeaderMarqueeConfig =
      parsed.marquee && typeof parsed.marquee === 'object'
        ? {
            enabled: Boolean(parsed.marquee.enabled),
            message: sanitizeSingleLine(parsed.marquee.message ?? '', 300),
            audience:
              parsed.marquee.audience === 'students' || parsed.marquee.audience === 'admins'
                ? parsed.marquee.audience
                : 'all',
            tone:
              parsed.marquee.tone === 'important' || parsed.marquee.tone === 'urgent'
                ? parsed.marquee.tone
                : 'neutral',
            updatedAt: parsed.marquee.updatedAt ?? '',
            updatedBy: parsed.marquee.updatedBy ?? '',
          }
        : defaults.marquee;

    const rawVisitorIds = Array.isArray(parsed.telemetry?.uniqueVisitorIds)
      ? parsed.telemetry.uniqueVisitorIds.filter((id): id is string => typeof id === 'string')
      : [];
    const hadDemoVisitors = rawVisitorIds.some((id) => isDemoId(id));
    const cleanedVisitorIds = rawVisitorIds.filter((id) => !isDemoId(id));
    const rawTotalVisits =
      typeof parsed.telemetry?.totalVisits === 'number'
        ? Math.max(0, parsed.telemetry.totalVisits)
        : 0;

    const telemetry: VisitorTelemetry =
      parsed.telemetry && typeof parsed.telemetry === 'object'
        ? {
            totalVisits: hadDemoVisitors
              ? Math.max(cleanedVisitorIds.length, rawTotalVisits - 184)
              : rawTotalVisits,
            uniqueVisitorIds: cleanedVisitorIds,
            lastVisitAt: parsed.telemetry.lastVisitAt,
          }
        : defaults.telemetry;

    const rawAuditLogs = Array.isArray(parsed.auditLogs) ? parsed.auditLogs : [];
    const rawPayments = Array.isArray(parsed.payments) ? parsed.payments : [];
    const rawActivities = Array.isArray(parsed.userActivities) ? parsed.userActivities : [];
    const rawTickets = Array.isArray(parsed.supportTickets) ? parsed.supportTickets : [];

    const auditLogs = rawAuditLogs.filter((l) => !isDemoId(l.id)).slice(0, 300);
    const payments = rawPayments.filter((p) => !isDemoId(p.id)).slice(0, 300);
    const userActivities = rawActivities.filter((a) => !isDemoId(a.id)).slice(0, 500);
    const supportTickets = rawTickets.filter((t) => !isDemoId(t.id)).slice(0, 300);

    const rawAcademicDocs = Array.isArray(parsed.academicDocuments)
      ? parsed.academicDocuments
      : [];
    const academicDocuments = rawAcademicDocs
      .filter((d): d is AcademicDocumentRecord => Boolean(d && typeof d.id === 'string'))
      .map((d) => ({
        ...d,
        optimizedPreviewUrl: sanitizeSafeUrl(d.optimizedPreviewUrl),
        diagrams: Array.isArray(d.diagrams)
          ? d.diagrams.map((dg) => ({ ...dg, dataUrl: sanitizeSafeUrl(dg.dataUrl) }))
          : [],
        pages: Array.isArray(d.pages)
          ? d.pages.map((pg) => ({
              ...pg,
              renderedPreviewUrl: sanitizeSafeUrl(pg.renderedPreviewUrl),
              diagrams: Array.isArray(pg.diagrams)
                ? pg.diagrams.map((dg) => ({ ...dg, dataUrl: sanitizeSafeUrl(dg.dataUrl) }))
                : [],
            }))
          : [],
        internalNotes: Array.isArray(d.internalNotes) ? d.internalNotes : [],
        processingHistory: Array.isArray(d.processingHistory) ? d.processingHistory : [],
      }))
      .slice(0, 120);

    const sanitizedState: AppStoreState = {
      schools,
      sessions:
        Array.isArray(parsed.sessions) && parsed.sessions.length > 0
          ? parsed.sessions
          : defaults.sessions,
      documents,
      materials: storedMaterials,
      academicDocuments,
      notifications,
      accounts,
      auditLogs,
      payments,
      userActivities,
      supportTickets,
      siteCms: mergeSiteCms(parsed.siteCms),
      telemetry,
      marquee,
      selectedSchoolId: parsed.selectedSchoolId ?? defaults.selectedSchoolId,
      recentDocIds: Array.isArray(parsed.recentDocIds)
        ? parsed.recentDocIds.filter((id): id is string => typeof id === 'string')
        : [],
      readSuperAdminNotifIds: Array.isArray(parsed.readSuperAdminNotifIds)
        ? parsed.readSuperAdminNotifIds.filter((id): id is string => typeof id === 'string')
        : [],
    };

    const strippedAnyDemoOrSeed =
      accounts.length !== rawAccounts.length ||
      hadDemoVisitors ||
      auditLogs.length !== rawAuditLogs.length ||
      payments.length !== rawPayments.length ||
      userActivities.length !== rawActivities.length ||
      supportTickets.length !== rawTickets.length;

    if (strippedAnyDemoOrSeed) {
      saveState(sanitizedState);
    }

    return sanitizedState;
  } catch {
    return getDefaultState();
  }
}

function saveState(state: AppStoreState): void {
  localStore.setJson(STORAGE_KEY, state);
}

/**
 * Automatic notices about uploads (uploaded, approved, rejected, needs a new
 * upload, removed). Students never get these. Notices saved before the
 * `uploadActivity` flag existed are recognised by their id prefix.
 */
function isUploadActivityNotice(n: AppNotification): boolean {
  return n.uploadActivity === true || /^notif-(new|doc|rev|del)-/.test(n.id);
}

/**
 * The public "new document" notice for School Admins (students do not get it).
 * Kept short and plain: what was uploaded, and by which university.
 */
function buildNewDocumentNotification(args: {
  docId: string;
  courseCode: string;
  session: string;
  semester: string;
  schoolId: string;
  schoolCode: string;
  exceptUserId?: string;
}): AppNotification {
  return {
    id: `notif-new-${args.docId}`,
    title: `${args.courseCode} was uploaded`,
    message: `${args.schoolCode} uploaded ${args.session} ${args.semester}.`,
    category: 'upload',
    audience: 'students',
    schoolId: args.schoolId,
    schoolCode: args.schoolCode,
    createdAt: new Date().toISOString(),
    isRead: false,
    targetDocId: args.docId,
    approvalStatus: 'approved',
    exceptUserId: args.exceptUserId,
    uploadActivity: true,
  };
}

function createAuditEntry(
  actor: Pick<AuthenticatedUser, 'id' | 'fullName' | 'email' | 'role'>,
  action: AuditActionType,
  targetType: AuditLogEntry['targetType'],
  targetId: string,
  summary: string,
  schoolId?: string
): AuditLogEntry {
  return {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    actorId: actor.id,
    actorName: sanitizeSingleLine(actor.fullName, 120),
    actorEmail: sanitizeSingleLine(actor.email, 160),
    actorRole: actor.role,
    action,
    targetType,
    targetId,
    summary: sanitizeSingleLine(summary, 300),
    schoolId,
  };
}

type Listener = () => void;

class ArchiveRepository {
  private state: AppStoreState = loadState();
  private listeners: Set<Listener> = new Set();

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (event) => {
        if (event.key === STORAGE_KEY) {
          this.state = loadState();
          this.listeners.forEach((l) => l());
        }
      });
    }
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): AppStoreState => this.state;

  refreshFromStorage(): AppStoreState {
    this.state = loadState();
    this.listeners.forEach((l) => l());
    return this.state;
  }

  private update(updater: (prev: AppStoreState) => AppStoreState): void {
    this.state = updater(this.state);
    saveState(this.state);
    this.listeners.forEach((l) => l());
  }

  private requirePermission(
    actor: AuthenticatedUser | null | undefined,
    permission: Parameters<typeof hasPermission>[1],
    message = 'Unauthorized action.'
  ): asserts actor is AuthenticatedUser {
    if (!isActiveAccount(actor) || !hasPermission(actor, permission)) {
      throw new Error(message);
    }
  }

  setSelectedSchool(schoolId: string): void {
    const exists = this.state.schools.some((s) => s.id === schoolId && s.isActive);
    if (!exists) return;
    this.update((prev) => ({ ...prev, selectedSchoolId: schoolId }));
  }

  getPublishedDocuments(schoolId?: string): PastQuestionDoc[] {
    return this.state.documents.filter(
      (d) => d.status === 'published' && (!schoolId || d.schoolId === schoolId)
    );
  }

  getPublishedMaterials(schoolId?: string): StudyMaterial[] {
    return this.state.materials.filter(
      (m) =>
        (m.status ?? 'published') === 'published' &&
        (!schoolId || !m.schoolId || m.schoolId === schoolId)
    );
  }

  filterDocuments(filter: ArchiveFilter): PastQuestionDoc[] {
    const q = filter.query.trim().toLowerCase();
    return this.state.documents.filter((doc) => {
      if (doc.status !== 'published') return false;
      if (filter.schoolId && doc.schoolId !== filter.schoolId) return false;
      if (filter.session !== 'All' && doc.session !== filter.session) return false;
      if (filter.semester !== 'All' && doc.semester !== filter.semester) return false;
      if (filter.level !== 'All' && doc.level !== filter.level) return false;
      if (!q) return true;
      return (
        doc.courseCode.toLowerCase().includes(q) ||
        doc.courseTitle.toLowerCase().includes(q) ||
        doc.department.toLowerCase().includes(q) ||
        doc.extractedText.toLowerCase().includes(q) ||
        doc.questions.some((question) => question.toLowerCase().includes(q))
      );
    });
  }

  recordRecent(docId: string): void {
    this.update((prev) => ({
      ...prev,
      recentDocIds: [docId, ...prev.recentDocIds.filter((id) => id !== docId)].slice(0, 12),
    }));
  }

  incrementView(docId: string): void {
    this.update((prev) => ({
      ...prev,
      documents: prev.documents.map((doc) =>
        doc.id === docId ? { ...doc, viewsCount: doc.viewsCount + 1 } : doc
      ),
    }));
  }

  /**
   * Who sees a notification.
   * - Students: announcements and anything sent to them (for example a payment receipt).
   *   Never upload, approval or rejection notices.
   * - School Admins: everything students see, new-document notices, admin notices, and
   *   anything sent to them (for example the result of their uploads).
   * Notices for one university only reach people from that university.
   */
  private isNotificationVisible(
    n: AppNotification,
    workspace: WorkspaceViewMode,
    userId?: string
  ): boolean {
    if ((n.approvalStatus ?? 'approved') !== 'approved') return false;
    if (workspace === 'student' && isUploadActivityNotice(n)) return false;
    if (n.exceptUserId && n.exceptUserId === userId) return false;
    if (n.targetUserId) {
      if (workspace === 'super_admin') return true;
      return Boolean(userId && n.targetUserId === userId);
    }
    if (n.schoolId && workspace !== 'super_admin' && userId) {
      const me = this.state.accounts.find((a) => a.id === userId);
      if (me?.schoolId && me.schoolId !== n.schoolId) return false;
    }
    const audience = n.audience ?? 'all';
    if (audience === 'all') return true;
    if (audience === 'students') return workspace === 'student' || workspace === 'school_admin';
    return workspace !== 'student';
  }

  getNotificationsForWorkspace(workspace: WorkspaceViewMode, userId?: string): AppNotification[] {
    return this.state.notifications.filter((n) => this.isNotificationVisible(n, workspace, userId));
  }

  getPendingNotifications(): AppNotification[] {
    return this.state.notifications.filter((n) => n.approvalStatus === 'pending_verification');
  }

  getSchoolSubmittedNotifications(schoolId: string): AppNotification[] {
    return this.state.notifications.filter((n) => n.schoolId === schoolId);
  }

  markNotificationRead(notifId: string): void {
    this.update((prev) => ({
      ...prev,
      notifications: prev.notifications.map((n) =>
        n.id === notifId ? { ...n, isRead: true } : n
      ),
    }));
  }

  markAllNotificationsRead(): void {
    this.update((prev) => ({
      ...prev,
      notifications: prev.notifications.map((n) =>
        (n.approvalStatus ?? 'approved') === 'approved' ? { ...n, isRead: true } : n
      ),
    }));
  }

  markAllNotificationsReadForWorkspace(workspace: WorkspaceViewMode, userId?: string): void {
    this.update((prev) => ({
      ...prev,
      notifications: prev.notifications.map((n) =>
        this.isNotificationVisible(n, workspace, userId) ? { ...n, isRead: true } : n
      ),
    }));
  }

  getSuperAdminGovernanceNotifications(): SuperAdminNotification[] {
    const readSet = new Set(this.state.readSuperAdminNotifIds ?? []);
    const items: SuperAdminNotification[] = [];

    for (const entry of this.state.auditLogs) {
      const schoolCode = resolveSchoolCode(this.state.schools, entry.schoolId);
      const meta = AUDIT_ACTION_META[entry.action];
      const id = `sa-audit-${entry.id}`;
      items.push({
        id,
        title: formatAuditHeadline(entry, schoolCode),
        message: entry.summary,
        actorName: entry.actorName,
        actorRoleLabel: formatRoleLabel(entry.actorRole),
        schoolCode,
        categoryLabel: meta?.label ?? entry.action.replace(/_/g, ' '),
        detail: meta?.whatItDoes ?? entry.summary,
        createdAt: entry.timestamp,
        isRead: readSet.has(id),
      });
    }

    for (const act of this.state.userActivities) {
      if (
        act.type !== 'signup' &&
        act.type !== 'payment_verified' &&
        act.type !== 'exam_completed'
      ) {
        continue;
      }
      const id = `sa-act-${act.id}`;
      const roleLabel = formatRoleLabel(act.userRole);
      const title =
        act.type === 'signup'
          ? `New account signup: ${act.userName}`
          : act.type === 'payment_verified'
            ? `Payment verified for ${act.userName}`
            : `${act.userName} finished a practice exam`;
      const categoryLabel =
        act.type === 'signup'
          ? 'Student Signup'
          : act.type === 'payment_verified'
            ? 'Payment Verified'
            : 'Practice Exam';

      items.push({
        id,
        title,
        message: act.detail,
        actorName: act.userName,
        actorRoleLabel: roleLabel,
        categoryLabel,
        detail: `${act.userName}${act.matricNumber ? ` (${act.matricNumber})` : ''}: ${act.detail}`,
        createdAt: act.timestamp,
        isRead: readSet.has(id),
      });
    }

    for (const ticket of this.state.supportTickets) {
      const id = `sa-sup-${ticket.id}`;
      items.push({
        id,
        title: `${ticket.senderName} sent a ${ticket.kind} message`,
        message: ticket.message,
        actorName: ticket.senderName,
        actorRoleLabel: formatRoleLabel(ticket.senderRole),
        categoryLabel: 'Support Inbox',
        detail: `From ${ticket.senderName} (${ticket.senderEmail}): "${ticket.message}"`,
        createdAt: ticket.createdAt,
        isRead: readSet.has(id),
      });
    }

    // Include baseline catalog provenance for initial documents not yet in auditLogs
    const auditedDocIds = new Set(
      this.state.auditLogs
        .filter((a) => a.targetType === 'past_question')
        .map((a) => a.targetId)
    );
    for (const doc of this.state.documents.slice(0, 4)) {
      if (auditedDocIds.has(doc.id)) continue;
      const uploaderAccount = this.state.accounts.find(
        (acc) =>
          (doc.uploadedById && acc.id === doc.uploadedById) ||
          acc.fullName.toLowerCase() === doc.uploadedBy.toLowerCase()
      );
      const roleLabel = uploaderAccount
        ? formatRoleLabel(uploaderAccount.role)
        : 'School Admin';
      const id = `sa-doc-${doc.id}`;
      items.push({
        id,
        title:
          uploaderAccount?.role === 'super_admin'
            ? `Uploaded by Super Admin ${doc.uploadedBy}`
            : `Uploaded by ${doc.uploadedBy} (${doc.schoolCode} ${roleLabel})`,
        message: `${courseHeading(doc)} (${doc.session} · ${doc.level}) is ${
          doc.status === 'published' ? 'live on student Home' : doc.status
        }.`,
        actorName: doc.uploadedBy,
        actorRoleLabel: roleLabel,
        schoolCode: doc.schoolCode,
        categoryLabel: 'Archive Upload',
        detail: `${doc.courseCode} — ${doc.courseTitle} (${doc.semester}, ${doc.session}) for ${doc.schoolCode}.`,
        createdAt: doc.uploadedAt,
        isRead: readSet.has(id),
      });
    }

    return items.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  markSuperAdminNotificationRead(notifId: string): void {
    this.update((prev) => {
      const existing = prev.readSuperAdminNotifIds ?? [];
      if (existing.includes(notifId)) return prev;
      return {
        ...prev,
        readSuperAdminNotifIds: [notifId, ...existing].slice(0, 600),
      };
    });
  }

  markAllSuperAdminNotificationsRead(): void {
    const allIds = this.getSuperAdminGovernanceNotifications().map((item) => item.id);
    this.update((prev) => {
      const merged = Array.from(new Set([...allIds, ...(prev.readSuperAdminNotifIds ?? [])])).slice(
        0,
        600
      );
      return {
        ...prev,
        readSuperAdminNotifIds: merged,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Past Questions CRUD (RBAC + University Scoping Enforced)
  // -------------------------------------------------------------------------

  addDocument(actor: AuthenticatedUser | null | undefined, doc: PastQuestionDoc): PastQuestionDoc {
    if (!isActiveAccount(actor)) {
      throw new Error('Authentication required to upload past questions.');
    }

    const canAll = hasPermission(actor, 'pq:manage_all');
    const canSchool = hasPermission(actor, 'pq:upload_school');
    if (!canAll && !canSchool) {
      throw new Error('Your account does not have permission to upload past questions.');
    }

    const targetSchoolId = canAll ? doc.schoolId : actor.assignedSchoolId;
    if (!targetSchoolId) {
      throw new Error('No university assigned to this administrator account.');
    }
    if (!canAll && doc.schoolId !== targetSchoolId) {
      throw new Error('School Administrators can only upload past questions for their assigned university.');
    }

    const school = this.state.schools.find((s) => s.id === targetSchoolId);
    if (!school) {
      throw new Error('Selected university does not exist.');
    }

    const sanitizedDoc: PastQuestionDoc = {
      ...doc,
      id: doc.id || `doc-${Date.now()}`,
      schoolId: school.id,
      schoolCode: school.code,
      courseCode: sanitizeIdentifier(doc.courseCode, 24).toUpperCase() || 'CSC 101',
      courseTitle: sanitizeSingleLine(doc.courseTitle, 160) || 'Past Question',
      department: sanitizeSingleLine(doc.department, 120) || 'General Studies',
      faculty: sanitizeSingleLine(doc.faculty, 120) || 'Academic Affairs',
      session: sanitizeIdentifier(doc.session, 20) || '2024/2025',
      originalFileName: sanitizeSingleLine(doc.originalFileName, 180) || 'upload.pdf',
      scannedPagePreviewUrl: sanitizeSafeUrl(doc.scannedPagePreviewUrl),
      extractedText: sanitizePlainText(doc.extractedText, 8000),
      questions: doc.questions
        .map((q) => sanitizeSingleLine(q, 1000))
        .filter(Boolean),
      uploadedBy: sanitizeSingleLine(actor.fullName, 120),
      uploadedById: actor.id,
      uploadedAt: doc.uploadedAt || new Date().toISOString(),
      status: doc.status === 'draft' || doc.status === 'review' ? doc.status : 'published',
    };

    const auditAction: AuditActionType =
      sanitizedDoc.status === 'published' ? 'pq_published' : 'pq_uploaded';

    this.update((prev) => {
      const sessions = prev.sessions.includes(sanitizedDoc.session)
        ? prev.sessions
        : [sanitizedDoc.session, ...prev.sessions].sort().reverse();

      const nextNotifications =
        sanitizedDoc.status === 'published'
          ? [
              buildNewDocumentNotification({
                docId: sanitizedDoc.id,
                courseCode: sanitizedDoc.courseCode,
                session: sanitizedDoc.session,
                semester: sanitizedDoc.semester,
                schoolId: school.id,
                schoolCode: school.code,
              }),
              ...prev.notifications,
            ]
          : prev.notifications;

      return {
        ...prev,
        sessions,
        documents: [sanitizedDoc, ...prev.documents],
        notifications: nextNotifications,
        auditLogs: [
          createAuditEntry(
            actor,
            auditAction,
            'past_question',
            sanitizedDoc.id,
            `${sanitizedDoc.status === 'published' ? 'Uploaded & published' : 'Saved draft'} ${sanitizedDoc.courseCode} (${sanitizedDoc.session}) for ${school.code}`,
            school.id
          ),
          ...prev.auditLogs,
        ].slice(0, 300),
      };
    });

    return sanitizedDoc;
  }

  updateDocument(
    actor: AuthenticatedUser | null | undefined,
    docId: string,
    patch: Partial<
      Pick<
        PastQuestionDoc,
        | 'schoolId'
        | 'courseCode'
        | 'courseTitle'
        | 'department'
        | 'faculty'
        | 'level'
        | 'session'
        | 'year'
        | 'semester'
        | 'questions'
        | 'extractedText'
        | 'status'
      >
    >
  ): PastQuestionDoc {
    const existing = this.state.documents.find((d) => d.id === docId);
    if (!existing) {
      throw new Error('Past question record not found.');
    }
    if (!canManageSchoolDocument(actor, existing.schoolId)) {
      throw new Error('You do not have permission to edit this past question.');
    }

    const canChangeSchool = hasPermission(actor, 'pq:manage_all');
    const targetSchoolId =
      canChangeSchool && patch.schoolId ? patch.schoolId : existing.schoolId;
    const school = this.state.schools.find((s) => s.id === targetSchoolId);
    if (!school) {
      throw new Error('Target university does not exist.');
    }

    const nextStatus: ContentStatus = patch.status ?? existing.status;
    const updated: PastQuestionDoc = {
      ...existing,
      schoolId: school.id,
      schoolCode: school.code,
      courseCode:
        patch.courseCode !== undefined
          ? sanitizeIdentifier(patch.courseCode, 24).toUpperCase() || existing.courseCode
          : existing.courseCode,
      courseTitle:
        patch.courseTitle !== undefined
          ? sanitizeSingleLine(patch.courseTitle, 160)
          : existing.courseTitle,
      department:
        patch.department !== undefined
          ? sanitizeSingleLine(patch.department, 120) || existing.department
          : existing.department,
      faculty:
        patch.faculty !== undefined
          ? sanitizeSingleLine(patch.faculty, 120) || existing.faculty
          : existing.faculty,
      level: patch.level ?? existing.level,
      session:
        patch.session !== undefined
          ? sanitizeIdentifier(patch.session, 20) || existing.session
          : existing.session,
      year: patch.year ?? existing.year,
      semester: patch.semester ?? existing.semester,
      extractedText:
        patch.extractedText !== undefined
          ? sanitizePlainText(patch.extractedText, 8000)
          : existing.extractedText,
      questions:
        patch.questions !== undefined
          ? patch.questions.map((q) => sanitizeSingleLine(q, 1000)).filter(Boolean)
          : existing.questions,
      status: nextStatus,
      updatedAt: new Date().toISOString(),
    };

    const action: AuditActionType =
      patch.status && patch.status !== existing.status
        ? patch.status === 'published'
          ? 'pq_published'
          : 'pq_unpublished'
        : 'pq_updated';

    this.update((prev) => ({
      ...prev,
      documents: prev.documents.map((d) => (d.id === docId ? updated : d)),
      auditLogs: [
        createAuditEntry(
          actor!,
          action,
          'past_question',
          docId,
          `${action === 'pq_published' ? 'Published' : action === 'pq_unpublished' ? 'Unpublished' : 'Updated'} ${updated.courseCode} (${updated.session}) · ${school.code}`,
          school.id
        ),
        ...prev.auditLogs,
      ].slice(0, 300),
    }));

    return updated;
  }

  setDocumentStatus(
    actor: AuthenticatedUser | null | undefined,
    docId: string,
    status: ContentStatus
  ): PastQuestionDoc {
    return this.updateDocument(actor, docId, { status });
  }

  deleteDocument(actor: AuthenticatedUser | null | undefined, docId: string): void {
    const existing = this.state.documents.find((d) => d.id === docId);
    if (!existing) {
      throw new Error('Past question record not found.');
    }
    if (!canManageSchoolDocument(actor, existing.schoolId)) {
      throw new Error('You do not have permission to delete this past question.');
    }

    this.update((prev) => ({
      ...prev,
      documents: prev.documents.filter((doc) => doc.id !== docId),
      recentDocIds: prev.recentDocIds.filter((id) => id !== docId),
      auditLogs: [
        createAuditEntry(
          actor!,
          'pq_deleted',
          'past_question',
          docId,
          `Deleted ${existing.courseCode} (${existing.session}) from ${existing.schoolCode}`,
          existing.schoolId
        ),
        ...prev.auditLogs,
      ].slice(0, 300),
    }));
  }

  // -------------------------------------------------------------------------
  // Study Materials CRUD (Separate Model, Super Admin Only)
  // -------------------------------------------------------------------------

  addMaterial(
    actor: AuthenticatedUser | null | undefined,
    material: StudyMaterial
  ): StudyMaterial {
    this.requirePermission(
      actor,
      'materials:manage',
      'Only Super Administrators can upload and manage study materials.'
    );

    const school =
      this.state.schools.find((s) => s.id === (material.schoolId || 'sch-aaua')) ??
      this.state.schools[0];

    const normalized: StudyMaterial = {
      id: material.id || `mat-${Date.now()}`,
      schoolId: school.id,
      schoolCode: school.code,
      faculty: sanitizeSingleLine(material.faculty, 120) || 'General Studies Unit',
      department: sanitizeSingleLine(material.department, 120) || 'General Studies',
      courseCode: sanitizeIdentifier(material.courseCode, 24).toUpperCase() || 'GNS 101',
      courseTitle: sanitizeSingleLine(material.courseTitle, 160) || 'Study Guide',
      level: sanitizeIdentifier(material.level, 16) || '100L',
      title: sanitizeSingleLine(material.title, 180) || 'Untitled Study Material',
      summary: sanitizePlainText(material.summary, 600),
      readMinutes: Math.max(1, Math.min(120, Math.round(material.readMinutes || 5))),
      sections: (material.sections || []).map((s) => ({
        heading: sanitizeSingleLine(s.heading, 140) || 'Section',
        paragraphs: (s.paragraphs ?? [])
          .map((p) => sanitizePlainText(p, 2000))
          .filter(Boolean),
        points: (s.points ?? [])
          .map((pt) => sanitizeSingleLine(pt, 500))
          .filter(Boolean),
      })),
      sourceType: material.sourceType ?? 'typed_document',
      originalFileName: material.originalFileName
        ? sanitizeSingleLine(material.originalFileName, 180)
        : undefined,
      extractedText: material.extractedText
        ? sanitizePlainText(material.extractedText, 8000)
        : undefined,
      attachmentPreviewUrl: sanitizeSafeUrl(material.attachmentPreviewUrl),
      status: material.status === 'draft' ? 'draft' : 'published',
      uploadedBy: sanitizeSingleLine(actor.fullName, 120),
      uploadedAt: material.uploadedAt || new Date().toISOString(),
    };

    this.update((prev) => ({
      ...prev,
      materials: [normalized, ...prev.materials],
      auditLogs: [
        createAuditEntry(
          actor,
          normalized.status === 'published' ? 'material_published' : 'material_uploaded',
          'study_material',
          normalized.id,
          `${normalized.status === 'published' ? 'Published' : 'Saved draft'} study material "${normalized.title}" (${normalized.courseCode}) for ${school.code}`,
          school.id
        ),
        ...prev.auditLogs,
      ].slice(0, 300),
    }));

    return normalized;
  }

  updateMaterial(
    actor: AuthenticatedUser | null | undefined,
    materialId: string,
    patch: Partial<StudyMaterial>
  ): StudyMaterial {
    this.requirePermission(
      actor,
      'materials:manage',
      'Only Super Administrators can edit study materials.'
    );

    const existing = this.state.materials.find((m) => m.id === materialId);
    if (!existing) {
      throw new Error('Study material not found.');
    }

    const targetSchool = patch.schoolId
      ? this.state.schools.find((s) => s.id === patch.schoolId)
      : this.state.schools.find((s) => s.id === (existing.schoolId || 'sch-aaua'));

    const schoolId = targetSchool?.id ?? existing.schoolId ?? 'sch-aaua';
    const schoolCode = targetSchool?.code ?? existing.schoolCode ?? 'AAUA';

    const nextStatus = patch.status ?? existing.status ?? 'published';
    const updated: StudyMaterial = {
      ...existing,
      schoolId,
      schoolCode,
      faculty:
        patch.faculty !== undefined
          ? sanitizeSingleLine(patch.faculty, 120)
          : existing.faculty,
      department:
        patch.department !== undefined
          ? sanitizeSingleLine(patch.department, 120)
          : existing.department,
      courseCode:
        patch.courseCode !== undefined
          ? sanitizeIdentifier(patch.courseCode, 24).toUpperCase() || existing.courseCode
          : existing.courseCode,
      courseTitle:
        patch.courseTitle !== undefined
          ? sanitizeSingleLine(patch.courseTitle, 160)
          : existing.courseTitle,
      level:
        patch.level !== undefined
          ? sanitizeIdentifier(patch.level, 16) || existing.level
          : existing.level,
      title:
        patch.title !== undefined
          ? sanitizeSingleLine(patch.title, 180) || existing.title
          : existing.title,
      summary:
        patch.summary !== undefined
          ? sanitizePlainText(patch.summary, 600)
          : existing.summary,
      readMinutes:
        patch.readMinutes !== undefined
          ? Math.max(1, Math.min(120, Math.round(patch.readMinutes)))
          : existing.readMinutes,
      sections:
        patch.sections !== undefined
          ? patch.sections.map((s) => ({
              heading: sanitizeSingleLine(s.heading, 140) || 'Section',
              paragraphs: (s.paragraphs ?? [])
                .map((p) => sanitizePlainText(p, 2000))
                .filter(Boolean),
              points: (s.points ?? [])
                .map((pt) => sanitizeSingleLine(pt, 500))
                .filter(Boolean),
            }))
          : existing.sections,
      attachmentPreviewUrl:
        patch.attachmentPreviewUrl !== undefined
          ? sanitizeSafeUrl(patch.attachmentPreviewUrl)
          : existing.attachmentPreviewUrl,
      status: nextStatus === 'draft' ? 'draft' : 'published',
      updatedAt: new Date().toISOString(),
    };

    const action: AuditActionType =
      patch.status && patch.status !== (existing.status ?? 'published')
        ? patch.status === 'published'
          ? 'material_published'
          : 'material_unpublished'
        : 'material_updated';

    this.update((prev) => ({
      ...prev,
      materials: prev.materials.map((m) => (m.id === materialId ? updated : m)),
      auditLogs: [
        createAuditEntry(
          actor,
          action,
          'study_material',
          materialId,
          `${action === 'material_published' ? 'Published' : action === 'material_unpublished' ? 'Unpublished' : 'Updated'} study material "${updated.title}" (${updated.courseCode})`,
          schoolId
        ),
        ...prev.auditLogs,
      ].slice(0, 300),
    }));

    return updated;
  }

  setMaterialStatus(
    actor: AuthenticatedUser | null | undefined,
    materialId: string,
    status: 'published' | 'draft'
  ): StudyMaterial {
    return this.updateMaterial(actor, materialId, { status });
  }

  deleteMaterial(actor: AuthenticatedUser | null | undefined, materialId: string): void {
    this.requirePermission(
      actor,
      'materials:manage',
      'Only Super Administrators can delete study materials.'
    );
    const existing = this.state.materials.find((m) => m.id === materialId);
    if (!existing) {
      throw new Error('Study material not found.');
    }

    this.update((prev) => ({
      ...prev,
      materials: prev.materials.filter((m) => m.id !== materialId),
      auditLogs: [
        createAuditEntry(
          actor,
          'material_deleted',
          'study_material',
          materialId,
          `Deleted study material "${existing.title}" (${existing.courseCode})`,
          existing.schoolId
        ),
        ...prev.auditLogs,
      ].slice(0, 300),
    }));
  }

  // -------------------------------------------------------------------------
  // Universities Management (Super Admin Only)
  // -------------------------------------------------------------------------

  addSchool(actor: AuthenticatedUser | null | undefined, school: Omit<School, 'id'>): School {
    this.requirePermission(
      actor,
      'schools:manage',
      'Only Super Administrators can add universities.'
    );

    const cleanCode = sanitizeIdentifier(school.code, 16).toUpperCase();
    const cleanName = sanitizeSingleLine(school.name, 160);
    if (!cleanCode || !cleanName) {
      throw new Error('University code and full name are required.');
    }
    if (this.state.schools.some((s) => s.code.toUpperCase() === cleanCode)) {
      throw new Error(`University with code "${cleanCode}" already exists.`);
    }

    const created: School = {
      id: `sch-${cleanCode.toLowerCase().replace(/[^a-z0-9]/g, '')}-${Date.now()}`,
      code: cleanCode,
      name: cleanName,
      shortName: sanitizeSingleLine(school.shortName || cleanCode, 80),
      location: sanitizeSingleLine(school.location || 'Nigeria', 120),
      isActive: Boolean(school.isActive),
      isPrimaryLaunch: Boolean(school.isPrimaryLaunch),
    };

    this.update((prev) => ({
      ...prev,
      schools: [...prev.schools, created],
      auditLogs: [
        createAuditEntry(
          actor,
          'university_created',
          'school',
          created.id,
          `Added university ${created.code} (${created.name})`,
          created.id
        ),
        ...prev.auditLogs,
      ].slice(0, 300),
    }));

    return created;
  }

  updateSchool(
    actor: AuthenticatedUser | null | undefined,
    schoolId: string,
    patch: Partial<Omit<School, 'id'>>
  ): School {
    this.requirePermission(
      actor,
      'schools:manage',
      'Only Super Administrators can edit universities.'
    );

    const existing = this.state.schools.find((s) => s.id === schoolId);
    if (!existing) {
      throw new Error('University not found.');
    }

    const updated: School = {
      ...existing,
      code:
        patch.code !== undefined
          ? sanitizeIdentifier(patch.code, 16).toUpperCase() || existing.code
          : existing.code,
      name:
        patch.name !== undefined
          ? sanitizeSingleLine(patch.name, 160) || existing.name
          : existing.name,
      shortName:
        patch.shortName !== undefined
          ? sanitizeSingleLine(patch.shortName, 80) || existing.shortName
          : existing.shortName,
      location:
        patch.location !== undefined
          ? sanitizeSingleLine(patch.location, 120) || existing.location
          : existing.location,
      isActive: patch.isActive !== undefined ? patch.isActive : existing.isActive,
      isPrimaryLaunch:
        patch.isPrimaryLaunch !== undefined
          ? patch.isPrimaryLaunch
          : existing.isPrimaryLaunch,
    };

    this.update((prev) => ({
      ...prev,
      schools: prev.schools.map((s) => (s.id === schoolId ? updated : s)),
      accounts: prev.accounts.map((a) =>
        a.schoolId === schoolId ? { ...a, schoolCode: updated.code } : a
      ),
      auditLogs: [
        createAuditEntry(
          actor,
          'university_updated',
          'school',
          schoolId,
          `Updated university details for ${updated.code} (${updated.name})`,
          schoolId
        ),
        ...prev.auditLogs,
      ].slice(0, 300),
    }));

    return updated;
  }

  toggleSchoolStatus(actor: AuthenticatedUser | null | undefined, schoolId: string): void {
    this.requirePermission(
      actor,
      'schools:manage',
      'Only Super Administrators can activate or deactivate universities.'
    );
    const existing = this.state.schools.find((s) => s.id === schoolId);
    if (!existing) {
      throw new Error('University not found.');
    }
    const nextActive = !existing.isActive;

    this.update((prev) => ({
      ...prev,
      schools: prev.schools.map((s) =>
        s.id === schoolId ? { ...s, isActive: nextActive } : s
      ),
      auditLogs: [
        createAuditEntry(
          actor,
          'university_status_changed',
          'school',
          schoolId,
          `${nextActive ? 'Activated' : 'Deactivated'} university ${existing.code}`,
          schoolId
        ),
        ...prev.auditLogs,
      ].slice(0, 300),
    }));
  }

  // -------------------------------------------------------------------------
  // Account Directory Synchronization & Audit Helpers (Called via authService)
  // -------------------------------------------------------------------------

  syncManagedAccount(account: ManagedAccount): void {
    this.update((prev) => {
      const idx = prev.accounts.findIndex(
        (a) => a.id === account.id || a.email.toLowerCase() === account.email.toLowerCase()
      );
      if (idx === -1) {
        return {
          ...prev,
          accounts: [account, ...prev.accounts],
        };
      }
      const next = [...prev.accounts];
      next[idx] = { ...next[idx], ...account };
      return { ...prev, accounts: next };
    });
  }

  appendAuditEvent(
    actor: Pick<AuthenticatedUser, 'id' | 'fullName' | 'email' | 'role'>,
    action: AuditActionType,
    targetType: AuditLogEntry['targetType'],
    targetId: string,
    summary: string,
    schoolId?: string
  ): void {
    this.update((prev) => ({
      ...prev,
      auditLogs: [
        createAuditEntry(actor, action, targetType, targetId, summary, schoolId),
        ...prev.auditLogs,
      ].slice(0, 300),
    }));
  }

  setManagedAccountStatusDirect(
    actor: AuthenticatedUser | null | undefined,
    accountId: string,
    nextStatus: AccountStatus,
    action: AuditActionType,
    summary: string
  ): void {
    this.requirePermission(actor, 'accounts:manage', 'Only Super Administrators can update account status.');
    this.update((prev) => ({
      ...prev,
      accounts: prev.accounts.map((acc) =>
        acc.id === accountId ? { ...acc, status: nextStatus } : acc
      ),
      auditLogs: [
        createAuditEntry(actor, action, 'account', accountId, summary),
        ...prev.auditLogs,
      ].slice(0, 300),
    }));
  }

  updateManagedAccountSchoolAndRole(
    actor: AuthenticatedUser | null | undefined,
    accountId: string,
    patch: {
      fullName?: string;
      email?: string;
      role?: UserRole;
      schoolId?: string;
      schoolCode?: string;
      status?: AccountStatus;
      adminVerified?: boolean;
      needsPasswordSetup?: boolean;
    },
    action: AuditActionType,
    summary: string
  ): void {
    this.requirePermission(actor, 'admins:manage', 'Only Super Administrators can modify administrator records.');
    this.update((prev) => ({
      ...prev,
      accounts: prev.accounts.map((acc) =>
        acc.id === accountId ? { ...acc, ...patch } : acc
      ),
      auditLogs: [
        createAuditEntry(actor, action, 'account', accountId, summary, patch.schoolId),
        ...prev.auditLogs,
      ].slice(0, 300),
    }));
  }

  // -------------------------------------------------------------------------
  // Verification, Telemetry, Payments & Broadcast Controls
  // -------------------------------------------------------------------------

  recordSiteVisit(visitorId: string): void {
    const cleanId = sanitizeIdentifier(visitorId, 80);
    if (!cleanId) return;
    const now = new Date().toISOString();
    this.update((prev) => {
      const seen = prev.telemetry.uniqueVisitorIds.includes(cleanId)
        ? prev.telemetry.uniqueVisitorIds
        : [cleanId, ...prev.telemetry.uniqueVisitorIds].slice(0, 500);
      return {
        ...prev,
        telemetry: {
          totalVisits: prev.telemetry.totalVisits + 1,
          uniqueVisitorIds: seen,
          lastVisitAt: now,
        },
      };
    });
  }

  recordUserActivity(event: Omit<UserActivityEvent, 'id' | 'timestamp'>): void {
    const now = new Date().toISOString();
    const entry: UserActivityEvent = {
      id: `uact-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: now,
      userId: event.userId,
      userName: sanitizeSingleLine(event.userName, 120),
      userEmail: sanitizeSingleLine(event.userEmail, 160),
      userRole: event.userRole,
      matricNumber: event.matricNumber ? sanitizeIdentifier(event.matricNumber, 32) : undefined,
      level: event.level,
      type: event.type,
      detail: sanitizeSingleLine(event.detail, 260),
    };

    this.update((prev) => ({
      ...prev,
      userActivities: [entry, ...prev.userActivities].slice(0, 500),
      accounts: prev.accounts.map((acc) =>
        acc.id === event.userId ? { ...acc, lastActiveAt: now } : acc
      ),
    }));
  }

  setAccountSessionState(accountId: string, state: 'logged_in' | 'logged_out'): void {
    const now = new Date().toISOString();
    this.update((prev) => ({
      ...prev,
      accounts: prev.accounts.map((acc) => {
        if (acc.id !== accountId) return acc;
        return {
          ...acc,
          sessionState: state,
          lastActiveAt: now,
          ...(state === 'logged_in' ? { lastLoginAt: now } : { lastLogoutAt: now }),
        };
      }),
    }));
  }

  setAccountAdminVerified(
    actor: AuthenticatedUser | null | undefined,
    accountId: string,
    verified: boolean
  ): void {
    this.requirePermission(
      actor,
      'accounts:manage',
      'Only Super Administrators can verify or unverify accounts.'
    );
    const target = this.state.accounts.find((a) => a.id === accountId);
    if (!target) {
      throw new Error('Target account not found.');
    }
    if (target.role === 'super_admin') {
      throw new Error('Super Admin verification cannot be revoked here.');
    }

    const action: AuditActionType =
      target.role === 'school_admin' ? 'admin_verified' : 'account_verified';

    this.update((prev) => ({
      ...prev,
      accounts: prev.accounts.map((acc) =>
        acc.id === accountId ? { ...acc, adminVerified: verified } : acc
      ),
      auditLogs: [
        createAuditEntry(
          actor,
          action,
          'account',
          accountId,
          `${verified ? 'Verified' : 'Marked pending'} ${
            target.role === 'school_admin' ? 'School Admin' : 'Student'
          } ${target.fullName} (${target.email})`,
          target.schoolId
        ),
        ...prev.auditLogs,
      ].slice(0, 300),
    }));
  }

  recordPaymentTransaction(
    user: AuthenticatedUser,
    tx: Omit<
      PaymentTransaction,
      'id' | 'createdAt' | 'verifiedAt' | 'status' | 'autoActivated'
    >
  ): PaymentTransaction {
    if (!isActiveAccount(user)) {
      throw new Error('Active account required to verify payment.');
    }
    const now = new Date().toISOString();
    const record: PaymentTransaction = {
      ...tx,
      id: `pay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      reference: sanitizeIdentifier(tx.reference, 48).toUpperCase(),
      userId: user.id,
      userName: sanitizeSingleLine(user.fullName, 120),
      userEmail: sanitizeSingleLine(user.email, 160),
      matricNumber: user.matricNumber,
      level: user.level,
      status: 'verified_auto',
      autoActivated: true,
      createdAt: now,
      verifiedAt: now,
    };

    const providerLabel = record.provider === 'paystack' ? 'Paystack' : 'Flutterwave';
    const activity: UserActivityEvent = {
      id: `uact-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: now,
      userId: user.id,
      userName: record.userName,
      userEmail: record.userEmail,
      userRole: user.role,
      matricNumber: user.matricNumber,
      level: user.level,
      type: 'payment_verified',
      detail: `${providerLabel} auto-verified ${record.tierName} (₦${record.amountNaira.toLocaleString()}) · Ref ${record.reference}`,
    };

    this.update((prev) => ({
      ...prev,
      payments: [record, ...prev.payments].slice(0, 300),
      userActivities: [activity, ...prev.userActivities].slice(0, 500),
      accounts: prev.accounts.map((acc) =>
        acc.id === user.id || acc.email.toLowerCase() === user.email.toLowerCase()
          ? {
              ...acc,
              subscriptionTier: record.tierId,
              lastActiveAt: now,
            }
          : acc
      ),
      notifications: [
        {
          id: `notif-pay-${Date.now()}`,
          title: `${record.tierName} is active`,
          message: `Payment of ₦${record.amountNaira.toLocaleString()} received. Ref ${record.reference}.`,
          category: 'system',
          audience: user.role === 'student' ? 'students' : 'admins',
          targetUserId: user.id,
          createdAt: now,
          isRead: false,
        },
        ...prev.notifications,
      ],
      auditLogs: [
        createAuditEntry(
          user,
          'payment_verified',
          'payment',
          record.id,
          `${providerLabel} auto-verified ₦${record.amountNaira.toLocaleString()} for ${record.userName} (${record.matricNumber || record.userEmail}) · Ref ${record.reference}`
        ),
        ...prev.auditLogs,
      ].slice(0, 300),
    }));

    return record;
  }

  updateHeaderMarquee(
    actor: AuthenticatedUser | null | undefined,
    config: Omit<HeaderMarqueeConfig, 'updatedAt' | 'updatedBy'>
  ): HeaderMarqueeConfig {
    this.requirePermission(
      actor,
      'broadcasts:manage',
      'Only Super Administrators can configure the header marquee.'
    );

    const next: HeaderMarqueeConfig = {
      enabled: Boolean(config.enabled),
      message: sanitizeSingleLine(config.message, 280),
      audience: config.audience,
      tone: config.tone,
      updatedAt: new Date().toISOString(),
      updatedBy: sanitizeSingleLine(actor.fullName, 120),
    };

    if (next.enabled && !next.message) {
      throw new Error('Enter a marquee message before turning the header banner on.');
    }

    this.update((prev) => ({
      ...prev,
      marquee: next,
      auditLogs: [
        createAuditEntry(
          actor,
          'marquee_updated',
          'broadcast',
          'header-marquee',
          `${next.enabled ? 'Enabled' : 'Disabled'} header marquee (${next.audience}): ${next.message || 'Cleared'}`
        ),
        ...prev.auditLogs,
      ].slice(0, 300),
    }));

    return next;
  }

  sendBroadcastNotification(
    actor: AuthenticatedUser | null | undefined,
    payload: {
      title: string;
      message: string;
      category: AppNotification['category'];
      audience: BroadcastAudience;
    }
  ): AppNotification {
    this.requirePermission(
      actor,
      'broadcasts:manage',
      'Only Super Administrators can send platform notifications.'
    );

    const title = sanitizeSingleLine(payload.title, 120);
    const message = sanitizePlainText(payload.message, 600).trim();
    if (!title || !message) {
      throw new Error('Enter both a notification title and message.');
    }

    const notif: AppNotification = {
      id: `notif-bc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title,
      message,
      category: payload.category,
      audience: payload.audience,
      createdAt: new Date().toISOString(),
      isRead: false,
      createdBy: sanitizeSingleLine(actor.fullName, 120),
      approvalStatus: 'approved',
    };

    this.update((prev) => ({
      ...prev,
      notifications: [notif, ...prev.notifications],
      auditLogs: [
        createAuditEntry(
          actor,
          'broadcast_sent',
          'broadcast',
          notif.id,
          `Sent notification "${notif.title}" to audience: ${notif.audience}`
        ),
        ...prev.auditLogs,
      ].slice(0, 300),
    }));

    return notif;
  }

  submitSchoolAdminNotification(
    actor: AuthenticatedUser | null | undefined,
    payload: {
      schoolId: string;
      schoolCode?: string;
      title: string;
      message: string;
      category?: AppNotification['category'];
    }
  ): AppNotification {
    if (!isActiveAccount(actor) || isRestrictedAccount(actor)) {
      throw new Error('Your account is currently restricted or inactive.');
    }
    const canAll = hasPermission(actor, 'broadcasts:manage');
    const canSchool = hasPermission(actor, 'pq:upload_school');
    if (!canAll && !canSchool) {
      throw new Error('Only verified School Administrators can submit student notifications.');
    }
    const targetSchoolId = canAll ? payload.schoolId : actor.assignedSchoolId;
    if (!targetSchoolId || (!canAll && payload.schoolId !== targetSchoolId)) {
      throw new Error('You can only submit notifications for your assigned university.');
    }
    const school = this.state.schools.find((s) => s.id === targetSchoolId);
    if (!school) {
      throw new Error('Assigned university not found.');
    }

    const title = sanitizeSingleLine(payload.title, 120);
    const message = sanitizePlainText(payload.message, 600).trim();
    if (!title || !message) {
      throw new Error('Enter both a notification title and message.');
    }

    const now = new Date().toISOString();
    const notif: AppNotification = {
      id: `notif-sch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title,
      message,
      category: payload.category ?? 'system',
      audience: 'students',
      createdAt: now,
      isRead: false,
      createdBy: sanitizeSingleLine(actor.fullName, 120),
      approvalStatus: 'pending_verification',
      schoolId: school.id,
      schoolCode: school.code,
      submittedById: actor.id,
      submittedByName: sanitizeSingleLine(actor.fullName, 120),
      submittedByRole: actor.role,
    };

    this.update((prev) => ({
      ...prev,
      notifications: [notif, ...prev.notifications],
      auditLogs: [
        createAuditEntry(
          actor,
          'notification_submitted',
          'broadcast',
          notif.id,
          `Submitted student notification "${notif.title}" (${school.code}) for Super Admin verification`,
          school.id
        ),
        ...prev.auditLogs,
      ].slice(0, 300),
    }));

    return notif;
  }

  verifySchoolAdminNotification(
    actor: AuthenticatedUser | null | undefined,
    notifId: string,
    decision: 'approve' | 'reject',
    reviewNote?: string
  ): AppNotification {
    this.requirePermission(
      actor,
      'broadcasts:manage',
      'Only Super Administrators can verify or decline School Admin notifications.'
    );
    const existing = this.state.notifications.find((n) => n.id === notifId);
    if (!existing) {
      throw new Error('Notification submission not found.');
    }

    const now = new Date().toISOString();
    const reviewer = sanitizeSingleLine(actor.fullName, 120);
    const cleanNote = reviewNote ? sanitizeSingleLine(reviewNote, 240) : undefined;

    const updated: AppNotification =
      decision === 'approve'
        ? {
            ...existing,
            approvalStatus: 'approved',
            createdAt: now,
            updatedAt: now,
            isRead: false,
            reviewedBy: reviewer,
            reviewedAt: now,
            reviewNote: cleanNote,
            // The sender gets the "is live" notice below instead of a copy of their own post
            exceptUserId: existing.submittedById,
          }
        : {
            ...existing,
            approvalStatus: 'rejected',
            reviewedBy: reviewer,
            reviewedAt: now,
            reviewNote: cleanNote || 'Not approved.',
          };

    const senderNotice: AppNotification | null = existing.submittedById
      ? {
          id: `notif-ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          title: decision === 'approve' ? 'Your notification is live' : 'Your notification was declined',
          message:
            decision === 'approve'
              ? `"${updated.title}" was sent to students.`
              : `"${updated.title}": ${cleanNote || 'Not approved.'}`,
          category: 'system',
          audience: 'admins',
          targetUserId: existing.submittedById,
          createdAt: now,
          isRead: false,
          approvalStatus: 'approved',
        }
      : null;

    this.update((prev) => ({
      ...prev,
      notifications: [
        ...(senderNotice ? [senderNotice] : []),
        ...prev.notifications.map((n) => (n.id === notifId ? updated : n)),
      ],
      auditLogs: [
        createAuditEntry(
          actor,
          decision === 'approve' ? 'notification_verified' : 'notification_rejected',
          'broadcast',
          notifId,
          decision === 'approve'
            ? `Verified & published "${updated.title}"${updated.schoolCode ? ` (${updated.schoolCode})` : ''} to student website`
            : `Declined student notification "${updated.title}"${updated.schoolCode ? ` (${updated.schoolCode})` : ''}`,
          updated.schoolId
        ),
        ...prev.auditLogs,
      ].slice(0, 300),
    }));

    return updated;
  }

  updateNotification(
    actor: AuthenticatedUser | null | undefined,
    notifId: string,
    patch: {
      title: string;
      message: string;
      category?: AppNotification['category'];
      audience?: BroadcastAudience;
    }
  ): AppNotification {
    if (!isActiveAccount(actor) || isRestrictedAccount(actor)) {
      throw new Error('Your account does not have permission to edit notifications.');
    }
    const existing = this.state.notifications.find((n) => n.id === notifId);
    if (!existing) {
      throw new Error('Notification not found.');
    }
    const isSuper = hasPermission(actor, 'broadcasts:manage');
    const isOwnPendingSchool =
      hasPermission(actor, 'pq:upload_school') &&
      existing.approvalStatus === 'pending_verification' &&
      Boolean(actor.assignedSchoolId && existing.schoolId === actor.assignedSchoolId);

    if (!isSuper && !isOwnPendingSchool) {
      throw new Error('You can only edit pending notifications submitted by your university.');
    }

    const title = sanitizeSingleLine(patch.title, 120);
    const message = sanitizePlainText(patch.message, 600).trim();
    if (!title || !message) {
      throw new Error('Notification title and message cannot be empty.');
    }

    const now = new Date().toISOString();
    const updated: AppNotification = {
      ...existing,
      title,
      message,
      category: patch.category ?? existing.category,
      audience: isSuper ? (patch.audience ?? existing.audience) : existing.audience,
      updatedAt: now,
      isRead: false,
    };

    this.update((prev) => ({
      ...prev,
      notifications: prev.notifications.map((n) => (n.id === notifId ? updated : n)),
      auditLogs: [
        createAuditEntry(
          actor,
          'notification_updated',
          'broadcast',
          notifId,
          `Updated notification "${updated.title}"${updated.schoolCode ? ` (${updated.schoolCode})` : ''}`,
          updated.schoolId
        ),
        ...prev.auditLogs,
      ].slice(0, 300),
    }));

    return updated;
  }

  sendDirectNotification(
    actor: AuthenticatedUser | null | undefined,
    payload: {
      targetUserId: string;
      title: string;
      message: string;
      category?: AppNotification['category'];
    }
  ): AppNotification {
    this.requirePermission(
      actor,
      'accounts:manage',
      'Only Super Administrators can send direct user notifications.'
    );

    const target = this.state.accounts.find((a) => a.id === payload.targetUserId);
    if (!target) {
      throw new Error('Target account not found.');
    }
    const title = sanitizeSingleLine(payload.title, 120);
    const message = sanitizePlainText(payload.message, 600).trim();
    if (!title || !message) {
      throw new Error('Enter both a notification title and message.');
    }

    const notif: AppNotification = {
      id: `notif-dir-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title,
      message,
      category: payload.category ?? 'system',
      audience: target.role === 'student' ? 'students' : 'admins',
      targetUserId: target.id,
      createdAt: new Date().toISOString(),
      isRead: false,
      createdBy: sanitizeSingleLine(actor.fullName, 120),
      approvalStatus: 'approved',
    };

    this.update((prev) => ({
      ...prev,
      notifications: [notif, ...prev.notifications],
      auditLogs: [
        createAuditEntry(
          actor,
          'broadcast_sent',
          'account',
          target.id,
          `Sent direct notification "${title}" to ${target.fullName} (${target.email})`
        ),
        ...prev.auditLogs,
      ].slice(0, 300),
    }));

    return notif;
  }

  recordModerationAction(
    actor: AuthenticatedUser | null | undefined,
    accountId: string,
    patch: {
      status?: AccountStatus;
      role?: UserRole;
      warningsCount?: number;
      moderationNote?: string;
    },
    action: AuditActionType,
    summary: string,
    directAlert?: { title: string; message: string }
  ): void {
    this.requirePermission(
      actor,
      'accounts:manage',
      'Only Super Administrators can perform moderation actions.'
    );

    const now = new Date().toISOString();
    const target = this.state.accounts.find((a) => a.id === accountId);

    this.update((prev) => {
      const nextNotifications =
        directAlert && target
          ? [
              {
                id: `notif-mod-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                title: sanitizeSingleLine(directAlert.title, 120),
                message: sanitizePlainText(directAlert.message, 600),
                category: 'access' as const,
                audience: (target.role === 'student' ? 'students' : 'admins') as BroadcastAudience,
                targetUserId: target.id,
                createdAt: now,
                isRead: false,
                createdBy: sanitizeSingleLine(actor.fullName, 120),
              },
              ...prev.notifications,
            ]
          : prev.notifications;

      return {
        ...prev,
        accounts: prev.accounts.map((acc) =>
          acc.id === accountId
            ? {
                ...acc,
                ...(patch.status ? { status: patch.status } : {}),
                ...(patch.role ? { role: patch.role } : {}),
                ...(patch.warningsCount !== undefined ? { warningsCount: patch.warningsCount } : {}),
                ...(patch.moderationNote !== undefined
                  ? { moderationNote: sanitizeSingleLine(patch.moderationNote, 260) }
                  : {}),
                lastModeratedAt: now,
              }
            : acc
        ),
        notifications: nextNotifications,
        auditLogs: [
          createAuditEntry(actor, action, 'account', accountId, summary, target?.schoolId),
          ...prev.auditLogs,
        ].slice(0, 300),
      };
    });
  }

  // -------------------------------------------------------------------------
  // Customer Support Inbox (Tickets & Super Admin Responses)
  // -------------------------------------------------------------------------

  submitSupportTicket(payload: {
    senderUserId?: string;
    senderRole?: UserRole;
    senderName?: string;
    senderEmail?: string;
    senderMatric?: string;
    senderLevel?: SupportTicket['senderLevel'];
    kind?: SupportTicket['kind'];
    message: string;
  }): SupportTicket {
    const cleanMsg = sanitizePlainText(payload.message, 1200).trim();
    if (!cleanMsg) {
      throw new Error('Please write a message before sending.');
    }

    const ticket: SupportTicket = {
      id: `sup-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      senderUserId: payload.senderUserId,
      senderRole: payload.senderRole ?? 'student',
      senderName: sanitizeSingleLine(payload.senderName || 'Student Guest', 120),
      senderEmail: sanitizeSingleLine(payload.senderEmail || 'No email provided', 160),
      senderMatric: payload.senderMatric
        ? sanitizeIdentifier(payload.senderMatric, 32)
        : undefined,
      senderLevel: payload.senderLevel,
      kind: payload.kind ?? 'Question',
      message: cleanMsg,
      status: 'new',
      createdAt: new Date().toISOString(),
    };

    this.update((prev) => ({
      ...prev,
      supportTickets: [ticket, ...prev.supportTickets].slice(0, 300),
    }));

    return ticket;
  }

  replyToSupportTicket(
    actor: AuthenticatedUser | null | undefined,
    ticketId: string,
    replyMessage: string,
    status: SupportTicket['status'] = 'resolved'
  ): SupportTicket {
    this.requirePermission(
      actor,
      'accounts:manage',
      'Only Super Administrators can respond to Customer Support tickets.'
    );
    const existing = this.state.supportTickets.find((t) => t.id === ticketId);
    if (!existing) {
      throw new Error('Support message not found.');
    }

    const cleanReply = sanitizePlainText(replyMessage, 800).trim();
    if (!cleanReply) {
      throw new Error('Write a response before sending.');
    }

    const now = new Date().toISOString();
    const updated: SupportTicket = {
      ...existing,
      status,
      adminReply: cleanReply,
      repliedBy: sanitizeSingleLine(actor.fullName, 120),
      repliedAt: now,
    };

    this.update((prev) => {
      const nextNotifications = existing.senderUserId
        ? [
            {
              id: `notif-sup-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              title: 'Support Response from pqguide',
              message: cleanReply,
              category: 'system' as const,
              audience: (existing.senderRole === 'student'
                ? 'students'
                : 'admins') as BroadcastAudience,
              targetUserId: existing.senderUserId,
              createdAt: now,
              isRead: false,
              createdBy: sanitizeSingleLine(actor.fullName, 120),
            },
            ...prev.notifications,
          ]
        : prev.notifications;

      return {
        ...prev,
        supportTickets: prev.supportTickets.map((t) => (t.id === ticketId ? updated : t)),
        notifications: nextNotifications,
        auditLogs: [
          createAuditEntry(
            actor,
            'support_replied',
            'support',
            ticketId,
            `Replied to support ticket from ${existing.senderName} (${existing.senderEmail})`
          ),
          ...prev.auditLogs,
        ].slice(0, 300),
      };
    });

    return updated;
  }

  setSupportTicketStatus(
    actor: AuthenticatedUser | null | undefined,
    ticketId: string,
    status: SupportTicket['status']
  ): void {
    this.requirePermission(
      actor,
      'accounts:manage',
      'Only Super Administrators can update support ticket status.'
    );
    this.update((prev) => ({
      ...prev,
      supportTickets: prev.supportTickets.map((t) =>
        t.id === ticketId ? { ...t, status } : t
      ),
    }));
  }

  // -------------------------------------------------------------------------
  // Live Website UI Settings (CMS Editor for Student UI, School Admin UI & Constant Pages)
  // -------------------------------------------------------------------------

  updateSiteCms(
    actor: AuthenticatedUser | null | undefined,
    nextConfig: SiteCmsConfig
  ): SiteCmsConfig {
    this.requirePermission(
      actor,
      'broadcasts:manage',
      'Only Super Administrators can edit website UI content.'
    );
    const merged = mergeSiteCms({
      ...nextConfig,
      updatedAt: new Date().toISOString(),
      updatedBy: sanitizeSingleLine(actor.fullName, 120),
    });

    this.update((prev) => ({
      ...prev,
      siteCms: merged,
      auditLogs: [
        createAuditEntry(
          actor,
          'cms_updated',
          'cms',
          'site-cms',
          'Updated live Student Website / School Admin UI & Info pages content'
        ),
        ...prev.auditLogs,
      ].slice(0, 300),
    }));

    return merged;
  }

  resetSiteCms(actor: AuthenticatedUser | null | undefined): SiteCmsConfig {
    this.requirePermission(
      actor,
      'broadcasts:manage',
      'Only Super Administrators can reset website UI content.'
    );
    const defaults = createDefaultSiteCms();
    const withMeta: SiteCmsConfig = {
      ...defaults,
      updatedAt: new Date().toISOString(),
      updatedBy: sanitizeSingleLine(actor.fullName, 120),
    };

    this.update((prev) => ({
      ...prev,
      siteCms: withMeta,
      auditLogs: [
        createAuditEntry(
          actor,
          'cms_updated',
          'cms',
          'site-cms',
          'Reset website UI copy and constant pages to defaults'
        ),
        ...prev.auditLogs,
      ].slice(0, 300),
    }));

    return withMeta;
  }

  // -------------------------------------------------------------------------
  // Student Document Intelligence, Scanning Pipeline & Super Admin Review
  // -------------------------------------------------------------------------

  findDocumentBySha256(sha256: string): AcademicDocumentRecord | undefined {
    const target = sha256.trim().toLowerCase();
    if (!target) return undefined;
    return this.state.academicDocuments.find(
      (d) => d.sha256.toLowerCase() === target && d.publicationStatus !== 'archived'
    );
  }

  getPublishedLibraryDocuments(schoolId?: string): AcademicDocumentRecord[] {
    return this.state.academicDocuments.filter(
      (d) =>
        d.publicationStatus === 'published' && (!schoolId || d.schoolId === schoolId)
    );
  }

  getDocumentsForSubmitter(userId: string): AcademicDocumentRecord[] {
    return this.state.academicDocuments.filter((d) => d.submittedById === userId);
  }

  getDocumentsForReview(
    actor: AuthenticatedUser | null | undefined,
    filter: 'pending_flagged' | 'checks_passed' | 'rejected' | 'all' = 'all'
  ): AcademicDocumentRecord[] {
    this.requirePermission(
      actor,
      'docs:review_all',
      'Only Super Administrators can inspect the document verification review queue.'
    );
    return this.state.academicDocuments.filter((doc) => {
      if (filter === 'pending_flagged') {
        return (
          doc.publicationStatus === 'flagged' ||
          doc.publicationStatus === 'pending_review' ||
          doc.publicationStatus === 'resubmission_requested'
        );
      }
      if (filter === 'checks_passed') {
        return doc.decision === 'auto_approved' && doc.publicationStatus === 'pending_review';
      }
      if (filter === 'rejected') {
        return doc.publicationStatus === 'rejected';
      }
      return true;
    });
  }

  submitScannedDocument(
    actor: AuthenticatedUser | null | undefined,
    payload: {
      id?: string;
      title: string;
      courseCode: string;
      courseTitle: string;
      department?: string;
      faculty?: string;
      level: StudentLevel;
      schoolId?: string;
      session: string;
      semester: SemesterType;
      category: AcademicDocCategory;
      originalFileName: string;
      mimeType: string;
      detectedFormat: AcademicDocumentRecord['detectedFormat'];
      fileSizeBytes: number;
      sha256: string;
      originalFileRef?: AcademicDocumentRecord['originalFileRef'];
      optimizedPreviewUrl?: string;
      pageCount: number;
      extractedText: string;
      summary: string;
      headings: string[];
      pages: AcademicDocumentRecord['pages'];
      diagrams: AcademicDocumentRecord['diagrams'];
      tables: AcademicDocumentRecord['tables'];
      formulas: AcademicDocumentRecord['formulas'];
      qrCodesFound: AcademicDocumentRecord['qrCodesFound'];
      averageOcrConfidence: number | null;
      deterministicChecks: AcademicDocumentRecord['deterministicChecks'];
      aiFindings?: AcademicDocumentRecord['aiFindings'];
      decision: AcademicDocumentRecord['decision'];
      riskLevel: AcademicDocumentRecord['riskLevel'];
      decisionReason?: string;
      parentZipName?: string;
    }
  ): AcademicDocumentRecord {
    this.requirePermission(
      actor,
      'docs:scan_submit',
      'Only active School Admin or Super Admin accounts can scan and submit academic documents.'
    );

    const requestedSchoolId =
      actor.role === 'school_admin' && actor.assignedSchoolId
        ? actor.assignedSchoolId
        : payload.schoolId || this.state.selectedSchoolId;
    const school =
      this.state.schools.find((s) => s.id === requestedSchoolId) ?? this.state.schools[0];

    const duplicate = this.findDocumentBySha256(payload.sha256);
    const now = new Date().toISOString();

    let finalDecision = payload.decision;
    if (duplicate && finalDecision === 'auto_approved') {
      finalDecision = 'flagged';
    }

    // Every scanned document waits for Super Admin verification. Nothing is published
    // automatically, even when the deterministic checks and the AI cross-check pass.
    const aiOk = finalDecision === 'auto_approved';
    const publicationStatus: AcademicDocumentRecord['publicationStatus'] =
      finalDecision === 'rejected'
        ? 'rejected'
        : finalDecision === 'flagged'
          ? 'flagged'
          : 'pending_review';

    const docId = payload.id || `adoc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const record: AcademicDocumentRecord = {
      id: docId,
      title: sanitizeSingleLine(payload.title, 180) || sanitizeSingleLine(payload.originalFileName, 120),
      courseCode: sanitizeIdentifier(payload.courseCode, 24).toUpperCase() || 'GEN 101',
      courseTitle: sanitizeSingleLine(payload.courseTitle, 160) || 'Academic Document',
      department: sanitizeSingleLine(payload.department || actor.department || 'General Studies', 120),
      faculty: sanitizeSingleLine(payload.faculty || actor.faculty || 'Academic Affairs', 120),
      level: payload.level,
      schoolId: school?.id ?? 'sch-aaua',
      schoolCode: school?.code ?? 'AAUA',
      session: sanitizeIdentifier(payload.session, 20) || '2024/2025',
      semester: payload.semester,
      category: payload.category,
      submittedById: actor.id,
      submittedByName: sanitizeSingleLine(actor.fullName, 120),
      submittedByRole: actor.role,
      submittedAt: now,
      updatedAt: now,
      originalFileName: sanitizeSingleLine(payload.originalFileName, 180),
      mimeType: sanitizeSingleLine(payload.mimeType, 120),
      detectedFormat: payload.detectedFormat,
      fileSizeBytes: Math.max(1, payload.fileSizeBytes),
      sha256: payload.sha256.toLowerCase(),
      duplicateOfDocId: duplicate?.id,
      originalFileRef: payload.originalFileRef,
      optimizedPreviewUrl: sanitizeSafeUrl(payload.optimizedPreviewUrl),
      pageCount: Math.max(1, payload.pageCount),
      extractedText: sanitizePlainText(payload.extractedText, 30_000),
      summary: sanitizePlainText(payload.summary, 600),
      headings: (payload.headings ?? []).map((h) => sanitizeSingleLine(h, 140)).filter(Boolean).slice(0, 20),
      pages: (payload.pages ?? []).slice(0, 40).map((pg) => ({
        ...pg,
        text: sanitizePlainText(pg.text, 10_000),
        renderedPreviewUrl: sanitizeSafeUrl(pg.renderedPreviewUrl),
        diagrams: (pg.diagrams ?? []).map((d) => ({ ...d, dataUrl: sanitizeSafeUrl(d.dataUrl) })),
      })),
      diagrams: (payload.diagrams ?? []).slice(0, 12).map((d) => ({
        ...d,
        dataUrl: sanitizeSafeUrl(d.dataUrl),
      })),
      tables: (payload.tables ?? []).slice(0, 16),
      formulas: (payload.formulas ?? []).slice(0, 32),
      qrCodesFound: payload.qrCodesFound ?? [],
      averageOcrConfidence: payload.averageOcrConfidence,
      deterministicChecks: payload.deterministicChecks ?? [],
      aiFindings: payload.aiFindings,
      decision: finalDecision,
      publicationStatus,
      riskLevel: duplicate && payload.riskLevel === 'low' ? 'medium' : payload.riskLevel,
      rejectionReason:
        publicationStatus === 'rejected'
          ? sanitizeSingleLine(
              payload.decisionReason || 'Rejected during automated security/integrity screening.',
              300
            )
          : undefined,
      internalNotes: [],
      parentZipName: payload.parentZipName ? sanitizeSingleLine(payload.parentZipName, 140) : undefined,
      processingHistory: [
        {
          id: `ph-${Date.now()}-scan`,
          timestamp: now,
          stage: 'Scan & Extraction',
          status: 'completed',
          actorName: actor.fullName,
          actorRole: actor.role,
          detail: `Processed ${payload.detectedFormat.toUpperCase()} (${payload.pageCount} page${payload.pageCount === 1 ? '' : 's'}) · SHA-256 ${payload.sha256.slice(0, 12)}...`,
        },
        {
          id: `ph-${Date.now()}-dec`,
          timestamp: now,
          stage: 'Verification Decision',
          status: publicationStatus === 'rejected' ? 'failed' : aiOk ? 'completed' : 'warning',
          detail: aiOk
            ? 'Passed deterministic checks and AI cross-check. Awaiting Super Admin verification before publication.'
            : payload.decisionReason || 'Routed to Super Admin Document Review.',
        },
      ],
    };

    const auditAction: AuditActionType = aiOk ? 'doc_auto_approved' : 'doc_flagged';
    const aiReason = sanitizeSingleLine(
      payload.decisionReason || record.aiFindings?.reason || 'Integrity or AI checks did not pass.',
      300
    );

    this.update((prev) => {
      // Only a successful upload notifies the uploader. Flagged, blocked or failed
      // uploads are reported to the Super Admin alone (through the audit entries below).
      const submitterNotification = {
        id: `notif-doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title: `${record.courseCode} was uploaded`,
        message: 'It will go live once it is checked.',
        category: 'upload' as const,
        audience: 'admins' as BroadcastAudience,
        targetUserId: actor.id,
        createdAt: now,
        isRead: false,
        approvalStatus: 'approved' as const,
        uploadActivity: true,
      };

      const auditEntries = [
        createAuditEntry(
          actor,
          'doc_scanned',
          'academic_document',
          record.id,
          `Scanned "${record.title}" (${record.courseCode} · ${record.detectedFormat.toUpperCase()})`,
          record.schoolId
        ),
        createAuditEntry(
          actor,
          auditAction,
          'academic_document',
          record.id,
          aiOk
            ? `Passed automated checks, awaiting your verification: "${record.title}"`
            : `${publicationStatus === 'rejected' ? 'Blocked' : 'Flagged for review'}: "${record.title}"`,
          record.schoolId
        ),
      ];

      // Extra alert for the Super Admin whenever the AI/integrity checks say the
      // document is not okay, on top of the normal "every scan" entry above.
      if (!aiOk) {
        auditEntries.push(
          createAuditEntry(
            actor,
            'doc_ai_alert',
            'academic_document',
            record.id,
            `AI cross-check found problems with "${record.title}" (${record.courseCode}, ${record.riskLevel} risk): ${aiReason}`,
            record.schoolId
          )
        );
      }

      return {
        ...prev,
        academicDocuments: [record, ...prev.academicDocuments].slice(0, 120),
        notifications: aiOk ? [submitterNotification, ...prev.notifications] : prev.notifications,
        auditLogs: [...auditEntries.reverse(), ...prev.auditLogs].slice(0, 300),
      };
    });

    return record;
  }

  /** Records a failed upload for the Super Admin only. The uploader is not notified. */
  reportUploadFailure(
    actor: AuthenticatedUser | null | undefined,
    payload: { fileName: string; reason: string }
  ): void {
    this.requirePermission(
      actor,
      'docs:scan_submit',
      'Only active School Admin or Super Admin accounts can upload documents.'
    );
    const fileName = sanitizeSingleLine(payload.fileName, 120) || 'a file';
    const reason = sanitizeSingleLine(payload.reason, 240) || 'Unknown error';
    const schoolId =
      actor.role === 'school_admin' ? actor.assignedSchoolId : this.state.selectedSchoolId;
    this.update((prev) => ({
      ...prev,
      auditLogs: [
        createAuditEntry(
          actor,
          'doc_upload_failed',
          'academic_document',
          `failed-${Date.now()}`,
          `Upload of "${fileName}" failed: ${reason}`,
          schoolId
        ),
        ...prev.auditLogs,
      ].slice(0, 300),
    }));
  }

  reviewSubmittedDocument(
    actor: AuthenticatedUser | null | undefined,
    docId: string,
    action: 'approve' | 'reject' | 'request_resubmission',
    options?: { rejectionReason?: string; note?: string }
  ): AcademicDocumentRecord {
    this.requirePermission(
      actor,
      'docs:review_all',
      'Only Super Administrators can approve, request resubmission, or reject submitted documents.'
    );

    const existing = this.state.academicDocuments.find((d) => d.id === docId);
    if (!existing) {
      throw new Error('Submitted document not found.');
    }

    const cleanReason = sanitizeSingleLine(options?.rejectionReason ?? '', 400);
    if ((action === 'reject' || action === 'request_resubmission') && cleanReason.length < 5) {
      throw new Error('A clear reason (at least 5 characters) is mandatory when rejecting or requesting resubmission.');
    }

    const cleanNote = sanitizeSingleLine(options?.note ?? '', 400);
    const now = new Date().toISOString();
    const nextStatus: AcademicDocumentRecord['publicationStatus'] =
      action === 'approve'
        ? 'published'
        : action === 'request_resubmission'
          ? 'resubmission_requested'
          : 'rejected';

    const nextNotes = cleanNote
      ? [
          {
            id: `dnote-${Date.now()}`,
            authorId: actor.id,
            authorName: sanitizeSingleLine(actor.fullName, 120),
            createdAt: now,
            note: cleanNote,
          },
          ...existing.internalNotes,
        ]
      : existing.internalNotes;

    const historyEntry = {
      id: `ph-${Date.now()}-rev`,
      timestamp: now,
      stage:
        action === 'approve'
          ? 'Super Admin Approved & Published'
          : action === 'request_resubmission'
            ? 'Resubmission Requested'
            : 'Super Admin Rejected',
      status: (action === 'approve' ? 'completed' : action === 'request_resubmission' ? 'warning' : 'failed') as
        | 'completed'
        | 'warning'
        | 'failed',
      actorName: actor.fullName,
      actorRole: actor.role,
      detail:
        action === 'approve'
          ? `Approved & published by ${actor.fullName}${existing.publicationStatus === 'flagged' || existing.publicationStatus === 'rejected' || existing.decision !== 'auto_approved' ? ' (Super Admin override of automated checks)' : ''}.`
          : cleanReason,
    };

    const updated: AcademicDocumentRecord = {
      ...existing,
      publicationStatus: nextStatus,
      reviewerId: actor.id,
      reviewerName: sanitizeSingleLine(actor.fullName, 120),
      reviewedAt: now,
      updatedAt: now,
      rejectionReason: action === 'approve' ? undefined : cleanReason,
      internalNotes: nextNotes,
      processingHistory: [...existing.processingHistory, historyEntry],
    };

    const auditAction: AuditActionType =
      action === 'approve'
        ? 'doc_review_approved'
        : action === 'request_resubmission'
          ? 'doc_resubmission_requested'
          : 'doc_review_rejected';

    this.update((prev) => ({
      ...prev,
      academicDocuments: prev.academicDocuments.map((d) => (d.id === docId ? updated : d)),
      notifications: [
        {
          id: `notif-rev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          title:
            action === 'approve'
              ? `${updated.courseCode} was approved`
              : action === 'request_resubmission'
                ? `${updated.courseCode} needs a new upload`
                : `${updated.courseCode} was rejected`,
          message: action === 'approve' ? 'Your upload is now live.' : cleanReason,
          category: 'upload' as const,
          audience: 'admins' as BroadcastAudience,
          targetUserId: updated.submittedById,
          createdAt: now,
          isRead: false,
          approvalStatus: 'approved' as const,
          uploadActivity: true,
        },
        ...prev.notifications,
      ],
      auditLogs: [
        createAuditEntry(
          actor,
          auditAction,
          'academic_document',
          docId,
          action === 'approve'
            ? `Approved & published "${updated.title}" (${updated.courseCode})`
            : `${action === 'request_resubmission' ? 'Requested resubmission for' : 'Rejected'} "${updated.title}": ${cleanReason}`,
          updated.schoolId
        ),
        ...prev.auditLogs,
      ].slice(0, 300),
    }));

    this.syncCatalogFromAcademicDoc(updated);

    // Tell students (and School Admins) once a past question is really live.
    if (action === 'approve') {
      const catalogId = `pqdoc-${updated.id}`;
      const school = this.state.schools.find((s) => s.id === updated.schoolId);
      const isLive = this.state.documents.some((d) => d.id === catalogId);
      const alreadyAnnounced = this.state.notifications.some(
        (n) => n.id === `notif-new-${catalogId}`
      );
      if (isLive && !alreadyAnnounced) {
        const notice = buildNewDocumentNotification({
          docId: catalogId,
          courseCode: updated.courseCode,
          session: updated.session,
          semester: updated.semester,
          schoolId: updated.schoolId,
          schoolCode: school?.code ?? updated.schoolCode,
          // The uploader already got "was approved" above
          exceptUserId: updated.submittedById,
        });
        this.update((prev) => ({ ...prev, notifications: [notice, ...prev.notifications] }));
      }
    }

    return updated;
  }

  /**
   * Keeps the student Past Questions catalog in step with a scanned document. Only an
   * approved past question with real numbered questions is published; any other status
   * (declined, resubmission, deleted) removes its typed copy.
   */
  private syncCatalogFromAcademicDoc(doc: AcademicDocumentRecord, removeOnly = false): void {
    const catalogId = `pqdoc-${doc.id}`;
    const questions =
      doc.category === 'past_question' && doc.publicationStatus === 'published' && !removeOnly
        ? extractQuestionsFromText(doc.extractedText)
        : [];
    const shouldPublish = questions.length > 0;
    const existing = this.state.documents.find((d) => d.id === catalogId);
    if (!shouldPublish && !existing) return;

    const school = this.state.schools.find((s) => s.id === doc.schoolId);
    const year = parseInt(doc.session.split('/')[1] ?? '', 10) || new Date().getFullYear();
    const entry: PastQuestionDoc = {
      id: catalogId,
      schoolId: doc.schoolId,
      schoolCode: school?.code ?? doc.schoolCode,
      courseCode: doc.courseCode,
      courseTitle: doc.courseTitle,
      department: doc.department,
      faculty: doc.faculty,
      level: doc.level,
      session: doc.session,
      year,
      semester: doc.semester,
      sourceType: doc.detectedFormat === 'image' ? 'scanned_image' : 'typed_document',
      originalFileName: doc.originalFileName,
      scannedPagePreviewUrl: doc.optimizedPreviewUrl,
      extractedText: sanitizePlainText(doc.extractedText, 8000),
      questions: questions.map((q) => sanitizeSingleLine(q, 1000)).filter(Boolean),
      uploadedBy: doc.submittedByName,
      uploadedById: doc.submittedById,
      uploadedAt: doc.submittedAt,
      updatedAt: new Date().toISOString(),
      viewsCount: existing?.viewsCount ?? 0,
      status: 'published',
    };

    this.update((prev) => ({
      ...prev,
      sessions:
        shouldPublish && !prev.sessions.includes(entry.session)
          ? [entry.session, ...prev.sessions].sort().reverse()
          : prev.sessions,
      documents: shouldPublish
        ? existing
          ? prev.documents.map((d) => (d.id === catalogId ? entry : d))
          : [entry, ...prev.documents]
        : prev.documents.filter((d) => d.id !== catalogId),
      recentDocIds: shouldPublish
        ? prev.recentDocIds
        : prev.recentDocIds.filter((id) => id !== catalogId),
    }));
  }

  deleteAcademicDocument(actor: AuthenticatedUser | null | undefined, docId: string): void {
    this.requirePermission(
      actor,
      'docs:review_all',
      'Only Super Administrators can delete uploaded documents.'
    );
    const existing = this.state.academicDocuments.find((d) => d.id === docId);
    if (!existing) {
      throw new Error('Submitted document not found.');
    }
    const now = new Date().toISOString();
    this.syncCatalogFromAcademicDoc(existing, true);
    this.update((prev) => ({
      ...prev,
      academicDocuments: prev.academicDocuments.filter((d) => d.id !== docId),
      notifications: [
        {
          id: `notif-del-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          title: `Document Removed: ${existing.courseCode}`,
          message: `Your upload "${existing.title}" was removed by the Super Admin.`,
          category: 'upload' as const,
          audience: 'admins' as BroadcastAudience,
          targetUserId: existing.submittedById,
          createdAt: now,
          isRead: false,
          createdBy: sanitizeSingleLine(actor.fullName, 120),
          approvalStatus: 'approved' as const,
          uploadActivity: true,
        },
        ...prev.notifications,
      ],
      auditLogs: [
        createAuditEntry(
          actor,
          'doc_deleted',
          'academic_document',
          docId,
          `Deleted "${existing.title}" (${existing.courseCode})`,
          existing.schoolId
        ),
        ...prev.auditLogs,
      ].slice(0, 300),
    }));
  }

  addDocumentReviewNote(
    actor: AuthenticatedUser | null | undefined,
    docId: string,
    note: string
  ): AcademicDocumentRecord {
    this.requirePermission(
      actor,
      'docs:review_all',
      'Only Super Administrators can attach reviewer notes.'
    );
    const existing = this.state.academicDocuments.find((d) => d.id === docId);
    if (!existing) {
      throw new Error('Submitted document not found.');
    }
    const cleanNote = sanitizeSingleLine(note, 400);
    if (!cleanNote) {
      throw new Error('Enter a reviewer note first.');
    }
    const now = new Date().toISOString();
    const updated: AcademicDocumentRecord = {
      ...existing,
      updatedAt: now,
      internalNotes: [
        {
          id: `dnote-${Date.now()}`,
          authorId: actor.id,
          authorName: sanitizeSingleLine(actor.fullName, 120),
          createdAt: now,
          note: cleanNote,
        },
        ...existing.internalNotes,
      ],
    };

    this.update((prev) => ({
      ...prev,
      academicDocuments: prev.academicDocuments.map((d) => (d.id === docId ? updated : d)),
    }));

    return updated;
  }

  // -------------------------------------------------------------------------
  // Dataset & Dev Reset Controls
  // -------------------------------------------------------------------------

  clearSeedSamples(actor: AuthenticatedUser | null | undefined): void {
    this.requirePermission(
      actor,
      'pq:manage_all',
      'Only Super Administrators can clear starter catalog samples.'
    );
    localStore.removeItem(LEGACY_DEMO_FLAG_KEY);
    this.update((prev) => ({
      ...prev,
      documents: prev.documents.filter((doc) => !doc.id.startsWith('pq-aaua-')),
      notifications: [
        {
          id: `notif-${Date.now()}`,
          title: 'Starter Samples Cleared',
          message:
            'Starter sample past questions were removed. All real user records and custom uploads remain intact.',
          category: 'system',
          createdAt: new Date().toISOString(),
          isRead: false,
        },
      ],
      auditLogs: [
        createAuditEntry(
          actor,
          'pq_deleted',
          'system',
          'seed-samples',
          'Cleared starter sample past questions'
        ),
        ...prev.auditLogs,
      ].slice(0, 300),
    }));
  }

  restoreDefaultCatalog(actor: AuthenticatedUser | null | undefined): void {
    this.requirePermission(
      actor,
      'dev:reset',
      'Only Super Administrators can restore starter catalog.'
    );
    const defaults = getDefaultState();
    this.update((prev) => ({
      ...prev,
      documents: defaults.documents,
      materials: defaults.materials.map(normalizeMaterial),
      notifications: defaults.notifications,
      auditLogs: [
        createAuditEntry(
          actor,
          'dev_data_reset',
          'system',
          'default-catalog',
          'Restored starter past questions and study materials catalog'
        ),
        ...prev.auditLogs,
      ].slice(0, 300),
    }));
  }

  resetAllForDev(): void {
    localStore.removeItem(LEGACY_DEMO_FLAG_KEY);
    this.state = getDefaultState();
    localStore.removeItem(STORAGE_KEY);
    this.listeners.forEach((l) => l());
  }
}

export const archiveRepository = new ArchiveRepository();
