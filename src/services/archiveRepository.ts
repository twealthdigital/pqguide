import {
  canManageSchoolDocument,
  hasPermission,
  isActiveAccount,
} from '../core/permissions';
import {
  sanitizeIdentifier,
  sanitizePlainText,
  sanitizeSafeUrl,
  sanitizeSingleLine,
} from '../core/security';
import { courseHeading } from '../core/docTitle';
import type {
  AccountStatus,
  AppNotification,
  ArchiveFilter,
  AuditActionType,
  AuditLogEntry,
  AuthenticatedUser,
  ContentStatus,
  ManagedAccount,
  PastQuestionDoc,
  School,
  StudyMaterial,
  UserRole,
} from '../core/types';
import { STUDY_MATERIALS } from '../data/materials';
import {
  SEED_ACCOUNTS,
  SEED_NOTIFICATIONS,
  SEED_PAST_QUESTIONS,
  SEED_SCHOOLS,
  SEED_SESSIONS,
} from '../data/seedCatalog';
import { localStore } from './storage/localStore';

const STORAGE_KEY = 'pqguide_aaua_store_v1';

export interface AppStoreState {
  schools: School[];
  sessions: string[];
  documents: PastQuestionDoc[];
  materials: StudyMaterial[];
  notifications: AppNotification[];
  accounts: ManagedAccount[];
  auditLogs: AuditLogEntry[];
  selectedSchoolId: string;
  /** Most recently opened past question ids, newest first. */
  recentDocIds: string[];
}

function getDefaultState(): AppStoreState {
  return {
    schools: SEED_SCHOOLS,
    sessions: SEED_SESSIONS,
    documents: SEED_PAST_QUESTIONS,
    materials: STUDY_MATERIALS,
    notifications: SEED_NOTIFICATIONS,
    accounts: SEED_ACCOUNTS,
    auditLogs: [],
    selectedSchoolId: 'sch-aaua',
    recentDocIds: [],
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

function loadState(): AppStoreState {
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

    const accounts = Array.isArray(parsed.accounts)
      ? parsed.accounts.map((a) => ({
          ...a,
          schoolId:
            a.schoolId ??
            schools.find((s) => s.code.toUpperCase() === (a.schoolCode || '').toUpperCase())?.id,
        }))
      : defaults.accounts;

    return {
      schools,
      sessions:
        Array.isArray(parsed.sessions) && parsed.sessions.length > 0
          ? parsed.sessions
          : defaults.sessions,
      documents,
      materials: storedMaterials,
      notifications,
      accounts,
      auditLogs: Array.isArray(parsed.auditLogs) ? parsed.auditLogs.slice(0, 300) : [],
      selectedSchoolId: parsed.selectedSchoolId ?? defaults.selectedSchoolId,
      recentDocIds: Array.isArray(parsed.recentDocIds)
        ? parsed.recentDocIds.filter((id): id is string => typeof id === 'string')
        : [],
    };
  } catch {
    return getDefaultState();
  }
}

function saveState(state: AppStoreState): void {
  localStore.setJson(STORAGE_KEY, state);
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

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): AppStoreState => this.state;

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
      notifications: prev.notifications.map((n) => ({ ...n, isRead: true })),
    }));
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
              {
                id: `notif-${Date.now()}`,
                title: `Uploaded ${sanitizedDoc.courseCode} (${sanitizedDoc.session})`,
                message: `${courseHeading(sanitizedDoc)} — ${sanitizedDoc.semester} (${school.code}) was indexed.`,
                category: 'upload' as const,
                createdAt: new Date().toISOString(),
                isRead: false,
                targetDocId: sanitizedDoc.id,
              },
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
  // Dataset & Dev Reset Controls
  // -------------------------------------------------------------------------

  clearSeedSamples(actor: AuthenticatedUser | null | undefined): void {
    this.requirePermission(
      actor,
      'pq:manage_all',
      'Only Super Administrators can clear starter catalog samples.'
    );
    this.update((prev) => ({
      ...prev,
      documents: prev.documents.filter((doc) => !doc.id.startsWith('pq-aaua-')),
      notifications: [
        {
          id: `notif-${Date.now()}`,
          title: 'Starter Samples Cleared',
          message:
            'Demo seed past questions were removed. Upload official past questions from Super Admin or School Admin.',
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
          'Cleared starter demo past question samples'
        ),
        ...prev.auditLogs,
      ].slice(0, 300),
    }));
  }

  restoreDefaultCatalog(actor: AuthenticatedUser | null | undefined): void {
    this.requirePermission(
      actor,
      'dev:reset',
      'Only Super Administrators can restore starter samples.'
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
          'Restored default past questions and study materials catalog'
        ),
        ...prev.auditLogs,
      ].slice(0, 300),
    }));
  }

  resetAllForDev(): void {
    this.state = getDefaultState();
    localStore.removeItem(STORAGE_KEY);
    this.listeners.forEach((l) => l());
  }
}

export const archiveRepository = new ArchiveRepository();
