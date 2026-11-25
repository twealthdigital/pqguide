import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppScreen, PastQuestionDoc, StudentAccount, StudyMaterial } from './core/types';
import { hasBackHandler, runTopBackHandler } from './core/navGuard';
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
  const [nav, setNav] = useState<NavState>(INITIAL_NAV);
  const [perf, setPerf] = useState<PerfNavState>(INITIAL_PERF);
  const [focusSearchSignal, setFocusSearchSignal] = useState(0);

  const authRef = useRef(authenticatedStudent);
  authRef.current = authenticatedStudent;
  const navRef = useRef<NavState>(nav);
  navRef.current = nav;
  const perfRef = useRef<PerfNavState>(perf);
  perfRef.current = perf;
  const historyIdxRef = useRef(0);
  const skipGuardRef = useRef(false);

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

  // Every move to a new screen or Performance sub-view adds a browser-history entry,
  // so the phone's Back button / gesture walks back through the same views.
  const go = useCallback(
    (nextNav: NavState, nextPerf: PerfNavState = INITIAL_PERF, scroll = true) => {
      navRef.current = nextNav;
      perfRef.current = nextPerf;
      setNav(nextNav);
      setPerf(nextPerf);
      historyIdxRef.current += 1;
      window.history.pushState(
        { nav: nextNav, perf: nextPerf, idx: historyIdxRef.current },
        ''
      );
      if (scroll) scrollTop();
    },
    []
  );

  useEffect(() => {
    if (authenticatedStudent) {
      const existing = window.history.state as { idx?: number; __pqgOut?: string } | null;
      historyIdxRef.current =
        existing && !existing.__pqgOut && typeof existing.idx === 'number' ? existing.idx : 0;
      navRef.current = INITIAL_NAV;
      perfRef.current = INITIAL_PERF;
      setNav(INITIAL_NAV);
      setPerf(INITIAL_PERF);
      window.history.replaceState(
        { nav: INITIAL_NAV, perf: INITIAL_PERF, idx: historyIdxRef.current },
        ''
      );
    } else {
      window.history.replaceState(
        { __pqgOut: hasCompletedOnboarding ? 'auth' : 'onboarding', idx: 0 },
        ''
      );
    }
    // Reset baseline history state cleanly at sign-in / sign-out transitions
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticatedStudent]);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const st = event.state as {
        __pqgOut?: 'onboarding' | 'auth';
        nav?: NavState;
        perf?: PerfNavState;
        idx?: number;
      } | null;

      if (!authRef.current) {
        if (st?.__pqgOut === 'onboarding') {
          authService.setOnboardingCompleted(false);
          setHasCompletedOnboarding(false);
        } else if (st?.__pqgOut === 'auth') {
          authService.setOnboardingCompleted(true);
          setHasCompletedOnboarding(true);
        }
        return;
      }

      const idx = typeof st?.idx === 'number' ? st.idx : 0;

      // An open sheet / drawer / menu / running exam takes the Back press first:
      // stay on this screen and let it close (or ask to confirm).
      if (skipGuardRef.current) {
        skipGuardRef.current = false;
      } else if (hasBackHandler()) {
        historyIdxRef.current = idx + 1;
        window.history.pushState(
          { nav: navRef.current, perf: perfRef.current, idx: historyIdxRef.current },
          ''
        );
        runTopBackHandler();
        return;
      }

      historyIdxRef.current = idx;
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
  }, []);

  // Tabs reset the trail. Alerts (opened from the bell) and Practice Exam remember where you were.
  const handleNavigate = useCallback(
    (screen: AppScreen) => {
      const prev = navRef.current;
      if (prev.screen === screen) {
        if (screen === 'performance' && perfRef.current.view !== 'list') {
          go(prev, INITIAL_PERF);
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
      skipGuardRef.current = true;
      window.setTimeout(() => {
        skipGuardRef.current = false;
      }, 600);
      window.history.back();
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
  }, []);

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
    window.history.replaceState(
      { nav: nextNav, perf: INITIAL_PERF, idx: historyIdxRef.current },
      ''
    );
    scrollTop();
  }, []);

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
      window.history.back();
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
          onComplete={() => {
            authService.setOnboardingCompleted(true);
            setHasCompletedOnboarding(true);
            window.history.pushState({ __pqgOut: 'auth', idx: 1 }, '');
          }}
        />
      </Suspense>
    );
  }

  if (!authenticatedStudent) {
    return (
      <Suspense fallback={<div className="min-h-screen bg-[#F6F7F9]" />}>
        <AuthScreen
          onAuthenticated={(account) => {
            authService.saveActiveSession(account);
            setAuthenticatedStudent(account);
          }}
          onBackToOnboarding={() => {
            const st = window.history.state as { __pqgOut?: string; __pqgAuthView?: string } | null;
            if (st?.__pqgOut === 'auth' && (!st.__pqgAuthView || st.__pqgAuthView === 'signin')) {
              window.history.back();
            } else {
              authService.setOnboardingCompleted(false);
              setHasCompletedOnboarding(false);
            }
          }}
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
