import type {
  AppNotification,
  ArchiveFilter,
  ManagedAccount,
  PastQuestionDoc,
  School,
  SubscriptionTierId,
  UserRole,
} from '../core/types';
import {
  SEED_ACCOUNTS,
  SEED_NOTIFICATIONS,
  SEED_PAST_QUESTIONS,
  SEED_SCHOOLS,
  SEED_SESSIONS,
} from '../data/seedCatalog';

const STORAGE_KEY = 'prepvault_aaua_store_v1';

export interface AppStoreState {
  schools: School[];
  sessions: string[];
  documents: PastQuestionDoc[];
  notifications: AppNotification[];
  accounts: ManagedAccount[];
  activeTierId: SubscriptionTierId;
  activeRole: UserRole;
  selectedSchoolId: string;
}

function getDefaultState(): AppStoreState {
  return {
    schools: SEED_SCHOOLS,
    sessions: SEED_SESSIONS,
    documents: SEED_PAST_QUESTIONS,
    notifications: SEED_NOTIFICATIONS,
    accounts: SEED_ACCOUNTS,
    activeTierId: 'free',
    activeRole: 'student',
    selectedSchoolId: 'sch-aaua',
  };
}

function loadState(): AppStoreState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultState();
    const parsed = JSON.parse(raw) as Partial<AppStoreState>;
    const defaults = getDefaultState();
    return {
      schools: Array.isArray(parsed.schools) && parsed.schools.length > 0 ? parsed.schools : defaults.schools,
      sessions: Array.isArray(parsed.sessions) && parsed.sessions.length > 0 ? parsed.sessions : defaults.sessions,
      documents: Array.isArray(parsed.documents) ? parsed.documents : defaults.documents,
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications : defaults.notifications,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : defaults.accounts,
      activeTierId: parsed.activeTierId ?? defaults.activeTierId,
      activeRole: parsed.activeRole ?? defaults.activeRole,
      selectedSchoolId: parsed.selectedSchoolId ?? defaults.selectedSchoolId,
    };
  } catch {
    return getDefaultState();
  }
}

function saveState(state: AppStoreState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors on constrained devices; in-memory state still operates cleanly.
  }
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

  setActiveTier(tierId: SubscriptionTierId): void {
    this.update((prev) => ({
      ...prev,
      activeTierId: tierId,
      notifications: [
        {
          id: `notif-${Date.now()}`,
          title: tierId === 'free' ? 'Switched to Free Starter' : 'Subscription Pass Activated',
          message:
            tierId === 'free'
              ? 'You are browsing on Free Starter preview mode.'
              : `Your ${tierId.replace('_', ' ₦')} access pass is now active across all unlocked past questions.`,
          category: 'billing',
          createdAt: new Date().toISOString(),
          isRead: false,
        },
        ...prev.notifications,
      ],
    }));
  }

  setActiveRole(role: UserRole): void {
    this.update((prev) => ({ ...prev, activeRole: role }));
  }

  setSelectedSchool(schoolId: string): void {
    this.update((prev) => ({ ...prev, selectedSchoolId: schoolId }));
  }

  filterDocuments(filter: ArchiveFilter): PastQuestionDoc[] {
    const q = filter.query.trim().toLowerCase();
    return this.state.documents.filter((doc) => {
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

  incrementView(docId: string): void {
    this.update((prev) => ({
      ...prev,
      documents: prev.documents.map((doc) =>
        doc.id === docId ? { ...doc, viewsCount: doc.viewsCount + 1 } : doc
      ),
    }));
  }

  addDocument(doc: PastQuestionDoc): void {
    this.update((prev) => {
      const sessions = prev.sessions.includes(doc.session)
        ? prev.sessions
        : [doc.session, ...prev.sessions].sort().reverse();
      return {
        ...prev,
        sessions,
        documents: [doc, ...prev.documents],
        notifications: [
          {
            id: `notif-${Date.now()}`,
            title: `Uploaded ${doc.courseCode} (${doc.session})`,
            message: `${doc.courseTitle} — ${doc.semester} was processed via ${
              doc.sourceType === 'scanned_image' ? 'Scan-to-PDF' : 'Text Extraction'
            } and indexed.`,
            category: 'upload',
            createdAt: new Date().toISOString(),
            isRead: false,
            targetDocId: doc.id,
          },
          ...prev.notifications,
        ],
      };
    });
  }

  deleteDocument(docId: string): void {
    this.update((prev) => ({
      ...prev,
      documents: prev.documents.filter((doc) => doc.id !== docId),
    }));
  }

  toggleDocumentFreePreview(docId: string): void {
    this.update((prev) => ({
      ...prev,
      documents: prev.documents.map((doc) =>
        doc.id === docId ? { ...doc, isFreePreview: !doc.isFreePreview } : doc
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

  toggleSchoolStatus(schoolId: string): void {
    this.update((prev) => ({
      ...prev,
      schools: prev.schools.map((s) =>
        s.id === schoolId ? { ...s, isActive: !s.isActive } : s
      ),
    }));
  }

  addSchool(school: Omit<School, 'id'>): void {
    this.update((prev) => ({
      ...prev,
      schools: [
        ...prev.schools,
        { ...school, id: `sch-${school.code.toLowerCase()}-${Date.now()}` },
      ],
    }));
  }

  toggleAccountStatus(accountId: string): void {
    this.update((prev) => ({
      ...prev,
      accounts: prev.accounts.map((acc) =>
        acc.id === accountId
          ? { ...acc, status: acc.status === 'active' ? 'suspended' : 'active' }
          : acc
      ),
    }));
  }

  updateAccountRole(accountId: string, role: UserRole): void {
    this.update((prev) => ({
      ...prev,
      accounts: prev.accounts.map((acc) =>
        acc.id === accountId ? { ...acc, role } : acc
      ),
    }));
  }

  clearSeedSamples(): void {
    this.update((prev) => ({
      ...prev,
      documents: prev.documents.filter((doc) => !doc.id.startsWith('pq-aaua-')),
      notifications: [
        {
          id: `notif-${Date.now()}`,
          title: 'Starter Samples Cleared',
          message: 'All demo seed past questions were removed. Upload real papers via School Admin.',
          category: 'system',
          createdAt: new Date().toISOString(),
          isRead: false,
        },
      ],
    }));
  }

  restoreDefaultCatalog(): void {
    this.state = getDefaultState();
    saveState(this.state);
    this.listeners.forEach((l) => l());
  }
}

export const archiveRepository = new ArchiveRepository();
