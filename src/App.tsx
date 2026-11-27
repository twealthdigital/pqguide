import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppScreen,
  AuthenticatedUser,
  AuthPortal,
  PastQuestionDoc,
  SchoolAdminSectionId,
  SettingsUiTarget,
  StudyMaterial,
  SuperAdminSectionId,
  WorkspaceViewMode,
} from './core/types';
import { getDefaultScreenForRole } from './core/permissions';
import {
  detectAuthPortal,
  getPortalForRole,
  getPortalPath,
  isPortalCompatibleWithRole,
} from './app/portal';
import {
  closeBackLayer,
  getBackLayers,
  runNavigationGuard,
  subscribeBackHandlers,
} from './core/navGuard';
import { getInitialScreenForUser, resolveSafeScreen } from './app/router';
import { ProtectedRoute } from './app/guards/ProtectedRoute';
import type { AuthNotice, AuthView } from './screens/AuthScreen';
import type { PerformanceSubView } from './screens/PerformanceScreen';
import { useArchiveStore } from './hooks/useArchiveStore';
import { archiveRepository } from './services/archiveRepository';
import { authService } from './services/authService';
import { SESSION_KEY } from './services/auth/sessionService';
import { localStore } from './services/storage/localStore';
import {
  subscriptionService,
  type PaywallContext,
} from './core/subscription';
import {
  NavigationShell,
  TopDropInNotification,
  type DropInNotificationItem,
} from './components/ui';
import { HomeScreenSkeleton } from './components/ui/Skeleton';
import { LoadingScreen } from './screens/LoadingScreen';
import { HomeScreen } from './screens/HomeScreen';

// Onboarding and auth are only needed by signed-out users, so they stay out of
// the main bundle that returning (signed-in) users download.
const loadOnboarding = () => import('./screens/OnboardingScreen');
const loadAuth = () => import('./screens/AuthScreen');

const OnboardingScreen = lazy(() =>
  loadOnboarding().then((m) => ({ default: m.OnboardingScreen }))
);

const AuthScreen = lazy(() =>
  loadAuth().then((m) => ({ default: m.AuthScreen }))
);

// Signed-out visitors see a splash first: fetch their next screens during it
// so there is no extra wait afterwards.
if (typeof window !== 'undefined' && authService.getActiveSession() === null) {
  void loadOnboarding();
  void loadAuth();
}

const PastQuestionReaderScreen = lazy(() =>
  import('./screens/PastQuestionReaderScreen').then((m) => ({
    default: m.PastQuestionReaderScreen,
  }))
);

const PastQuestionsScreen = lazy(() =>
  import('./screens/PastQuestionsScreen').then((m) => ({ default: m.PastQuestionsScreen }))
);

const InfoScreen = lazy(() =>
  import('./screens/InfoScreen').then((m) => ({ default: m.InfoScreen }))
);

const MaterialsScreen = lazy(() =>
  import('./screens/MaterialsScreen').then((m) => ({ default: m.MaterialsScreen }))
);

const MaterialReaderScreen = lazy(() =>
  import('./screens/MaterialReaderScreen').then((m) => ({ default: m.MaterialReaderScreen }))
);

const NotificationsScreen = lazy(() =>
  import('./screens/NotificationsScreen').then((m) => ({
    default: m.NotificationsScreen,
  }))
);

const MockExamScreen = lazy(() =>
  import('./screens/MockExamScreen').then((m) => ({ default: m.MockExamScreen }))
);

const PerformanceScreen = lazy(() =>
  import('./screens/PerformanceScreen').then((m) => ({ default: m.PerformanceScreen }))
);

const SchoolAdminScreen = lazy(() =>
  import('./screens/SchoolAdminScreen').then((m) => ({
    default: m.SchoolAdminScreen,
  }))
);

const SuperAdminScreen = lazy(() =>
  import('./screens/SuperAdminScreen').then((m) => ({
    default: m.SuperAdminScreen,
  }))
);

const SubscriptionScreen = lazy(() =>
  import('./screens/SubscriptionScreen').then((m) => ({
    default: m.SubscriptionScreen,
  }))
);

/** One step in the in-app "Back" trail. */
interface NavEntry {
  screen: AppScreen;
  docId: string | null;
  materialId: string | null;
}

interface NavState extends NavEntry {
  /** Screens the person came from, oldest first. Back pops the last one. */
  stack: NavEntry[];
}

interface PerfNavState {
  view: PerformanceSubView;
  selectedId: string | null;
}

type PreAuthScreen = 'onboarding' | 'auth';

interface AppHistoryState {
  idx: number;
  __pqgLayers?: string[];
  __pqgOut?: PreAuthScreen;
  __pqgStep?: number;
  __pqgAuthView?: AuthView;
  nav?: NavState;
  perf?: PerfNavState;
  paywall?: PaywallContext | null;
}

const INITIAL_NAV: NavState = { screen: 'home', docId: null, materialId: null, stack: [] };
const INITIAL_PERF: PerfNavState = { view: 'list', selectedId: null };

const entryOf = (n: NavState): NavEntry => ({
  screen: n.screen,
  docId: n.docId,
  materialId: n.materialId,
});

function AppContent() {
  const store = useArchiveStore();
  const [portal, setPortal] = useState<AuthPortal>(() => detectAuthPortal());
  const [authenticatedStudent, setAuthenticatedStudent] = useState<AuthenticatedUser | null>(() => {
    const session = authService.getActiveSession();
    subscriptionService.setRoleOverride(session?.role ?? null);
    return session;
  });
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceViewMode>(
    () => authService.getActiveSession()?.role ?? 'student'
  );
  const [superAdminSection, setSuperAdminSection] = useState<SuperAdminSectionId>('overview');
  const [schoolAdminSection, setSchoolAdminSection] = useState<SchoolAdminSectionId>('overview');
  const [settingsTarget, setSettingsTarget] = useState<SettingsUiTarget>('normal_website');
  const [superAdminPreviewSchoolId, setSuperAdminPreviewSchoolId] = useState('sch-aaua');
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(
    () => authService.hasCompletedOnboarding() || authService.getActiveSession() !== null
  );
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [authView, setAuthView] = useState<AuthView>('signin');
  const [nav, setNav] = useState<NavState>(INITIAL_NAV);
  const [perf, setPerf] = useState<PerfNavState>(INITIAL_PERF);
  const [paywallContext, setPaywallContext] = useState<PaywallContext | null>(null);
  const [focusSearchSignal, setFocusSearchSignal] = useState(0);
  const [activeDropIn, setActiveDropIn] = useState<DropInNotificationItem | null>(null);
  const [authNotice, setAuthNotice] = useState<AuthNotice | null>(() => {
    if (authService.consumeExpiredSessionNotice()) {
      return {
        tone: 'warning',
        message: 'Your 12-hour session has expired. Please sign in again to continue.',
      };
    }
    return null;
  });
  const sessionBootMsRef = useRef<number>(Date.now());
  const seenNotifSignaturesRef = useRef<Map<string, Map<string, string>>>(new Map());

  const authRef = useRef(authenticatedStudent);
  authRef.current = authenticatedStudent;
  const workspaceModeRef = useRef<WorkspaceViewMode>(workspaceMode);
  workspaceModeRef.current = workspaceMode;
  const hasCompletedOnboardingRef = useRef(hasCompletedOnboarding);
  hasCompletedOnboardingRef.current = hasCompletedOnboarding;
  const onboardingStepRef = useRef(onboardingStep);
  onboardingStepRef.current = onboardingStep;
  const authViewRef = useRef<AuthView>(authView);
  authViewRef.current = authView;
  const navRef = useRef<NavState>(nav);
  navRef.current = nav;
  const perfRef = useRef<PerfNavState>(perf);
  perfRef.current = perf;
  const paywallRef = useRef<PaywallContext | null>(paywallContext);
  paywallRef.current = paywallContext;

  const historyIdxRef = useRef(0);
  const pushedLayerIdsRef = useRef<string[]>([]);
  const poppedByHistoryRef = useRef<Set<string>>(new Set());
  const supersededLayerIdsRef = useRef<Set<string>>(new Set());
  const ignorePopToIdxRef = useRef<number | null>(null);
  const ignorePopTimerRef = useRef<number | null>(null);
  const pendingReplaceRef = useRef<{
    targetIdx: number;
    stateWithoutIdx: Omit<AppHistoryState, 'idx'>;
  } | null>(null);
  const pendingPopTimerRef = useRef<number | null>(null);
  const syncScheduledRef = useRef(false);
  const enteredAuthFromOnboardingRef = useRef(false);
  const authTrailDepthRef = useRef(0);
  const resetCompletedInAuthRef = useRef(false);

  const activeScreen = nav.screen;
  const selectedDocId = nav.docId;
  const selectedMaterialId = nav.materialId;
  // The screen "Back" would return to; also decides which tab stays highlighted
  // while a paper or guide is open.
  const parentScreen: AppScreen = nav.stack[nav.stack.length - 1]?.screen ?? 'home';

  const effectiveWorkspace: WorkspaceViewMode =
    authenticatedStudent?.role === 'super_admin'
      ? workspaceMode
      : authenticatedStudent?.role === 'school_admin'
        ? 'school_admin'
        : 'student';

  const isRestrictedAdmin =
    authenticatedStudent?.role === 'school_admin' ||
    (authenticatedStudent?.role === 'super_admin' && effectiveWorkspace === 'school_admin');

  const unreadCount = useMemo(
    () =>
      effectiveWorkspace === 'super_admin'
        ? archiveRepository
            .getSuperAdminGovernanceNotifications()
            .filter((n) => !n.isRead).length
        : archiveRepository
            .getNotificationsForWorkspace(effectiveWorkspace, authenticatedStudent?.id)
            .filter((n) => !n.isRead).length,
    [
      store.notifications,
      store.auditLogs,
      store.userActivities,
      store.supportTickets,
      store.documents,
      store.readSuperAdminNotifIds,
      effectiveWorkspace,
      authenticatedStudent?.id,
    ]
  );

  const openSupportCount = useMemo(
    () => store.supportTickets.filter((t) => t.status === 'new').length,
    [store.supportTickets]
  );

  useEffect(() => {
    subscriptionService.setRoleOverride(authenticatedStudent?.role ?? null);
  }, [authenticatedStudent?.role]);

  // Watch workspace notification feed for new or updated alerts during the active session
  useEffect(() => {
    if (!authenticatedStudent) {
      setActiveDropIn(null);
      return;
    }

    const wsKey = `${effectiveWorkspace}:${authenticatedStudent.id}`;
    let seenMap = seenNotifSignaturesRef.current.get(wsKey);
    const isFirstInit = !seenMap;
    if (!seenMap) {
      seenMap = new Map<string, string>();
      seenNotifSignaturesRef.current.set(wsKey, seenMap);
    }

    const feed =
      effectiveWorkspace === 'super_admin'
        ? archiveRepository.getSuperAdminGovernanceNotifications().map((n) => ({
            id: n.id,
            signature: n.createdAt,
            title: n.title,
            message: n.message,
            category: 'governance' as const,
            createdAt: n.createdAt,
            hasExplicitUpdate: false,
            targetDocId: undefined,
            isGovernance: true,
          }))
        : archiveRepository
            .getNotificationsForWorkspace(effectiveWorkspace, authenticatedStudent.id)
            .map((n) => ({
              id: n.id,
              signature: n.updatedAt ?? n.reviewedAt ?? n.createdAt,
              title: n.title,
              message: n.message,
              category: n.category,
              createdAt: n.createdAt,
              hasExplicitUpdate: Boolean(n.updatedAt && n.updatedAt !== n.createdAt),
              targetDocId: n.targetDocId,
              isGovernance: false,
            }));

    let candidate: DropInNotificationItem | null = null;

    if (isFirstInit) {
      for (const entry of feed) {
        const ts = Date.parse(entry.signature);
        if (!Number.isNaN(ts) && ts >= sessionBootMsRef.current && !candidate) {
          candidate = {
            id: entry.id,
            versionKey: `${entry.id}::${entry.signature}`,
            title: entry.title,
            message: entry.message,
            category: entry.category,
            createdAt: entry.createdAt,
            updated: entry.hasExplicitUpdate,
            targetDocId: entry.targetDocId,
            isGovernance: entry.isGovernance,
          };
        }
        seenMap.set(entry.id, entry.signature);
      }
    } else {
      for (const entry of feed) {
        const prevSig = seenMap.get(entry.id);
        if (prevSig !== entry.signature) {
          if (!candidate) {
            candidate = {
              id: entry.id,
              versionKey: `${entry.id}::${entry.signature}`,
              title: entry.title,
              message: entry.message,
              category: entry.category,
              createdAt: entry.createdAt,
              updated: prevSig !== undefined || entry.hasExplicitUpdate,
              targetDocId: entry.targetDocId,
              isGovernance: entry.isGovernance,
            };
          }
          seenMap.set(entry.id, entry.signature);
        }
      }
    }

    if (candidate) {
      setActiveDropIn(candidate);
    }
  }, [
    authenticatedStudent,
    effectiveWorkspace,
    store.notifications,
    store.auditLogs,
    store.userActivities,
    store.supportTickets,
    store.documents,
  ]);

  const selectedDoc = useMemo(
    () => store.documents.find((d) => d.id === selectedDocId) ?? null,
    [store.documents, selectedDocId]
  );

  const selectedMaterial = useMemo(
    () =>
      store.materials.find(
        (m) => m.id === selectedMaterialId && (m.status ?? 'published') === 'published'
      ) ?? null,
    [store.materials, selectedMaterialId]
  );

  const scrollTop = () => window.scrollTo({ top: 0, behavior: 'instant' });

  const buildStateWithoutIdx = useCallback(
    (layerIds: string[] = pushedLayerIdsRef.current): Omit<AppHistoryState, 'idx'> => {
      const layersPatch = layerIds.length > 0 ? { __pqgLayers: [...layerIds] } : {};
      if (!authRef.current) {
        const out: PreAuthScreen = hasCompletedOnboardingRef.current ? 'auth' : 'onboarding';
        return {
          __pqgOut: out,
          ...(out === 'onboarding'
            ? { __pqgStep: onboardingStepRef.current }
            : { __pqgAuthView: authViewRef.current }),
          ...layersPatch,
        };
      }
      return {
        nav: navRef.current,
        perf: perfRef.current,
        paywall: paywallRef.current,
        ...layersPatch,
      };
    },
    []
  );

  const buildCurrentState = useCallback(
    (idx: number, layerIds: string[] = pushedLayerIdsRef.current): AppHistoryState => ({
      ...buildStateWithoutIdx(layerIds),
      idx,
    }),
    [buildStateWithoutIdx]
  );

  // Every open sheet, dialog box, popover, drawer, filter, or dropdown gets its own
  // real browser history entry so device Back pops one layer at a time smoothly.
  const syncLayers = useCallback(() => {
    const rawLayers = getBackLayers();
    const rawIdSet = new Set(rawLayers.map((l) => l.id));

    poppedByHistoryRef.current.forEach((id) => {
      if (!rawIdSet.has(id)) poppedByHistoryRef.current.delete(id);
    });
    supersededLayerIdsRef.current.forEach((id) => {
      if (!rawIdSet.has(id)) supersededLayerIdsRef.current.delete(id);
    });

    const activeIds = rawLayers
      .map((l) => l.id)
      .filter(
        (id) =>
          !poppedByHistoryRef.current.has(id) &&
          !supersededLayerIdsRef.current.has(id)
      );

    const pushed = pushedLayerIdsRef.current;

    if (
      pushed.length === activeIds.length &&
      pushed.every((id, i) => id === activeIds[i])
    ) {
      return;
    }

    // Pure append: push one browser history entry per newly opened overlay/sheet/dialog
    const isPureAppend =
      activeIds.length > pushed.length &&
      pushed.every((id, i) => id === activeIds[i]);
    if (isPureAppend) {
      const toAdd = activeIds.slice(pushed.length);
      for (const id of toAdd) {
        pushedLayerIdsRef.current = [...pushedLayerIdsRef.current, id];
        historyIdxRef.current += 1;
        window.history.pushState(
          buildCurrentState(historyIdxRef.current, pushedLayerIdsRef.current),
          ''
        );
      }
      return;
    }

    // 1-for-1 swap at the top (e.g. Exam guard <-> Confirm dialog box)
    if (pushed.length > 0 && activeIds.length === pushed.length) {
      let prefix = 0;
      while (prefix < pushed.length && pushed[prefix] === activeIds[prefix]) {
        prefix += 1;
      }
      if (prefix === pushed.length - 1) {
        pushedLayerIdsRef.current = [...activeIds];
        window.history.replaceState(
          buildCurrentState(historyIdxRef.current, pushedLayerIdsRef.current),
          ''
        );
        return;
      }
    }

    // Programmatic close (X button, backdrop tap, Select item chosen, etc.)
    let common = 0;
    while (
      common < pushed.length &&
      common < activeIds.length &&
      pushed[common] === activeIds[common]
    ) {
      common += 1;
    }
    const removedCount = pushed.length - common;
    const addedAfter = activeIds.slice(common);

    if (removedCount > 0 && addedAfter.length === 0) {
      const nextIdx = Math.max(0, historyIdxRef.current - removedCount);
      historyIdxRef.current = nextIdx;
      pushedLayerIdsRef.current = pushed.slice(0, common);
      ignorePopToIdxRef.current = nextIdx;
      if (ignorePopTimerRef.current !== null) window.clearTimeout(ignorePopTimerRef.current);
      ignorePopTimerRef.current = window.setTimeout(() => {
        ignorePopToIdxRef.current = null;
        ignorePopTimerRef.current = null;
      }, 400);
      if (removedCount === 1) {
        window.history.back();
      } else {
        window.history.go(-removedCount);
      }
      return;
    }

    if (removedCount > 0 && addedAfter.length > 0) {
      const deltaBack = removedCount - 1;
      const targetIdx = Math.max(0, historyIdxRef.current - deltaBack);
      const nextLayers = [...pushed.slice(0, common), addedAfter[0]];
      historyIdxRef.current = targetIdx;
      pushedLayerIdsRef.current = nextLayers;
      if (deltaBack === 0) {
        window.history.replaceState(buildCurrentState(targetIdx, nextLayers), '');
      } else {
        pendingReplaceRef.current = {
          targetIdx,
          stateWithoutIdx: buildStateWithoutIdx(nextLayers),
        };
        if (pendingPopTimerRef.current !== null) window.clearTimeout(pendingPopTimerRef.current);
        pendingPopTimerRef.current = window.setTimeout(() => {
          pendingReplaceRef.current = null;
          pendingPopTimerRef.current = null;
        }, 400);
        window.history.go(-deltaBack);
      }
    }
  }, [buildCurrentState, buildStateWithoutIdx]);

  useEffect(() => {
    const scheduleSync = () => {
      if (syncScheduledRef.current) return;
      syncScheduledRef.current = true;
      queueMicrotask(() => {
        syncScheduledRef.current = false;
        syncLayers();
      });
    };
    scheduleSync();
    return subscribeBackHandlers(scheduleSync);
  }, [syncLayers]);

  const pushHistory = useCallback(
    (stateWithoutIdx: Omit<AppHistoryState, 'idx'>, replace = false) => {
      const pushed = pushedLayerIdsRef.current;
      const k = pushed.length;
      pushed.forEach((id) => supersededLayerIdsRef.current.add(id));
      pushedLayerIdsRef.current = [];

      if (replace) {
        if (k === 0) {
          window.history.replaceState(
            { ...stateWithoutIdx, idx: historyIdxRef.current } satisfies AppHistoryState,
            ''
          );
          return;
        }
        const targetIdx = Math.max(0, historyIdxRef.current - k);
        historyIdxRef.current = targetIdx;
        pendingReplaceRef.current = { targetIdx, stateWithoutIdx };
        if (pendingPopTimerRef.current !== null) window.clearTimeout(pendingPopTimerRef.current);
        pendingPopTimerRef.current = window.setTimeout(() => {
          pendingReplaceRef.current = null;
          pendingPopTimerRef.current = null;
        }, 400);
        if (k === 1) {
          window.history.back();
        } else {
          window.history.go(-k);
        }
        return;
      }

      if (k === 0) {
        historyIdxRef.current += 1;
        window.history.pushState(
          { ...stateWithoutIdx, idx: historyIdxRef.current } satisfies AppHistoryState,
          ''
        );
        return;
      }

      if (k === 1) {
        // Reuse the single open overlay's slot synchronously so Back returns straight to the page behind it.
        window.history.replaceState(
          { ...stateWithoutIdx, idx: historyIdxRef.current } satisfies AppHistoryState,
          ''
        );
        return;
      }

      const targetIdx = Math.max(1, historyIdxRef.current - k + 1);
      historyIdxRef.current = targetIdx;
      pendingReplaceRef.current = { targetIdx, stateWithoutIdx };
      if (pendingPopTimerRef.current !== null) window.clearTimeout(pendingPopTimerRef.current);
      pendingPopTimerRef.current = window.setTimeout(() => {
        pendingReplaceRef.current = null;
        pendingPopTimerRef.current = null;
      }, 400);
      window.history.go(-(k - 1));
    },
    []
  );

  // Every move to a new screen or Performance sub-view adds a browser-history entry,
  // so the phone's Back button / gesture walks back through the same views.
  const go = useCallback(
    (
      nextNav: NavState,
      nextPerf: PerfNavState = INITIAL_PERF,
      scroll = true,
      nextPaywall: PaywallContext | null = null
    ) => {
      const safeNav: NavState = {
        ...nextNav,
        screen: resolveSafeScreen(authRef.current, nextNav.screen, workspaceModeRef.current),
      };
      navRef.current = safeNav;
      perfRef.current = nextPerf;
      paywallRef.current = nextPaywall;
      setNav(safeNav);
      setPerf(nextPerf);
      setPaywallContext(nextPaywall);
      pushHistory({
        nav: safeNav,
        perf: nextPerf,
        paywall: nextPaywall,
      });
      if (scroll) scrollTop();
    },
    [pushHistory]
  );

  const resetSessionLocalState = useCallback(
    (targetPortal: AuthPortal, notice: AuthNotice | null = null) => {
      subscriptionService.setRoleOverride(null);
      setAuthenticatedStudent(null);
      setSuperAdminSection('overview');
      setSchoolAdminSection('overview');
      setSettingsTarget('normal_website');
      setSuperAdminPreviewSchoolId('sch-aaua');
      workspaceModeRef.current = 'student';
      setWorkspaceMode('student');
      navRef.current = INITIAL_NAV;
      perfRef.current = INITIAL_PERF;
      paywallRef.current = null;
      setNav(INITIAL_NAV);
      setPerf(INITIAL_PERF);
      setPaywallContext(null);
      setActiveDropIn(null);
      seenNotifSignaturesRef.current.clear();
      setAuthNotice(notice);

      const nextHash = getPortalPath(targetPortal);
      if (window.location.hash !== nextHash) {
        window.history.replaceState(null, '', nextHash);
      }
      setPortal(targetPortal);
    },
    []
  );

  // Sync separated sign-in portal on URL hash/path change, enforce portal isolation, & record visitor telemetry
  useEffect(() => {
    let visitorId = localStore.getItem('pqguide_visitor_id_v1');
    if (!visitorId) {
      visitorId = `vis-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      localStore.setItem('pqguide_visitor_id_v1', visitorId);
    }
    archiveRepository.recordSiteVisit(visitorId);

    const syncPortal = () => {
      const nextPortal = detectAuthPortal();
      const activeUser = authRef.current;

      if (activeUser && !isPortalCompatibleWithRole(nextPortal, activeUser.role)) {
        const expectedPortal = getPortalForRole(activeUser.role);
        const expectedHash = getPortalPath(expectedPortal);
        if (window.location.hash !== expectedHash) {
          window.history.replaceState(window.history.state, '', expectedHash);
        }
        setPortal(expectedPortal);
        if (nextPortal !== 'student') {
          setActiveDropIn({
            id: `portal-block-${Date.now()}`,
            versionKey: `portal-block-${Date.now()}`,
            title: 'Portal Access Restricted',
            message: 'Your active account cannot open a different role sign-in portal.',
            category: 'access',
            createdAt: new Date().toISOString(),
          });
        }
        return;
      }

      setPortal((prev) => {
        if (prev !== nextPortal && !activeUser) {
          authViewRef.current = 'signin';
          setAuthView('signin');
          setAuthNotice(null);
        }
        return nextPortal;
      });
    };

    syncPortal();
    authService.syncVerifiedAccountsToRepository();
    window.addEventListener('hashchange', syncPortal);
    window.addEventListener('popstate', syncPortal);
    return () => {
      window.removeEventListener('hashchange', syncPortal);
      window.removeEventListener('popstate', syncPortal);
    };
  }, []);

  // Watch 12-hour session expiration, cross-tab sign-out, & account status revocation
  useEffect(() => {
    if (!authenticatedStudent) return;

    const handleSessionInvalidated = (reason: 'expired' | 'external') => {
      const current = authRef.current;
      const targetPortal = current ? getPortalForRole(current.role) : detectAuthPortal();
      if (reason === 'expired') {
        authService.clearActiveSession(current, 'expired');
        authService.consumeExpiredSessionNotice();
        resetSessionLocalState(targetPortal, {
          tone: 'warning',
          message: 'Your 12-hour session has expired. Please sign in again to continue.',
        });
      } else {
        authService.clearActiveSession(null, 'manual');
        resetSessionLocalState(targetPortal, {
          tone: 'info',
          message: 'You were signed out of your session.',
        });
      }
    };

    const verifySession = () => {
      const current = authService.getActiveSession();
      if (!current) {
        const expired = authService.consumeExpiredSessionNotice();
        handleSessionInvalidated(expired ? 'expired' : 'external');
        return;
      }
      if (current.role === 'super_admin') {
        void authService.verifyServerSuperAdminSession().then((res) => {
          if (!res.verified && authRef.current?.id === current.id) {
            authService.clearActiveSession(authRef.current, 'revoked');
            resetSessionLocalState('super_admin', {
              tone: 'warning',
              message: 'Super Admin session could not be verified. Please sign in again.',
            });
          }
        });
      }
    };

    if (authenticatedStudent.role === 'super_admin') {
      verifySession();
    }

    const remainingMs = authService.getSessionRemainingMs();
    if (remainingMs === null || remainingMs <= 0) {
      verifySession();
      return;
    }

    // Cap single setTimeout delay safely under 32-bit signed int limit (12h = 43.2M ms, well within 2.14B ms)
    const expiryTimer = window.setTimeout(verifySession, remainingMs + 250);
    const intervalId = window.setInterval(verifySession, 60_000);

    const onVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        verifySession();
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === SESSION_KEY || event.key === null) {
        verifySession();
      }
    };

    window.addEventListener('focus', onVisibilityOrFocus);
    document.addEventListener('visibilitychange', onVisibilityOrFocus);
    window.addEventListener('storage', onStorage);

    return () => {
      window.clearTimeout(expiryTimer);
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onVisibilityOrFocus);
      document.removeEventListener('visibilitychange', onVisibilityOrFocus);
      window.removeEventListener('storage', onStorage);
    };
  }, [authenticatedStudent, resetSessionLocalState]);

  useEffect(() => {
    getBackLayers().forEach((l) => supersededLayerIdsRef.current.add(l.id));
    pushedLayerIdsRef.current = [];
    poppedByHistoryRef.current.clear();
    ignorePopToIdxRef.current = null;
    pendingReplaceRef.current = null;

    if (authenticatedStudent) {
      const nextWorkspace: WorkspaceViewMode = authenticatedStudent.role;
      workspaceModeRef.current = nextWorkspace;
      setWorkspaceMode(nextWorkspace);

      const existing = window.history.state as AppHistoryState | null;
      const hasValidSignedInRoot =
        existing &&
        !existing.__pqgOut &&
        !(existing.__pqgLayers && existing.__pqgLayers.length > 0) &&
        typeof existing.idx === 'number';
      historyIdxRef.current = hasValidSignedInRoot ? existing.idx : 0;

      const landingNav: NavState = {
        ...INITIAL_NAV,
        screen: getInitialScreenForUser(authenticatedStudent, nextWorkspace),
      };

      navRef.current = landingNav;
      perfRef.current = INITIAL_PERF;
      paywallRef.current = null;
      setNav(landingNav);
      setPerf(INITIAL_PERF);
      setPaywallContext(null);
      window.history.replaceState(
        {
          nav: landingNav,
          perf: INITIAL_PERF,
          paywall: null,
          idx: historyIdxRef.current,
        } satisfies AppHistoryState,
        ''
      );
    } else {
      historyIdxRef.current = 0;
      enteredAuthFromOnboardingRef.current = false;
      authTrailDepthRef.current = 0;
      resetCompletedInAuthRef.current = false;
      const initialStep = 0;
      const initialView: AuthView = 'signin';
      onboardingStepRef.current = initialStep;
      authViewRef.current = initialView;
      setOnboardingStep(initialStep);
      setAuthView(initialView);
      window.history.replaceState(
        hasCompletedOnboarding
          ? ({
              __pqgOut: 'auth',
              __pqgAuthView: initialView,
              idx: 0,
            } satisfies AppHistoryState)
          : ({
              __pqgOut: 'onboarding',
              __pqgStep: initialStep,
              idx: 0,
            } satisfies AppHistoryState),
        ''
      );
    }
    // Reset baseline history state cleanly at sign-in / sign-out transitions
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticatedStudent]);

  useEffect(() => {
    return () => {
      if (ignorePopTimerRef.current !== null) window.clearTimeout(ignorePopTimerRef.current);
      if (pendingPopTimerRef.current !== null) window.clearTimeout(pendingPopTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const st = event.state as AppHistoryState | null;
      const idx = typeof st?.idx === 'number' ? st.idx : 0;

      if (pendingReplaceRef.current) {
        if (idx <= pendingReplaceRef.current.targetIdx) {
          const pending = pendingReplaceRef.current;
          pendingReplaceRef.current = null;
          if (pendingPopTimerRef.current !== null) {
            window.clearTimeout(pendingPopTimerRef.current);
            pendingPopTimerRef.current = null;
          }
          historyIdxRef.current = idx;
          window.history.replaceState(
            { ...pending.stateWithoutIdx, idx } satisfies AppHistoryState,
            ''
          );
        }
        return;
      }

      if (ignorePopToIdxRef.current !== null) {
        if (idx <= ignorePopToIdxRef.current) {
          ignorePopToIdxRef.current = null;
          if (ignorePopTimerRef.current !== null) {
            window.clearTimeout(ignorePopTimerRef.current);
            ignorePopTimerRef.current = null;
          }
          historyIdxRef.current = idx;
          if (!authRef.current && st?.nav) {
            historyIdxRef.current = 0;
            window.history.replaceState(buildCurrentState(0, []), '');
          }
        }
        return;
      }

      const targetLayers = st?.__pqgLayers ?? [];
      const currentPushed = pushedLayerIdsRef.current;
      const layersPopped = currentPushed.filter((id) => !targetLayers.includes(id));

      historyIdxRef.current = idx;
      if (layersPopped.length > 0) {
        pushedLayerIdsRef.current = currentPushed.filter((id) => targetLayers.includes(id));
        for (let i = layersPopped.length - 1; i >= 0; i--) {
          const id = layersPopped[i];
          poppedByHistoryRef.current.add(id);
          closeBackLayer(id);
        }
      } else {
        pushedLayerIdsRef.current = [...targetLayers];
      }

      if (!authRef.current) {
        if (st?.__pqgOut === 'onboarding') {
          const nextStep = typeof st.__pqgStep === 'number' ? st.__pqgStep : 0;
          const screenChanged =
            hasCompletedOnboardingRef.current || onboardingStepRef.current !== nextStep;
          authService.setOnboardingCompleted(false);
          hasCompletedOnboardingRef.current = false;
          onboardingStepRef.current = nextStep;
          authTrailDepthRef.current = 0;
          setHasCompletedOnboarding(false);
          setOnboardingStep(nextStep);
          if (screenChanged && layersPopped.length === 0) scrollTop();
        } else if (st?.__pqgOut === 'auth') {
          const nextView = st.__pqgAuthView ?? 'signin';
          const screenChanged =
            !hasCompletedOnboardingRef.current || authViewRef.current !== nextView;
          authService.setOnboardingCompleted(true);
          hasCompletedOnboardingRef.current = true;
          authViewRef.current = nextView;
          if (nextView === 'signin') {
            authTrailDepthRef.current = 0;
          } else {
            authTrailDepthRef.current = Math.max(1, authTrailDepthRef.current);
          }
          setHasCompletedOnboarding(true);
          setAuthView(nextView);
          if (screenChanged && layersPopped.length === 0) scrollTop();
        } else if (st?.nav) {
          historyIdxRef.current = 0;
          pushedLayerIdsRef.current = [];
          window.history.replaceState(buildCurrentState(0, []), '');
        }
        return;
      }

      if (st?.__pqgOut) {
        const landingNav: NavState = {
          ...INITIAL_NAV,
          screen: getInitialScreenForUser(authRef.current),
        };
        historyIdxRef.current = 0;
        pushedLayerIdsRef.current = [];
        navRef.current = landingNav;
        perfRef.current = INITIAL_PERF;
        paywallRef.current = null;
        setNav(landingNav);
        setPerf(INITIAL_PERF);
        setPaywallContext(null);
        window.history.replaceState(
          {
            nav: landingNav,
            perf: INITIAL_PERF,
            paywall: null,
            idx: 0,
          } satisfies AppHistoryState,
          ''
        );
        scrollTop();
        return;
      }

      const rawNav = st?.nav ?? INITIAL_NAV;
      const nextNav: NavState = {
        ...rawNav,
        screen: resolveSafeScreen(authRef.current, rawNav.screen, workspaceModeRef.current),
      };
      const nextPerf = st?.perf ?? INITIAL_PERF;
      const nextPaywall = st?.paywall ?? null;
      const navOrPerfChanged =
        navRef.current.screen !== nextNav.screen ||
        navRef.current.docId !== nextNav.docId ||
        navRef.current.materialId !== nextNav.materialId ||
        perfRef.current.view !== nextPerf.view ||
        perfRef.current.selectedId !== nextPerf.selectedId;

      navRef.current = nextNav;
      perfRef.current = nextPerf;
      paywallRef.current = nextPaywall;
      setNav(nextNav);
      setPerf(nextPerf);
      setPaywallContext(nextPaywall);
      if (navOrPerfChanged && layersPopped.length === 0) {
        scrollTop();
      }
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [buildCurrentState]);

  const openPaywallDirect = useCallback(
    (context?: PaywallContext) => {
      if (authRef.current?.role === 'school_admin') return;
      const prev = navRef.current;
      const nextStack =
        prev.screen === 'subscription' ? prev.stack : [...prev.stack, entryOf(prev)];
      go(
        {
          ...prev,
          screen: 'subscription',
          stack: nextStack,
        },
        perfRef.current,
        true,
        context ?? null
      );
    },
    [go]
  );

  const openPaywall = useCallback(
    (context?: PaywallContext) => {
      runNavigationGuard(() => openPaywallDirect(context));
    },
    [openPaywallDirect]
  );

  // Single paywall gate used when FREE_TIER_ENABLED is set to false.
  const ensureStandardAccess = useCallback(
    (reason?: string) => {
      if (authRef.current?.role === 'school_admin' || authRef.current?.role === 'super_admin') {
        return true;
      }
      if (subscriptionService.hasStandardAccess()) return true;
      openPaywallDirect({
        highlightTier: 'standard',
        blockedByPaywall: true,
        reason: reason ?? 'Free access has ended. Choose Standard or AI Scholar to continue.',
      });
      return false;
    },
    [openPaywallDirect]
  );

  // Tabs reset the trail. Alerts (opened from the bell) and Practice Exam remember where you were.
  const navigateDirect = useCallback(
    (screen: AppScreen) => {
      const safeScreen = resolveSafeScreen(authRef.current, screen, workspaceModeRef.current);
      if (safeScreen === 'subscription') {
        openPaywallDirect();
        return;
      }
      if (!ensureStandardAccess()) return;

      const prev = navRef.current;
      if (prev.screen === safeScreen) {
        if (safeScreen === 'performance' && perfRef.current.view !== 'list') {
          go(prev, INITIAL_PERF);
          return;
        }
        return;
      }
      const remember = safeScreen === 'notifications' || safeScreen === 'mock_exam';
      go(
        {
          ...prev,
          screen: safeScreen,
          stack: remember ? [...prev.stack, entryOf(prev)] : [],
        },
        INITIAL_PERF
      );
    },
    [ensureStandardAccess, go, openPaywallDirect]
  );

  const handleNavigate = useCallback(
    (screen: AppScreen) => {
      const prev = navRef.current;
      if (prev.screen === screen && (screen !== 'performance' || perfRef.current.view === 'list')) {
        navigateDirect(screen);
        return;
      }
      runNavigationGuard(() => navigateDirect(screen));
    },
    [navigateDirect]
  );

  // Back goes to exactly where the person came from (home if there is no trail).
  const handleBack = useCallback(() => {
    const pushed = pushedLayerIdsRef.current;
    const k = pushed.length;
    const baseIdx = Math.max(0, historyIdxRef.current - k);
    pushed.forEach((id) => supersededLayerIdsRef.current.add(id));
    pushedLayerIdsRef.current = [];

    if (baseIdx > 0) {
      const steps = k + 1;
      if (steps === 1) {
        window.history.back();
      } else {
        window.history.go(-steps);
      }
      return;
    }

    const prev = navRef.current;
    const last = prev.stack[prev.stack.length - 1];
    const next: NavState = last
      ? { ...last, stack: prev.stack.slice(0, -1) }
      : { ...INITIAL_NAV, docId: prev.docId, materialId: prev.materialId };
    navRef.current = next;
    perfRef.current = INITIAL_PERF;
    paywallRef.current = null;
    setNav(next);
    setPerf(INITIAL_PERF);
    setPaywallContext(null);

    if (k > 0) {
      historyIdxRef.current = 0;
      pendingReplaceRef.current = {
        targetIdx: 0,
        stateWithoutIdx: {
          nav: next,
          perf: INITIAL_PERF,
          paywall: null,
        },
      };
      if (pendingPopTimerRef.current !== null) window.clearTimeout(pendingPopTimerRef.current);
      pendingPopTimerRef.current = window.setTimeout(() => {
        pendingReplaceRef.current = null;
        pendingPopTimerRef.current = null;
      }, 400);
      if (k === 1) {
        window.history.back();
      } else {
        window.history.go(-k);
      }
    }
    scrollTop();
  }, []);

  const handleOpenDocument = useCallback(
    (doc: PastQuestionDoc) => {
      runNavigationGuard(() => {
        if (!ensureStandardAccess('Subscribe to open verified past questions and worked answers.')) {
          return;
        }
        archiveRepository.incrementView(doc.id);
        archiveRepository.recordRecent(doc.id);
        const actor = authRef.current;
        if (actor) {
          archiveRepository.recordUserActivity({
            userId: actor.id,
            userName: actor.fullName,
            userEmail: actor.email,
            userRole: actor.role,
            matricNumber: actor.matricNumber,
            level: actor.level,
            type: 'doc_opened',
            detail: `Opened past question ${doc.courseCode} (${doc.session})`,
          });
        }
        const prev = navRef.current;
        go({
          screen: 'reader',
          docId: doc.id,
          materialId: prev.materialId,
          stack: [...prev.stack, entryOf(prev)],
        });
      });
    },
    [ensureStandardAccess, go]
  );

  const handleOpenMaterial = useCallback(
    (material: StudyMaterial) => {
      runNavigationGuard(() => {
        if (!ensureStandardAccess('Subscribe to open course study guides.')) {
          return;
        }
        const actor = authRef.current;
        if (actor) {
          archiveRepository.recordUserActivity({
            userId: actor.id,
            userName: actor.fullName,
            userEmail: actor.email,
            userRole: actor.role,
            matricNumber: actor.matricNumber,
            level: actor.level,
            type: 'material_opened',
            detail: `Opened study guide ${material.courseCode} — ${material.title}`,
          });
        }
        const prev = navRef.current;
        go({
          screen: 'material_reader',
          docId: prev.docId,
          materialId: material.id,
          stack: [...prev.stack, entryOf(prev)],
        });
      });
    },
    [ensureStandardAccess, go]
  );

  const handleQuickFind = useCallback(() => {
    const prev = navRef.current;
    if (prev.screen === 'home') {
      if (!ensureStandardAccess()) return;
      setFocusSearchSignal((n) => n + 1);
      return;
    }
    runNavigationGuard(() => {
      if (!ensureStandardAccess()) return;
      const latest = navRef.current;
      if (latest.screen !== 'home') {
        go({ ...latest, screen: 'home', stack: [] }, INITIAL_PERF, false);
      }
      setFocusSearchSignal((n) => n + 1);
    });
  }, [ensureStandardAccess, go]);

  const handleExamSubmitted = useCallback(() => {
    const actor = authRef.current;
    if (actor) {
      archiveRepository.recordUserActivity({
        userId: actor.id,
        userName: actor.fullName,
        userEmail: actor.email,
        userRole: actor.role,
        matricNumber: actor.matricNumber,
        level: actor.level,
        type: 'exam_completed',
        detail: 'Completed timed CBT / theory practice exam',
      });
    }
    // Replace the mock_exam entry (and any open exam/confirm layer) so pressing Back
    // from Performance returns to where the exam was opened from, never back into it.
    const nextNav: NavState = { ...navRef.current, screen: 'performance', stack: [] };
    navRef.current = nextNav;
    perfRef.current = INITIAL_PERF;
    setNav(nextNav);
    setPerf(INITIAL_PERF);
    pushHistory(
      {
        nav: nextNav,
        perf: INITIAL_PERF,
      },
      true
    );
    scrollTop();
  }, [pushHistory]);

  const handlePerfOpenDetail = useCallback(
    (id: string) => {
      go(navRef.current, { view: 'detail', selectedId: id });
    },
    [go]
  );

  const handlePerfOpenOverall = useCallback(() => {
    go(navRef.current, { view: 'overall', selectedId: perfRef.current.selectedId });
  }, [go]);

  const handlePerfBackView = useCallback(() => {
    const pushed = pushedLayerIdsRef.current;
    const k = pushed.length;
    const baseIdx = Math.max(0, historyIdxRef.current - k);
    pushed.forEach((id) => supersededLayerIdsRef.current.add(id));
    pushedLayerIdsRef.current = [];

    if (baseIdx > 0) {
      const steps = k + 1;
      if (steps === 1) {
        window.history.back();
      } else {
        window.history.go(-steps);
      }
      return;
    }

    perfRef.current = INITIAL_PERF;
    setPerf(INITIAL_PERF);
    scrollTop();
  }, []);

  const handlePerfViewList = useCallback(() => {
    if (perfRef.current.view === 'list') return;
    go(navRef.current, INITIAL_PERF);
  }, [go]);

  const handleOnboardingStepChange = useCallback(
    (nextStep: number) => {
      if (nextStep === onboardingStepRef.current) return;
      onboardingStepRef.current = nextStep;
      setOnboardingStep(nextStep);
      pushHistory({ __pqgOut: 'onboarding', __pqgStep: nextStep });
      scrollTop();
    },
    [pushHistory]
  );

  const handleOnboardingBackStep = useCallback(() => {
    const pushed = pushedLayerIdsRef.current;
    const k = pushed.length;
    const baseIdx = Math.max(0, historyIdxRef.current - k);
    if (baseIdx > 0) {
      pushed.forEach((id) => supersededLayerIdsRef.current.add(id));
      pushedLayerIdsRef.current = [];
      const steps = k + 1;
      if (steps === 1) window.history.back();
      else window.history.go(-steps);
      return;
    }
    const nextStep = Math.max(0, onboardingStepRef.current - 1);
    onboardingStepRef.current = nextStep;
    setOnboardingStep(nextStep);
    pushHistory({ __pqgOut: 'onboarding', __pqgStep: nextStep }, true);
    scrollTop();
  }, [pushHistory]);

  const handleOnboardingComplete = useCallback(() => {
    authService.setOnboardingCompleted(true);
    hasCompletedOnboardingRef.current = true;
    enteredAuthFromOnboardingRef.current = true;
    authTrailDepthRef.current = 0;
    resetCompletedInAuthRef.current = false;
    authViewRef.current = 'signin';
    setHasCompletedOnboarding(true);
    setAuthView('signin');
    pushHistory({ __pqgOut: 'auth', __pqgAuthView: 'signin' });
    scrollTop();
  }, [pushHistory]);

  const handleAuthViewChange = useCallback(
    (next: AuthView, options?: { replace?: boolean }) => {
      if (next === authViewRef.current) return;
      const replace = Boolean(options?.replace);
      if (replace && next === 'signin') {
        authTrailDepthRef.current = 0;
        resetCompletedInAuthRef.current = true;
      } else if (!replace) {
        authTrailDepthRef.current += 1;
      }
      authViewRef.current = next;
      setAuthView(next);
      pushHistory({ __pqgOut: 'auth', __pqgAuthView: next }, replace);
      scrollTop();
    },
    [pushHistory]
  );

  const handleAuthBack = useCallback(
    (fallbackView: AuthView) => {
      const pushed = pushedLayerIdsRef.current;
      const k = pushed.length;
      const baseIdx = Math.max(0, historyIdxRef.current - k);
      if (authTrailDepthRef.current > 0 && baseIdx > 0) {
        authTrailDepthRef.current -= 1;
        pushed.forEach((id) => supersededLayerIdsRef.current.add(id));
        pushedLayerIdsRef.current = [];
        const steps = k + 1;
        if (steps === 1) window.history.back();
        else window.history.go(-steps);
        return;
      }
      authTrailDepthRef.current = 0;
      authViewRef.current = fallbackView;
      setAuthView(fallbackView);
      pushHistory({ __pqgOut: 'auth', __pqgAuthView: fallbackView }, true);
      scrollTop();
    },
    [pushHistory]
  );

  const handleBackToOnboarding = useCallback(() => {
    const pushed = pushedLayerIdsRef.current;
    const k = pushed.length;
    const baseIdx = Math.max(0, historyIdxRef.current - k);
    if (
      enteredAuthFromOnboardingRef.current &&
      authTrailDepthRef.current === 0 &&
      !resetCompletedInAuthRef.current &&
      baseIdx > 0
    ) {
      pushed.forEach((id) => supersededLayerIdsRef.current.add(id));
      pushedLayerIdsRef.current = [];
      const steps = k + 1;
      if (steps === 1) window.history.back();
      else window.history.go(-steps);
      return;
    }
    authService.setOnboardingCompleted(false);
    hasCompletedOnboardingRef.current = false;
    onboardingStepRef.current = 2;
    authTrailDepthRef.current = 0;
    setHasCompletedOnboarding(false);
    setOnboardingStep(2);
    pushHistory({ __pqgOut: 'onboarding', __pqgStep: 2 });
    scrollTop();
  }, [pushHistory]);

  const handleSwitchWorkspace = useCallback(
    (nextMode: WorkspaceViewMode) => {
      const actor = authRef.current;
      if (!actor || actor.role !== 'super_admin') return;
      runNavigationGuard(() => {
        workspaceModeRef.current = nextMode;
        setWorkspaceMode(nextMode);
        if (nextMode === 'school_admin') {
          setSchoolAdminSection('overview');
        }
        const targetScreen = getDefaultScreenForRole('super_admin', nextMode);
        go(
          {
            screen: targetScreen,
            docId: null,
            materialId: null,
            stack: [],
          },
          INITIAL_PERF
        );
      });
    },
    [go]
  );

  const handleSelectSuperAdminSection = useCallback(
    (section: SuperAdminSectionId) => {
      const actor = authRef.current;
      if (!actor || actor.role !== 'super_admin') return;
      runNavigationGuard(() => {
        setSuperAdminSection(section);
        workspaceModeRef.current = 'super_admin';
        setWorkspaceMode('super_admin');
        if (navRef.current.screen !== 'super_admin') {
          go(
            {
              screen: 'super_admin',
              docId: null,
              materialId: null,
              stack: [],
            },
            INITIAL_PERF
          );
        }
      });
    },
    [go]
  );

  const handleSelectSchoolAdminSection = useCallback(
    (section: SchoolAdminSectionId) => {
      const actor = authRef.current;
      if (!actor || (actor.role !== 'school_admin' && actor.role !== 'super_admin')) return;
      runNavigationGuard(() => {
        setSchoolAdminSection(section);
        if (actor.role === 'super_admin') {
          workspaceModeRef.current = 'school_admin';
          setWorkspaceMode('school_admin');
        }
        if (navRef.current.screen !== 'school_admin') {
          go(
            {
              screen: 'school_admin',
              docId: null,
              materialId: null,
              stack: [],
            },
            INITIAL_PERF
          );
        }
      });
    },
    [go]
  );

  const handleSelectSettingsTarget = useCallback(
    (target: SettingsUiTarget) => {
      const actor = authRef.current;
      if (!actor || actor.role !== 'super_admin') return;
      runNavigationGuard(() => {
        setSettingsTarget(target);
        setSuperAdminSection('settings');
        workspaceModeRef.current = 'super_admin';
        setWorkspaceMode('super_admin');
        if (navRef.current.screen !== 'super_admin') {
          go(
            {
              screen: 'super_admin',
              docId: null,
              materialId: null,
              stack: [],
            },
            INITIAL_PERF
          );
        }
      });
    },
    [go]
  );

  const handleSignOut = useCallback(() => {
    runNavigationGuard(() => {
      const current = authRef.current;
      const currentPortal: AuthPortal = current ? getPortalForRole(current.role) : 'student';

      authService.clearActiveSession(current, 'manual');
      resetSessionLocalState(currentPortal, null);
    });
  }, [resetSessionLocalState]);

  const handleDismissDropIn = useCallback(() => {
    setActiveDropIn(null);
  }, []);

  const handleViewDropIn = useCallback(
    (item: DropInNotificationItem) => {
      if (item.isGovernance) {
        archiveRepository.markSuperAdminNotificationRead(item.id);
      } else {
        archiveRepository.markNotificationRead(item.id);
      }
      setActiveDropIn(null);

      if (!item.isGovernance && !isRestrictedAdmin && item.targetDocId) {
        const doc = store.documents.find((d) => d.id === item.targetDocId);
        if (doc) {
          handleOpenDocument(doc);
          return;
        }
      }
      handleNavigate('notifications');
    },
    [handleNavigate, handleOpenDocument, isRestrictedAdmin, store.documents]
  );

  if (!hasCompletedOnboarding && portal === 'student' && !authenticatedStudent) {
    return (
      <Suspense fallback={<div className="min-h-screen bg-[#F6F7F9]" />}>
        <OnboardingScreen
          step={onboardingStep}
          onStepChange={handleOnboardingStepChange}
          onBackStep={handleOnboardingBackStep}
          onComplete={handleOnboardingComplete}
        />
      </Suspense>
    );
  }

  if (!authenticatedStudent) {
    return (
      <Suspense fallback={<div className="min-h-screen bg-[#F6F7F9]" />}>
        <AuthScreen
          portal={portal}
          view={authView}
          sessionNotice={authNotice}
          onDismissSessionNotice={() => setAuthNotice(null)}
          onViewChange={handleAuthViewChange}
          onAuthBack={handleAuthBack}
          onAuthenticated={(account, rememberMe = true) => {
            setAuthNotice(null);
            authService.saveActiveSession(account, rememberMe);
            setAuthenticatedStudent(account);
          }}
          onBackToOnboarding={portal === 'student' ? handleBackToOnboarding : undefined}
        />
      </Suspense>
    );
  }

  if (activeScreen === 'subscription' && authenticatedStudent.role !== 'school_admin') {
    return (
      <>
        <TopDropInNotification
          item={activeDropIn}
          onView={handleViewDropIn}
          onDismiss={handleDismissDropIn}
        />
        <Suspense fallback={<div className="min-h-screen bg-[#F6F7F9]" />}>
          <SubscriptionScreen
            currentUser={authenticatedStudent}
            paywallContext={paywallContext}
            onBack={handleBack}
            onClose={handleBack}
          />
        </Suspense>
      </>
    );
  }

  return (
    <>
      <TopDropInNotification
        item={activeDropIn}
        onView={handleViewDropIn}
        onDismiss={handleDismissDropIn}
      />
      <NavigationShell
      activeScreen={activeScreen}
      parentScreen={parentScreen}
      workspaceMode={effectiveWorkspace}
      onWorkspaceModeChange={
        authenticatedStudent.role === 'super_admin' ? handleSwitchWorkspace : undefined
      }
      activeAdminSection={superAdminSection}
      onSelectAdminSection={
        authenticatedStudent.role === 'super_admin'
          ? handleSelectSuperAdminSection
          : undefined
      }
      activeSchoolAdminSection={schoolAdminSection}
      onSelectSchoolAdminSection={
        authenticatedStudent.role === 'school_admin' ||
        authenticatedStudent.role === 'super_admin'
          ? handleSelectSchoolAdminSection
          : undefined
      }
      settingsTarget={settingsTarget}
      onSelectSettingsTarget={
        authenticatedStudent.role === 'super_admin'
          ? handleSelectSettingsTarget
          : undefined
      }
      openSupportCount={openSupportCount}
      marquee={store.marquee}
      onNavigate={handleNavigate}
      onOpenPaywall={openPaywall}
      onQuickFind={handleQuickFind}
      unreadCount={unreadCount}
      student={authenticatedStudent}
      onSignOut={handleSignOut}
    >
      <Suspense fallback={<HomeScreenSkeleton />}>
        {activeScreen === 'home' && (
          <HomeScreen
            onOpenDocument={handleOpenDocument}
            focusSearchSignal={focusSearchSignal}
            onOpenPaywall={openPaywall}
          />
        )}

        {activeScreen === 'reader' && (
          <PastQuestionReaderScreen
            doc={selectedDoc}
            onBack={handleBack}
            onOpenPaywall={openPaywall}
          />
        )}

        {activeScreen === 'past_questions' && (
          <PastQuestionsScreen onOpenDocument={handleOpenDocument} />
        )}

        {activeScreen === 'notifications' && (
          <NotificationsScreen
            workspaceMode={effectiveWorkspace}
            userId={authenticatedStudent.id}
            restrictedAdminView={isRestrictedAdmin}
            onBack={handleBack}
            onOpenDocument={handleOpenDocument}
          />
        )}

        {activeScreen === 'materials' && (
          <MaterialsScreen onOpenMaterial={handleOpenMaterial} />
        )}

        {activeScreen === 'material_reader' && (
          <MaterialReaderScreen
            material={selectedMaterial}
            onBack={handleBack}
            onOpenPaywall={openPaywall}
          />
        )}

        {activeScreen === 'mock_exam' && (
          <MockExamScreen
            currentUser={authenticatedStudent}
            onBack={handleBack}
            onSubmitted={handleExamSubmitted}
            onOpenPaywall={openPaywall}
          />
        )}

        {activeScreen === 'performance' && (
          <PerformanceScreen
            onStartExam={() => handleNavigate('mock_exam')}
            view={perf.view}
            selectedId={perf.selectedId}
            onOpenDetail={handlePerfOpenDetail}
            onOpenOverall={handlePerfOpenOverall}
            onBackView={handlePerfBackView}
            onViewList={handlePerfViewList}
          />
        )}

        {(activeScreen === 'about' ||
          activeScreen === 'services' ||
          activeScreen === 'help' ||
          activeScreen === 'support') && (
          <InfoScreen
            page={activeScreen}
            currentUser={authenticatedStudent}
            restrictedAdminView={isRestrictedAdmin}
            onNavigate={handleNavigate}
          />
        )}

        {activeScreen === 'school_admin' && (
          <ProtectedRoute
            user={authenticatedStudent}
            screen="school_admin"
            workspaceMode={effectiveWorkspace}
            onFallbackNavigate={handleNavigate}
          >
            <SchoolAdminScreen
              currentUser={authenticatedStudent}
              activeSection={schoolAdminSection}
              onSelectSection={handleSelectSchoolAdminSection}
              previewSchoolId={
                authenticatedStudent.role === 'super_admin'
                  ? superAdminPreviewSchoolId
                  : undefined
              }
              onPreviewSchoolChange={
                authenticatedStudent.role === 'super_admin'
                  ? setSuperAdminPreviewSchoolId
                  : undefined
              }
            />
          </ProtectedRoute>
        )}

        {activeScreen === 'super_admin' && (
          <ProtectedRoute
            user={authenticatedStudent}
            screen="super_admin"
            workspaceMode={effectiveWorkspace}
            onFallbackNavigate={handleNavigate}
          >
            <SuperAdminScreen
              currentUser={authenticatedStudent}
              activeSection={superAdminSection}
              onSelectSection={handleSelectSuperAdminSection}
              settingsTarget={settingsTarget}
              onSelectSettingsTarget={setSettingsTarget}
              onSignedOutReset={handleSignOut}
            />
          </ProtectedRoute>
        )}
      </Suspense>
    </NavigationShell>
    </>
  );
}

type BootPhase = 'splash' | 'reveal' | 'done';

export default function App() {
  // Signed-out visitors get the splash. The app mounts underneath it as the
  // splash starts to fade, so the fade reveals the real first screen.
  const [phase, setPhase] = useState<BootPhase>(() =>
    authService.getActiveSession() === null ? 'splash' : 'done'
  );

  return (
    <>
      {phase !== 'splash' && <AppContent />}
      {phase !== 'done' && (
        <LoadingScreen
          onReveal={() => setPhase((p) => (p === 'splash' ? 'reveal' : p))}
          onComplete={() => setPhase('done')}
        />
      )}
    </>
  );
}
