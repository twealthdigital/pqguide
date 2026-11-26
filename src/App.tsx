import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppScreen,
  PastQuestionDoc,
  StudentAccount,
  StudyMaterial,
  UserRole,
} from './core/types';
import {
  getBackHandlerCount,
  hasBackHandler,
  runTopBackHandler,
  subscribeBackHandlers,
} from './core/navGuard';
import type { AuthView } from './screens/AuthScreen';
import type { PerformanceSubView } from './screens/PerformanceScreen';
import { useArchiveStore } from './hooks/useArchiveStore';
import { archiveRepository } from './services/archiveRepository';
import { authService } from './services/authService';
import { NavigationShell } from './components/ui/NavigationShell';
import { HomeScreenSkeleton } from './components/ui/Skeleton';
import { LoadingScreen } from './screens/LoadingScreen';
import { HomeScreen } from './screens/HomeScreen';
import { STUDY_MATERIALS } from './data/materials';

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
  __pqgGuard?: boolean;
  __pqgOut?: PreAuthScreen;
  __pqgStep?: number;
  __pqgAuthView?: AuthView;
  nav?: NavState;
  perf?: PerfNavState;
  role?: UserRole;
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
  const [authenticatedStudent, setAuthenticatedStudent] = useState<StudentAccount | null>(() =>
    authService.getActiveSession()
  );
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(
    () => authService.hasCompletedOnboarding() || authService.getActiveSession() !== null
  );
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [authView, setAuthView] = useState<AuthView>('signin');
  const [nav, setNav] = useState<NavState>(INITIAL_NAV);
  const [perf, setPerf] = useState<PerfNavState>(INITIAL_PERF);
  const [focusSearchSignal, setFocusSearchSignal] = useState(0);

  const authRef = useRef(authenticatedStudent);
  authRef.current = authenticatedStudent;
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

  const historyIdxRef = useRef(0);
  const skipGuardRef = useRef(false);
  const skipGuardTimerRef = useRef<number | null>(null);
  const ignoreGuardPopRef = useRef(false);
  const guardTimerRef = useRef<number | null>(null);
  const guardActiveRef = useRef(false);
  const enteredAuthFromOnboardingRef = useRef(false);
  const authTrailDepthRef = useRef(0);
  const resetCompletedInAuthRef = useRef(false);

  const activeScreen = nav.screen;
  const selectedDocId = nav.docId;
  const selectedMaterialId = nav.materialId;
  // The screen "Back" would return to; also decides which tab stays highlighted
  // while a paper or guide is open.
  const parentScreen: AppScreen = nav.stack[nav.stack.length - 1]?.screen ?? 'home';

  const unreadCount = useMemo(
    () => store.notifications.filter((n) => !n.isRead).length,
    [store.notifications]
  );

  const selectedDoc = useMemo(
    () => store.documents.find((d) => d.id === selectedDocId) ?? null,
    [store.documents, selectedDocId]
  );

  const selectedMaterial = useMemo(
    () => STUDY_MATERIALS.find((m) => m.id === selectedMaterialId) ?? null,
    [selectedMaterialId]
  );

  const scrollTop = () => window.scrollTo({ top: 0, behavior: 'instant' });

  const buildCurrentState = useCallback((idx: number, guard = false): AppHistoryState => {
    if (!authRef.current) {
      const out: PreAuthScreen = hasCompletedOnboardingRef.current ? 'auth' : 'onboarding';
      return {
        __pqgOut: out,
        ...(out === 'onboarding'
          ? { __pqgStep: onboardingStepRef.current }
          : { __pqgAuthView: authViewRef.current }),
        idx,
        ...(guard ? { __pqgGuard: true } : {}),
      };
    }
    return {
      nav: navRef.current,
      perf: perfRef.current,
      role: archiveRepository.getSnapshot().activeRole,
      idx,
      ...(guard ? { __pqgGuard: true } : {}),
    };
  }, []);

  const pushHistory = useCallback((stateWithoutIdx: Omit<AppHistoryState, 'idx'>, replace = false) => {
    const current = window.history.state as AppHistoryState | null;
    if (replace || current?.__pqgGuard) {
      guardActiveRef.current = false;
      window.history.replaceState(
        { ...stateWithoutIdx, idx: historyIdxRef.current } satisfies AppHistoryState,
        ''
      );
      return;
    }
    historyIdxRef.current += 1;
    guardActiveRef.current = false;
    window.history.pushState(
      { ...stateWithoutIdx, idx: historyIdxRef.current } satisfies AppHistoryState,
      ''
    );
  }, []);

  // Every move to a new screen or Performance sub-view adds a browser-history entry,
  // so the phone's Back button / gesture walks back through the same views.
  const go = useCallback(
    (nextNav: NavState, nextPerf: PerfNavState = INITIAL_PERF, scroll = true) => {
      navRef.current = nextNav;
      perfRef.current = nextPerf;
      setNav(nextNav);
      setPerf(nextPerf);
      pushHistory({
        nav: nextNav,
        perf: nextPerf,
        role: archiveRepository.getSnapshot().activeRole,
      });
      if (scroll) scrollTop();
    },
    [pushHistory]
  );

  // Keep a guard entry armed whenever an overlay/dropdown opens at the root (idx === 0)
  // so pressing hardware/gesture Back closes the overlay instead of exiting the app.
  useEffect(() => {
    const syncRootGuard = () => {
      const count = getBackHandlerCount();
      const st = window.history.state as AppHistoryState | null;
      if (count > 0 && historyIdxRef.current === 0 && !st?.__pqgGuard) {
        historyIdxRef.current = 1;
        guardActiveRef.current = true;
        window.history.pushState(buildCurrentState(1, true), '');
      } else if (count === 0 && st?.__pqgGuard) {
        guardActiveRef.current = false;
        ignoreGuardPopRef.current = true;
        if (guardTimerRef.current !== null) window.clearTimeout(guardTimerRef.current);
        guardTimerRef.current = window.setTimeout(() => {
          ignoreGuardPopRef.current = false;
          guardTimerRef.current = null;
        }, 300);
        window.history.back();
      }
    };
    syncRootGuard();
    return subscribeBackHandlers(syncRootGuard);
  }, [buildCurrentState]);

  useEffect(() => {
    if (authenticatedStudent) {
      const existing = window.history.state as AppHistoryState | null;
      historyIdxRef.current =
        existing && !existing.__pqgOut && !existing.__pqgGuard && typeof existing.idx === 'number'
          ? existing.idx
          : 0;
      guardActiveRef.current = false;
      navRef.current = INITIAL_NAV;
      perfRef.current = INITIAL_PERF;
      setNav(INITIAL_NAV);
      setPerf(INITIAL_PERF);
      window.history.replaceState(
        {
          nav: INITIAL_NAV,
          perf: INITIAL_PERF,
          role: archiveRepository.getSnapshot().activeRole,
          idx: historyIdxRef.current,
        } satisfies AppHistoryState,
        ''
      );
    } else {
      historyIdxRef.current = 0;
      guardActiveRef.current = false;
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
      if (guardTimerRef.current !== null) window.clearTimeout(guardTimerRef.current);
      if (skipGuardTimerRef.current !== null) window.clearTimeout(skipGuardTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const st = event.state as AppHistoryState | null;
      const idx = typeof st?.idx === 'number' ? st.idx : 0;

      if (ignoreGuardPopRef.current) {
        ignoreGuardPopRef.current = false;
        if (guardTimerRef.current !== null) {
          window.clearTimeout(guardTimerRef.current);
          guardTimerRef.current = null;
        }
        guardActiveRef.current = false;
        historyIdxRef.current = idx;
        if (!authRef.current && st?.nav) {
          historyIdxRef.current = 0;
          window.history.replaceState(buildCurrentState(0, false), '');
        }
        return;
      }

      // An open sheet / drawer / menu / dropdown / running exam takes the Back press first:
      // stay on this screen and let it close (or ask to confirm).
      if (skipGuardRef.current) {
        skipGuardRef.current = false;
        if (skipGuardTimerRef.current !== null) {
          window.clearTimeout(skipGuardTimerRef.current);
          skipGuardTimerRef.current = null;
        }
      } else if (hasBackHandler()) {
        const keepRootGuard = guardActiveRef.current;
        historyIdxRef.current = idx + 1;
        window.history.pushState(buildCurrentState(historyIdxRef.current, keepRootGuard), '');
        runTopBackHandler();
        return;
      }

      guardActiveRef.current = Boolean(st?.__pqgGuard);
      historyIdxRef.current = idx;

      if (!authRef.current) {
        if (st?.__pqgOut === 'onboarding') {
          const nextStep = typeof st.__pqgStep === 'number' ? st.__pqgStep : 0;
          authService.setOnboardingCompleted(false);
          hasCompletedOnboardingRef.current = false;
          onboardingStepRef.current = nextStep;
          authTrailDepthRef.current = 0;
          setHasCompletedOnboarding(false);
          setOnboardingStep(nextStep);
          scrollTop();
        } else if (st?.__pqgOut === 'auth') {
          const nextView = st.__pqgAuthView ?? 'signin';
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
          scrollTop();
        } else if (st?.nav) {
          // Stale signed-in entry reached after sign-out: keep user on signed-out screen.
          historyIdxRef.current = 0;
          window.history.replaceState(buildCurrentState(0, false), '');
        }
        return;
      }

      if (st?.__pqgOut) {
        // Stale pre-auth entry popped while signed in: keep user cleanly at Home.
        historyIdxRef.current = 0;
        navRef.current = INITIAL_NAV;
        perfRef.current = INITIAL_PERF;
        setNav(INITIAL_NAV);
        setPerf(INITIAL_PERF);
        window.history.replaceState(
          {
            nav: INITIAL_NAV,
            perf: INITIAL_PERF,
            role: archiveRepository.getSnapshot().activeRole,
            idx: 0,
          } satisfies AppHistoryState,
          ''
        );
        scrollTop();
        return;
      }

      if (st?.role && st.role !== archiveRepository.getSnapshot().activeRole) {
        archiveRepository.setActiveRole(st.role);
      }

      const nextNav = st?.nav ?? INITIAL_NAV;
      const nextPerf = st?.perf ?? INITIAL_PERF;
      navRef.current = nextNav;
      perfRef.current = nextPerf;
      setNav(nextNav);
      setPerf(nextPerf);
      scrollTop();
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [buildCurrentState]);

  const popBypassingGuard = useCallback(() => {
    skipGuardRef.current = true;
    if (skipGuardTimerRef.current !== null) window.clearTimeout(skipGuardTimerRef.current);
    skipGuardTimerRef.current = window.setTimeout(() => {
      skipGuardRef.current = false;
      skipGuardTimerRef.current = null;
    }, 600);
    window.history.back();
  }, []);

  // Tabs reset the trail. Alerts (opened from the bell) and Practice Exam remember where you were.
  const handleNavigate = useCallback(
    (screen: AppScreen) => {
      const prev = navRef.current;
      if (prev.screen === screen) {
        if (screen === 'performance' && perfRef.current.view !== 'list') {
          go(prev, INITIAL_PERF);
          return;
        }
        const st = window.history.state as AppHistoryState | null;
        const currentRole = archiveRepository.getSnapshot().activeRole;
        if (st && !st.__pqgOut && st.role !== currentRole) {
          window.history.replaceState({ ...st, role: currentRole } satisfies AppHistoryState, '');
        }
        return;
      }
      const remember = screen === 'notifications' || screen === 'mock_exam';
      go(
        { ...prev, screen, stack: remember ? [...prev.stack, entryOf(prev)] : [] },
        INITIAL_PERF
      );
    },
    [go]
  );

  // Back goes to exactly where the person came from (home if there is no trail).
  const handleBack = useCallback(() => {
    if (historyIdxRef.current > 0) {
      popBypassingGuard();
      return;
    }
    const prev = navRef.current;
    const last = prev.stack[prev.stack.length - 1];
    const next: NavState = last
      ? { ...last, stack: prev.stack.slice(0, -1) }
      : { ...INITIAL_NAV, docId: prev.docId, materialId: prev.materialId };
    navRef.current = next;
    perfRef.current = INITIAL_PERF;
    setNav(next);
    setPerf(INITIAL_PERF);
    scrollTop();
  }, [popBypassingGuard]);

  const handleOpenDocument = useCallback(
    (doc: PastQuestionDoc) => {
      archiveRepository.incrementView(doc.id);
      archiveRepository.recordRecent(doc.id);
      const prev = navRef.current;
      go({
        screen: 'reader',
        docId: doc.id,
        materialId: prev.materialId,
        stack: [...prev.stack, entryOf(prev)],
      });
    },
    [go]
  );

  const handleOpenMaterial = useCallback(
    (material: StudyMaterial) => {
      const prev = navRef.current;
      go({
        screen: 'material_reader',
        docId: prev.docId,
        materialId: material.id,
        stack: [...prev.stack, entryOf(prev)],
      });
    },
    [go]
  );

  const handleQuickFind = useCallback(() => {
    const prev = navRef.current;
    if (prev.screen !== 'home') {
      go({ ...prev, screen: 'home', stack: [] }, INITIAL_PERF, false);
    }
    setFocusSearchSignal((n) => n + 1);
  }, [go]);

  const handleExamSubmitted = useCallback(() => {
    // Replace the mock_exam entry so pressing Back from Performance returns
    // to where the exam was opened from, never back into the submitted exam.
    const nextNav: NavState = { ...navRef.current, screen: 'performance', stack: [] };
    navRef.current = nextNav;
    perfRef.current = INITIAL_PERF;
    setNav(nextNav);
    setPerf(INITIAL_PERF);
    pushHistory(
      {
        nav: nextNav,
        perf: INITIAL_PERF,
        role: archiveRepository.getSnapshot().activeRole,
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
    if (historyIdxRef.current > 0) {
      popBypassingGuard();
      return;
    }
    perfRef.current = INITIAL_PERF;
    setPerf(INITIAL_PERF);
    scrollTop();
  }, [popBypassingGuard]);

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
    if (historyIdxRef.current > 0) {
      popBypassingGuard();
      return;
    }
    const nextStep = Math.max(0, onboardingStepRef.current - 1);
    onboardingStepRef.current = nextStep;
    setOnboardingStep(nextStep);
    pushHistory({ __pqgOut: 'onboarding', __pqgStep: nextStep }, true);
    scrollTop();
  }, [popBypassingGuard, pushHistory]);

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
      if (authTrailDepthRef.current > 0 && historyIdxRef.current > 0) {
        authTrailDepthRef.current -= 1;
        popBypassingGuard();
        return;
      }
      authTrailDepthRef.current = 0;
      authViewRef.current = fallbackView;
      setAuthView(fallbackView);
      pushHistory({ __pqgOut: 'auth', __pqgAuthView: fallbackView }, true);
      scrollTop();
    },
    [popBypassingGuard, pushHistory]
  );

  const handleBackToOnboarding = useCallback(() => {
    if (
      enteredAuthFromOnboardingRef.current &&
      authTrailDepthRef.current === 0 &&
      !resetCompletedInAuthRef.current &&
      historyIdxRef.current > 0
    ) {
      popBypassingGuard();
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
  }, [popBypassingGuard, pushHistory]);

  const handleSignOut = useCallback(() => {
    authService.clearActiveSession();
    setAuthenticatedStudent(null);
    navRef.current = INITIAL_NAV;
    perfRef.current = INITIAL_PERF;
    setNav(INITIAL_NAV);
    setPerf(INITIAL_PERF);
  }, []);

  if (!hasCompletedOnboarding) {
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
          view={authView}
          onViewChange={handleAuthViewChange}
          onAuthBack={handleAuthBack}
          onAuthenticated={(account) => {
            authService.saveActiveSession(account);
            setAuthenticatedStudent(account);
          }}
          onBackToOnboarding={handleBackToOnboarding}
        />
      </Suspense>
    );
  }

  return (
    <NavigationShell
      activeScreen={activeScreen}
      parentScreen={parentScreen}
      onNavigate={handleNavigate}
      onQuickFind={handleQuickFind}
      unreadCount={unreadCount}
      activeRole={store.activeRole}
      onRoleChange={(role) => archiveRepository.setActiveRole(role)}
      student={authenticatedStudent}
      onSignOut={handleSignOut}
    >
      <Suspense fallback={<HomeScreenSkeleton />}>
        {activeScreen === 'home' && (
          <HomeScreen
            onOpenDocument={handleOpenDocument}
            focusSearchSignal={focusSearchSignal}
          />
        )}

        {activeScreen === 'reader' && (
          <PastQuestionReaderScreen
            doc={selectedDoc}
            onBack={handleBack}
          />
        )}

        {activeScreen === 'past_questions' && (
          <PastQuestionsScreen onOpenDocument={handleOpenDocument} />
        )}

        {activeScreen === 'notifications' && (
          <NotificationsScreen
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
          />
        )}

        {activeScreen === 'mock_exam' && (
          <MockExamScreen
            onBack={handleBack}
            onSubmitted={handleExamSubmitted}
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
          <InfoScreen page={activeScreen} onNavigate={handleNavigate} />
        )}

        {activeScreen === 'school_admin' && <SchoolAdminScreen />}

        {activeScreen === 'super_admin' && <SuperAdminScreen />}
      </Suspense>
    </NavigationShell>
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
